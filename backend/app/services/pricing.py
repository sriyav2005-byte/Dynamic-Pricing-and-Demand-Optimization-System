"""
services/pricing.py — recommendation, simulation and closed-loop feedback.

Pipeline for POST /v1/pricing/recommend
    1. Load product, daily history, competitor market, elasticity, events and
       the staff-entered seasonal considerations that overlap the horizon.
    2. Evaluate candidate prices with the demand model (optimizer.evaluate);
       considerations scale the forecast day by day (services/considerations.py):
         * model price  = best objective over the economic range [cost, MRP]
                          (what the model would do without business rules)
         * band grid    = candidates inside the allowed band [lo, hi]
                          computed by the Go API's constraint engine
    3. Policy picks the price inside the band:
         model_ts (default)  Thompson Sampling over the 10 Beta arms with a
                             model-informed prior
         contextual_ts       linear Thompson Sampling (runs in shadow mode
                             unless PRICING_POLICY=contextual_ts)
    4. Explanation: drivers (forecast, competitors, inventory, expiry / wastage,
       elasticity, season, considerations, history), exact TreeSHAP
       contributions of the demand model at the recommended price, expected
       impact vs. current price and data provenance labels.

The band [lo, hi] comes from the Go constraint engine and is the only place
the policy may pick from; the Go API clamps and re-validates whatever is
returned here, so nothing in this module can override a business rule.
"""

from __future__ import annotations

import math
from datetime import date

import numpy as np
import pandas as pd

from app import db
from app.config import get_settings
from app.ml import seasonal
from app.ml.inference.demand import registry, shap_for
from app.ml.pricing import optimizer
from app.ml.pricing.bandit import LinearThompson, ThompsonBandit, context_vector, normalize, reference_profit
from app.ml.pricing.elasticity import own_price_elasticity
from app.services import considerations, data
from app.utils.cache import ttl_cache

FEATURE_LABELS = {
    "price": "Price level", "rel_price": "Price vs. recent average", "margin": "Margin", "price_to_mrp": "Price vs. MRP",
    "base_demand_28": "28-day sales level", "base_demand_7": "7-day sales level", "day_of_week": "Day of week",
    "is_weekend": "Weekend", "month": "Month", "days_to_expiry": "Days to expiry", "season_factor": "Season factor",
    "event_flag": "Festival window", "days_to_event": "Days to next festival", "category_enc": "Category",
    "cost_price": "Cost", "mrp": "MRP", "product_id": "Product identity", "stock_level": "Stock level",
}


@ttl_cache(3600)
def elasticity_for(store_id: str, product_id: str) -> dict:
    hist = data.history(store_id, product_id)
    res = own_price_elasticity(hist) if not hist.empty else {"status": "INSUFFICIENT_DATA", "elasticity": None,
                                                              "n_obs": 0, "reason": "no sales history",
                                                              "method": "Poisson GLM (log-log), HC1 SE"}
    try:
        db.execute(
            """insert into price_elasticities(product_id, store_id, status, elasticity, std_error, ci_low, ci_high, p_value,
                                              r_squared, n_obs, price_cv, method, computed_at)
               values (:p, :s, :st, :e, :se, :lo, :hi, :pv, :r2, :n, :cv, :m, now())
               on conflict (product_id) do update set status = excluded.status, elasticity = excluded.elasticity,
                 std_error = excluded.std_error, ci_low = excluded.ci_low, ci_high = excluded.ci_high, p_value = excluded.p_value,
                 r_squared = excluded.r_squared, n_obs = excluded.n_obs, price_cv = excluded.price_cv, method = excluded.method,
                 computed_at = now()""",
            p=product_id, s=store_id, st=res["status"], e=res.get("elasticity"), se=res.get("std_error"),
            lo=res.get("ci_low"), hi=res.get("ci_high"), pv=res.get("p_value"), r2=res.get("pseudo_r2"),
            n=res.get("n_obs", 0), cv=res.get("price_cv"), m=res.get("method", ""),
        )
    except Exception:
        pass
    return res


