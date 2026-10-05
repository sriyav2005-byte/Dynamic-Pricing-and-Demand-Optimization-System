"""
services/ml_admin.py — store-level ML maintenance and policy validation.

refresh(store_id)
    Recomputes own-price elasticities for every product and cross-price
    effects between products of the same category; only relationships that
    survive Benjamini–Hochberg FDR control are stored in product_relationships.

evaluate_policies(store_id)
    Offline, *model-based* comparison of pricing policies on the last 30 days of
    history: for each day, the price each policy would have chosen inside a
    ±10% band around the historical price is scored with the demand model and
    compared with the price actually charged. This is a counterfactual
    estimate (it relies on the demand model), not a live A/B test — use it to
    decide whether the challenger is worth a controlled rollout.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sqlalchemy import text

from app import db
from app.ml.features import add_lag_features, future_frame
from app.ml.inference.demand import registry
from app.ml.pricing.bandit import LIN_FEATURES, LinearThompson, context_vector
from app.ml.pricing.elasticity import apply_fdr, cross_effects_for
from app.ml.forecasting import forecaster
from app.ml import seasonal
from app.services import data, pricing


def refresh(store_id: str) -> dict:
    panel = data.panel(store_id)
    if panel.empty:
        return {"elasticities": 0, "relationships": 0, "note": "no history"}
    pricing.elasticity_for.cache_clear()
    statuses: dict[str, int] = {}
    for pid in panel["product_id"].unique():
        e = pricing.elasticity_for(store_id, pid)
        statuses[e["status"]] = statuses.get(e["status"], 0) + 1

    family = []
    for cat, g in panel.groupby("category"):
        ids = list(g["product_id"].unique())
        for target in ids:
            family += [{**r, "target": target} for r in cross_effects_for(panel, target, ids)]
    apply_fdr(family)
    tested, kept = len(family), 0
    with db.transaction() as c:
        c.execute(text("delete from product_relationships where store_id = :s"), {"s": store_id})
        for r in family:
            if not r["significant"]:
                continue
            kept += 1
            c.execute(text("""insert into product_relationships(store_id, product_id, related_product_id, relationship,
                                cross_elasticity, std_error, p_value, n_obs, method)
                              values (:s, :p, :r, :rel, :ce, :se, :pv, :n, 'Poisson GLM cross-price, BH-FDR 10%')"""),
                      {"s": store_id, "p": r["target"], "r": r["related_product_id"], "rel": r["relationship"],
                       "ce": r["cross_elasticity"], "se": r["std_error"], "pv": r["p_value"], "n": r["n_obs"]})
    forecaster._bt_cache.pop(store_id, None)
    seasonal.insights.cache_clear()
    return {"elasticities": statuses, "pairs_tested": tested, "relationships_kept": kept,
            "note": "Relationships are stored only when statistically supported (Benjamini–Hochberg, FDR 10%)."}


def evaluate_policies(store_id: str, days: int = 30) -> dict:
    reg = registry()
    m = reg.v2
    st = data.store(store_id)
    panel = data.panel(store_id)
    if m is None or panel.empty or st is None:
        return {"available": False, "reason": "no model or history"}
    events = data.seasonal_events(st["organization_id"], panel["date"].min().date(), panel["date"].max().date())
    results = []
    for pid, g in add_lag_features(panel).groupby("product_id"):
        g = g.set_index("date").sort_index()
        if len(g) < 60:
            continue
        product = data.product(store_id, pid)
        # Warm-start the challenger on pre-window data only, without persisting it.
        lin = LinearThompson.__new__(LinearThompson)
        lin.store_id, lin.product, lin.rng = store_id, product, np.random.default_rng(0)
        lin.state = lin._warm_start(g.iloc[:-days], len(LIN_FEATURES))
        lin.A, lin.b = np.asarray(lin.state["A"]), np.asarray(lin.state["b"])
        rows = {"actual": [], "model_greedy": [], "contextual_greedy": []}
        for d in g.index[-days:]:
            hist = g[g.index < d]
            day = g.loc[d]
            base = float(day["price"])
            grid = np.round(np.linspace(base * 0.9, min(base * 1.1, float(day["mrp"])), 9), 2)
            prod = {"cost_price": float(day["cost_price"]), "mrp": float(day["mrp"]), "category": day["category"],
                    "season_factor": float(day["season_factor"]), "days_to_expiry": None}
            f = future_frame(hist.reset_index(), [d] * len(grid), grid, prod, events, m.encoder)
            f["days_to_expiry"] = day["days_to_expiry"]
            dem = np.clip(m.model.predict(f[m.features]), 0, None)
            prof = (grid - prod["cost_price"]) * dem
            i_actual = int(np.argmin(np.abs(grid - base)))
            rows["actual"].append(prof[i_actual])
            rows["model_greedy"].append(float(prof.max()))
            X = np.array([context_vector(p, lin.ref_price, day["days_to_expiry"], int(d.dayofweek >= 5), 0, None) for p in grid])
            mu = np.linalg.solve(lin.A, lin.b)
            rows["contextual_greedy"].append(float(prof[int(np.argmax(X @ mu))]))
        results.append({k: float(np.mean(v)) for k, v in rows.items()})
    if not results:
        return {"available": False, "reason": "need ≥ 60 days of history per product"}
    df = pd.DataFrame(results)
    base = df["actual"].sum()
    return {
        "available": True, "products": len(df), "days": days,
        "avg_daily_profit_per_product": {k: round(float(df[k].mean()), 2) for k in df.columns},
        "uplift_vs_actual_pct": {k: round(float((df[k].sum() - base) / base * 100), 2) for k in ("model_greedy", "contextual_greedy")},
        "method": "Model-based counterfactual on the last 30 days (±10% band around the historical price). Not a live A/B test.",
        "recommendation": "Keep thompson_sampling_v2 as the production policy; enable contextual_ts only after a controlled live test confirms the offline result.",
    }
