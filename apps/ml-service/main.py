"""
SIMES ML Service — LightGBM energy consumption forecasting.
Provides /train and /predict endpoints consumed by api-core.
"""

import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

import numpy as np
import pandas as pd
import lightgbm as lgb
import joblib
import psycopg2
from psycopg2.extras import RealDictCursor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ml-service")

# ─── Config ───────────────────────────────────────────────────
TELEMETRY_DB = {
    "host": os.getenv("TELEMETRY_DB_HOST", "telemetry-db"),
    "port": int(os.getenv("TELEMETRY_DB_PORT", "5432")),
    "dbname": os.getenv("TELEMETRY_DB_NAME", "simes_telemetry"),
    "user": os.getenv("TELEMETRY_DB_USER", "simes"),
    "password": os.getenv("TELEMETRY_DB_PASSWORD", "simes"),
}

MODEL_DIR = os.getenv("MODEL_DIR", "/data/models")
os.makedirs(MODEL_DIR, exist_ok=True)

# In-memory model cache: terrain_id → {model, model_lower, model_upper, metadata}
model_cache: dict = {}


# ─── DB helpers ───────────────────────────────────────────────
def get_conn():
    return psycopg2.connect(**TELEMETRY_DB, cursor_factory=RealDictCursor)


def fetch_daily_features(terrain_id: str) -> pd.DataFrame:
    """Extract daily aggregated data with lag/rolling features.
    Uses acrel_agg_daily (pre-computed) first; falls back to raw acrel_readings."""

    # Try pre-aggregated table first (fast)
    agg_query = """
    SELECT
        day,
        point_id,
        active_power_avg  AS power_avg,
        active_power_max  AS power_max,
        energy_total_delta AS energy_delta,
        EXTRACT(DOW FROM day)::int AS day_of_week,
        EXTRACT(MONTH FROM day)::int AS month,
        EXTRACT(WEEK FROM day)::int AS week_of_year,
        CASE WHEN EXTRACT(DOW FROM day) IN (0, 6) THEN 1 ELSE 0 END AS is_weekend,
        LAG(energy_total_delta, 1)  OVER w AS lag_1d,
        LAG(energy_total_delta, 7)  OVER w AS lag_7d,
        LAG(energy_total_delta, 14) OVER w AS lag_14d,
        AVG(energy_total_delta)   OVER (PARTITION BY point_id ORDER BY day ROWS BETWEEN 6  PRECEDING AND CURRENT ROW) AS rolling_avg_7d,
        AVG(energy_total_delta)   OVER (PARTITION BY point_id ORDER BY day ROWS BETWEEN 29 PRECEDING AND CURRENT ROW) AS rolling_avg_30d,
        STDDEV(energy_total_delta) OVER (PARTITION BY point_id ORDER BY day ROWS BETWEEN 6  PRECEDING AND CURRENT ROW) AS rolling_std_7d
    FROM acrel_agg_daily
    WHERE terrain_id = %s
      AND day > NOW() - INTERVAL '365 days'
    WINDOW w AS (PARTITION BY point_id ORDER BY day)
    ORDER BY point_id, day;
    """

    # Fallback: compute from raw readings (slower)
    raw_query = """
    WITH daily AS (
        SELECT
            time_bucket('1 day', time) AS day,
            point_id,
            AVG(active_power_total)  AS power_avg,
            MAX(active_power_total)  AS power_max,
            MAX(energy_total) - MIN(energy_total) AS energy_delta
        FROM acrel_readings
        WHERE terrain_id = %s
          AND active_power_total IS NOT NULL
          AND time > NOW() - INTERVAL '365 days'
        GROUP BY 1, 2
        ORDER BY point_id, day
    )
    SELECT
        day, point_id, power_avg, power_max, energy_delta,
        EXTRACT(DOW FROM day)::int AS day_of_week,
        EXTRACT(MONTH FROM day)::int AS month,
        EXTRACT(WEEK FROM day)::int AS week_of_year,
        CASE WHEN EXTRACT(DOW FROM day) IN (0, 6) THEN 1 ELSE 0 END AS is_weekend,
        LAG(energy_delta, 1)  OVER w AS lag_1d,
        LAG(energy_delta, 7)  OVER w AS lag_7d,
        LAG(energy_delta, 14) OVER w AS lag_14d,
        AVG(energy_delta) OVER (PARTITION BY point_id ORDER BY day ROWS BETWEEN 6  PRECEDING AND CURRENT ROW) AS rolling_avg_7d,
        AVG(energy_delta) OVER (PARTITION BY point_id ORDER BY day ROWS BETWEEN 29 PRECEDING AND CURRENT ROW) AS rolling_avg_30d,
        STDDEV(energy_delta) OVER (PARTITION BY point_id ORDER BY day ROWS BETWEEN 6  PRECEDING AND CURRENT ROW) AS rolling_std_7d
    FROM daily
    WINDOW w AS (PARTITION BY point_id ORDER BY day)
    ORDER BY point_id, day;
    """

    with get_conn() as conn:
        df = pd.read_sql(agg_query, conn, params=(terrain_id,))
        if df.empty:
            logger.info(f"acrel_agg_daily empty for {terrain_id}, falling back to raw readings")
            df = pd.read_sql(raw_query, conn, params=(terrain_id,))
    return df


