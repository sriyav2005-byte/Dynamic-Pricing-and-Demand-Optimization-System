"""
api/pricing.py — Price Recommendation and Simulation Endpoints
==============================================================
Exposes the ML pricing engine to the frontend.

Routes
------
GET /pricing/recommend/{product_id}
    → Full Thompson Sampling recommendation with constraints applied.
    → Returns recommended price, expected demand, expected profit, and all 10 arms.

GET /pricing/simulate/{product_id}?price=X
    → What-if simulation at any price the user specifies.
    → Does NOT consult or update the bandit — read-only.
    → Used by the Price Simulator slider on the Product Detail page.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.product import Product
from app.schemas.product import PriceRecommendation, SimulationResult
from app.services.pricing_engine import recommend_price, simulate_price

router = APIRouter(prefix="/pricing", tags=["pricing"])


def _get_product_or_404(product_id: int, db: Session) -> Product:
    """
    Helper: fetch a product row or raise 404 if it doesn't exist.
    Used by both endpoints to avoid code duplication.
    """
    product = db.query(Product).filter(Product.product_id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found")
    return product


@router.get("/recommend/{product_id}", response_model=PriceRecommendation)
def get_recommendation(product_id: int, db: Session = Depends(get_db)):
    """
    Generate an AI price recommendation for a product.

    Internally calls recommend_price() which:
      1. Queries the Thompson Sampling bandit for the best price arm
      2. Applies pricing constraints (margin, expiry, MRP)
      3. Predicts demand at the selected price using XGBoost
      4. Evaluates all 10 arms for the Demand vs Price chart

    The `constraint_applied` field in the response indicates which (if any)
    constraint overrode the bandit's selection:
      - "expiry_discount" : product is expiring soon
      - "min_margin"      : bandit selected a below-margin price
      - "max_increase"    : bandit wanted to raise price by more than 10%
    """
    p = _get_product_or_404(product_id, db)

    # Pass the full product context to the pricing engine
    return recommend_price(
        product_id=p.product_id,
        category=p.category,
        cost_price=p.cost_price,
        mrp=p.mrp,
        current_price=p.current_price,
        stock_level=p.stock_level,
        days_to_expiry=p.days_to_expiry,
        season_factor=p.season_factor,
    )


@router.get("/simulate/{product_id}", response_model=SimulationResult)
def simulate(
    product_id: int,
    price: float = Query(..., gt=0, description="Simulated price to evaluate"),
    db: Session = Depends(get_db),
):
    """
    What-if simulation — predict demand and profit at a user-chosen price.

    Validates that the simulated price is within the valid range:
      - Must not exceed MRP (violates pricing regulations)
      - Must not be below cost (would result in a loss)

    Does NOT update the bandit state — purely informational.
    """
    p = _get_product_or_404(product_id, db)

    # Guard: simulated price must be within economic bounds
    if price > p.mrp:
        raise HTTPException(status_code=400, detail="Simulated price cannot exceed MRP")
    if price < p.cost_price:
        raise HTTPException(status_code=400, detail="Simulated price cannot be below cost")

    return simulate_price(
        product_id=p.product_id,
        category=p.category,
        cost_price=p.cost_price,
        mrp=p.mrp,
        current_price=p.current_price,
        stock_level=p.stock_level,
        days_to_expiry=p.days_to_expiry,
        season_factor=p.season_factor,
        simulated_price=price,
    )
