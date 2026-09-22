from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class SaleCreate(BaseModel):
    product_id: int
    price: float
    units_sold: int


class SaleResponse(BaseModel):
    id: int
    product_id: int
    price_sold: float
    units_sold: int
    profit: float
    sold_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class AnalyticsSummary(BaseModel):
    total_revenue: float
    total_profit: float
    total_units_sold: int
    avg_margin_pct: float
    products_at_risk: int  # expiry < 7 days
    top_products: list[dict]


class TrendPoint(BaseModel):
    date: str
    revenue: float
    profit: float
    units: int