def _events(product: dict, days: int = 90) -> list[dict]:
    today = date.today()
    return data.seasonal_events(product["organization_id"], today, today + pd.Timedelta(days=days))


def _horizon_dates(product: dict, horizon: int) -> list[pd.Timestamp]:
    """The planning days optimizer.evaluate() uses (today … today + horizon − 1, store timezone)."""
    today = pd.Timestamp.now(tz=product.get("timezone") or "Asia/Kolkata").normalize().tz_localize(None)
    return [today + pd.Timedelta(days=i) for i in range(horizon)]


def _pct(new: float, old: float, min_base: float = 1.0) -> float | None:
    """Percent change; None when the baseline is too close to zero to be meaningful."""
    return None if old is None or abs(old) < min_base else round((new - old) / abs(old) * 100, 2)


def _shap_explanation(product: dict, hist: pd.DataFrame, events: list[dict], price: float, horizon: int) -> dict:
    """Average TreeSHAP contributions over the planning horizon at `price`."""
    reg = registry()
    model = reg.select(product)
    today = pd.Timestamp.now(tz=product.get("timezone") or "Asia/Kolkata").normalize().tz_localize(None)
    dates = [today + pd.Timedelta(days=i) for i in range(horizon)]
    h = hist.reset_index() if not hist.empty else pd.DataFrame(columns=["date", "units", "price"])
    from app.ml.features import future_frame
    frame = future_frame(h, dates, price, product, events, model.encoder)
    contrib, X = shap_for(frame, product, model)
    mean_c = contrib.mean()
    bias = float(mean_c.pop("bias"))
    rows = []
    for feat, c in mean_c.sort_values(key=lambda s: -s.abs()).items():
        val = X[feat].mean()
        effect = (math.exp(c) - 1) * 100 if model.log_link else None
        rows.append({"feature": feat, "label": FEATURE_LABELS.get(feat, feat),
                     "value": None if pd.isna(val) else round(float(val), 3),
                     "contribution": round(float(c), 4),
                     "effect_pct": None if effect is None else round(effect, 1),
                     "direction": "increases demand" if c > 0 else "decreases demand"})
    return {"model_version": model.key, "method": "TreeSHAP (XGBoost pred_contribs)",
            "scale": "log-demand (effect_pct = multiplicative % change in demand)" if model.log_link else "units/day",
            "baseline": round(math.exp(bias) if model.log_link else bias, 3), "top": rows[:8]}


