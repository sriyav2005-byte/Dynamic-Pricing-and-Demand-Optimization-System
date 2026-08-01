"""
api/competitor.py — Competitor Price Intelligence Endpoints
============================================================
Routes
------
GET  /competitor/prices/{product_id}     → Competitor prices for one product
GET  /competitor/market-overview         → All products with competitor data (supports ?live=true)
GET  /competitor/strategy/{product_id}   → Pricing strategy recommendation
POST /competitor/fetch-live/{product_id} → Fetch real-time live prices from Blinkit, Zepto, Instamart, BigBasket, Amazon, Flipkart
POST /competitor/live-search             → Search real-time fast commerce prices for any custom product query
"""

from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from app.database import get_db
from app.models.product import Product
from app.schemas.competitor import (
    CompetitorPriceResponse,
    MarketOverviewItem,
    PricingStrategyResponse,
    LiveFetchRequest,
    LiveFetchResponse,
)
from app.schemas.agent import MarketPriceQuery
from app.services.competitor_service import (
    get_competitor_prices,
    get_market_overview,
    get_pricing_strategy,
    fetch_live_competitor_prices,
    fetch_all_live_market_overview,
)
from app.services.market_scraper import search_product_prices

router = APIRouter(prefix="/competitor", tags=["competitor"])


@router.get("/prices/{product_id}", response_model=CompetitorPriceResponse)
def competitor_prices(product_id: int, db: Session = Depends(get_db)):
    """
    Get competitor prices for a single product across all platforms.
    """
    product = db.query(Product).filter(Product.product_id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found")

    return get_competitor_prices(
        product_id=product.product_id,
        cost_price=product.cost_price,
        mrp=product.mrp,
        category=product.category,
        our_price=product.current_price,
    )


@router.get("/market-overview", response_model=List[MarketOverviewItem])
async def market_overview(live: bool = Query(False), db: Session = Depends(get_db)):
    """
    Get competitor comparison data for all products.
    Pass ?live=true to load real-time prices scraped from fast commerce platforms.
    """
    products = db.query(Product).all()
    if live:
        return await fetch_all_live_market_overview(products)
    return get_market_overview(products)


@router.post("/fetch-live/{product_id}", response_model=MarketOverviewItem)
async def fetch_live_product_prices(product_id: int, db: Session = Depends(get_db)):
    """
    Fetch real-time scraped fast commerce prices for a single product.
    Queries Blinkit, Zepto, Swiggy Instamart, BigBasket, Amazon, Flipkart, JioMart.
    """
    product = db.query(Product).filter(Product.product_id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found")

    return await fetch_live_competitor_prices(product)


@router.post("/live-search", response_model=LiveFetchResponse)
async def live_search_fast_commerce(payload: MarketPriceQuery):
    """
    Search real-time product prices across fast-commerce platforms directly
    from the Competitor page.
    """
    results = await search_product_prices(payload.query)

    # Sort by price ascending so results[0] is the cheapest
    results = sorted(results, key=lambda r: r.get("price", 0))

    prices = [r["price"] for r in results if isinstance(r.get("price"), (int, float))]
    market_avg = round(sum(prices) / len(prices), 2) if prices else 0.0
    cheapest = results[0] if results else None
    now_str = datetime.now().strftime("%I:%M %p")

    return LiveFetchResponse(
        query=payload.query,
        product_id=None,
        our_price=None,
        market_avg=market_avg,
        cheapest_platform=cheapest["platform"] if cheapest else "N/A",
        cheapest_price=float(cheapest["price"]) if cheapest else 0.0,
        competitiveness_score=85.0,
        price_position="market_tracked",
        results=results,
        fetched_at=now_str,
    )


@router.get("/strategy/{product_id}", response_model=PricingStrategyResponse)
def pricing_strategy(product_id: int, db: Session = Depends(get_db)):
    """
    Get a recommended pricing strategy for a product.
    """
    product = db.query(Product).filter(Product.product_id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found")

    return get_pricing_strategy(
        product_id=product.product_id,
        cost_price=product.cost_price,
        mrp=product.mrp,
        category=product.category,
        our_price=product.current_price,
        days_to_expiry=product.days_to_expiry,
        stock_level=product.stock_level,
    )

