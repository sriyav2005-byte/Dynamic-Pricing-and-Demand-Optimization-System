"""Pydantic schemas for competitor intelligence API."""

from pydantic import BaseModel
from typing import List, Optional


class CompetitorPrice(BaseModel):
    platform: str
    platform_key: str
    price: float
    diff_pct: float
    color: str
    url: Optional[str] = "#"
    unit: Optional[str] = ""


class CompetitorPriceResponse(BaseModel):
    product_id: int
    our_price: float
    competitors: List[CompetitorPrice]
    market_avg: float
    cheapest_platform: str
    most_expensive_platform: str
    competitiveness_score: float
    price_position: str
    is_live: Optional[bool] = False
    live_fetched_at: Optional[str] = None


class MarketOverviewItem(BaseModel):
    product_id: int
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
    is_live: Optional[bool] = False
    live_fetched_at: Optional[str] = None


class PricingStrategyResponse(BaseModel):
    product_id: int
    strategy: str
    current_price: float
    target_price: float
    market_avg: float
    competitiveness_score: float
    reason: str
    impact_pct: float
    competitors: List[CompetitorPrice]


class LiveFetchRequest(BaseModel):
    product_id: Optional[int] = None
    query: Optional[str] = None


class LiveFetchResponse(BaseModel):
    query: str
    product_id: Optional[int] = None
    our_price: Optional[float] = None
    market_avg: float
    cheapest_platform: str
    cheapest_price: float
    competitiveness_score: float
    price_position: str
    results: List[dict]
    fetched_at: str
