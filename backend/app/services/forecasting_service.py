"""
services/forecasting_service.py — Demand Forecasting Service
=============================================================
Uses the existing XGBoost demand predictor to generate multi-day
demand forecasts with confidence intervals.

Forecast approach
-----------------
1. Iterate over the next N days (7 or 30).
2. For each day, predict demand using the XGBoost model with that day's
   temporal features (day_of_week, month, is_weekend).
3. Add confidence bands using historical variance scaled by a growth factor
   (farther out = wider bands).
4. Calculate aggregate metrics: total predicted demand, trend direction,
   peak day, seasonal adjustment.

Confidence intervals
--------------------
We use a heuristic ±σ approach:
    lower = prediction × (1 - uncertainty)
    upper = prediction × (1 + uncertainty)
where uncertainty grows linearly from 10% (day 1) to 35% (day 30).
"""

import datetime
from typing import Optional

from app.services.demand_predictor import get_predictor
from app.utils.product_names import PRODUCT_NAMES


def generate_forecast(
    product_id: int,
    category: str,
    cost_price: float,
    mrp: float,
    current_price: float,
    stock_level: int,
    days_to_expiry: int,
    season_factor: float,
    horizon: int = 7,
) -> dict:
    """
    Generate a demand forecast for the next `horizon` days.

    Parameters
    ----------
    product_id .. season_factor : Product context (same as pricing engine)
    horizon : int, default 7
        Number of days to forecast (typically 7 or 30).

    Returns
    -------
    dict with keys:
        product_id, horizon, forecast_points (list),
        total_predicted_demand, avg_daily_demand,
        peak_day, trend_direction, seasonal_impact
    """
    predictor = get_predictor()
    today = datetime.datetime.now()

    points = []
    demands = []

    for day_offset in range(horizon):
        future_date = today + datetime.timedelta(days=day_offset)
        dow = future_date.weekday()
        month = future_date.month
        is_wknd = 1 if dow >= 5 else 0

        # Expiry decreases each day
        adjusted_expiry = max(0, days_to_expiry - day_offset)

        # Predict demand at the current price point
        predicted = predictor.predict(
            product_id=product_id,
            category=category,
            price=current_price,
            cost_price=cost_price,
            mrp=mrp,
            stock_level=max(0, stock_level - int(sum(demands))),
            days_to_expiry=adjusted_expiry,
            season_factor=season_factor,
            day_of_week=dow,
            month=month,
            is_weekend=is_wknd,
        )

        predicted = max(0.0, predicted)

        # Confidence interval: widens over forecast horizon
        # Day 0 → ±10%, Day 30 → ±35%
        uncertainty = 0.10 + (0.25 * day_offset / max(horizon - 1, 1))
        lower = round(max(0, predicted * (1 - uncertainty)), 1)
        upper = round(predicted * (1 + uncertainty), 1)

        demands.append(predicted)

        points.append({
            "date": future_date.strftime("%Y-%m-%d"),
            "day_label": future_date.strftime("%a %b %d"),
            "day_of_week": dow,
            "is_weekend": bool(is_wknd),
            "predicted_demand": round(predicted, 1),
            "lower_bound": lower,
            "upper_bound": upper,
            "days_to_expiry": adjusted_expiry,
        })

    # Aggregate metrics
    total = round(sum(demands), 1)
    avg_daily = round(total / horizon, 1) if horizon > 0 else 0
    peak_idx = demands.index(max(demands)) if demands else 0
    peak_day = points[peak_idx]["day_label"] if points else "N/A"

    # Trend: compare first half avg to second half avg
    half = max(1, horizon // 2)
    first_half_avg = sum(demands[:half]) / half
    second_half_avg = sum(demands[half:]) / max(1, len(demands[half:]))

    if second_half_avg > first_half_avg * 1.05:
        trend = "increasing"
    elif second_half_avg < first_half_avg * 0.95:
        trend = "decreasing"
    else:
        trend = "stable"

    # Seasonal impact label
    if season_factor > 1.15:
        seasonal = "high_season"
    elif season_factor > 1.05:
        seasonal = "moderate_boost"
    elif season_factor < 0.9:
        seasonal = "low_season"
    else:
        seasonal = "normal"

    return {
        "product_id": product_id,
        "product_name": PRODUCT_NAMES.get(product_id, f"Product #{product_id}"),
        "horizon": horizon,
        "forecast_points": points,
        "total_predicted_demand": total,
        "avg_daily_demand": avg_daily,
        "peak_day": peak_day,
        "trend_direction": trend,
        "seasonal_impact": seasonal,
        "current_price": current_price,
        "season_factor": season_factor,
    }


def get_forecast_overview(products: list) -> list:
    """
    Generate a summary forecast for all products.

    Returns a list of dicts with product-level forecast summaries
    (7-day horizon, compact format for the overview table).
    """
    summaries = []
    for p in products:
        forecast = generate_forecast(
            product_id=p.product_id,
            category=p.category,
            cost_price=p.cost_price,
            mrp=p.mrp,
            current_price=p.current_price,
            stock_level=p.stock_level,
            days_to_expiry=p.days_to_expiry,
            season_factor=p.season_factor,
            horizon=7,
        )

        summaries.append({
            "product_id": p.product_id,
            "product_name": p.name,
            "category": p.category,
            "current_price": p.current_price,
            "total_7d_demand": forecast["total_predicted_demand"],
            "avg_daily_demand": forecast["avg_daily_demand"],
            "trend_direction": forecast["trend_direction"],
            "seasonal_impact": forecast["seasonal_impact"],
            "peak_day": forecast["peak_day"],
        })

    return summaries
