"""
ml/pricing/optimizer.py — evaluate candidate prices with the demand model.

For a candidate price p over a planning horizon of T days:

    d_t          predicted units/day (demand model, frozen lag features)
    sold         Σ_t min(d_t, remaining stock), zero after expiry
    unsold_exp   units still on hand when the product expires within T
    revenue      p · sold
    profit       (p − cost) · sold − cost · unsold_exp      (waste is a loss)

T = days until expiry (+1) when the product expires within 14 days,
otherwise 7. Every candidate is evaluated in one batched model call.

`demand_multiplier` scales the model's forecast: a scalar (what-if scenarios)
or one value per horizon day (staff-entered seasonal considerations, see
services/considerations.py).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from app.ml.features import future_frame
from app.ml.inference.demand import DemandModel, predict_units


@dataclass
class Evaluation:
    price: float
    demand_per_day: float
    sold: float
    revenue: float
    profit: float
    waste_units: float
    margin_pct: float
    days_to_sell_out: float | None

    def as_dict(self, horizon: int) -> dict:
        return {
            "price": round(float(self.price), 2),
            "demand": round(float(self.demand_per_day), 3),
            "units_over_horizon": round(float(self.sold), 2),
            "revenue": round(float(self.revenue) / horizon, 2),
            "profit": round(float(self.profit) / horizon, 2),
            "revenue_horizon": round(float(self.revenue), 2),
            "profit_horizon": round(float(self.profit), 2),
            "waste_units": round(float(self.waste_units), 2),
            "margin_pct": round(float(self.margin_pct), 2),
            "days_to_sell_out": None if self.days_to_sell_out is None else round(float(self.days_to_sell_out), 1),
        }


def planning_horizon(product: dict) -> int:
    dte = product.get("days_to_expiry")
    if dte is not None and not pd.isna(dte) and 0 <= dte < 14:
        return max(1, int(dte) + 1)
    return 7


def evaluate(prices: list[float], product: dict, hist: pd.DataFrame, events: list[dict], encoder: dict,
             model: DemandModel, horizon: int, demand_multiplier: float | np.ndarray = 1.0) -> list[Evaluation]:
    today = pd.Timestamp.now(tz=product.get("timezone") or "Asia/Kolkata").normalize().tz_localize(None)
    dates = [today + pd.Timedelta(days=i) for i in range(horizon)]
    h = hist.reset_index() if not hist.empty else pd.DataFrame(columns=["date", "units", "price"])
    frames = []
    for p in prices:
        f = future_frame(h, dates, float(p), product, events, encoder)
        f["_price"] = p
        frames.append(f)
    big = pd.concat(frames, ignore_index=True)
    mult = np.asarray(demand_multiplier, dtype=float)
    if mult.ndim == 1:                       # per-day values: repeat for every candidate price
        mult = np.tile(mult, len(prices))
    demand = predict_units(big, product, model) * mult
    big["_demand"] = demand

    stock = float(product.get("stock") or 0)
    cost = float(product["cost_price"])
    dte = product.get("days_to_expiry")
    has_expiry = dte is not None and not pd.isna(dte)
    out = []
    for p, g in big.groupby("_price", sort=False):
        d = g["_demand"].to_numpy()
        remaining, sold, sell_out = stock, 0.0, None
        for i, di in enumerate(d):
            if has_expiry and i > dte:
                break
            s = min(di, remaining)
            if s < di and sell_out is None and di > 0:
                sell_out = i + (s / di)
            remaining -= s
            sold += s
        waste = remaining if has_expiry and dte < horizon else 0.0
        if sell_out is None and d.mean() > 0 and stock > 0:
            sell_out = stock / d.mean()
        revenue = p * sold
        profit = (p - cost) * sold - cost * waste
        out.append(Evaluation(price=float(p), demand_per_day=float(d.mean()), sold=float(sold), revenue=float(revenue),
                              profit=float(profit), waste_units=float(waste),
                              margin_pct=float((p - cost) / p * 100) if p > 0 else 0.0,
                              days_to_sell_out=None if sell_out is None else float(sell_out)))
    order = {float(p): i for i, p in enumerate(prices)}
    return sorted(out, key=lambda e: order.get(e.price, 0))


def candidate_grid(lo: float, hi: float, extra: list[float], n: int = 15) -> list[float]:
    pts = list(np.linspace(lo, hi, n)) if hi > lo else [lo]
    pts += [x for x in extra if lo - 1e-9 <= x <= hi + 1e-9]
    return sorted({round(float(x), 2) for x in pts})
