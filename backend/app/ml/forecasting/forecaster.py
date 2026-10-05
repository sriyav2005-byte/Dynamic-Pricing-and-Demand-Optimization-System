"""
ml/forecasting/forecaster.py — multi-day demand forecasts with honest accuracy.

Forecast
    For each day of the horizon the demand model predicts units at the current
    price; lag features are frozen at the forecast origin (today). Expected
    *sales* additionally respect stock on hand and product expiry.

Prediction intervals (80%)
    Relative residual quantiles by lead time (1–7, 8–14, 15–30 days) from a
    rolling-origin backtest pooled over the store's products. When the store
    history overlaps the model's training data, the backtest uses the model
    fitted *before* the holdout window and only evaluates holdout days, so
    the accuracy figures are out-of-sample. Without a usable backtest the
    model's validation residuals are used (flagged).

Accuracy (per product, from the same backtest)
    MAE, RMSE, MAPE (non-zero days), WAPE, R².
"""

from __future__ import annotations

import threading
import time
from datetime import timedelta

import numpy as np
import pandas as pd

from app.ml.evaluation.metrics import confidence_label, regression_metrics
from app.ml.features import add_lag_features, future_frame
from app.ml.inference.demand import predict_units, registry
from app.services import considerations, data

HORIZONS = (7, 14, 30)
LEAD_BUCKETS = ((1, 7), (8, 14), (15, 30))
BACKTEST_ORIGINS = 8          # weekly origins
BACKTEST_TTL_S = 900

_bt_cache: dict[str, tuple[float, dict]] = {}
_bt_lock = threading.Lock()


def _bucket(lead: int) -> str:
    for a, b in LEAD_BUCKETS:
        if a <= lead <= b:
            return f"{a}-{b}"
    return f"{LEAD_BUCKETS[-1][0]}-{LEAD_BUCKETS[-1][1]}"


def backtest_store(store_id: str) -> dict:
    """Rolling-origin backtest for every product in a store (cached)."""
    now = time.time()
    with _bt_lock:
        hit = _bt_cache.get(store_id)
        if hit and now - hit[0] < BACKTEST_TTL_S:
            return hit[1]
    result = _run_backtest(store_id)
    with _bt_lock:
        _bt_cache[store_id] = (now, result)
    return result


def _run_backtest(store_id: str) -> dict:
    reg = registry()
    m = reg.v2
    st = data.store(store_id)
    panel = data.panel(store_id)
    if m is None or st is None or panel.empty:
        return {"available": False, "reason": "no model or no history"}
    panel = add_lag_features(panel)
    ref = panel["date"].max()

    # Out-of-sample protocol when the store history overlaps training data.
    model, window_start, protocol = m.model, None, "final model (store history not in training data)"
    if m.data_range and m.model_holdout is not None and m.holdout_start:
        t0, t1 = pd.Timestamp(m.data_range[0]), pd.Timestamp(m.data_range[1])
        if panel["date"].min() <= t1 and ref >= t0:
            model, window_start = m.model_holdout, pd.Timestamp(m.holdout_start)
            protocol = f"holdout model, evaluated only on days ≥ {m.holdout_start} (not seen in training)"

    events = data.seasonal_events(st["organization_id"], panel["date"].min().date(), ref.date() + timedelta(days=90))
    rows = []
    for pid, g in panel.groupby("product_id"):
        g = g.set_index("date").sort_index()
        if len(g) < 60:
            continue
        for k in range(1, BACKTEST_ORIGINS + 1):
            origin = ref - pd.Timedelta(days=7 * k)
            if window_start is not None and origin < window_start - pd.Timedelta(days=1):
                break
            hist = g[g.index <= origin]
            fut = g[(g.index > origin)]
            if window_start is not None:
                fut = fut[fut.index >= window_start]
            fut = fut.head(30)
            if len(hist) < 28 or fut.empty:
                continue
            prod = {"cost_price": float(fut["cost_price"].iloc[0]), "mrp": float(fut["mrp"].iloc[0]),
                    "category": g["category"].iloc[0], "season_factor": float(fut["season_factor"].iloc[0])}
            f = future_frame(hist.reset_index(), list(fut.index), fut["price"].to_numpy(), prod, events, m.encoder)
            f["days_to_expiry"] = fut["days_to_expiry"].to_numpy()  # known countdown from the batch in stock
            pred = np.clip(model.predict(f[m.features]), 0, None)
            for lead, (d, y, p) in enumerate(zip(fut.index, fut["units"].to_numpy(), pred), start=1):
                rows.append((pid, lead, float(y), float(p)))
    if not rows:
        return {"available": False, "reason": "not enough history for a backtest (need ≥ 60 days)"}
    bt = pd.DataFrame(rows, columns=["product_id", "lead", "actual", "pred"])
    bt["rel"] = (bt["actual"] - bt["pred"]) / np.maximum(bt["pred"], 1.0)
    bt["bucket"] = bt["lead"].map(_bucket)
    quantiles = {b: {"q10": float(g["rel"].quantile(0.1)), "q90": float(g["rel"].quantile(0.9)), "n": int(len(g))}
                 for b, g in bt.groupby("bucket")}
    per_product = {pid: g for pid, g in bt.groupby("product_id")}
    return {"available": True, "protocol": protocol, "quantiles": quantiles, "per_product": per_product,
            "store_metrics": regression_metrics(bt["actual"], bt["pred"]), "n_points": int(len(bt))}


