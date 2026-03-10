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


def fetch_daily_features(terrain_id: str, min_days: int = 30) -> pd.DataFrame:
    """Extract daily aggregated data with lag/rolling features."""
    query = """
    WITH daily AS (
        SELECT
            time_bucket('1 day', time) AS day,
            point_id,
            AVG(active_power_total) AS power_avg,
            MAX(active_power_total) AS power_max,
            MAX(energy_import) - MIN(energy_import) AS energy_delta
        FROM acrel_readings
        WHERE terrain_id = %s
          AND active_power_total IS NOT NULL
          AND time > NOW() - INTERVAL '365 days'
        GROUP BY 1, 2
        ORDER BY point_id, day
    )
    SELECT
        day,
        point_id,
        power_avg,
        power_max,
        energy_delta,
        EXTRACT(DOW FROM day)::int AS day_of_week,
        EXTRACT(MONTH FROM day)::int AS month,
        EXTRACT(WEEK FROM day)::int AS week_of_year,
        CASE WHEN EXTRACT(DOW FROM day) IN (0, 6) THEN 1 ELSE 0 END AS is_weekend,
        LAG(energy_delta, 1) OVER w AS lag_1d,
        LAG(energy_delta, 7) OVER w AS lag_7d,
        LAG(energy_delta, 14) OVER w AS lag_14d,
        AVG(energy_delta) OVER (PARTITION BY point_id ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS rolling_avg_7d,
        AVG(energy_delta) OVER (PARTITION BY point_id ORDER BY day ROWS BETWEEN 29 PRECEDING AND CURRENT ROW) AS rolling_avg_30d,
        STDDEV(energy_delta) OVER (PARTITION BY point_id ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS rolling_std_7d
    FROM daily
    WINDOW w AS (PARTITION BY point_id ORDER BY day)
    ORDER BY point_id, day;
    """
    with get_conn() as conn:
        df = pd.read_sql(query, conn, params=(terrain_id,))
    return df


FEATURE_COLS = [
    "day_of_week", "month", "week_of_year", "is_weekend",
    "lag_1d", "lag_7d", "lag_14d",
    "rolling_avg_7d", "rolling_avg_30d", "rolling_std_7d",
    "power_max",
]

TARGET_COL = "energy_delta"


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


def get_model(terrain_id: str):
    if terrain_id in model_cache:
        return model_cache[terrain_id]
    model_path = os.path.join(MODEL_DIR, f"terrain_{terrain_id}.pkl")
    if os.path.exists(model_path):
        model_cache[terrain_id] = joblib.load(model_path)
        return model_cache[terrain_id]
    return None


def predict_forecast(terrain_id: str, days: int) -> PredictResponse:
    bundle = get_model(terrain_id)
    if bundle is None:
        raise HTTPException(status_code=404, detail="No trained model for this terrain. Call /train first.")

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

    return PredictResponse(
        terrain_id=terrain_id,
        forecast=forecast,
        model_mape=bundle.get("mape"),
        model_rmse=bundle.get("rmse"),
    )


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