def recommend(store_id: str, product_id: str, bounds: dict, settings: dict) -> dict:
    product = data.product(store_id, product_id)
    if product is None:
        raise LookupError("product not found")
    hist = data.history(store_id, product_id)
    model = registry().select(product)
    encoder = model.encoder
    events = _events(product)
    market = data.market(product_id)
    elast = elasticity_for(store_id, product_id)
    horizon = optimizer.planning_horizon(product)
    lo, hi = float(bounds["lo"]), float(bounds["hi"])
    cur = float(product["price"])
    cost, mrp = float(product["cost_price"]), float(product["mrp"])

    # Staff-entered seasonal considerations for the planning horizon.
    cons = considerations.plan(store_id, product, _horizon_dates(product, horizon))
    if cons["shortage"]:
        # Scarce stock is not discounted: the policy may only hold or raise
        # the price, still inside the band the constraint engine allows.
        lo = min(max(lo, cur), hi)

    def evaluate(prices: list[float]) -> list[optimizer.Evaluation]:
        return optimizer.evaluate(prices, product, hist, events, encoder, model, horizon,
                                  demand_multiplier=cons["multipliers"])

    # 1. Evaluate economic range (model view) + band grid + bandit arms.
    econ = optimizer.candidate_grid(max(cost, 0.01), mrp, [cur], n=25)
    band = optimizer.candidate_grid(lo, hi, [cur, lo, hi], n=15)
    all_prices = sorted({*econ, *band})
    evals = {e.price: e for e in evaluate(all_prices)}
    model_best = max((evals[p] for p in econ), key=lambda e: e.profit)
    band_best = max((evals[p] for p in band), key=lambda e: e.profit)
    current = evals[round(cur, 2)] if round(cur, 2) in evals else evaluate([cur])[0]

    # 2. Policies.
    rng = np.random.default_rng()
    ts = ThompsonBandit(store_id, product, rng)
    ts_prices = ts.candidates(lo, hi, band)
    extra = [p for p in ts_prices if round(p, 2) not in evals]
    if extra:
        for e in evaluate(extra):
            evals[e.price] = e
    ts_obj = {p: evals[round(p, 2)].profit for p in ts_prices}
    prior = normalize(ts_obj)
    ts_choice = ts.select(prior)
    ts_price = min(max(ts_choice["price"], lo), hi)
    ts.remember_decision(ts_price, min(ts_obj.values()), max(ts_obj.values()))

    lin = LinearThompson(store_id, product, hist, rng)
    today = pd.Timestamp.now(tz=product.get("timezone") or "Asia/Kolkata")
    in_event = any(pd.Timestamp(e["start_date"]).date() <= today.date() <= pd.Timestamp(e["end_date"]).date() for e in events)
    lin_choice = lin.choose(band, product.get("days_to_expiry"), int(today.dayofweek >= 5), int(in_event), market["avg"])

    policy = get_settings().pricing_policy
    if policy == "contextual_ts":
        chosen, shadow = lin_choice["price"], {"policy": "thompson_sampling_v2", "price": ts_price}
        policy_name = "contextual_ts_v1"
    else:
        chosen, shadow = ts_price, {"policy": "contextual_ts_v1", "price": lin_choice["price"],
                                    "note": "challenger policy evaluated in shadow mode (not applied)"}
        policy_name = "thompson_sampling_v2"
    chosen = round(float(chosen), 2)
    rec = evals.get(chosen) or evaluate([chosen])[0]

    # 3. Explanation.
    recent28 = float(hist["units"].tail(28).mean()) if not hist.empty else None
    hist_prof = reference_profit(hist)
    factors = []
    fc_level = current.demand_per_day
    if recent28 is not None:
        chg = _pct(fc_level, recent28)
        factors.append({"factor": "demand_forecast", "label": "Demand forecast",
                        "detail": f"{fc_level:.1f} units/day expected at the current price vs {recent28:.1f}/day over the last 28 days of history",
                        "signal": "up" if (chg or 0) > 5 else "down" if (chg or 0) < -5 else "neutral", "change_pct": chg})
    if market["count"]:
        gap = _pct(cur, market["avg"])
        factors.append({"factor": "competitors", "label": "Competitor prices",
                        "detail": f"Market average ₹{market['avg']:.2f} across {market['count']} observed price(s) (live, manually verified or cached); "
                                  f"our price is {gap:+.1f}% vs market; lowest ₹{market['min']:.2f}",
                        "signal": "down" if (gap or 0) > 5 else "up" if (gap or 0) < -5 else "neutral", "gap_pct": gap,
                        "observations": [{"competitor": o["name"], "price": o["price"], "status": o["status"]} for o in market["observations"]]})
    else:
        factors.append({"factor": "competitors", "label": "Competitor prices", "signal": "neutral",
                        "detail": "Competitor prices UNAVAILABLE for this product (no live, manually verified or cached observation) — "
                                  "competitor position not considered."})
    stock = float(product["stock"] or 0)
    if fc_level > 0:
        cover = stock / fc_level
        factors.append({"factor": "inventory", "label": "Inventory", "days_of_cover": round(cover, 1),
                        "detail": f"{int(stock)} units ≈ {cover:.1f} days of cover at the current price",
                        "signal": "up" if cover < 3 else "down" if cover > 30 else "neutral"})
    dte = product.get("days_to_expiry")
    if dte is not None and not pd.isna(dte):
        waste = current.waste_units
        wastage_pct = round(waste / stock * 100, 1) if stock > 0 else 0.0
        shelf = product.get("shelf_life_days")
        factors.append({"factor": "expiry", "label": "Expiry & wastage risk" if product.get("is_perishable") else "Expiry",
                        "days_to_expiry": int(dte), "wastage_risk_pct": wastage_pct,
                        "shelf_life_days": None if shelf is None or pd.isna(shelf) else int(shelf),
                        "detail": f"Expires in {int(dte)} day(s)"
                                  + (f" (shelf life {int(shelf)} days)" if shelf is not None and not pd.isna(shelf) else "")
                                  + f"; at the current price ≈{waste:.0f} unit(s) ({wastage_pct:.0f}% of stock) would remain unsold at expiry"
                                  + (f" vs ≈{rec.waste_units:.0f} at the recommended price" if abs(rec.waste_units - waste) > 0.5 else ""),
                        "signal": "down" if waste > 0.5 else "neutral"})
    if elast.get("status") == "ESTIMATED":
        factors.append({"factor": "elasticity", "label": "Price elasticity", "elasticity": elast["elasticity"],
                        "detail": f"Estimated elasticity {elast['elasticity']:.2f} (95% CI {elast['ci_low']:.2f} to {elast['ci_high']:.2f}); "
                                  + ("demand is price-sensitive" if elast["elasticity"] < -1 else "demand is relatively price-insensitive"),
                        "signal": "neutral"})
    else:
        factors.append({"factor": "elasticity", "label": "Price elasticity", "signal": "neutral",
                        "detail": f"Not used: {elast.get('reason') or elast.get('status')}"})
    ev = seasonal.next_event_context(store_id, product["organization_id"])
    if ev:
        factors.append({"factor": "season", "label": "Upcoming festival", "signal": "up" if (ev.get("historical_uplift_pct") or 0) > 5 else "neutral",
                        "detail": f"{ev['name']} in {ev['days_until']} day(s). {ev['guidance']}"})
    if cons["applied"]:
        net = float(np.mean(cons["multipliers"]) - 1) * 100
        factors.append({"factor": "seasonal_consideration", "label": "Seasonal considerations (staff-entered)",
                        "signal": "up" if net > 2 or cons["shortage"] else "down" if net < -2 else "neutral",
                        "net_demand_change_pct": round(net, 1), "considerations": cons["applied"],
                        "detail": f"MANUAL planning assumption applied on top of the model: {considerations.describe(cons['applied'])}. "
                                  f"Average demand adjustment over the horizon {net:+.1f}%."
                                  + (" Supply SHORTAGE: discounts are not recommended." if cons["shortage"] else "")})
    ws = product.get("weather_sensitivity")
    if ws is not None and not pd.isna(ws) and float(ws) >= 0.6 and not any(a["kind"] == "WEATHER" for a in cons["applied"]):
        factors.append({"factor": "weather", "label": "Weather sensitivity", "signal": "neutral",
                        "detail": f"Weather-sensitive product (sensitivity {float(ws):.1f}). No weather effect is modelled because the "
                                  "sales history has no linked weather; add a WEATHER seasonal consideration to reflect a forecast."})
    if float(product.get("season_factor") or 1) != 1.0:
        factors.append({"factor": "season_factor", "label": "Season factor", "signal": "neutral",
                        "detail": f"Product season factor {float(product['season_factor']):.2f} is a model input"})
    if not hist.empty:
        factors.append({"factor": "history", "label": "Historical sales", "signal": "neutral",
                        "detail": f"{len(hist)} days of history; typical good-day profit ₹{hist_prof:.0f} (95th percentile)"})

    impact = {
        "horizon_days": horizon,
        "demand_change_pct": _pct(rec.demand_per_day, current.demand_per_day),
        "revenue_change_pct": _pct(rec.revenue, current.revenue),
        "profit_change_pct": _pct(rec.profit, current.profit),
        "margin_change_pts": round(rec.margin_pct - current.margin_pct, 2),
        "current": current.as_dict(horizon), "recommended": rec.as_dict(horizon),
    }
    action = "hold" if abs(chosen - cur) < 0.005 else ("increase" if chosen > cur else "decrease")
    summary = (f"{'Hold' if action == 'hold' else ('Raise' if action == 'increase' else 'Lower')} price "
               f"{'at' if action == 'hold' else 'to'} ₹{chosen:.2f}"
               + ("" if action == "hold" else f" ({(chosen - cur) / cur * 100:+.1f}%)")
               + f": expected profit ₹{rec.profit / horizon:.0f}/day vs ₹{current.profit / horizon:.0f}/day at the current price"
               + (f", selling {rec.demand_per_day:.1f} vs {current.demand_per_day:.1f} units/day." if rec.demand_per_day else "."))
    if abs(model_best.price - chosen) > 0.01:
        summary += f" Without business rules the model would pick ₹{model_best.price:.2f}."

    # 4. Confidence (0–1): history depth, forecast validation, elasticity, bandit learning.
    hist_days = len(hist) if not hist.empty else 0
    mape = (model.metrics or {}).get("mape_pct")
    conf = 0.25 * min(hist_days / 90, 1.0)
    conf += 0.25 * (max(0.0, 1 - (mape or 100) / 100))
    conf += 0.2 * (1.0 if elast.get("status") == "ESTIMATED" else 0.3 if elast.get("status") == "NOT_SIGNIFICANT" else 0.0)
    conf += 0.15 * min(ts.state.get("n_updates", 0) / 30, 1.0)
    conf += 0.15 * (1.0 if not ts_choice["explored"] else 0.5)
    conf = round(min(conf, 1.0), 3)

    explanation = {
        "summary": summary, "action": action.upper(), "factors": factors,
        "shap": _shap_explanation(product, hist, events, chosen, horizon),
        "impact": {**impact, "note": "Profit is net of the cost of units expected to expire unsold within the horizon."},
        "elasticity": elast,
        "policy": {"name": policy_name, "explored": ts_choice["explored"] if policy_name.startswith("thompson") else lin_choice["explored"],
                   "greedy_price": ts_choice["greedy_price"] if policy_name.startswith("thompson") else lin_choice["greedy_price"],
                   "shadow": shadow, "arms": ts_choice["table"], "updates_from_feedback": ts.state.get("n_updates", 0),
                   "note": "Thompson Sampling deliberately explores: when 'explored' is true the price was sampled from a less-certain arm to keep learning."},
        "model_optimum": {"price": model_best.price, "profit_per_day": round(model_best.profit / horizon, 2)},
        "band_optimum": {"price": band_best.price, "profit_per_day": round(band_best.profit / horizon, 2)},
        "data_provenance": {
            "demand_model": f"{model.key} trained on {model.training_data} data",
            "sales_history": "Synthetic/Training Data" if product.get("data_mode") == "SYNTHETIC" else "Store sales",
            "competitor_data": ("Observed prices: " + ", ".join(sorted({o["status"] for o in market["observations"]})))
                               if market["count"] else "UNAVAILABLE",
            "seasonal_considerations": f"{len(cons['applied'])} MANUAL planning assumption(s) applied" if cons["applied"] else "none",
        },
    }
    candidates = [{"price": e.price, "demand": round(e.demand_per_day, 3), "revenue": round(e.revenue / horizon, 2),
                   "profit": round(e.profit / horizon, 2), "in_band": lo - 1e-9 <= e.price <= hi + 1e-9}
                  for e in sorted(evals.values(), key=lambda e: e.price)]
    return {
        "recommended_price": chosen, "model_price": model_best.price,
        "expected_demand": round(rec.demand_per_day, 3), "expected_revenue": round(rec.revenue / horizon, 2),
        "expected_profit": round(rec.profit / horizon, 2), "expected_margin_pct": round(rec.margin_pct, 2),
        "confidence": conf, "policy": policy_name, "model_version": model.key,
        "explanation": explanation,
        "context": {"horizon_days": horizon, "history_days": hist_days, "market": {k: market[k] for k in ("count", "avg", "min", "max")},
                    "stock": int(stock), "days_to_expiry": None if dte is None or pd.isna(dte) else int(dte),
                    "band": {"lo": lo, "hi": hi}, "considerations": cons["applied"]},
        "candidates": candidates,
    }