def fetch_daily_simple(terrain_id: str) -> pd.DataFrame:
    """Fetch basic daily energy data (no lag features) for simple forecasting."""
    query = """
    SELECT day, SUM(energy_total_delta) AS energy_delta,
           SUM(active_power_avg) AS power_avg,
           EXTRACT(DOW FROM day)::int AS day_of_week
    FROM acrel_agg_daily
    WHERE terrain_id = %s AND day > NOW() - INTERVAL '365 days'
    GROUP BY day
    ORDER BY day;
    """
    raw_fallback = """
    SELECT
        time_bucket('1 day', time)::date AS day,
        SUM(MAX(energy_total) - MIN(energy_total)) AS energy_delta,
        AVG(active_power_total) AS power_avg,
        EXTRACT(DOW FROM time_bucket('1 day', time))::int AS day_of_week
    FROM acrel_readings
    WHERE terrain_id = %s AND active_power_total IS NOT NULL
      AND time > NOW() - INTERVAL '365 days'
    GROUP BY 1
    ORDER BY 1;
    """
    with get_conn() as conn:
        df = pd.read_sql(query, conn, params=(terrain_id,))
        if df.empty:
            df = pd.read_sql(raw_fallback, conn, params=(terrain_id,))
    return df


FEATURE_COLS = [
    "day_of_week", "month", "week_of_year", "is_weekend",
    "lag_1d", "lag_7d", "lag_14d",
    "rolling_avg_7d", "rolling_avg_30d", "rolling_std_7d",
    "power_max",
]

TARGET_COL = "energy_delta"


# ─── Prediction storage ──────────────────────────────────────
def store_predictions(terrain_id: str, forecast: list, model_type: str):
    """Store forecast predictions in ml_predictions table for later comparison."""
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                for fd in forecast:
                    # Parse dd/mm day format back to a full date
                    from datetime import datetime
                    day_parts = fd.day.split("/")
                    year = datetime.now().year
                    predicted_day = f"{year}-{day_parts[1]}-{day_parts[0]}"
                    cur.execute("""
                        INSERT INTO ml_predictions
                          (terrain_id, model_type, predicted_day, predicted_kwh, lower_bound, upper_bound)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (terrain_id, model_type, predicted_day)
                        DO UPDATE SET predicted_kwh = EXCLUDED.predicted_kwh,
                                      lower_bound  = EXCLUDED.lower_bound,
                                      upper_bound  = EXCLUDED.upper_bound,
                                      created_at   = NOW()
                    """, (terrain_id, model_type, predicted_day, fd.predicted_kwh, fd.lower, fd.upper))
            conn.commit()
        logger.info(f"Stored {len(forecast)} predictions for terrain {terrain_id}")
    except Exception as e:
        logger.error(f"Failed to store predictions for {terrain_id}: {e}")


# ─── Train ────────────────────────────────────────────────────
class TrainRequest(BaseModel):
    terrain_id: str


class TrainResponse(BaseModel):
    terrain_id: str
    status: str
    samples: int = 0
    mape: float | None = None
    rmse: float | None = None
    message: str = ""


