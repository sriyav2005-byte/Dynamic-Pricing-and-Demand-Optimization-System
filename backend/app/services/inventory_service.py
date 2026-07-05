"""
services/inventory_service.py — Inventory Intelligence Service
===============================================================
Analyses stock levels, expiry risk, and category health to provide
actionable inventory management insights.

Key functions
-------------
- get_inventory_overview : Full dashboard metrics
- get_expiry_risk       : Products at risk with markdown recommendations
- get_inventory_alerts  : Categorised alert cards (critical/warning/info)
"""

from typing import List
from app.services.demand_predictor import get_predictor


# ── Thresholds ────────────────────────────────────────────────────────────────
LOW_STOCK_THRESHOLD = 30
OVERSTOCK_THRESHOLD = 150
EXPIRY_CRITICAL_DAYS = 3
EXPIRY_WARNING_DAYS = 7
EXPIRY_WATCH_DAYS = 14


def get_inventory_overview(products: list) -> dict:
    """
    Comprehensive inventory health dashboard.

    Returns
    -------
    dict with:
        total_products, total_stock_value, category_health,
        risk_distribution, stock_distribution, expiry_timeline
    """
    predictor = get_predictor()

    # Category health
    cat_map: dict[str, dict] = {}
    risk_dist = {"critical": 0, "warning": 0, "healthy": 0}
    stock_dist = {"low_stock": 0, "optimal": 0, "overstock": 0}
    expiry_timeline = {"0_3_days": 0, "3_7_days": 0, "7_14_days": 0, "14_plus": 0}
    total_stock_value = 0.0

    for p in products:
        cat = p.category
        if cat not in cat_map:
            cat_map[cat] = {
                "category": cat,
                "total_products": 0,
                "healthy": 0,
                "at_risk": 0,
                "critical": 0,
                "total_stock": 0,
                "avg_days_to_expiry": 0,
                "_expiry_sum": 0,
            }

        cm = cat_map[cat]
        cm["total_products"] += 1
        cm["total_stock"] += p.stock_level
        cm["_expiry_sum"] += p.days_to_expiry

        stock_value = p.current_price * p.stock_level
        total_stock_value += stock_value

        # Risk classification
        if p.days_to_expiry < EXPIRY_CRITICAL_DAYS or (p.days_to_expiry < EXPIRY_WARNING_DAYS and p.stock_level > 100):
            risk_dist["critical"] += 1
            cm["critical"] += 1
        elif p.days_to_expiry < EXPIRY_WARNING_DAYS:
            risk_dist["warning"] += 1
            cm["at_risk"] += 1
        else:
            risk_dist["healthy"] += 1
            cm["healthy"] += 1

        # Stock classification
        if p.stock_level < LOW_STOCK_THRESHOLD:
            stock_dist["low_stock"] += 1
        elif p.stock_level > OVERSTOCK_THRESHOLD:
            stock_dist["overstock"] += 1
        else:
            stock_dist["optimal"] += 1

        # Expiry timeline
        if p.days_to_expiry <= 3:
            expiry_timeline["0_3_days"] += 1
        elif p.days_to_expiry <= 7:
            expiry_timeline["3_7_days"] += 1
        elif p.days_to_expiry <= 14:
            expiry_timeline["7_14_days"] += 1
        else:
            expiry_timeline["14_plus"] += 1

    # Calculate category averages
    category_health = []
    for cm in cat_map.values():
        n = cm["total_products"]
        cm["avg_days_to_expiry"] = round(cm["_expiry_sum"] / n, 1) if n else 0
        health_pct = round((cm["healthy"] / n) * 100, 1) if n else 0
        cm["health_pct"] = health_pct
        del cm["_expiry_sum"]
        category_health.append(cm)

    category_health.sort(key=lambda x: x["health_pct"])

    return {
        "total_products": len(products),
        "total_stock_value": round(total_stock_value, 2),
        "risk_distribution": risk_dist,
        "stock_distribution": stock_dist,
        "expiry_timeline": expiry_timeline,
        "category_health": category_health,
    }