# ── Simulation ──────────────────────────────────────────────────────────────

def simulate(store_id: str, product_id: str, prices: list[float], scenarios: list[dict], horizon_days: int | None,
             bounds: dict) -> dict:
    product = data.product(store_id, product_id)
    if product is None:
        raise LookupError("product not found")
    hist = data.history(store_id, product_id)
    model = registry().select(product)
    encoder = model.encoder
    events = _events(product)
    market = data.market(product_id)
    horizon = horizon_days or optimizer.planning_horizon(product)
    cur = float(product["price"])
    cons = considerations.plan(store_id, product, _horizon_dates(product, horizon))
    mult = cons["multipliers"]
    observed = (float(hist["price"].min()), float(hist["price"].max())) if not hist.empty else None

    def risk(p: float) -> dict:
        if observed is None:
            return {"level": "HIGH", "reason": "No sales history — predictions rely on category patterns"}
        lo_o, hi_o = observed
        if p < lo_o * 0.97 or p > hi_o * 1.03:
            return {"level": "HIGH", "reason": f"Outside the historically observed price range ₹{lo_o:.2f}–₹{hi_o:.2f} (extrapolation)"}
        if abs(p - cur) / cur > 0.1:
            return {"level": "MEDIUM", "reason": "More than 10% away from the current price"}
        return {"level": "LOW", "reason": "Within the observed price range"}

    def position(p: float, avg: float | None, mn: float | None) -> dict | None:
        if not avg:
            return None
        return {"vs_market_avg_pct": round((p - avg) / avg * 100, 2), "cheapest": mn is not None and p <= mn,
                "market_avg": round(avg, 2), "market_low": mn}

    base_evals = optimizer.evaluate(prices, product, hist, events, encoder, model, horizon, demand_multiplier=mult)
    cur_eval = optimizer.evaluate([cur], product, hist, events, encoder, model, horizon, demand_multiplier=mult)[0]
    results = []
    for e in base_evals:
        d = e.as_dict(horizon)
        d.update({"risk": risk(e.price), "competitor_position": position(e.price, market["avg"], market["min"]),
                  "vs_current": {"demand_pct": _pct(e.demand_per_day, cur_eval.demand_per_day),
                                 "revenue_pct": _pct(e.revenue, cur_eval.revenue), "profit_pct": _pct(e.profit, cur_eval.profit)},
                  "in_band": bounds["lo"] - 1e-9 <= e.price <= bounds["hi"] + 1e-9})
        results.append(d)

    scenario_out = []
    for sc in scenarios or []:
        kind, pct = sc.get("type"), float(sc.get("pct", 0))
        if kind == "our_price_change":
            p = round(cur * (1 + pct / 100), 2)
            e = optimizer.evaluate([p], product, hist, events, encoder, model, horizon, demand_multiplier=mult)[0]
            scenario_out.append({"scenario": sc, "label": f"Our price {pct:+.0f}% → ₹{p:.2f}", "result": e.as_dict(horizon),
                                 "risk": risk(p), "vs_current_profit_pct": _pct(e.profit, cur_eval.profit)})
        elif kind == "demand_change":
            e = optimizer.evaluate([cur], product, hist, events, encoder, model, horizon, demand_multiplier=mult * (1 + pct / 100))[0]
            scenario_out.append({"scenario": sc, "label": f"Demand {pct:+.0f}% at the current price", "result": e.as_dict(horizon),
                                 "vs_current_profit_pct": _pct(e.profit, cur_eval.profit),
                                 "note": "Demand multiplied uniformly; stock and expiry limits still apply"})
        elif kind == "competitor_price_change":
            if not market["avg"]:
                scenario_out.append({"scenario": sc, "label": f"Competitors {pct:+.0f}%", "estimable": False,
                                     "note": "No live or cached competitor prices for this product — the effect cannot be evaluated."})
                continue
            new_avg = market["avg"] * (1 + pct / 100)
            new_min = market["min"] * (1 + pct / 100) if market["min"] else None
            scenario_out.append({
                "scenario": sc, "label": f"Competitors {pct:+.0f}% → market avg ₹{new_avg:.2f}", "estimable": False,
                "position_now": position(cur, market["avg"], market["min"]), "position_after": position(cur, new_avg, new_min),
                "note": "Demand impact not estimated: there is no competitor-price history overlapping our sales, so a "
                        "competitor cross-elasticity cannot be measured. Only the change in price position is shown.",
            })
        else:
            scenario_out.append({"scenario": sc, "error": "unknown scenario type (use our_price_change, demand_change, competitor_price_change)"})

    return {"product_id": product_id, "product_name": product["name"], "current_price": cur, "horizon_days": horizon,
            "model_version": model.key, "results": results, "current": cur_eval.as_dict(horizon), "scenarios": scenario_out,
            "cross_effects": cross_effect_notes(store_id, product_id, prices, cur),
            "considerations": cons["applied"],
            "notes": ["Revenue/profit are per day averaged over the horizon; *_horizon fields are totals.",
                      "Profit subtracts the cost of units expected to expire unsold."]
                     + ([f"Includes staff-entered seasonal consideration(s) (MANUAL assumption): {considerations.describe(cons['applied'])}."]
                        if cons["applied"] else [])}