def train_model(terrain_id: str) -> TrainResponse:
    df = fetch_daily_features(terrain_id)
    if df.empty or len(df) < 30:
        return TrainResponse(
            terrain_id=terrain_id,
            status="insufficient_data",
            samples=len(df),
            message=f"Need >= 30 daily samples, got {len(df)}",
        )

    # Aggregate across points (sum by day)
    agg = df.groupby("day").agg({
        TARGET_COL: "sum",
        "power_avg": "sum",
        "power_max": "sum",
        "day_of_week": "first",
        "month": "first",
        "week_of_year": "first",
        "is_weekend": "first",
        "lag_1d": "sum",
        "lag_7d": "sum",
        "lag_14d": "sum",
        "rolling_avg_7d": "sum",
        "rolling_avg_30d": "sum",
        "rolling_std_7d": "sum",
    }).reset_index().sort_values("day")

    # Drop rows with nulls in features (early rows lack lags)
    agg = agg.dropna(subset=FEATURE_COLS + [TARGET_COL])
    if len(agg) < 20:
        return TrainResponse(
            terrain_id=terrain_id,
            status="insufficient_data",
            samples=len(agg),
            message=f"After dropping nulls, only {len(agg)} samples remain",
        )

    # Train / validation split (last 20%)
    split_idx = int(len(agg) * 0.8)
    train_df = agg.iloc[:split_idx]
    valid_df = agg.iloc[split_idx:]

    X_train = train_df[FEATURE_COLS].values
    y_train = train_df[TARGET_COL].values
    X_valid = valid_df[FEATURE_COLS].values
    y_valid = valid_df[TARGET_COL].values

    params = {
        "objective": "regression",
        "metric": "mae",
        "boosting_type": "gbdt",
        "num_leaves": 31,
        "learning_rate": 0.05,
        "feature_fraction": 0.8,
        "bagging_fraction": 0.8,
        "bagging_freq": 5,
        "verbose": -1,
    }

    train_data = lgb.Dataset(X_train, label=y_train)
    valid_data = lgb.Dataset(X_valid, label=y_valid, reference=train_data)

    model = lgb.train(
        params,
        train_data,
        num_boost_round=500,
        valid_sets=[valid_data],
        callbacks=[lgb.early_stopping(50), lgb.log_evaluation(100)],
    )

    # Quantile models for confidence bands
    params_lower = {**params, "objective": "quantile", "alpha": 0.1}
    params_upper = {**params, "objective": "quantile", "alpha": 0.9}
    model_lower = lgb.train(params_lower, train_data, num_boost_round=300)
    model_upper = lgb.train(params_upper, train_data, num_boost_round=300)

    # Evaluate
    preds = model.predict(X_valid)
    mape = float(np.mean(np.abs((y_valid - preds) / np.maximum(y_valid, 1e-6))) * 100)
    rmse = float(np.sqrt(np.mean((y_valid - preds) ** 2)))

    # Save
    model_path = os.path.join(MODEL_DIR, f"terrain_{terrain_id}.pkl")
    joblib.dump({
        "model": model,
        "model_lower": model_lower,
        "model_upper": model_upper,
        "mape": mape,
        "rmse": rmse,
        "samples": len(agg),
        "last_row": agg.iloc[-1].to_dict(),
    }, model_path)

    # Cache
    model_cache[terrain_id] = joblib.load(model_path)

    logger.info(f"Trained model for terrain {terrain_id}: MAPE={mape:.2f}%, RMSE={rmse:.2f}")
    return TrainResponse(
        terrain_id=terrain_id,
        status="success",
        samples=len(agg),
        mape=round(mape, 2),
        rmse=round(rmse, 2),
        message=f"Model trained on {len(agg)} days",
    )


# ─── Predict ─────────────────────────────────────────────────
class PredictRequest(BaseModel):
    terrain_id: str
    days: int = Field(default=7, ge=1, le=30)


class ForecastDay(BaseModel):
    day: str
    predicted_kwh: float
    lower: float
    upper: float


class PredictResponse(BaseModel):
    terrain_id: str
    forecast: list[ForecastDay]
    model_mape: float | None = None
    model_rmse: float | None = None
    model_type: str = "lightgbm"  # "lightgbm" | "simple" | "naive"


def get_model(terrain_id: str):
    if terrain_id in model_cache:
        return model_cache[terrain_id]
    model_path = os.path.join(MODEL_DIR, f"terrain_{terrain_id}.pkl")
    if os.path.exists(model_path):
        model_cache[terrain_id] = joblib.load(model_path)
        return model_cache[terrain_id]
    return None


