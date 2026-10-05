"""
ml/anomalies.py — statistical anomaly detection (only where data suffices).

Detectors
    sales        per product: robust z = 0.6745·(x − rolling median)/MAD over the
                 previous 28 days; |z| ≥ 3.5 in the last 7 days of history
                 (needs ≥ 35 days and a non-zero MAD)
    prices       operational price changes (manual / recommendation / automatic;
                 imported history excluded) larger than 20% in one step, or beyond
                 4 robust deviations of the product's usual change size (last 30 days)
    inventory    manual stock adjustments / waste in the last 14 days larger
                 than 5× average daily sales
    competitors  competitor observations deviating > 3σ from that listing's
                 history (needs ≥ 10 observations)
    store days   IsolationForest over (units, revenue, avg price, active products)
                 per store-day, last 120 days (needs ≥ 60 days); top outliers
                 in the last 14 days only
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

from app import db
from app.services import data

Z_THRESHOLD = 3.5


def _robust_z(series: pd.Series, window: int = 28) -> pd.DataFrame:
    med = series.shift(1).rolling(window, min_periods=21).median()
    mad = series.shift(1).rolling(window, min_periods=21).apply(lambda w: np.median(np.abs(w - np.median(w))), raw=True)
    z = 0.6745 * (series - med) / mad.replace(0, np.nan)
    return pd.DataFrame({"value": series, "median": med, "mad": mad, "z": z})


def detect(store_id: str) -> dict:
    st = data.store(store_id)
    if st is None:
        raise LookupError("store not found")
    panel = data.panel(store_id)
    anomalies: list[dict] = []
    detectors: dict[str, str] = {}

    # ── sales ───────────────────────────────────────────────────────────────
    if panel.empty:
        detectors["sales"] = "insufficient data: no sales history"
    else:
        checked = 0
        for pid, g in panel.groupby("product_id"):
            g = g.set_index("date").sort_index()
            if len(g) < 35:
                continue
            checked += 1
            z = _robust_z(g["units"]).tail(7).dropna()
            for d, r in z[np.abs(z["z"]) >= Z_THRESHOLD].iterrows():
                kind = "spike" if r["z"] > 0 else "drop"
                name = str(g["category"].iloc[0])
                pname = data.db.fetch_one("select name from products where id = :p", p=pid)["name"]
                anomalies.append({
                    "product_id": pid, "kind": "sales_" + kind,
                    "title": f"Unusual sales {kind} for {pname}",
                    "message": f"{int(r['value'])} units on {d.date()} vs typical {r['median']:.0f} (robust z = {r['z']:.1f}).",
                    "severity": "MEDIUM" if abs(r["z"]) < 6 else "HIGH",
                    "key": f"sales:{pid}:{d.date()}",
                    "metadata": {"date": str(d.date()), "units": float(r["value"]), "median": float(r["median"]),
                                 "z": round(float(r["z"]), 2), "category": name},
                })
        detectors["sales"] = f"checked {checked} product(s) with ≥35 days of history"

    # ── our prices ──────────────────────────────────────────────────────────
    ch = db.fetch_all(
        """select h.product_id::text, p.name, h.old_price::float8 as old, h.new_price::float8 as new, h.created_at, h.source
           from pricing_history h join products p on p.id = h.product_id
           where h.store_id = :s and h.old_price is not null and h.source <> 'IMPORT'
             and h.created_at >= app.store_reference_time(:s) - interval '30 days'
           order by h.created_at""", s=store_id)
    if len(ch) < 10:
        detectors["prices"] = f"insufficient data: {len(ch)} price changes in the last 30 days"
    else:
        dfc = pd.DataFrame(ch)
        dfc["chg"] = (dfc["new"] - dfc["old"]) / dfc["old"]
        for pid, g in dfc.groupby("product_id"):
            mad = np.median(np.abs(g["chg"] - g["chg"].median())) or np.nan
            for _, r in g.tail(5).iterrows():
                rz = 0.6745 * (r["chg"] - g["chg"].median()) / mad if mad and not np.isnan(mad) else 0
                if abs(r["chg"]) >= 0.2 or abs(rz) >= 4:
                    anomalies.append({
                        "product_id": pid, "kind": "price_jump", "title": f"Unusual price change for {r['name']}",
                        "message": f"₹{r['old']:.2f} → ₹{r['new']:.2f} ({r['chg']*100:+.1f}%) via {r['source']} on {pd.Timestamp(r['created_at']).date()}.",
                        "severity": "MEDIUM", "key": f"price:{pid}:{pd.Timestamp(r['created_at']).isoformat()}",
                        "metadata": {"change_pct": round(float(r["chg"]) * 100, 2), "source": r["source"]},
                    })
        detectors["prices"] = f"checked {len(dfc)} price change(s)"

    # ── inventory ───────────────────────────────────────────────────────────
    mv = db.fetch_all(
        """select m.product_id::text, p.name, m.change, m.reason, m.created_at, pm.avg_daily_units::float8 as avg
           from inventory_movements m join products p on p.id = m.product_id
           join product_inventory_metrics pm on pm.product_id = m.product_id
           where m.store_id = :s and m.reason in ('ADJUSTMENT', 'WASTE') and m.created_at >= now() - interval '14 days'""", s=store_id)
    for r in mv:
        if r["avg"] and abs(r["change"]) > 5 * r["avg"]:
            anomalies.append({
                "product_id": r["product_id"], "kind": "inventory_adjustment",
                "title": f"Large stock {r['reason'].lower()} for {r['name']}",
                "message": f"{r['change']:+d} units ({abs(r['change'])/r['avg']:.0f}× average daily sales) on {pd.Timestamp(r['created_at']).date()}.",
                "severity": "HIGH" if r["reason"] == "WASTE" else "MEDIUM",
                "key": f"inventory:{r['product_id']}:{pd.Timestamp(r['created_at']).isoformat()}",
                "metadata": {"change": r["change"], "reason": r["reason"]},
            })
    detectors["inventory"] = f"checked {len(mv)} manual adjustment(s) in the last 14 days"

    # ── competitors ─────────────────────────────────────────────────────────
    comp = db.fetch_df(
        """select h.competitor_product_id::text as cp, cp.product_id::text as product_id, p.name, k.name as competitor,
                  h.price::float8 as price, h.observed_at
           from competitor_price_history h join competitor_products cp on cp.id = h.competitor_product_id
           join competitors k on k.id = cp.competitor_id join products p on p.id = cp.product_id
           where h.store_id = :s and h.source <> 'ESTIMATE' order by h.observed_at""", s=store_id)
    enough = 0
    for cp, g in comp.groupby("cp") if not comp.empty else []:
        if len(g) < 10:
            continue
        enough += 1
        base = g.iloc[:-1]["price"]
        last = g.iloc[-1]
        sd = base.std()
        if sd > 0 and abs(last["price"] - base.mean()) / sd > 3:
            anomalies.append({
                "product_id": last["product_id"], "kind": "competitor_price",
                "title": f"{last['competitor']} price anomaly for {last['name']}",
                "message": f"₹{last['price']:.2f} vs usual ₹{base.mean():.2f} ± {sd:.2f}.",
                "severity": "LOW", "key": f"competitor:{cp}:{pd.Timestamp(last['observed_at']).isoformat()}",
                "metadata": {"competitor": last["competitor"], "price": float(last["price"]), "mean": float(base.mean())},
            })
    detectors["competitors"] = (f"checked {enough} competitor listing(s) with ≥10 observations" if enough
                                else "insufficient data: no competitor listing has ≥10 observations")

    # ── store-level days (Isolation Forest) ─────────────────────────────────
    if not panel.empty:
        daily = panel.assign(active=(panel["units"] > 0).astype(int)).groupby("date").agg(
            units=("units", "sum"), revenue=("revenue", "sum"), price=("price", "mean"), active=("active", "sum")).tail(120)
        if len(daily) >= 60:
            iso = IsolationForest(n_estimators=200, contamination=0.02, random_state=42)
            X = (daily - daily.mean()) / daily.std().replace(0, 1)
            daily["score"] = iso.fit(X).decision_function(X)
            daily["outlier"] = iso.predict(X) == -1
            recent = daily[daily["outlier"]].tail(14)
            ref = daily.index.max()
            for d, r in recent[recent.index > ref - pd.Timedelta(days=14)].iterrows():
                anomalies.append({
                    "product_id": None, "kind": "store_day", "title": f"Unusual trading day ({d.date()})",
                    "message": f"{r['units']:.0f} units, ₹{r['revenue']:.0f} revenue, {int(r['active'])} products sold — atypical combination for this store.",
                    "severity": "LOW", "key": f"storeday:{d.date()}",
                    "metadata": {"units": float(r["units"]), "revenue": float(r["revenue"]), "score": round(float(r["score"]), 4)},
                })
            detectors["store_days"] = f"IsolationForest over {len(daily)} days"
        else:
            detectors["store_days"] = f"insufficient data: {len(daily)} days (need 60)"
    return {"store_id": store_id, "anomalies": anomalies, "detectors": detectors,
            "data_mode": st.get("data_mode"), "reference_time": str(st.get("reference_time"))}
