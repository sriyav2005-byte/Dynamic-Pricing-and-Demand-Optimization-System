"""
api/sales.py — Sales Recording and Analytics Endpoints
=======================================================
Handles the critical feedback loop that makes the system learn over time.

Routes
------
POST /update-sales
    Records a sale, updates the product's current price, and feeds the
    reward back to the Thompson Sampling bandit so it learns.

GET /analytics/summary
    Aggregate KPI metrics (revenue, profit, margin, at-risk products).

GET /analytics/trends
    Daily time-series data for the sales trend chart.

Learning Loop (POST /update-sales)
------------------------------------
1. Record the sale in the `sales` table (price, units, profit).
2. Update product.current_price to the sold price.
3. Identify which bandit arm is closest to the price used.
4. Compute normalised reward = profit / max_possible_profit ∈ [0, 1].
5. Update bandit: alpha[arm] += reward, beta[arm] += (1 - reward).

This closes the feedback loop:
    recommend → sell → observe → update → better recommendations
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models.sale import Sale
from app.models.product import Product
from app.schemas.sale import SaleCreate, SaleResponse, AnalyticsSummary, TrendPoint
from app.services.bandit import get_bandit
from app.services.analytics import get_summary, get_trends

router = APIRouter(tags=["sales"])


@router.post("/update-sales", response_model=SaleResponse)
def update_sales(payload: SaleCreate, db: Session = Depends(get_db)):
    """
    Record a completed sale and update the bandit model.

    Request body
    ------------
    product_id : Product that was sold.
    price      : Price at which it was sold.
    units_sold : Number of units in this sale.

    Side effects
    ------------
    - Inserts a new row into the `sales` table.
    - Updates product.current_price to the sold price.
    - Feeds a normalised reward back to the Thompson Sampling bandit.
    """
    # Verify the product exists before recording a sale
    product = db.query(Product).filter(Product.product_id == payload.product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    # Compute profit = margin × quantity
    profit = (payload.price - product.cost_price) * payload.units_sold

    # Persist the sale record
    sale = Sale(
        product_id=payload.product_id,
        price_sold=payload.price,
        units_sold=payload.units_sold,
        profit=profit,
    )
    db.add(sale)

    # Update the product's active price so the dashboard reflects the change
    product.current_price = payload.price
    db.commit()
    db.refresh(sale)

    # ── Bandit update ─────────────────────────────────────────────────────────
    bandit = get_bandit()
    arms = bandit.get_all_arms(product.product_id, product.cost_price, product.mrp)

    # Find the arm index whose price is closest to what was actually sold.
    # This handles cases where the sold price was from a simulation rather
    # than directly from the bandit's recommendation.
    arm_idx = min(
        range(len(arms)),
        key=lambda i: abs(arms[i]["price"] - payload.price),
    )

    # Normalise reward to [0, 1]:
    #   reward = profit / (max possible profit if sold at MRP)
    # This prevents high-volume low-margin sales from getting artificially
    # high rewards just because units_sold is large.
    max_possible_profit = (product.mrp - product.cost_price) * payload.units_sold
    normalised_reward = (
        min(1.0, max(0.0, profit / max_possible_profit))
        if max_possible_profit > 0
        else 0.0
    )

    bandit.update(payload.product_id, arm_idx, normalised_reward, product.cost_price, product.mrp)

    return sale


@router.get("/analytics/summary", response_model=AnalyticsSummary)
def analytics_summary(db: Session = Depends(get_db)):
    """
    Return aggregated KPI metrics across all sales.

    Displayed as the stat cards at the top of the Analytics page:
      - Total Revenue, Total Profit, Units Sold, Avg Margin, At-Risk Products
    """
    return get_summary(db)


@router.get("/analytics/trends", response_model=List[TrendPoint])
def analytics_trends(db: Session = Depends(get_db)):
    """
    Return daily revenue, profit, and unit count aggregates.

    Used to render the time-series area chart on the Analytics page.
    Returns an empty list if no sales have been recorded yet.
    """
    return get_trends(db)