def get_expiry_risk(products: list) -> list:
    """
    Products at expiry risk with recommended markdown percentages.

    Logic:
      - < 3 days: Markdown 40-50% (fire sale)
      - 3-7 days: Markdown 20-30%
      - 7-14 days: Markdown 10-15% (early action)

    Returns list sorted by days_to_expiry ascending (most urgent first).
    """
    at_risk = []

    for p in products:
        if p.days_to_expiry >= EXPIRY_WATCH_DAYS:
            continue

        if p.days_to_expiry < EXPIRY_CRITICAL_DAYS:
            risk_level = "critical"
            markdown_pct = min(50, max(40, 50 - p.days_to_expiry * 5))
            urgency = "immediate"
        elif p.days_to_expiry < EXPIRY_WARNING_DAYS:
            risk_level = "warning"
            markdown_pct = min(30, max(20, 35 - p.days_to_expiry * 2))
            urgency = "high"
        else:
            risk_level = "watch"
            markdown_pct = min(15, max(10, 20 - p.days_to_expiry))
            urgency = "moderate"

        suggested_price = round(p.current_price * (1 - markdown_pct / 100), 2)
        suggested_price = max(suggested_price, p.cost_price * 1.02)  # min 2% margin

        waste_value = round(p.cost_price * p.stock_level, 2)

        at_risk.append({
            "product_id": p.product_id,
            "category": p.category,
            "current_price": p.current_price,
            "cost_price": p.cost_price,
            "stock_level": p.stock_level,
            "days_to_expiry": p.days_to_expiry,
            "risk_level": risk_level,
            "urgency": urgency,
            "markdown_pct": markdown_pct,
            "suggested_price": suggested_price,
            "potential_waste_value": waste_value,
        })

    at_risk.sort(key=lambda x: x["days_to_expiry"])
    return at_risk


def get_inventory_alerts(products: list) -> list:
    """
    Generate prioritised inventory alerts.

    Alert types:
      - critical: Expiring in < 3 days with stock > 0
      - warning:  Expiring in 3-7 days OR stock < LOW_STOCK_THRESHOLD
      - info:     Overstocked (> OVERSTOCK_THRESHOLD) OR watch-list expiry
    """
    alerts = []

    for p in products:
        # Critical: about to expire with stock
        if p.days_to_expiry < EXPIRY_CRITICAL_DAYS and p.stock_level > 0:
            alerts.append({
                "type": "critical",
                "product_id": p.product_id,
                "category": p.category,
                "title": f"Product #{p.product_id} expires in {p.days_to_expiry} day(s)",
                "message": (
                    f"{p.stock_level} units of {p.category} at risk. "
                    f"Potential waste: ₹{round(p.cost_price * p.stock_level, 2)}. "
                    "Apply immediate markdown."
                ),
                "metric_value": p.days_to_expiry,
                "metric_label": "days to expiry",
            })

        # Warning: expiring soon
        elif p.days_to_expiry < EXPIRY_WARNING_DAYS:
            alerts.append({
                "type": "warning",
                "product_id": p.product_id,
                "category": p.category,
                "title": f"Product #{p.product_id} expiring soon ({p.days_to_expiry}d)",
                "message": (
                    f"{p.stock_level} units remaining. "
                    "Consider promotional pricing to accelerate sales."
                ),
                "metric_value": p.days_to_expiry,
                "metric_label": "days to expiry",
            })

        # Warning: low stock
        if p.stock_level < LOW_STOCK_THRESHOLD and p.days_to_expiry >= EXPIRY_WARNING_DAYS:
            alerts.append({
                "type": "warning",
                "product_id": p.product_id,
                "category": p.category,
                "title": f"Product #{p.product_id} low stock ({p.stock_level} units)",
                "message": (
                    f"Only {p.stock_level} units of {p.category} left. "
                    "Consider reordering to avoid stockout."
                ),
                "metric_value": p.stock_level,
                "metric_label": "units",
            })

        # Info: overstocked
        if p.stock_level > OVERSTOCK_THRESHOLD:
            alerts.append({
                "type": "info",
                "product_id": p.product_id,
                "category": p.category,
                "title": f"Product #{p.product_id} overstocked ({p.stock_level} units)",
                "message": (
                    f"Stock level ({p.stock_level}) exceeds optimal range. "
                    "Consider promotional pricing to increase turnover."
                ),
                "metric_value": p.stock_level,
                "metric_label": "units",
            })

    # Sort: critical first, then warning, then info
    priority = {"critical": 0, "warning": 1, "info": 2}
    alerts.sort(key=lambda a: (priority.get(a["type"], 3), a.get("metric_value", 999)))

    return alerts
