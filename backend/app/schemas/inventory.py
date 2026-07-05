"""Pydantic schemas for inventory intelligence API."""

from pydantic import BaseModel
from typing import List, Optional


class CategoryHealth(BaseModel):
    category: str
    total_products: int
    healthy: int
    at_risk: int
    critical: int
    total_stock: int
    avg_days_to_expiry: float
    health_pct: float


class RiskDistribution(BaseModel):
    critical: int
    warning: int
    healthy: int


class StockDistribution(BaseModel):
    low_stock: int
    optimal: int
    overstock: int


class ExpiryTimeline(BaseModel):
    """Count of products in each expiry bucket."""
    # Pydantic v2 alias support for JSON keys with special characters
    zero_3_days: int = 0
    three_7_days: int = 0
    seven_14_days: int = 0
    fourteen_plus: int = 0


class InventoryOverview(BaseModel):
    total_products: int
    total_stock_value: float
    risk_distribution: RiskDistribution
    stock_distribution: StockDistribution
    expiry_timeline: dict  # raw dict to avoid alias complexity
    category_health: List[CategoryHealth]


class ExpiryRiskItem(BaseModel):
    product_id: int
    category: str
    current_price: float
    cost_price: float
    stock_level: int
    days_to_expiry: int
    risk_level: str
    urgency: str
    markdown_pct: int
    suggested_price: float
    potential_waste_value: float


class InventoryAlert(BaseModel):
    type: str
    product_id: int
    category: str
    title: str
    message: str
    metric_value: int
    metric_label: str
