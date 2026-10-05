"""
services/considerations.py — apply staff-entered seasonal considerations.

A seasonal consideration (table seasonal_considerations, managed through the
Go API / Seasonal page) is a *planning assumption*: "between these dates,
demand for this product / category / the whole store is expected to change by
X% and supply is NORMAL / SURPLUS / LIMITED / SHORTAGE".

How it feeds pricing intelligence
    1. `for_product()` loads the active considerations that overlap the
       planning horizon and match the product (own id, its category, or the
       whole store).
    2. `daily_multipliers()` turns them into one demand multiplier per day:

           multiplier(day) = Π (1 + change% × weight)   over considerations active that day

       weight = 1 for a consideration that targets the product itself.
       For category- or store-wide considerations the weight is the product's
       own sensitivity for that kind (SEASON → seasonal_sensitivity,
       FESTIVAL/EVENT → festival_sensitivity, WEATHER → weather_sensitivity).
       If the product has no sensitivity recorded, the level entered on the
       consideration (LOW .5 / MEDIUM .75 / HIGH 1) is used, else 1.
    3. The optimizer multiplies the demand model's forecast by it, so stock
       cover, expected waste and the profit of every candidate price reflect
       the assumption.
    4. A SHORTAGE supply condition additionally stops the policy from
       discounting scarce stock (`shortage` flag; see services/pricing.py).

The adjustment is always reported separately ("MANUAL planning assumption")
and never changes the allowed price band — the Go constraint engine still
has the final word on every price.
"""

from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd

from app import db

LEVEL_WEIGHT = {"LOW": 0.5, "MEDIUM": 0.75, "HIGH": 1.0}
SENSITIVITY_FIELD = {"SEASON": "seasonal_sensitivity", "FESTIVAL": "festival_sensitivity",
                     "EVENT": "festival_sensitivity", "WEATHER": "weather_sensitivity"}
MIN_MULT, MAX_MULT = 0.1, 4.0     # guard rails against stacked extreme assumptions


def for_product(store_id: str, product: dict, start: date, end: date) -> list[dict]:
    """Active considerations overlapping [start, end] that apply to the product."""
    from app.services import data
    if data._batch.get() is not None:
        # Store-wide job: one query for the whole store, scoped here exactly as the SQL below does.
        rows = data.batch_memo(("considerations", store_id, start, end), lambda: db.fetch_all(_SELECT + """
            where sc.store_id = :sid and sc.is_active and sc.end_date >= :a and sc.start_date <= :b
            order by sc.start_date, sc.name""", sid=store_id, a=start, b=end))
        pid, cid = product["id"], product.get("category_id")
        return [_public(r) for r in rows
                if r["product_id"] == pid or (r["product_id"] is None and (r["category_id"] is None or r["category_id"] == cid))]
    return [_public(r) for r in db.fetch_all(
        _SELECT + """
        where sc.store_id = :sid and sc.is_active
          and sc.end_date >= :a and sc.start_date <= :b
          and (sc.product_id = cast(:pid as uuid)
               or (sc.product_id is null and sc.category_id = cast(:cid as uuid))
               or (sc.product_id is null and sc.category_id is null))
        order by sc.start_date, sc.name
        """,
        sid=store_id, pid=product["id"], cid=product.get("category_id"), a=start, b=end,
    )]


def _public(row: dict) -> dict:
    return {k: v for k, v in row.items() if k not in ("product_id", "category_id")}


_SELECT = """
        select sc.id::text, sc.name, sc.kind, sc.start_date, sc.end_date,
               sc.expected_demand_change_pct::float8 as change_pct, sc.supply_condition,
               sc.weather_sensitivity, sc.festival_sensitivity, sc.notes,
               sc.product_id::text as product_id, sc.category_id::text as category_id,
               case when sc.product_id is not null then 'PRODUCT'
                    when sc.category_id is not null then 'CATEGORY' else 'STORE' end as scope
        from seasonal_considerations sc
"""


def weight(product: dict, c: dict) -> float:
    """Share of a consideration's stated effect that applies to this product."""
    if c["scope"] == "PRODUCT":
        return 1.0
    own = product.get(SENSITIVITY_FIELD.get(c["kind"], ""))
    if own is not None and not pd.isna(own):
        return float(own)
    level = c.get("weather_sensitivity") if c["kind"] == "WEATHER" else c.get("festival_sensitivity")
    return LEVEL_WEIGHT.get(level or "", 1.0)


def daily_multipliers(product: dict, considerations: list[dict], dates: list) -> tuple[np.ndarray, list[dict]]:
    """Per-day demand multipliers plus a description of what was applied."""
    mult = np.ones(len(dates), dtype=float)
    applied = []
    days = [pd.Timestamp(d).date() for d in dates]
    for c in considerations:
        w = weight(product, c)
        effect = float(c["change_pct"]) / 100.0 * w
        active = np.array([c["start_date"] <= d <= c["end_date"] for d in days])
        if not active.any():
            continue
        mult[active] *= 1.0 + effect
        applied.append({
            "id": c["id"], "name": c["name"], "kind": c["kind"], "scope": c["scope"],
            "start_date": c["start_date"].isoformat(), "end_date": c["end_date"].isoformat(),
            "stated_change_pct": round(float(c["change_pct"]), 2), "weight": round(w, 2),
            "applied_change_pct": round(effect * 100, 2), "days_in_horizon": int(active.sum()),
            "supply_condition": c["supply_condition"], "source": "MANUAL",
        })
    return np.clip(mult, MIN_MULT, MAX_MULT), applied


def plan(store_id: str, product: dict, dates: list) -> dict:
    """Everything the pricing / forecasting code needs for a planning horizon."""
    if not dates:
        return {"multipliers": np.ones(0), "applied": [], "shortage": False, "supply": []}
    days = [pd.Timestamp(d).date() for d in dates]
    try:
        rows = for_product(store_id, product, min(days), max(days))
    except Exception:
        # A missing table (migration not applied yet) must not break pricing.
        rows = []
    mult, applied = daily_multipliers(product, rows, dates)
    supply = sorted({a["supply_condition"] for a in applied if a["supply_condition"] != "NORMAL"})
    return {"multipliers": mult, "applied": applied, "shortage": "SHORTAGE" in supply, "supply": supply}


def describe(applied: list[dict]) -> str:
    return "; ".join(
        f"{a['name']} ({a['applied_change_pct']:+.0f}% demand on {a['days_in_horizon']} day(s)"
        + (f", supply {a['supply_condition'].lower()}" if a["supply_condition"] != "NORMAL" else "") + ")"
        for a in applied)