def cross_effect_notes(store_id: str, product_id: str, prices: list[float], cur: float) -> list[dict]:
    """Statistically supported cannibalization / complement effects of changing this product's price."""
    rows = db.fetch_all(
        """select r.product_id::text as affected_id, p.name, r.relationship, r.cross_elasticity, r.p_value
           from product_relationships r join products p on p.id = r.product_id
           where r.related_product_id = :pid and r.store_id = :sid""", pid=product_id, sid=store_id)
    out = []
    for r in rows:
        for p in prices:
            dp = math.log(p / cur) if p > 0 and cur > 0 else 0
            out.append({"affected_product": r["name"], "affected_product_id": r["affected_id"], "relationship": r["relationship"],
                        "price": p, "demand_change_pct": round((math.exp(r["cross_elasticity"] * dp) - 1) * 100, 2),
                        "cross_elasticity": round(r["cross_elasticity"], 3), "p_value": r["p_value"]})
    return out


# ── Closed-loop feedback ────────────────────────────────────────────────────

def feedback(store_id: str, product_id: str, price: float, quantity: int, unit_cost: float, sold_at: str) -> dict:
    product = data.product(store_id, product_id)
    if product is None:
        raise LookupError("product not found")
    hist = data.history(store_id, product_id)
    ts = ThompsonBandit(store_id, product)
    tz = product.get("timezone") or "Asia/Kolkata"
    day = pd.Timestamp(sold_at).tz_convert(tz).date() if pd.Timestamp(sold_at).tzinfo else pd.Timestamp(sold_at).date()
    finalized = ts.record_sale(day, float(price), (float(price) - float(unit_cost)) * int(quantity))
    if finalized:
        # One contextual update per finalized day as well.
        lin = LinearThompson(store_id, product, hist)
        pend_day = pd.Timestamp(day) - pd.Timedelta(days=1)
        prev = hist.loc[hist.index <= pend_day].tail(1)
        if not prev.empty:
            r = prev.iloc[0]
            x = context_vector(float(r["price"]), lin.ref_price, r.get("days_to_expiry"), int(pend_day.dayofweek >= 5), 0, None)
            lin.update(x, float(np.clip((r["price"] - r["cost_price"]) * r["units"] / lin.state.get("ref_profit", 1.0), 0, 1.5)))
    return {"recorded": True, "bandit_updated": finalized, "n_updates": ts.state.get("n_updates", 0)}
