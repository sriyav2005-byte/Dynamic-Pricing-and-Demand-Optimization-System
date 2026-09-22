"""
api/competitor.py — Competitor Price Intelligence Endpoints
============================================================
Routes
------
GET  /competitor/prices/{product_id}   → Competitor prices for one product
GET  /competitor/market-overview       → All products with competitor data
GET  /competitor/strategy/{product_id} → Pricing strategy recommendation
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models.product import Product
from app.schemas.competitor import (
    CompetitorPriceResponse,
    MarketOverviewItem,
    PricingStrategyResponse,
)
from app.services.competitor_service import (
    get_competitor_prices,
    get_market_overview,
    get_pricing_strategy,
)

router = APIRouter(prefix="/competitor", tags=["competitor"])


@router.get("/prices/{product_id}", response_model=CompetitorPriceResponse)
def competitor_prices(product_id: int, db: Session = Depends(get_db)):
    """
    Get competitor prices for a single product across all platforms.

    Returns our price, competitor prices (Blinkit, Zepto, Instamart, BigBasket),
    market average, and competitiveness score.
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
def market_overview(db: Session = Depends(get_db)):
    """
    Get competitor comparison data for all products.

    Returns a list of products with their competitor prices and
    competitiveness metrics. Used by the Competitor Analysis page.
    """
    products = db.query(Product).all()
    return get_market_overview(products)


@router.get("/strategy/{product_id}", response_model=PricingStrategyResponse)
def pricing_strategy(product_id: int, db: Session = Depends(get_db)):
    """
    Get a recommended pricing strategy for a product based on
    competitor data and product context (stock, expiry).

    Strategies: aggressive_discount, undercut, match, premium
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