def simple_forecast(terrain_id: str, days: int) -> PredictResponse | None:
    """Day-of-week-average forecast for terrains with 3-29 days of data."""
    from datetime import datetime, timedelta

    df = fetch_daily_simple(terrain_id)
    if df.empty or len(df) < 3:
        return None

    # Day-of-week profiles
    dow_avg = df.groupby("day_of_week")["energy_delta"].mean().to_dict()
    global_avg = float(df["energy_delta"].mean())
    global_std = float(df["energy_delta"].std()) if len(df) > 1 else global_avg * 0.3

    # Linear trend
    n = len(df)
    slope = 0.0
    if n >= 3:
        x = np.arange(n, dtype=float)
        y = df["energy_delta"].values.astype(float)
        x_mean, y_mean = x.mean(), y.mean()
        denom = ((x - x_mean) ** 2).sum()
        if denom > 0:
            slope = float(((x - x_mean) * (y - y_mean)).sum() / denom)

    today = datetime.now()
    forecast: list[ForecastDay] = []
    for i in range(1, days + 1):
        future = today + timedelta(days=i)
        dow = future.weekday()  # 0=Mon Python
        # PG DOW: 0=Sun. Convert: Python Mon=0..Sun=6 → PG Sun=0,Mon=1..Sat=6
        pg_dow = (dow + 1) % 7
        base = dow_avg.get(pg_dow, global_avg)
        pred = max(0.0, base + slope * i)
        band = global_std * 1.2 * np.sqrt(1 + i / max(n, 1))
        forecast.append(ForecastDay(
            day=future.strftime("%d/%m"),
            predicted_kwh=round(pred, 2),
            lower=round(max(0.0, pred - band), 2),
            upper=round(pred + band, 2),
        ))

    logger.info(f"Simple forecast for terrain {terrain_id}: {len(df)} days of data, {days} days predicted")
    result = PredictResponse(
        terrain_id=terrain_id,
        forecast=forecast,
        model_mape=None,
        model_rmse=None,
        model_type="simple",
    )
    store_predictions(terrain_id, forecast, "simple")
    return result


def predict_forecast(terrain_id: str, days: int) -> PredictResponse:
    bundle = get_model(terrain_id)
    if bundle is None:
        # Auto-train on first prediction request
        logger.info(f"No model for terrain {terrain_id} — auto-training…")
        result = train_model(terrain_id)
        if result.status != "success":
            # Fall back to simple day-of-week forecast
            simple = simple_forecast(terrain_id, days)
            if simple is not None:
                return simple
            raise HTTPException(
                status_code=422,
                detail=f"Not enough data for any forecast: {result.message}",
            )
        bundle = get_model(terrain_id)
        if bundle is None:
            raise HTTPException(status_code=500, detail="Training succeeded but model not loadable")

    model = bundle["model"]
    model_lower = bundle["model_lower"]
    model_upper = bundle["model_upper"]
    last_row = bundle["last_row"]

    forecast: list[ForecastDay] = []
    # Build iterative forecast using last known values
    lag_1d = last_row.get("energy_delta", 0) or 0
    lag_7d = last_row.get("lag_7d", lag_1d) or lag_1d
    lag_14d = last_row.get("lag_14d", lag_1d) or lag_1d
    rolling_avg_7d = last_row.get("rolling_avg_7d", lag_1d) or lag_1d
    rolling_avg_30d = last_row.get("rolling_avg_30d", lag_1d) or lag_1d
    rolling_std_7d = last_row.get("rolling_std_7d", 0) or 0
    power_max = last_row.get("power_max", 0) or 0

    from datetime import datetime, timedelta
    today = datetime.now()

    for i in range(1, days + 1):
        future = today + timedelta(days=i)
        features = np.array([[
            future.weekday(),  # day_of_week (0=Mon in Python vs 0=Sun in PG, close enough)
            future.month,
            future.isocalendar()[1],
            1 if future.weekday() >= 5 else 0,
            lag_1d,
            lag_7d,
            lag_14d,
            rolling_avg_7d,
            rolling_avg_30d,
            rolling_std_7d,
            power_max,
        ]])

        pred = float(max(0, model.predict(features)[0]))
        lower = float(max(0, model_lower.predict(features)[0]))
        upper = float(max(0, model_upper.predict(features)[0]))

        forecast.append(ForecastDay(
            day=future.strftime("%d/%m"),
            predicted_kwh=round(pred, 2),
            lower=round(lower, 2),
            upper=round(upper, 2),
        ))

        # Update lags for next iteration
        lag_14d = lag_7d
        lag_7d = lag_1d
        lag_1d = pred
        rolling_avg_7d = rolling_avg_7d * 0.85 + pred * 0.15  # approximate

    result = PredictResponse(
        terrain_id=terrain_id,
        forecast=forecast,
        model_mape=bundle.get("mape"),
        model_rmse=bundle.get("rmse"),
        model_type="lightgbm",
    )
    store_predictions(terrain_id, forecast, "lightgbm")
    return result


