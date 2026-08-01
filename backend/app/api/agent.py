"""
api/agent.py — AI Agent Chat Endpoints
========================================
Routes
------
POST /agent/chat          → Process a chat message and return structured response
GET  /agent/suggestions   → Get contextual suggested questions
POST /agent/market-price  → Search real-time product prices across platforms
"""

import asyncio
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.schemas.agent import (
    ChatMessage,
    ChatResponse,
    SuggestedQuestion,
    MarketPriceQuery,
    MarketPriceResponse,
)
from app.services.agent_service import process_message, get_suggested_questions
from app.services.market_scraper import search_product_prices

router = APIRouter(prefix="/agent", tags=["agent"])


@router.post("/chat", response_model=ChatResponse)
def chat(payload: ChatMessage, db: Session = Depends(get_db)):
    """
    Process a user chat message and return an AI-generated response.

    The agent classifies the intent, queries real product/pricing data,
    and returns a structured response with explanation text, data tables,
    and follow-up suggestions.

    Supported intents:
      - pricing_explanation
      - discount_suggestions
      - expiry_risk
      - competitor_comparison
      - profit_impact
      - general_greeting / general_help
    """
    return process_message(payload.message, db)


@router.get("/suggestions", response_model=List[SuggestedQuestion])
def suggestions(db: Session = Depends(get_db)):
    """
    Return contextual suggested questions based on current data state.

    Includes urgent suggestions when products are at expiry risk.
    """
    return get_suggested_questions(db)


@router.post("/market-price", response_model=MarketPriceResponse)
async def market_price_search(payload: MarketPriceQuery):
    """
    Fetch real-time product prices from quick-commerce and e-commerce platforms.

    Queries Google Shopping, DuckDuckGo, and Bing search results to extract
    live prices from Blinkit, Zepto, Swiggy Instamart, BigBasket, Amazon, etc.

    Parameters
    ----------
    payload.query : str
        Product search query, e.g. "tata salt 1kg", "amul butter 500g".

    Returns
    -------
    MarketPriceResponse with a list of per-platform prices sorted cheapest first.
    """
    results = await search_product_prices(payload.query)

    cheapest = results[0] if results else None

    return MarketPriceResponse(
        query=payload.query,
        results=results,
        platform_count=len(results),
        cheapest_platform=cheapest["platform"] if cheapest else None,
        cheapest_price=cheapest["price"] if cheapest else None,
    )
