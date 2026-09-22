"""Pydantic schemas for competitor intelligence API."""

from pydantic import BaseModel
from typing import List, Optional


class CompetitorPrice(BaseModel):
    platform: str
    platform_key: str
    price: float
    diff_pct: float
    color: str


class CompetitorPriceResponse(BaseModel):
    product_id: int
    product_name: Optional[str] = None
    our_price: float
    competitors: List[CompetitorPrice]
    market_avg: float
    cheapest_platform: str
    most_expensive_platform: str
    competitiveness_score: float
    price_position: str


class MarketOverviewItem(BaseModel):
    product_id: int
    product_name: Optional[str] = None
    our_price: float
    competitors: List[CompetitorPrice]
    market_avg: float
    cheapest_platform: str
    most_expensive_platform: str
    competitiveness_score: float
    price_position: str
    category: str
    cost_price: float
    mrp: float
    stock_level: int
    days_to_expiry: int


class PricingStrategyResponse(BaseModel):
    product_id: int
    product_name: Optional[str] = None
    strategy: str
    current_price: float
    target_price: float
    market_avg: float
    competitiveness_score: float
    reason: str
    impact_pct: float
    competitors: List[CompetitorPrice]
