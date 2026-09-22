from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class ProductBase(BaseModel):
    product_id: int
    name: str
    product_name: Optional[str] = None
    category: str
    cost_price: float
    mrp: float
    current_price: float
    stock_level: int
    days_to_expiry: int
    season_factor: float


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    current_price: Optional[float] = None
    stock_level: Optional[int] = None
    days_to_expiry: Optional[int] = None
    season_factor: Optional[float] = None


class ProductResponse(ProductBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class PriceRecommendation(BaseModel):
    product_id: int
    product_name: Optional[str] = None
    current_price: float
    recommended_price: float
    expected_demand: float
    expected_profit: float
    price_options: list[dict]
    constraint_applied: Optional[str] = None


class SimulationResult(BaseModel):
    product_id: int
    product_name: Optional[str] = None
    simulated_price: float
    expected_demand: float
    expected_profit: float
    margin_pct: float
