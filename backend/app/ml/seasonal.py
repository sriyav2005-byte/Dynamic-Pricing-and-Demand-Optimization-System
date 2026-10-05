"""
ml/seasonal.py — seasonal & festival demand intelligence from history.

For every past occurrence of a festival / national holiday inside the store's
sales history:
    uplift = mean daily units in the event window
             ÷ mean daily units in the 28 preceding days (other events excluded) − 1
    significance: Welch's t-test (event days vs baseline days)
Climatic seasons (IMD convention) are compared with the overall daily mean.

No uplift is assumed for events that never occurred in the history; the
response says so explicitly instead of inventing an effect.
"""

from __future__ import annotations

from datetime import timedelta

import numpy as np
import pandas as pd
from scipy import stats

from app import db
from app.services import data
from app.utils.cache import ttl_cache

ALPHA = 0.05


def _events(org_id: str | None) -> pd.DataFrame:
    rows = db.fetch_all(
        """select name, event_type, start_date, end_date, is_date_approximate from seasonal_events
           where organization_id is null or organization_id = cast(:org as uuid) order by start_date""", org=org_id)
    df = pd.DataFrame(rows)
    if not df.empty:
        df["start_date"] = pd.to_datetime(df["start_date"])
        df["end_date"] = pd.to_datetime(df["end_date"])
    return df


def _test(window: np.ndarray, base: np.ndarray) -> tuple[float | None, float | None]:
    if len(window) == 0 or len(base) < 7 or base.mean() <= 0:
        return None, None
    uplift = float(window.mean() / base.mean() - 1)
    if len(window) < 2 or np.std(window) == 0 and np.std(base) == 0:
        return uplift, None
    with np.errstate(all="ignore"):
        p = stats.ttest_ind(window, base, equal_var=False).pvalue
    return uplift, (None if np.isnan(p) else float(p))


def store_daily(store_id: str) -> tuple[pd.DataFrame, dict | None]:
    st = data.store(store_id)
    panel = data.panel(store_id)
    if panel.empty or st is None:
        return pd.DataFrame(), st
    daily = panel.groupby("date")["units"].sum().to_frame("total")
    by_cat = panel.pivot_table(index="date", columns="category", values="units", aggfunc="sum").fillna(0)
    return daily.join(by_cat), st


