"""
services/analytics.py — Analytics Aggregation Service
=======================================================
Pure read-only functions that query the `sales` table to produce
the KPI and trend data shown on the Analytics page.

All computation is done with SQLAlchemy queries rather than pandas
to minimise memory usage and leverage DB-level aggregation.
"""

from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models.sale import Sale
from app.models.product import Product


def get_summary(db: Session) -> dict:
    """
    Aggregate key business metrics across all recorded sales.

    Calculates
    ----------
    total_revenue    : Sum of (price_sold × units_sold) across all sales.
    total_profit     : Sum of the pre-computed profit column.
    total_units_sold : Total number of units across all transactions.
    avg_margin_pct   : Average percentage margin per sale
                       = mean of ((price_sold - cost) / cost × 100).
    products_at_risk : Count of products with days_to_expiry < 7.
                       These are flagged on the dashboard and analytics page.
    top_products     : Top 5 products ranked by cumulative profit.

    Returns
    -------
    dict matching the AnalyticsSummary Pydantic schema.
    """
    # Load all sales and products into memory (dataset is small enough)
    sales = db.query(Sale).all()
    products = db.query(Product).all()

    # ── Revenue & Profit ─────────────────────────────────────────────────────
    total_revenue = sum(s.price_sold * s.units_sold for s in sales)
    total_profit  = sum(s.profit for s in sales)
    total_units   = sum(s.units_sold for s in sales)

    # ── Average margin ───────────────────────────────────────────────────────
    # Build a lookup dict {product_id → Product} for O(1) access in the loop
    product_map = {p.product_id: p for p in products}
    margins = []
    for s in sales:
        p = product_map.get(s.product_id)
        if p and p.cost_price > 0:
            margins.append((s.price_sold - p.cost_price) / p.cost_price * 100)
    avg_margin = sum(margins) / len(margins) if margins else 0.0

    # ── Products at risk ─────────────────────────────────────────────────────
    # Count products expiring soon — shown as a red KPI card on the frontend
    at_risk = sum(1 for p in products if p.days_to_expiry < 7)

    # ── Top 5 products by profit ─────────────────────────────────────────────
    product_profits: dict[int, float] = {}
    for s in sales:
        product_profits[s.product_id] = product_profits.get(s.product_id, 0) + s.profit
    top = sorted(product_profits.items(), key=lambda x: x[1], reverse=True)[:5]
    top_products = [
        {"product_id": pid, "total_profit": round(profit, 2)}
        for pid, profit in top
    ]

    return {
        "total_revenue":    round(total_revenue, 2),
        "total_profit":     round(total_profit, 2),
        "total_units_sold": total_units,
        "avg_margin_pct":   round(avg_margin, 2),
        "products_at_risk": at_risk,
        "top_products":     top_products,
    }


def get_trends(db: Session) -> list:
    """
    Return daily aggregated revenue, profit, and units sold.

    Used to render the time-series area chart on the Analytics page.
    Groups sales by calendar date (stripping the time component) and
    orders chronologically so Recharts can plot them left-to-right.

    Returns
    -------
    list of dicts:  [{date, revenue, profit, units}, ...]
    """
    rows = (
        db.query(
            func.date(Sale.sold_at).label("date"),           # group by day
            func.sum(Sale.price_sold * Sale.units_sold).label("revenue"),
            func.sum(Sale.profit).label("profit"),
            func.sum(Sale.units_sold).label("units"),
        )
        .group_by(func.date(Sale.sold_at))
        .order_by(func.date(Sale.sold_at))   # chronological for the chart
        .all()
    )

    return [
        {
            "date":    str(r.date),
            "revenue": round(float(r.revenue or 0), 2),
            "profit":  round(float(r.profit or 0), 2),
            "units":   int(r.units or 0),
        }
        for r in rows
    ]
