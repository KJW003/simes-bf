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
    return psycopg2.connect(**TELEMETRY_DB)


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
        try:
            df = pd.read_sql(agg_query, conn, params=(terrain_id,))
            if df.empty:
                logger.info(f"acrel_agg_daily empty for {terrain_id}, falling back to raw readings")
                df = pd.read_sql(raw_query, conn, params=(terrain_id,))
        except Exception as e:
            logger.warning(f"acrel_agg_daily query failed for {terrain_id}, fallback to raw readings: {e}")
            df = pd.read_sql(raw_query, conn, params=(terrain_id,))

    # Normalize dtypes to prevent pandas aggregation errors on object columns.
    numeric_cols = [
        "power_avg", "power_max", "energy_delta",
        "day_of_week", "month", "week_of_year", "is_weekend",
        "lag_1d", "lag_7d", "lag_14d",
        "rolling_avg_7d", "rolling_avg_30d", "rolling_std_7d",
    ]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # Keep only rows where target is numeric/usable.
    if "energy_delta" in df.columns:
        df = df[df["energy_delta"].notna()]
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
    WITH per_point_day AS (
        SELECT
            time_bucket('1 day', time)::date AS day,
            point_id,
            MAX(energy_total) - MIN(energy_total) AS energy_delta_point,
            AVG(active_power_total) AS power_avg_point
        FROM acrel_readings
        WHERE terrain_id = %s AND active_power_total IS NOT NULL
          AND time > NOW() - INTERVAL '365 days'
        GROUP BY 1, 2
    )
    SELECT
        day,
        SUM(energy_delta_point) AS energy_delta,
        SUM(power_avg_point) AS power_avg,
        EXTRACT(DOW FROM day)::int AS day_of_week
    FROM per_point_day
    GROUP BY day
    ORDER BY day;
    """
    with get_conn() as conn:
        try:
            df = pd.read_sql(query, conn, params=(terrain_id,))
            if df.empty:
                df = pd.read_sql(raw_fallback, conn, params=(terrain_id,))
        except Exception as e:
            logger.warning(f"Simple daily agg query failed for {terrain_id}, fallback to raw readings: {e}")
            df = pd.read_sql(raw_fallback, conn, params=(terrain_id,))

    # Force numerics for robust statistics (mean/std) in simple_forecast.
    for col in ("energy_delta", "power_avg", "day_of_week"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # Drop rows that cannot be used for day-of-week averaging.
    required = [c for c in ("energy_delta", "day_of_week") if c in df.columns]
    if required:
        df = df.dropna(subset=required)

    if "day_of_week" in df.columns:
        df["day_of_week"] = df["day_of_week"].astype(int)
    return df


FEATURE_COLS = [
    "day_of_week", "month", "week_of_year", "is_weekend",
    "lag_1d", "lag_7d", "lag_14d",
    "rolling_avg_7d", "rolling_avg_30d", "rolling_std_7d",
    "power_max",
]

TARGET_COL = "energy_delta"


# ─── Prediction storage ──────────────────────────────────────
def store_predictions(terrain_id: str, forecast: list, model_type: str, start_date=None):
    """Store forecast predictions in ml_predictions table for later comparison."""
    try:
        from datetime import datetime, timedelta

        base_date = start_date or datetime.now()
        with get_conn() as conn:
            with conn.cursor() as cur:
                for idx, fd in enumerate(forecast, start=1):
                    # Persist by forecast horizon offset to avoid year rollover bugs.
                    predicted_day = (base_date + timedelta(days=idx)).date()
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
    model_type: str = "lightgbm"  # "lightgbm" | "simple" | "bootstrap_1d"
    warnings: list[str] | None = None


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
    store_predictions(terrain_id, forecast, "simple", start_date=today)
    return result


def bootstrap_forecast(terrain_id: str, days: int) -> PredictResponse | None:
    """Very-low-data fallback forecast for terrains with 1-2 daily samples."""
    from datetime import datetime, timedelta

    df = fetch_daily_simple(terrain_id)
    if df.empty or len(df) < 1:
        return None

    n = len(df)
    recent = df.tail(min(2, n))
    base = float(recent["energy_delta"].mean())
    if n >= 2:
        vals = recent["energy_delta"].values.astype(float)
        slope = float(vals[-1] - vals[0])
    else:
        slope = 0.0

    base_std = float(df["energy_delta"].std()) if n >= 2 else max(base * 0.35, 0.1)

    today = datetime.now()
    forecast: list[ForecastDay] = []
    for i in range(1, days + 1):
        future = today + timedelta(days=i)
        pred = max(0.0, base + slope * i)
        band = max(base_std * 1.8 * np.sqrt(1 + i / max(n, 1)), pred * 0.25)
        forecast.append(ForecastDay(
            day=future.strftime("%d/%m"),
            predicted_kwh=round(pred, 2),
            lower=round(max(0.0, pred - band), 2),
            upper=round(pred + band, 2),
        ))

    warnings = [
        f"Mode bootstrap active: seulement {n} jour(s) d'historique.",
        "Confiance tres faible: previsions basees sur extrapolation minimale.",
    ]

    logger.warning(f"Bootstrap forecast for terrain {terrain_id}: {n} days of data, {days} days predicted")
    result = PredictResponse(
        terrain_id=terrain_id,
        forecast=forecast,
        model_mape=None,
        model_rmse=None,
        model_type="bootstrap_1d",
        warnings=warnings,
    )
    store_predictions(terrain_id, forecast, "bootstrap_1d", start_date=today)
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
            bootstrap = bootstrap_forecast(terrain_id, days)
            if bootstrap is not None:
                return bootstrap
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
        pg_dow = (future.weekday() + 1) % 7  # Match PostgreSQL EXTRACT(DOW): 0=Sun..6=Sat
        features = np.array([[
            pg_dow,
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
    store_predictions(terrain_id, forecast, "lightgbm", start_date=today)
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
    try:
        return predict_forecast(req.terrain_id, req.days)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Predict failed for terrain {req.terrain_id}")
        raise HTTPException(status_code=500, detail=f"Predict failed: {e}")


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


# ─── Pattern-Based Anomaly Detection Helpers ────────────────

def detect_change_points_cusum(energy_series: np.ndarray, threshold: float = 2.5) -> list[dict]:
    """
    CUSUM (Cumulative Sum Control Chart) for change point detection.
    Detects when the mean of energy consumption shifts significantly.
    """
    if len(energy_series) < 10:
        return []

    # Use first half as baseline to learn "normal"
    baseline = energy_series[:len(energy_series)//2]
    mean_baseline = np.mean(baseline)
    std_baseline = np.std(baseline)
    if std_baseline < 0.01:
        std_baseline = mean_baseline * 0.1  # Fallback if no variance

    cusum_pos = 0.0
    cusum_neg = 0.0
    changes = []
    in_change = False
    change_start = None

    for i, value in enumerate(energy_series):
        z = (value - mean_baseline) / std_baseline

        # Update cumulative sums (drift detection)
        cusum_pos = max(0, cusum_pos + z - 0.5)  # Slack parameter 0.5
        cusum_neg = min(0, cusum_neg + z + 0.5)

        # Detect change point
        if not in_change and (cusum_pos > threshold or abs(cusum_neg) > threshold):
            in_change = True
            change_start = i
        elif in_change and abs(cusum_pos) < 0.5 and abs(cusum_neg) < 0.5:
            # Reset after signal
            in_change = False
            if change_start is not None:
                direction = "+" if cusum_pos > abs(cusum_neg) else "-"
                score = max(cusum_pos, abs(cusum_neg))
                changes.append({
                    "index": change_start,
                    "direction": direction,
                    "score": round(score, 2),
                    "severity": "critical" if score > 4 else "high" if score > 3 else "medium",
                })
            change_start = None
            cusum_pos = 0.0
            cusum_neg = 0.0

    # Handle ongoing change at end
    if in_change and change_start is not None:
        direction = "+" if cusum_pos > abs(cusum_neg) else "-"
        score = max(cusum_pos, abs(cusum_neg))
        changes.append({
            "index": change_start,
            "direction": direction,
            "score": round(score, 2),
            "severity": "critical" if score > 4 else "high" if score > 3 else "medium",
        })

    return changes


def detect_volatility_spikes(energy_series: np.ndarray, window: int = 7, factor: float = 3.0) -> list[dict]:
    """
    Detect periods where volatility (rolling std) spikes abnormally.
    Indicates equipment instability or erratic behavior.
    """
    if len(energy_series) < window * 2:
        return []

    rolling_std = pd.Series(energy_series).rolling(window).std().dropna().values
    if len(rolling_std) < 5:
        return []

    # Historical baseline of volatility
    mean_vol = np.mean(rolling_std)
    std_vol = np.std(rolling_std)
    if std_vol < 0.01:
        std_vol = mean_vol * 0.3

    threshold = mean_vol + factor * std_vol
    spikes = []

    for i, vol in enumerate(rolling_std):
        if vol > threshold:
            spike_factor = round(vol / max(mean_vol, 0.01), 2)
            spikes.append({
                "index": i + window,  # Offset by window size
                "volatility_factor": spike_factor,
                "score": round((vol - mean_vol) / std_vol, 2),
                "severity": "critical" if spike_factor > 5 else "high" if spike_factor > 3 else "medium",
            })

    return spikes


def detect_anomaly_clusters(anomaly_indices: list[int], window: int = 7, min_count: int = 3) -> list[dict]:
    """
    Detect when multiple anomalies cluster together (systemic issue).
    If 3+ anomalies in 7 days → not random noise, pattern is wrong.
    """
    if len(anomaly_indices) < min_count:
        return []

    anomaly_indices = sorted(anomaly_indices)
    clusters = []
    visited = set()

    for i, idx in enumerate(anomaly_indices):
        if idx in visited:
            continue

        # Count anomalies within window
        cluster_indices = [j for j in anomaly_indices if abs(j - idx) <= window]

        if len(cluster_indices) >= min_count:
            for j in cluster_indices:
                visited.add(j)
            clusters.append({
                "start_index": min(cluster_indices),
                "end_index": max(cluster_indices),
                "count": len(cluster_indices),
                "score": round(len(cluster_indices) / min_count, 2),
                "severity": "critical" if len(cluster_indices) >= 5 else "high" if len(cluster_indices) >= 4 else "medium",
            })

    return clusters


def detect_seasonality_break(energy_series: np.ndarray, lookback_weeks: int = 4) -> list[dict]:
    """
    Use FFT to detect if weekly pattern changed significantly.
    Compares frequency power of recent vs historical data.
    """
    min_samples = lookback_weeks * 7 * 2  # Need 2x for comparison
    if len(energy_series) < min_samples:
        return []

    # Split into historical and recent
    split = len(energy_series) - (lookback_weeks * 7)
    historical = energy_series[:split]
    recent = energy_series[split:]

    if len(historical) < 14 or len(recent) < 7:
        return []

    # Compute FFT power spectrum
    def weekly_power(series):
        if len(series) < 7:
            return 0
        fft_result = np.abs(np.fft.fft(series))
        # 7-day frequency index
        freq_idx = max(1, int(len(series) / 7))
        if freq_idx >= len(fft_result):
            return 0
        return fft_result[freq_idx]

    hist_power = weekly_power(historical)
    recent_power = weekly_power(recent)

    if hist_power < 0.01:
        return []

    # Check if weekly power changed
    power_change = (recent_power - hist_power) / hist_power
    breaks = []

    if power_change < -0.4:  # > 40% drop in weekly seasonality
        breaks.append({
            "index": split,
            "power_change_pct": round(power_change * 100, 1),
            "score": round(abs(power_change), 2),
            "severity": "high" if power_change < -0.6 else "medium",
            "description": "Saisonnalité hebdomadaire affaiblie",
        })
    elif power_change > 0.5:  # > 50% increase (new pattern emerged)
        breaks.append({
            "index": split,
            "power_change_pct": round(power_change * 100, 1),
            "score": round(power_change, 2),
            "severity": "medium",
            "description": "Nouveau pattern hebdomadaire apparu",
        })

    return breaks


# ─── Quality Anomaly Detection (from raw acrel_readings) ──────

def detect_quality_anomalies(terrain_id: str, lookback_hours: int = 48) -> list[dict]:
    """
    Detect electrical quality anomalies from raw acrel_readings.
    Analyzes: THD, Power Factor, Voltage/Current Unbalance, Frequency.
    
    Returns list of quality anomalies with violations flagged when:
    - Consecutive violations or high frequency of violations detected
    """
    results = []
    
    quality_metrics = {
        'thd': {
            'cols': ['thdi_a', 'thdi_b', 'thdi_c'],
            'thresholds': {'warning': 5, 'critical': 8},
            'description_template': 'THD {phase} = {value}% ({severity})',
        },
        'pf': {
            'cols': ['power_factor_a', 'power_factor_b', 'power_factor_c', 'power_factor_total'],
            'thresholds': {'warning': 0.85, 'critical': 0.80},
            'is_lower_bound': True,
            'description_template': 'Facteur de puissance {phase} = {value} ({severity})',
        },
        'voltage_unbalance': {
            'cols': ['voltage_unbalance'],
            'thresholds': {'warning': 3, 'critical': 5},
            'description_template': 'Déséquilibre tension = {value}% ({severity})',
        },
        'current_unbalance': {
            'cols': ['current_unbalance'],
            'thresholds': {'warning': 10, 'critical': 15},
            'description_template': 'Déséquilibre courant = {value}% ({severity})',
        },
    }
    
    try:
        with get_conn() as conn:
            # Fetch raw readings from last N hours
            query = f"""
            SELECT 
                time,
                point_id,
                thdi_a, thdi_b, thdi_c,
                power_factor_a, power_factor_b, power_factor_c, power_factor_total,
                voltage_unbalance, current_unbalance, frequency
            FROM acrel_readings
            WHERE terrain_id = %s
              AND time >= NOW() - INTERVAL '{lookback_hours} hours'
            ORDER BY point_id, time
            """
            df = pd.read_sql(query, conn, params=(terrain_id,))
            
            if df.empty:
                return results
            
            # Analyze each metric
            for metric_name, metric_config in quality_metrics.items():
                cols = metric_config['cols']
                thresholds = metric_config['thresholds']
                is_lower = metric_config.get('is_lower_bound', False)
                desc_template = metric_config['description_template']
                
                # Check each column
                for col in cols:
                    if col not in df.columns:
                        continue
                    
                    valid_data = df[df[col].notna()].copy()
                    if len(valid_data) < 10:  # Need minimum data
                        continue
                    
                    # Find violations
                    if is_lower:
                        warnings = valid_data[valid_data[col] < thresholds['warning']]
                        criticals = valid_data[valid_data[col] < thresholds['critical']]
                    else:
                        warnings = valid_data[valid_data[col] > thresholds['warning']]
                        criticals = valid_data[valid_data[col] > thresholds['critical']]
                    
                    # Count consecutive violations
                    violation_count = len(criticals) if len(criticals) > 0 else len(warnings)
                    
                    if violation_count >= 5:  # Flag if 5+ violations in lookback
                        most_severe = criticals if len(criticals) > 0 else warnings
                        worst_reading = most_severe.iloc[-1]  # Last violation (most recent)
                        
                        severity = "critical" if len(criticals) > 0 else "high" if len(warnings) >= 5 else "medium"
                        value = worst_reading[col]
                        phase_label = col.split('_')[-1].upper() if col != 'voltage_unbalance' and col != 'current_unbalance' else ""
                        
                        phase_display = f"Phase {phase_label}" if phase_label else metric_name.replace('_', ' ').title()
                        
                        results.append({
                            "anomaly_type": f"quality_{metric_name}",
                            "anomaly_date": str(worst_reading['time'].date()),
                            "severity": severity,
                            "score": round(float(value), 3),
                            "expected_kwh": None,
                            "actual_kwh": None,
                            "deviation_pct": None,
                            "description": f"{phase_display}: {value:.2f} ({severity.upper()}) — {violation_count} violation(s) détectée(s) sur {lookback_hours}h",
                        })
        
        return results
    
    except Exception as e:
        logger.error(f"Quality anomaly detection failed for {terrain_id}: {e}")
        return results


# ─── Anomaly Detection Endpoint ─────────────────────────────

@app.post("/anomalies/detect/{terrain_id}")
def detect_anomalies(terrain_id: str):
    """Run anomaly detection for a terrain using algorithms:
    1. Residual analysis: compare actual vs predicted (uses ML predictions)
    2. Isolation Forest: multivariate outlier detection
    3. CUSUM change point: detect mean shifts in energy consumption
    4. Volatility spikes: detect equipment instability
    5. Anomaly clustering: detect systemic issues (multiple anomalies in short window)
    6. Seasonality break: detect if weekly pattern changed (FFT)
    7. Quality analysis: THD, PF, unbalances from raw readings
    
    Uses sliding window: only analyzes data since last successful analysis.
    """
    results = []
    all_anomaly_indices = []  # For clustering
    analysis_start_time = None

    try:
        with get_conn() as conn:
            # ─ Get last analysis state for efficient sliding-window analysis ─
            # Gracefully fallback if anomaly_analysis_state table doesn't exist yet
            lookback_hours = 48
            analysis_start_time = pd.Timestamp.now(tz='UTC') - pd.Timedelta(hours=lookback_hours)
            
            try:
                state_df = pd.read_sql("""
                    SELECT last_analyzed_until FROM anomaly_analysis_state
                    WHERE terrain_id = %s
                """, conn, params=(terrain_id,))
                
                if len(state_df) > 0:
                    last_analyzed_until = pd.Timestamp(state_df.iloc[0]['last_analyzed_until'])
                    analysis_start_time = last_analyzed_until
                    lookback_hours = int((pd.Timestamp.now(tz='UTC') - last_analyzed_until).total_seconds() / 3600)
                    lookback_hours = min(max(lookback_hours, 1), 48)  # Clamp 1-48h
                    logger.info(f"Incremental analysis for {terrain_id}: analyzing last {lookback_hours}h (since {last_analyzed_until})")
                else:
                    # First time: analyze full 48 hours
                    logger.info(f"Initial analysis for {terrain_id}: analyzing last {lookback_hours}h")
            except Exception as state_err:
                # Table doesn't exist yet (migration pending) - fallback to 48h
                logger.warn(f"anomaly_analysis_state not available: {state_err}. Using fallback 48h lookback.")
                logger.info(f"Initial analysis for {terrain_id}: analyzing last {lookback_hours}h (migration pending)")
            
            # Fetch features once for all methods
            features_df = fetch_daily_features(terrain_id)
            if features_df.empty:
                return {"terrain_id": terrain_id, "anomalies_found": 0, "anomalies": [], "message": "Données insuffisantes"}

            # Aggregate by day (sum across points)
            daily_df = features_df.groupby("day").agg({
                "energy_delta": "sum",
                "power_avg": "sum",
                "power_max": "max",
            }).reset_index().sort_values("day")

            day_list = daily_df["day"].tolist()
            energy_series = daily_df["energy_delta"].fillna(0).values

            # ─────────────────────────────────────────────────────────────
            # 1) Residual-based detection (requires ML predictions + actuals)
            # ─────────────────────────────────────────────────────────────
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

                mu = residual_df["residual"].mean()
                sigma = residual_df["residual"].std()
                if sigma > 0:
                    for idx, row in residual_df.iterrows():
                        r = row["residual"]
                        z_score = abs((r - mu) / sigma)
                        if z_score > 2:
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
                                "description": f"Écart prévu/réel: {'+' if r > 0 else ''}{r:.1f} kWh ({deviation}%) — z={z_score:.1f}σ",
                            })
                            # Track index for clustering
                            if str(row["predicted_day"]) in [str(d) for d in day_list]:
                                all_anomaly_indices.append([str(d) for d in day_list].index(str(row["predicted_day"])))

            # ─────────────────────────────────────────────────────────────
            # 2) Isolation Forest: multivariate outliers
            # ─────────────────────────────────────────────────────────────
            if len(features_df) >= 14:
                from sklearn.ensemble import IsolationForest

                feat_cols = [c for c in features_df.columns if c not in ("day", "energy_delta", "point_id")]
                X = features_df[feat_cols].fillna(0).values

                iso = IsolationForest(contamination=0.1, random_state=42, n_estimators=100)
                features_df = features_df.copy()
                features_df["iso_score"] = iso.fit_predict(X)
                features_df["iso_anomaly_score"] = iso.decision_function(X)

                iso_anomalies = features_df[features_df["iso_score"] == -1]
                for _, row in iso_anomalies.iterrows():
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
                        "description": f"Anomalie multivariée (features anormales, score={a_score:.3f})",
                    })
                    if str(row["day"]) in [str(d) for d in day_list]:
                        all_anomaly_indices.append([str(d) for d in day_list].index(str(row["day"])))

            # ─────────────────────────────────────────────────────────────
            # 3) CUSUM: Change Point Detection (mean shift)
            # ─────────────────────────────────────────────────────────────
            if len(energy_series) >= 14:
                change_points = detect_change_points_cusum(energy_series, threshold=2.5)
                for cp in change_points:
                    idx = cp["index"]
                    if idx < len(day_list):
                        anomaly_date = day_list[idx]
                        direction_text = "hausse" if cp["direction"] == "+" else "baisse"
                        results.append({
                            "anomaly_type": "change_point",
                            "anomaly_date": str(anomaly_date),
                            "severity": cp["severity"],
                            "score": cp["score"],
                            "expected_kwh": None,
                            "actual_kwh": float(energy_series[idx]) if idx < len(energy_series) else None,
                            "deviation_pct": None,
                            "description": f"Point de rupture: {direction_text} soudaine de la consommation (CUSUM={cp['score']:.1f})",
                        })
                        all_anomaly_indices.append(idx)

            # ─────────────────────────────────────────────────────────────
            # 4) Volatility Spikes: Equipment instability
            # ─────────────────────────────────────────────────────────────
            if len(energy_series) >= 14:
                vol_spikes = detect_volatility_spikes(energy_series, window=7, factor=3.0)
                for vs in vol_spikes:
                    idx = vs["index"]
                    if idx < len(day_list):
                        anomaly_date = day_list[idx]
                        results.append({
                            "anomaly_type": "volatility_spike",
                            "anomaly_date": str(anomaly_date),
                            "severity": vs["severity"],
                            "score": vs["score"],
                            "expected_kwh": None,
                            "actual_kwh": float(energy_series[idx]) if idx < len(energy_series) else None,
                            "deviation_pct": None,
                            "description": f"Instabilité équipement: volatilité ×{vs['volatility_factor']} (z={vs['score']:.1f}σ)",
                        })
                        all_anomaly_indices.append(idx)

            # ─────────────────────────────────────────────────────────────
            # 5) Seasonality Break (FFT): Weekly pattern changed
            # ─────────────────────────────────────────────────────────────
            if len(energy_series) >= 28:  # Need 4 weeks minimum
                season_breaks = detect_seasonality_break(energy_series, lookback_weeks=4)
                for sb in season_breaks:
                    idx = sb["index"]
                    if idx < len(day_list):
                        anomaly_date = day_list[idx]
                        results.append({
                            "anomaly_type": "seasonality_break",
                            "anomaly_date": str(anomaly_date),
                            "severity": sb["severity"],
                            "score": sb["score"],
                            "expected_kwh": None,
                            "actual_kwh": None,
                            "deviation_pct": sb.get("power_change_pct"),
                            "description": sb.get("description", f"Pattern hebdomadaire modifié ({sb.get('power_change_pct', 0):.0f}%)"),
                        })
                        all_anomaly_indices.append(idx)

            # ─────────────────────────────────────────────────────────────
            # 6) Anomaly Clustering: Systemic issues
            # ─────────────────────────────────────────────────────────────
            if len(all_anomaly_indices) >= 3:
                clusters = detect_anomaly_clusters(all_anomaly_indices, window=7, min_count=3)
                for cl in clusters:
                    start_idx = cl["start_index"]
                    end_idx = cl["end_index"]
                    if start_idx < len(day_list) and end_idx < len(day_list):
                        start_date = day_list[start_idx]
                        end_date = day_list[end_idx]
                        results.append({
                            "anomaly_type": "anomaly_cluster",
                            "anomaly_date": str(start_date),  # Stored as start of cluster
                            "severity": cl["severity"],
                            "score": cl["score"],
                            "expected_kwh": None,
                            "actual_kwh": None,
                            "deviation_pct": None,
                            "description": f"Problème systémique: {cl['count']} anomalies du {start_date} au {end_date}",
                        })

            # ─────────────────────────────────────────────────────────────
            # Store all results in DB
            # ─────────────────────────────────────────────────────────────
            
            # Add quality anomalies (from raw readings, using calculated lookback)
            quality_results = detect_quality_anomalies(terrain_id, lookback_hours=lookback_hours)
            results.extend(quality_results)
            
            if results:
                with conn.cursor() as cur:
                    for a in results:
                        cur.execute("""
                            INSERT INTO energy_anomalies
                                (terrain_id, anomaly_date, anomaly_type, severity, score,
                                 expected_kwh, actual_kwh, deviation_pct, description)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                            ON CONFLICT (terrain_id, anomaly_date, anomaly_type) DO NOTHING
                        """, (terrain_id, a["anomaly_date"], a["anomaly_type"],
                              a["severity"], a["score"], a["expected_kwh"],
                              a["actual_kwh"], a["deviation_pct"], a["description"]))
                    conn.commit()
            
            # ─────────────────────────────────────────────────────────────
            # Update analysis state (sliding window tracking)
            # ─────────────────────────────────────────────────────────────
            analysis_end_time = pd.Timestamp.now(tz='UTC')
            try:
                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO anomaly_analysis_state (terrain_id, last_analysis_time, last_analyzed_until)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (terrain_id) 
                        DO UPDATE SET 
                            last_analysis_time = EXCLUDED.last_analysis_time,
                            last_analyzed_until = EXCLUDED.last_analyzed_until,
                            updated_at = NOW()
                    """, (terrain_id, analysis_end_time, analysis_end_time))
                    conn.commit()
                    logger.info(f"Updated analysis state for {terrain_id}: last_analyzed_until = {analysis_end_time}")
            except Exception as state_err:
                logger.warn(f"Could not update analysis state (table pending): {state_err}")
                # This is OK - migration will create the table and it will work next time

        # Group by type for summary
        by_type = {}
        for r in results:
            t = r["anomaly_type"]
            by_type[t] = by_type.get(t, 0) + 1

        return {
            "terrain_id": terrain_id,
            "anomalies_found": len(results),
            "by_type": by_type,
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
                WHERE terrain_id = %s AND anomaly_date >= CURRENT_DATE - (%s * INTERVAL '1 day')
                ORDER BY anomaly_date DESC
            """, conn, params=(terrain_id, days))
        return {"terrain_id": terrain_id, "anomalies": df.to_dict(orient="records")}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")


# ─── Hourly Forecast Endpoint (replaces frontend logic) ─────────────────────────

def fetch_raw_readings(terrain_id: str, point_id: str | None, history_days: int) -> pd.DataFrame:
    """Fetch raw acrel_readings for hourly profile computation."""
    with get_conn() as conn:
        if point_id:
            df = pd.read_sql("""
                SELECT time, active_power_total
                FROM acrel_readings
                WHERE terrain_id = %s AND point_id = %s
                  AND time >= NOW() - (%s * INTERVAL '1 day')
                ORDER BY time
            """, conn, params=(terrain_id, point_id, history_days))
        else:
            # Aggregate across all points per time bucket (5-min)
            df = pd.read_sql("""
                SELECT DATE_TRUNC('minute', time) - (EXTRACT(MINUTE FROM time)::int %% 5) * INTERVAL '1 minute' AS time,
                       SUM(active_power_total) AS active_power_total
                FROM acrel_readings
                WHERE terrain_id = %s AND time >= NOW() - (%s * INTERVAL '1 day')
                GROUP BY 1
                ORDER BY 1
            """, conn, params=(terrain_id, history_days))
    return df


def build_hourly_shape(readings_df: pd.DataFrame) -> list[float]:
    """Build average hourly profile (24 values) from raw readings."""
    if readings_df.empty:
        return [0.0] * 24

    readings_df = readings_df.copy()
    readings_df["time"] = pd.to_datetime(readings_df["time"], errors="coerce")
    readings_df["active_power_total"] = pd.to_numeric(readings_df["active_power_total"], errors="coerce")
    readings_df = readings_df.dropna(subset=["time", "active_power_total"])
    if readings_df.empty:
        return [0.0] * 24

    readings_df["hour"] = readings_df["time"].dt.hour
    hourly_avg = readings_df.groupby("hour")["active_power_total"].mean()

    shape = []
    for h in range(24):
        if h in hourly_avg.index:
            shape.append(float(hourly_avg[h]))
        else:
            shape.append(0.0)
    return shape


def build_daily_stats(readings_df: pd.DataFrame) -> dict:
    """Compute daily averages, trend (slope), and volatility."""
    if readings_df.empty:
        return {"daily_avg": 0, "slope": 0, "std_dev": 0, "n_days": 0, "days": []}

    readings_df = readings_df.copy()
    readings_df["time"] = pd.to_datetime(readings_df["time"], errors="coerce")
    readings_df["active_power_total"] = pd.to_numeric(readings_df["active_power_total"], errors="coerce")
    readings_df = readings_df.dropna(subset=["time", "active_power_total"])
    if readings_df.empty:
        return {"daily_avg": 0, "slope": 0, "std_dev": 0, "n_days": 0, "days": []}

    readings_df["day"] = readings_df["time"].dt.date

    daily = readings_df.groupby("day")["active_power_total"].agg(["mean", "max", "count"]).reset_index()
    daily = daily.sort_values("day")
    n = len(daily)

    if n == 0:
        return {"daily_avg": 0, "slope": 0, "std_dev": 0, "n_days": 0, "days": []}

    avgs = daily["mean"].values
    daily_avg = float(np.mean(avgs))

    # Linear trend (simple regression)
    slope = 0.0
    if n >= 2:
        x_mean = (n - 1) / 2
        num = den = 0.0
        for i in range(n):
            num += (i - x_mean) * (avgs[i] - daily_avg)
            den += (i - x_mean) ** 2
        if den != 0:
            slope = num / den

    std_dev = float(np.std(avgs)) if n >= 2 else daily_avg * 0.3

    days_list = []
    for _, row in daily.iterrows():
        days_list.append({
            "date": str(row["day"]),
            "avg_kw": round(float(row["mean"]), 2),
            "max_kw": round(float(row["max"]), 2),
        })

    return {
        "daily_avg": round(daily_avg, 2),
        "slope": round(slope, 4),
        "std_dev": round(std_dev, 2),
        "n_days": n,
        "days": days_list,
    }


def compute_hourly_forecast(
    hourly_shape: list[float],
    daily_avg: float,
    slope: float,
    n_days: int,
    forecast_day_index: int,
    std_dev: float,
) -> list[dict]:
    """
    Scale the hourly shape to the predicted daily level.
    Returns 24-hour forecast with confidence intervals.
    """
    # Predicted daily average with trend
    if n_days >= 2:
        predicted_daily = max(0, daily_avg + slope * forecast_day_index)
    else:
        predicted_daily = daily_avg

    # Total of hourly shape (sum of 24 averages)
    shape_total = sum(hourly_shape)
    if shape_total <= 0:
        shape_total = 1.0

    # Scale factor to reach predicted daily level
    # hourly_shape is sum of 24 averages → divide by 24 for per-hour avg
    shape_avg = shape_total / 24
    scale = predicted_daily / shape_avg if shape_avg > 0 else 1.0

    # Confidence band width (widens with forecast horizon)
    confidence_factor = std_dev * 1.5 * np.sqrt(1 + forecast_day_index / max(n_days, 1))

    hourly_forecast = []
    for h in range(24):
        base = hourly_shape[h] * scale
        predicted = max(0, round(base, 2))
        # Adjust confidence proportionally to base value
        conf = confidence_factor * (hourly_shape[h] / shape_avg if shape_avg > 0 else 1.0)
        hourly_forecast.append({
            "hour": h,
            "predicted_kw": predicted,
            "lower": max(0, round(base - conf, 2)),
            "upper": round(base + conf, 2),
        })

    return hourly_forecast


@app.get("/forecast/hourly/{terrain_id}")
def get_hourly_forecast(terrain_id: str, days: int = 1, point_id: str | None = None, history_days: int = 14):
    """
    Compute hourly forecast (24-hour curve) for future days.
    
    This endpoint replaces the client-side buildPredictedHourly() logic.
    
    - Fetches raw readings from acrel_readings
    - Builds hourly shape (avg profile across history)
    - Computes daily stats (avg, trend, std_dev)
    - Scales hourly shape to predicted daily level
    - Returns confidence bands
    
    Parameters:
    - terrain_id: Target terrain UUID
    - days: Number of forecast days (1-7)
    - point_id: Optional specific point_id (null = aggregate all points)
    - history_days: Days of history to use for pattern (default 14)
    """
    days = min(max(days, 1), 7)  # Clamp 1-7
    history_days = min(max(history_days, 7), 90)  # Clamp 7-90

    try:
        # Fetch raw readings
        readings_df = fetch_raw_readings(terrain_id, point_id, history_days)

        if readings_df.empty or len(readings_df) < 24:
            return {
                "terrain_id": terrain_id,
                "point_id": point_id,
                "model_type": "insufficient_data",
                "confidence_level": 0,
                "data_days": 0,
                "warning": "Données horaires insuffisantes (minimum 24 lectures requises)",
                "hourly_forecast": [],
                "daily_forecast": [],
            }

        # Build hourly shape and daily stats
        hourly_shape = build_hourly_shape(readings_df)
        stats = build_daily_stats(readings_df)

        n_days = stats["n_days"]
        daily_avg = stats["daily_avg"]
        slope = stats["slope"]
        std_dev = stats["std_dev"]

        # Confidence level based on data availability
        if n_days >= 30:
            confidence_level = 0.9
            model_type = "hourly_profile_full"
        elif n_days >= 14:
            confidence_level = 0.75
            model_type = "hourly_profile"
        elif n_days >= 7:
            confidence_level = 0.6
            model_type = "hourly_profile_limited"
        else:
            confidence_level = 0.4
            model_type = "hourly_profile_sparse"

        # Generate forecasts for each requested day
        hourly_forecasts = []
        daily_forecasts = []

        from datetime import datetime, timedelta
        today = datetime.now()

        for i in range(1, days + 1):
            future_date = today + timedelta(days=i)
            day_label = future_date.strftime("%d/%m")
            day_iso = future_date.strftime("%Y-%m-%d")

            # Hourly forecast for this day
            hourly = compute_hourly_forecast(
                hourly_shape, daily_avg, slope, n_days, i, std_dev
            )

            # Daily totals (sum of hourly)
            daily_kwh = sum(h["predicted_kw"] for h in hourly)
            daily_lower = sum(h["lower"] for h in hourly)
            daily_upper = sum(h["upper"] for h in hourly)

            hourly_forecasts.append({
                "day": day_label,
                "day_iso": day_iso,
                "hours": hourly,
            })

            daily_forecasts.append({
                "day": day_label,
                "day_iso": day_iso,
                "predicted_kwh": round(daily_kwh, 2),
                "lower": round(daily_lower, 2),
                "upper": round(daily_upper, 2),
            })

        # Warning messages for data quality
        warnings = []
        if n_days < 7:
            warnings.append("Historique trop court — prévisions peu fiables")
        if confidence_level < 0.6:
            warnings.append("Confiance faible — collectez plus de données")

        return {
            "terrain_id": terrain_id,
            "point_id": point_id,
            "model_type": model_type,
            "confidence_level": confidence_level,
            "data_days": n_days,
            "daily_avg_kw": daily_avg,
            "trend_per_day": slope,
            "warnings": warnings if warnings else None,
            "hourly_forecast": hourly_forecasts,
            "daily_forecast": daily_forecasts,
            "history_summary": {
                "n_days": n_days,
                "daily_avg": daily_avg,
                "std_dev": std_dev,
                "slope": slope,
            },
        }
    except Exception as e:
        logger.error(f"Hourly forecast error: {e}")
        raise HTTPException(status_code=500, detail=f"Hourly forecast failed: {e}")


@app.get("/forecast/profiles/{terrain_id}")
def get_comparison_profiles(terrain_id: str, point_id: str | None = None):
    """
    Get hourly profiles for today and yesterday for chart comparison.
    
    Returns actual hourly averages (not predictions) for:
    - Today (partial, up to current hour)
    - Yesterday (complete 24h)
    
    This is used alongside the predicted J+1 curve.
    """
    try:
        with get_conn() as conn:
            if point_id:
                today_df = pd.read_sql("""
                    SELECT EXTRACT(HOUR FROM time)::int AS hour,
                           AVG(active_power_total) AS avg_kw
                    FROM acrel_readings
                    WHERE terrain_id = %s AND point_id = %s
                      AND time >= CURRENT_DATE
                    GROUP BY 1
                    ORDER BY 1
                """, conn, params=(terrain_id, point_id))

                yesterday_df = pd.read_sql("""
                    SELECT EXTRACT(HOUR FROM time)::int AS hour,
                           AVG(active_power_total) AS avg_kw
                    FROM acrel_readings
                    WHERE terrain_id = %s AND point_id = %s
                      AND time >= CURRENT_DATE - INTERVAL '1 day'
                      AND time < CURRENT_DATE
                    GROUP BY 1
                    ORDER BY 1
                """, conn, params=(terrain_id, point_id))
            else:
                # Aggregate all points
                today_df = pd.read_sql("""
                    SELECT EXTRACT(HOUR FROM time)::int AS hour,
                           SUM(active_power_total) / COUNT(DISTINCT point_id) AS avg_kw
                    FROM acrel_readings
                    WHERE terrain_id = %s AND time >= CURRENT_DATE
                    GROUP BY 1
                    ORDER BY 1
                """, conn, params=(terrain_id,))

                yesterday_df = pd.read_sql("""
                    SELECT EXTRACT(HOUR FROM time)::int AS hour,
                           SUM(active_power_total) / COUNT(DISTINCT point_id) AS avg_kw
                    FROM acrel_readings
                    WHERE terrain_id = %s
                      AND time >= CURRENT_DATE - INTERVAL '1 day'
                      AND time < CURRENT_DATE
                    GROUP BY 1
                    ORDER BY 1
                """, conn, params=(terrain_id,))

        # Build 24-hour arrays
        today_profile = [None] * 24
        yesterday_profile = [None] * 24

        for _, row in today_df.iterrows():
            h = int(row["hour"])
            if 0 <= h < 24:
                today_profile[h] = round(float(row["avg_kw"]), 2)

        for _, row in yesterday_df.iterrows():
            h = int(row["hour"])
            if 0 <= h < 24:
                yesterday_profile[h] = round(float(row["avg_kw"]), 2)

        return {
            "terrain_id": terrain_id,
            "point_id": point_id,
            "today": [{"hour": h, "kw": today_profile[h]} for h in range(24)],
            "yesterday": [{"hour": h, "kw": yesterday_profile[h]} for h in range(24)],
        }
    except Exception as e:
        logger.error(f"Profiles endpoint error: {e}")
        raise HTTPException(status_code=500, detail=f"Profiles fetch failed: {e}")


@app.get("/forecast/daily-chart/{terrain_id}")
def get_daily_chart_data(terrain_id: str, history_days: int = 14, forecast_days: int = 3):
    """
    Get combined daily history + forecast for chart visualization.
    
    Returns historical daily averages and forecast predictions in a single
    data structure ready for charting (history + forecast overlay).
    """
    history_days = min(max(history_days, 7), 90)
    forecast_days = min(max(forecast_days, 1), 7)

    try:
        # Get historical daily data
        # Use separate connections for agg and raw-fallback: if the first query fails at
        # the SQL level, psycopg2 puts that connection into an aborted-transaction state
        # and any subsequent query on the same connection raises InFailedSqlTransaction.
        history_df = None
        try:
            with get_conn() as conn:
                history_df = pd.read_sql("""
                    SELECT day,
                           SUM(energy_total_delta) AS energy_kwh,
                           AVG(active_power_avg) AS avg_kw,
                           MAX(active_power_max) AS max_kw
                    FROM acrel_agg_daily
                    WHERE terrain_id = %s
                      AND day >= CURRENT_DATE - (%s * INTERVAL '1 day')
                      AND day < CURRENT_DATE
                    GROUP BY day
                    ORDER BY day
                """, conn, params=(terrain_id, history_days))
        except Exception as e:
            logger.warning(f"Daily chart agg query failed for {terrain_id}, fallback to raw readings: {e}")
            try:
                with get_conn() as conn2:
                    history_df = pd.read_sql("""
                        WITH daily AS (
                            SELECT
                                time_bucket('1 day', time)::date AS day,
                                point_id,
                                MAX(energy_total) - MIN(energy_total) AS energy_kwh_point,
                                AVG(active_power_total) AS avg_kw_point,
                                MAX(active_power_total) AS max_kw_point
                            FROM acrel_readings
                            WHERE terrain_id = %s
                              AND time >= NOW() - (%s * INTERVAL '1 day')
                              AND time < CURRENT_DATE
                            GROUP BY 1, 2
                        )
                        SELECT
                            day,
                            SUM(energy_kwh_point) AS energy_kwh,
                            SUM(avg_kw_point) AS avg_kw,
                            MAX(max_kw_point) AS max_kw
                        FROM daily
                        GROUP BY day
                        ORDER BY day
                    """, conn2, params=(terrain_id, history_days))
            except Exception as e2:
                logger.warning(f"Daily chart raw fallback also failed for {terrain_id}: {e2}")
                history_df = pd.DataFrame(columns=["day", "energy_kwh", "avg_kw", "max_kw"])

        # Get ML forecast
        try:
            forecast_response = predict_forecast(terrain_id, forecast_days)
            forecast_data = forecast_response.forecast if forecast_response else []
        except Exception:
            forecast_data = []

        # Build chart data
        chart_data = []

        # Historical points
        for _, row in history_df.iterrows():
            day_str = row["day"].strftime("%d/%m") if hasattr(row["day"], "strftime") else str(row["day"])[-5:]
            chart_data.append({
                "day": day_str,
                "day_iso": str(row["day"]),
                "actual_kwh": round(float(row["energy_kwh"]), 2) if pd.notna(row["energy_kwh"]) else None,
                "actual_max": round(float(row["max_kw"]), 2) if pd.notna(row["max_kw"]) else None,
                "predicted_kwh": None,
                "upper": None,
                "lower": None,
                "type": "history",
            })

        # Forecast points
        for fc in forecast_data:
            chart_data.append({
                "day": fc.day,
                "day_iso": None,
                "actual_kwh": None,
                "actual_max": None,
                "predicted_kwh": fc.predicted_kwh,
                "upper": fc.upper,
                "lower": fc.lower,
                "type": "forecast",
            })

        # Bridge last history to first forecast
        if len(history_df) > 0 and len(forecast_data) > 0:
            last_actual = chart_data[-len(forecast_data) - 1]["actual_kwh"] if len(chart_data) > len(forecast_data) else None
            if last_actual is not None and len(forecast_data) > 0:
                # Duplicate last history point in forecast for seamless line
                chart_data[-len(forecast_data)]["actual_kwh"] = last_actual

        return {
            "terrain_id": terrain_id,
            "history_days": len(history_df),
            "forecast_days": len(forecast_data),
            "chart_data": chart_data,
        }
    except Exception as e:
        logger.error(f"Daily chart error: {e}")
        raise HTTPException(status_code=500, detail=f"Daily chart fetch failed: {e}")
