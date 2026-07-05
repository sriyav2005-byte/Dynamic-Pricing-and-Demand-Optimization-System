"""Pydantic schemas for demand forecasting API."""

from pydantic import BaseModel
from typing import List, Optional


class ForecastPoint(BaseModel):
    date: str
    day_label: str
    day_of_week: int
    is_weekend: bool
    predicted_demand: float
    lower_bound: float
    upper_bound: float
    days_to_expiry: int


class DemandForecast(BaseModel):
    product_id: int
    horizon: int
    forecast_points: List[ForecastPoint]
    total_predicted_demand: float
    avg_daily_demand: float
    peak_day: str
    trend_direction: str
    seasonal_impact: str
    current_price: float
    season_factor: float


class ForecastOverviewItem(BaseModel):
    product_id: int
    category: str
    current_price: float
    total_7d_demand: float
    avg_daily_demand: float
    trend_direction: str
    seasonal_impact: str
    peak_day: str
