"""schemas/requests.py — request bodies of the internal AI API (validated)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class Bounds(BaseModel):
    lo: float = Field(gt=0)
    hi: float = Field(gt=0)
    round_to: float | None = 0
    expiry_window: bool | None = False
    conflict: str | None = None

    @field_validator("hi")
    @classmethod
    def hi_ge_lo(cls, v, info):
        if "lo" in info.data and v < info.data["lo"]:
            raise ValueError("hi must be ≥ lo")
        return v


class StoreRef(BaseModel):
    store_id: str = Field(pattern=r"^[0-9a-fA-F-]{36}$")


class ProductRef(StoreRef):
    product_id: str = Field(pattern=r"^[0-9a-fA-F-]{36}$")


class RecommendRequest(ProductRef):
    bounds: Bounds
    settings: dict[str, Any] = {}


class Scenario(BaseModel):
    type: Literal["our_price_change", "demand_change", "competitor_price_change"]
    pct: float = Field(ge=-90, le=500)


class SimulateRequest(ProductRef):
    prices: list[float] = Field(default_factory=list, max_length=50)
    scenarios: list[Scenario] | None = Field(default=None, max_length=10)
    horizon_days: int | None = Field(default=None, ge=1, le=90)
    bounds: Bounds
    settings: dict[str, Any] = {}

    @field_validator("prices")
    @classmethod
    def positive(cls, v):
        if any(p <= 0 for p in v):
            raise ValueError("prices must be positive")
        return v


class FeedbackRequest(ProductRef):
    price: float = Field(ge=0)
    quantity: int = Field(gt=0)
    unit_cost: float = Field(ge=0)
    mrp: float | None = None
    recommendation_id: str | None = None
    sold_at: str


class ForecastRequest(ProductRef):
    horizon: Literal[7, 14, 30] = 7


class ForecastOverviewRequest(StoreRef):
    horizon: Literal[7, 14, 30] = 7


class ExpiryRequest(StoreRef):
    settings: dict[str, Any] = {}


class ChatRequest(StoreRef):
    conversation_id: str | None = None
    message: str = Field(min_length=1, max_length=4000)
    history: list[dict] | None = None
    user: dict[str, Any] = {}


class DocumentRequest(BaseModel):
    organization_id: str | None = None
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=200_000)
    doc_type: Literal["PRICING_POLICY", "INVENTORY_RULE", "BUSINESS_RULE", "PRODUCT_DOC", "OPERATIONS"] = "BUSINESS_RULE"
