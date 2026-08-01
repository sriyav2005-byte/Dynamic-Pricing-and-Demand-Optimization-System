"""Pydantic schemas for AI agent chat API."""

from pydantic import BaseModel
from typing import Any, List, Optional


class ChatMessage(BaseModel):
    message: str


class ChatResponse(BaseModel):
    intent: str
    response_text: str
    data: Optional[Any] = None
    data_type: Optional[str] = None
    confidence: float
    suggestions: List[str] = []


class SuggestedQuestion(BaseModel):
    text: str
    category: str
    icon: str


# ── Market Price Search ───────────────────────────────────────────────────────

class MarketPriceQuery(BaseModel):
    """Request body for the market-price search endpoint."""
    query: str


class MarketPriceResult(BaseModel):
    """A single platform price result."""
    platform: str
    platform_key: str
    price: float
    unit: str
    title: str
    url: str
    color: str
    bg: str
    emoji: str
    source: str
    is_cheapest: Optional[bool] = False


class MarketPriceResponse(BaseModel):
    """Response from the market-price search endpoint."""
    query: str
    results: List[MarketPriceResult]
    platform_count: int
    cheapest_platform: Optional[str] = None
    cheapest_price: Optional[float] = None