def forecast(store_id: str, product_id: str, horizon: int = 7, price: float | None = None,
             demand_multiplier: float = 1.0, hist: pd.DataFrame | None = None) -> dict:
    """`hist` lets store-level callers pass a pre-loaded history (see data.histories)."""
    if horizon not in HORIZONS:
        raise ValueError("horizon must be 7, 14 or 30")
    product = data.product(store_id, product_id)
    if product is None:
        raise LookupError("product not found")
    if hist is None:
        hist = data.history(store_id, product_id)
    reg = registry()
    model = reg.select(product)
    tz = product.get("timezone") or "Asia/Kolkata"
    today = pd.Timestamp.now(tz=tz).normalize().tz_localize(None)
    dates = [today + pd.Timedelta(days=i) for i in range(horizon)]
    events = data.seasonal_events(product["organization_id"], today.date(), (today + pd.Timedelta(days=horizon + 70)).date())
    p = float(price if price is not None else product["price"])
    h = hist.reset_index() if not hist.empty else pd.DataFrame(columns=["date", "units", "price"])
    frame = future_frame(h, dates, p, product, events, model.encoder)
    # Staff-entered seasonal considerations are applied on top of the model and
    # reported separately so the pure model forecast stays visible.
    cons = considerations.plan(store_id, product, dates)
    model_demand = predict_units(frame, product, model)
    demand = model_demand * cons["multipliers"] * demand_multiplier

    # Stock & expiry constrained expected sales.
    stock = float(product["stock"] or 0)
    dte = product.get("days_to_expiry")
    sales, remaining, stockout_date = [], stock, None
    for i, d in enumerate(demand):
        expired = dte is not None and not pd.isna(dte) and i > dte
        sell = 0.0 if expired else min(d, remaining)
        remaining -= sell
        sales.append(sell)
        if stockout_date is None and remaining <= 1e-9 and d > 0 and not expired:
            stockout_date = dates[i].date().isoformat()

    bt = backtest_store(store_id)
    q_by_bucket = bt.get("quantiles", {}) if bt.get("available") else {}
    fallback_q = model.residual_quantiles or {}
    points = []
    for i, (d, dem, sell) in enumerate(zip(dates, demand, sales)):
        q = q_by_bucket.get(_bucket(i + 1)) or {"q10": fallback_q.get("q10", -0.5), "q90": fallback_q.get("q90", 0.5)}
        lo, hi = max(0.0, dem * (1 + q["q10"])), max(0.0, dem * (1 + q["q90"]))
        points.append({
            "date": d.date().isoformat(), "day_label": d.strftime("%a %d %b"), "is_weekend": d.dayofweek >= 5,
            "event": bool(frame["event_flag"].iloc[i]), "predicted_demand": round(float(dem), 2),
            "model_demand": round(float(model_demand[i]), 2),
            "lower_bound": round(float(lo), 2), "upper_bound": round(float(hi), 2), "expected_sales": round(float(sell), 2),
            "days_to_expiry": None if frame["days_to_expiry"].isna().iloc[i] else int(frame["days_to_expiry"].iloc[i]),
        })

    arr = np.asarray(demand, dtype=float)
    slope = float(np.polyfit(np.arange(len(arr)), arr, 1)[0]) if len(arr) > 1 else 0.0
    recent = float(hist["units"].tail(28).mean()) if not hist.empty else None
    avg = float(arr.mean())
    trend = "stable"
    if avg > 0 and abs(slope) * len(arr) / avg > 0.1:
        trend = "increasing" if slope > 0 else "decreasing"
    peak_i = int(np.argmax(arr)) if len(arr) else 0

    accuracy = None
    if bt.get("available") and product_id in bt["per_product"]:
        g = bt["per_product"][product_id]
        accuracy = {**regression_metrics(g[g["lead"] <= horizon]["actual"], g[g["lead"] <= horizon]["pred"]),
                    "protocol": bt["protocol"]}
    n_hist = int(len(hist)) if not hist.empty else 0
    conf = confidence_label(accuracy.get("mape_pct") if accuracy else None, n_hist)

    warnings = []
    if product.get("is_synthetic") or product.get("data_mode") == "SYNTHETIC":
        warnings.append("History is the synthetic training dataset (Synthetic/Training Data); forecast dates are projected from today.")
    if cons["applied"]:
        warnings.append("Includes staff-entered seasonal consideration(s) — a MANUAL planning assumption, not a model output: "
                        + considerations.describe(cons["applied"]) + ".")
    train_months = set()
    if model.data_range:
        train_months = set(pd.date_range(model.data_range[0], model.data_range[1], freq="D").month)
    out_months = sorted({d.month for d in dates} - train_months) if train_months else []
    if out_months:
        warnings.append(f"Forecast months {out_months} are outside the model's training months — seasonal effects for them are extrapolated.")
    if stockout_date:
        warnings.append(f"Stock on hand ({int(stock)} units) is expected to run out on {stockout_date}.")
    if dte is not None and not pd.isna(dte) and dte < horizon:
        warnings.append(f"Product expires in {int(dte)} day(s); sales after expiry are counted as zero.")
    if n_hist < 28:
        warnings.append("Less than 28 days of sales history — forecast relies mostly on category-level patterns.")

    return {
        "product_id": product_id, "product_name": product["name"], "horizon": horizon, "price": p,
        "model_version": model.key, "training_data": model.training_data,
        "points": points,
        "total_predicted_demand": round(float(arr.sum()), 2),
        "total_expected_sales": round(float(sum(sales)), 2),
        "avg_daily_demand": round(avg, 2),
        "recent_avg_daily_units": round(recent, 2) if recent is not None else None,
        "trend": trend, "trend_slope_per_day": round(slope, 4),
        "peak": {"date": points[peak_i]["date"], "demand": points[peak_i]["predicted_demand"]} if points else None,
        "stockout_date": stockout_date,
        "interval": {"level": 0.8, "method": "backtest residual quantiles by lead time" if q_by_bucket else "model validation residuals (fallback)"},
        "accuracy": accuracy, "confidence": conf, "history_days": n_hist,
        "considerations": cons["applied"],
        "warnings": warnings,
    }