@ttl_cache(600)
def insights(store_id: str) -> dict:
    daily, st = store_daily(store_id)
    if daily.empty:
        return {"available": False, "reason": "No sales history for this store yet."}
    ev = _events(st["organization_id"])
    fest = ev[ev["event_type"] != "SEASON"] if not ev.empty else ev
    seasons = ev[ev["event_type"] == "SEASON"] if not ev.empty else ev
    start, end = daily.index.min(), daily.index.max()
    in_event = pd.Series(False, index=daily.index)
    for _, e in fest.iterrows():
        in_event |= (daily.index >= e.start_date) & (daily.index <= e.end_date)

    categories = [c for c in daily.columns if c != "total"]
    occurrences = []
    for _, e in fest.iterrows():
        if e.end_date < start or e.start_date > end:
            continue
        w = daily[(daily.index >= e.start_date) & (daily.index <= e.end_date)]
        b = daily[(daily.index < e.start_date) & (daily.index >= e.start_date - timedelta(days=28)) & ~in_event]
        if w.empty or len(b) < 7:
            continue
        up, p = _test(w["total"].to_numpy(), b["total"].to_numpy())
        cats = {}
        for c in categories:
            cu, cp = _test(w[c].to_numpy(), b[c].to_numpy())
            if cu is not None:
                cats[c] = {"uplift_pct": round(cu * 100, 1), "p_value": None if cp is None else round(cp, 4)}
        occurrences.append({"name": e["name"], "start_date": e.start_date.date().isoformat(), "end_date": e.end_date.date().isoformat(),
                            "window_days": int(len(w)), "baseline_days": int(len(b)),
                            "uplift_pct": None if up is None else round(up * 100, 1),
                            "p_value": None if p is None else round(p, 4),
                            "significant": p is not None and p < ALPHA, "by_category": cats})

    by_event: dict[str, dict] = {}
    for o in occurrences:
        agg = by_event.setdefault(o["name"], {"name": o["name"], "occurrences": 0, "uplifts": [], "significant": 0})
        agg["occurrences"] += 1
        if o["uplift_pct"] is not None:
            agg["uplifts"].append(o["uplift_pct"])
        agg["significant"] += int(o["significant"])
    event_summary = []
    for name, a in by_event.items():
        mean_up = float(np.mean(a["uplifts"])) if a["uplifts"] else None
        status = "SIGNIFICANT" if a["significant"] else "NOT_SIGNIFICANT"
        event_summary.append({"name": name, "occurrences": a["occurrences"], "mean_uplift_pct": None if mean_up is None else round(mean_up, 1),
                              "status": status,
                              "confidence": "LOW" if a["occurrences"] < 2 else ("MEDIUM" if a["significant"] else "LOW")})

    overall = float(daily["total"].mean())
    season_rows = []
    for name in ["Winter", "Summer", "Monsoon", "Post-monsoon"]:
        mask = pd.Series(False, index=daily.index)
        for _, s in seasons[seasons["name"] == name].iterrows() if not seasons.empty else []:
            mask |= (daily.index >= s.start_date) & (daily.index <= s.end_date)
        vals = daily.loc[mask, "total"].to_numpy()
        rest = daily.loc[~mask, "total"].to_numpy()
        if len(vals) < 14:
            season_rows.append({"season": name, "days_in_history": int(len(vals)), "status": "NO_HISTORY"})
            continue
        up, p = _test(vals, rest) if len(rest) >= 7 else (float(vals.mean() / overall - 1), None)
        season_rows.append({"season": name, "days_in_history": int(len(vals)), "avg_daily_units": round(float(vals.mean()), 1),
                            "uplift_vs_rest_pct": None if up is None else round(up * 100, 1),
                            "p_value": None if p is None else round(p, 4),
                            "status": "SIGNIFICANT" if p is not None and p < ALPHA else "NOT_SIGNIFICANT"})

    wk = daily.index.dayofweek >= 5
    wk_up, wk_p = _test(daily.loc[wk, "total"].to_numpy(), daily.loc[~wk, "total"].to_numpy())

    today = pd.Timestamp.now(tz=st.get("timezone") or "Asia/Kolkata").normalize().tz_localize(None)
    known = {e["name"]: e for e in event_summary}
    upcoming = []
    for _, e in fest.iterrows():
        if today <= e.end_date <= today + timedelta(days=120):
            h = known.get(e["name"])
            upcoming.append({
                "name": e["name"], "start_date": e.start_date.date().isoformat(), "end_date": e.end_date.date().isoformat(),
                "days_until": int((e.start_date - today).days), "is_date_approximate": bool(e["is_date_approximate"]),
                "historical_uplift_pct": h["mean_uplift_pct"] if h else None,
                "evidence": h["status"] if h else "NO_HISTORY",
                "guidance": (f"Historically {h['mean_uplift_pct']:+.1f}% demand ({h['status'].lower().replace('_', ' ')}, "
                             f"{h['occurrences']} occurrence(s))" if h and h["mean_uplift_pct"] is not None
                             else "No occurrence of this event in the sales history — no demand adjustment is applied."),
            })
    return {
        "available": True,
        "history": {"from": start.date().isoformat(), "to": end.date().isoformat(), "days": int(len(daily)),
                    "data_mode": st.get("data_mode")},
        "weekend_effect": {"uplift_pct": None if wk_up is None else round(wk_up * 100, 1),
                           "p_value": None if wk_p is None else round(wk_p, 4),
                           "status": "SIGNIFICANT" if wk_p is not None and wk_p < ALPHA else "NOT_SIGNIFICANT"},
        "events": event_summary, "occurrences": occurrences, "seasons": season_rows, "upcoming": upcoming,
        "method": "Event window vs preceding 28 days (other events excluded); Welch t-test, α = 0.05",
    }


def next_event_context(store_id: str, org_id: str | None, within_days: int = 14) -> dict | None:
    """Nearest upcoming festival within `within_days` with its historical evidence."""
    try:
        ins = insights(store_id)
    except Exception:
        return None
    if not ins.get("available"):
        return None
    for u in sorted(ins["upcoming"], key=lambda x: x["days_until"]):
        if u["days_until"] <= within_days:
            return u
    return None