# ─── FastAPI app ──────────────────────────────────────────────
@asynccontextmanager
async def lifespan(application: FastAPI):
    logger.info("ML Service started")
    yield
    logger.info("ML Service shutting down")

app = FastAPI(title="SIMES ML Service", version="1.0.0", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "models_cached": len(model_cache)}


@app.post("/train", response_model=TrainResponse)
def train(req: TrainRequest):
    return train_model(req.terrain_id)


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    return predict_forecast(req.terrain_id, req.days)


@app.get("/models/{terrain_id}/status")
def model_status(terrain_id: str):
    bundle = get_model(terrain_id)
    if bundle is None:
        return {"terrain_id": terrain_id, "status": "not_trained"}
    return {
        "terrain_id": terrain_id,
        "status": "ready",
        "mape": bundle.get("mape"),
        "rmse": bundle.get("rmse"),
        "samples": bundle.get("samples"),
    }


@app.post("/train-all")
def train_all():
    """Train models for all terrains that have enough data."""
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT DISTINCT terrain_id FROM acrel_readings WHERE terrain_id IS NOT NULL")
                terrain_ids = [row["terrain_id"] for row in cur.fetchall()]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")

    results = []
    for tid in terrain_ids:
        try:
            r = train_model(str(tid))
            results.append({"terrain_id": str(tid), "status": r.status, "samples": r.samples, "message": r.message})
        except Exception as e:
            results.append({"terrain_id": str(tid), "status": "error", "message": str(e)})
    return {"trained": len([r for r in results if r["status"] == "success"]), "total": len(terrain_ids), "results": results}