def persist(store_id: str, fc: dict, model_key: str) -> None:
    from app import db
    with db.transaction() as c:
        from sqlalchemy import text
        c.execute(text("delete from demand_forecasts where product_id = :p and horizon_days = :h"),
                  {"p": fc["product_id"], "h": fc["horizon"]})
        c.execute(text("""insert into demand_forecasts(store_id, product_id, model_version_id, horizon_days, forecast_date,
                                                      predicted, lower_bound, upper_bound)
                          select :s, :p, (select id from model_versions where name || ':' || version = :mv), :h,
                                 cast(x->>'date' as date), cast(x->>'predicted_demand' as float8),
                                 cast(x->>'lower_bound' as float8), cast(x->>'upper_bound' as float8)
                          from jsonb_array_elements(cast(:pts as jsonb)) x"""),
                  {"s": store_id, "p": fc["product_id"], "mv": model_key, "h": fc["horizon"],
                   "pts": __import__("json").dumps(fc["points"])})


def overview(store_id: str, horizon: int = 7) -> dict:
    with data.batch():        # per-product lookups inside forecast() become one store-level query each
        return _overview(store_id, horizon)


def _overview(store_id: str, horizon: int) -> dict:
    items = []
    hists = data.histories(store_id)          # one panel load instead of four queries per product
    for p in data.store_products(store_id):
        try:
            fc = forecast(store_id, p["id"], horizon, hist=hists.get(p["id"], pd.DataFrame()))
        except Exception as exc:  # one bad product must not break the overview
            items.append({"product_id": p["id"], "product_name": p["name"], "error": str(exc)})
            continue
        items.append({
            "product_id": p["id"], "product_name": p["name"], "category": p["category"], "price": p["price"],
            "stock": p["stock"], "total_predicted_demand": fc["total_predicted_demand"],
            "avg_daily_demand": fc["avg_daily_demand"], "recent_avg_daily_units": fc["recent_avg_daily_units"],
            "trend": fc["trend"], "peak": fc["peak"], "stockout_date": fc["stockout_date"], "confidence": fc["confidence"],
            "mape_pct": (fc["accuracy"] or {}).get("mape_pct"),
        })
    bt = backtest_store(store_id)
    return {"horizon": horizon, "items": items,
            "store_accuracy": bt.get("store_metrics") if bt.get("available") else None,
            "protocol": bt.get("protocol") if bt.get("available") else bt.get("reason")}
