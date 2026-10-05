"""
services/expiry.py — markdown optimization for perishable stock.

For every product with stock that expires within the store's markdown window
(or within 14 days), markdown levels from 0% up to the store's maximum are
evaluated with the demand model over the product's remaining shelf life:

    expected units sold before expiry, expected liquidation %, waste units,
    revenue and profit net of waste.

The recommended markdown maximizes profit net of waste (cost is sunk, so this
is the revenue-maximizing clearance price subject to the floor). The floor is
break-even cost unless below-cost clearance is enabled in store settings.

Wastage risk = share of the stock on hand not expected to sell before expiry
at the current price. Staff-entered seasonal considerations (festival demand,
weather, supply) scale the demand forecast before the markdowns are compared.
The markdowns are suggestions: applying one still goes through a pricing
recommendation and the Go constraint engine.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.ml.inference.demand import registry
from app.ml.pricing import optimizer
from app.services import considerations, data


def optimize(store_id: str, settings: dict) -> dict:
    with data.batch():        # per-product lookups become one store-level query each
        return _optimize(store_id, settings)


def _optimize(store_id: str, settings: dict) -> dict:
    window = max(int(settings.get("expiry_markdown_days") or 7), 1)
    max_md = float(settings.get("max_expiry_markdown_pct") or 0.4)
    below_cost = bool(settings.get("allow_below_cost_clearance"))
    reg = registry()
    items = []
    hists = data.histories(store_id)
    for sp in data.store_products(store_id):
        dte = sp.get("days_to_expiry")
        if dte is None or pd.isna(dte) or dte < 0 or dte > max(window, 14) or not sp.get("stock"):
            continue
        product = data.product(store_id, sp["id"])
        hist = hists.get(sp["id"], pd.DataFrame())
        model = reg.select(product)
        horizon = int(dte) + 1
        today = pd.Timestamp.now(tz=product.get("timezone") or "Asia/Kolkata").normalize().tz_localize(None)
        cons = considerations.plan(store_id, product, [today + pd.Timedelta(days=i) for i in range(horizon)])
        events = data.seasonal_events(product["organization_id"], pd.Timestamp.now().date(),
                                      (pd.Timestamp.now() + pd.Timedelta(days=90)).date())
        cur, cost = float(product["price"]), float(product["cost_price"])
        floor = 0.01 if below_cost else cost
        levels = [m for m in np.arange(0, max_md + 1e-9, 0.05)]
        prices = sorted({round(max(cur * (1 - m), floor), 2) for m in levels})
        evals = optimizer.evaluate(prices, product, hist, events, model.encoder, model, horizon,
                                   demand_multiplier=cons["multipliers"])
        stock = float(product["stock"])
        rows = [{"markdown_pct": round((1 - e.price / cur) * 100, 1), "price": e.price,
                 "expected_units_sold": round(e.sold, 1), "liquidation_pct": round(e.sold / stock * 100, 1) if stock else None,
                 "waste_units": round(e.waste_units, 1), "revenue": round(e.revenue, 2), "profit_net_of_waste": round(e.profit, 2)}
                for e in evals]
        best = max(rows, key=lambda r: r["profit_net_of_waste"])
        base = next(r for r in rows if abs(r["price"] - cur) < 0.005) if any(abs(r["price"] - cur) < 0.005 for r in rows) else rows[-1]
        risk = "CRITICAL" if dte <= 3 and base["waste_units"] > 0 else "HIGH" if base["waste_units"] > 0 else "LOW"
        items.append({
            "product_id": sp["id"], "product_name": sp["name"], "category": sp["category"], "stock": int(stock),
            "days_to_expiry": int(dte), "current_price": cur, "cost_price": cost, "expiry_risk": risk,
            "is_perishable": bool(product.get("is_perishable")), "shelf_life_days": product.get("shelf_life_days"),
            "wastage_risk_pct": round(base["waste_units"] / stock * 100, 1) if stock else None,
            "considerations": cons["applied"],
            "at_current_price": base, "recommended": best,
            "waste_reduction_units": round(base["waste_units"] - best["waste_units"], 1),
            "profit_gain": round(best["profit_net_of_waste"] - base["profit_net_of_waste"], 2),
            "options": rows, "model_version": model.key,
        })
    items.sort(key=lambda x: (x["days_to_expiry"], -x["waste_reduction_units"]))
    return {"items": items, "window_days": window, "max_markdown_pct": max_md * 100,
            "floor": "any price (below-cost clearance enabled)" if below_cost else "break-even (cost price)",
            "method": "Demand-model evaluation of markdown levels over remaining shelf life; profit is net of expected waste."}