@app.get("/predictions/{terrain_id}")
def get_predictions(terrain_id: str):
    """Return stored predictions with actual values backfilled from acrel_agg_daily."""
    try:
        with get_conn() as conn:
            # Backfill actual_kwh for past prediction days
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE ml_predictions p
                    SET actual_kwh = sub.actual,
                        error_pct = CASE WHEN p.predicted_kwh > 0
                            THEN ROUND(ABS(sub.actual - p.predicted_kwh) / p.predicted_kwh * 100, 2)
                            ELSE NULL END
                    FROM (
                        SELECT terrain_id, day, SUM(energy_total_delta) AS actual
                        FROM acrel_agg_daily
                        WHERE terrain_id = %s
                        GROUP BY terrain_id, day
                    ) sub
                    WHERE p.terrain_id = sub.terrain_id
                      AND p.predicted_day = sub.day
                      AND p.actual_kwh IS NULL
                """, (terrain_id,))
                conn.commit()

            df = pd.read_sql("""
                SELECT predicted_day, model_type, predicted_kwh, lower_bound, upper_bound,
                       actual_kwh, error_pct, created_at
                FROM ml_predictions
                WHERE terrain_id = %s
                ORDER BY predicted_day DESC
                LIMIT 90
            """, conn, params=(terrain_id,))
        return {"terrain_id": terrain_id, "predictions": df.to_dict(orient="records")}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")


# ─── Anomaly Detection ──────────────────────────────────────

@app.post("/anomalies/detect/{terrain_id}")
def detect_anomalies(terrain_id: str):
    """Run anomaly detection for a terrain using two methods:
    1. Residual analysis: compare actual vs predicted energy with adaptive thresholds
    2. Isolation Forest: multivariate anomaly detection on daily features
    """
    results = []

    try:
        with get_conn() as conn:
            # 1) Residual-based detection (requires predictions + actuals)
            residual_df = pd.read_sql("""
                SELECT p.predicted_day, p.predicted_kwh, p.lower_bound, p.upper_bound,
                       COALESCE(p.actual_kwh, (
                           SELECT SUM(energy_total_delta) FROM acrel_agg_daily
                           WHERE terrain_id = %s AND day = p.predicted_day
                       )) AS actual_kwh
                FROM ml_predictions p
                WHERE p.terrain_id = %s AND p.model_type = 'lightgbm'
                ORDER BY p.predicted_day DESC
                LIMIT 90
            """, conn, params=(terrain_id, terrain_id))

            if len(residual_df) > 0 and residual_df["actual_kwh"].notna().sum() > 5:
                residual_df = residual_df.dropna(subset=["actual_kwh"])
                residual_df["residual"] = residual_df["actual_kwh"] - residual_df["predicted_kwh"]
                residual_df["abs_residual"] = residual_df["residual"].abs()

                # Adaptive thresholds: mean ± 2*std of residuals
                mu = residual_df["residual"].mean()
                sigma = residual_df["residual"].std()
                if sigma > 0:
                    upper_thresh = mu + 2 * sigma
                    lower_thresh = mu - 2 * sigma

                    for _, row in residual_df.iterrows():
                        r = row["residual"]
                        if r > upper_thresh or r < lower_thresh:
                            z_score = abs((r - mu) / sigma)
                            severity = "critical" if z_score > 3 else "high" if z_score > 2.5 else "medium"
                            deviation = round(abs(r) / max(row["predicted_kwh"], 0.01) * 100, 1)
                            results.append({
                                "anomaly_type": "residual",
                                "anomaly_date": str(row["predicted_day"]),
                                "severity": severity,
                                "score": round(z_score, 2),
                                "expected_kwh": round(float(row["predicted_kwh"]), 2),
                                "actual_kwh": round(float(row["actual_kwh"]), 2),
                                "deviation_pct": deviation,
                                "description": f"Résidu {'+' if r > 0 else ''}{r:.1f} kWh ({deviation}% écart) — z={z_score:.1f}σ",
                            })

            # 2) Isolation Forest on daily features
            features_df = fetch_daily_features(terrain_id)
            if len(features_df) >= 14:
                from sklearn.ensemble import IsolationForest

                feat_cols = [c for c in features_df.columns if c not in ("day", "energy_delta")]
                X = features_df[feat_cols].fillna(0).values

                iso = IsolationForest(contamination=0.1, random_state=42, n_estimators=100)
                features_df["iso_score"] = iso.fit_predict(X)
                features_df["iso_anomaly_score"] = iso.decision_function(X)

                anomalies = features_df[features_df["iso_score"] == -1]
                for _, row in anomalies.iterrows():
                    a_score = abs(float(row["iso_anomaly_score"]))
                    severity = "high" if a_score > 0.15 else "medium" if a_score > 0.1 else "low"
                    results.append({
                        "anomaly_type": "isolation_forest",
                        "anomaly_date": str(row["day"]),
                        "severity": severity,
                        "score": round(a_score, 3),
                        "expected_kwh": None,
                        "actual_kwh": round(float(row["energy_delta"]), 2) if pd.notna(row["energy_delta"]) else None,
                        "deviation_pct": None,
                        "description": f"Anomalie multivariée détectée (score={a_score:.3f})",
                    })

            # Store results in DB
            if results:
                with conn.cursor() as cur:
                    for a in results:
                        cur.execute("""
                            INSERT INTO energy_anomalies
                                (terrain_id, anomaly_date, anomaly_type, severity, score,
                                 expected_kwh, actual_kwh, deviation_pct, description)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                            ON CONFLICT DO NOTHING
                        """, (terrain_id, a["anomaly_date"], a["anomaly_type"],
                              a["severity"], a["score"], a["expected_kwh"],
                              a["actual_kwh"], a["deviation_pct"], a["description"]))
                    conn.commit()

        return {
            "terrain_id": terrain_id,
            "anomalies_found": len(results),
            "anomalies": sorted(results, key=lambda x: x["anomaly_date"], reverse=True),
        }
    except Exception as e:
        logger.error(f"Anomaly detection error: {e}")
        raise HTTPException(status_code=500, detail=f"Anomaly detection failed: {e}")


@app.get("/anomalies/{terrain_id}")
def get_anomalies(terrain_id: str, days: int = 30):
    """Get stored anomalies for a terrain."""
    try:
        with get_conn() as conn:
            df = pd.read_sql("""
                SELECT id, anomaly_date, anomaly_type, severity, score,
                       expected_kwh, actual_kwh, deviation_pct, description,
                       resolved, created_at
                FROM energy_anomalies
                WHERE terrain_id = %s AND anomaly_date >= CURRENT_DATE - INTERVAL '%s days'
                ORDER BY anomaly_date DESC
            """, conn, params=(terrain_id, days))
        return {"terrain_id": terrain_id, "anomalies": df.to_dict(orient="records")}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")
