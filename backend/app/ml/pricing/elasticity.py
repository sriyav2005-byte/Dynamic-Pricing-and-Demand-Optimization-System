"""
ml/pricing/elasticity.py — own-price and cross-price elasticity estimation.

Own-price elasticity (per product)
    Poisson GLM with log link on daily history (zero-sales days included):
        log E[q_t] = a + ε·log p_t + Σ dow + Σ month + β·days_to_expiry + γ·event
    ε is the elasticity (−1.2 ⇒ +1% price → −1.2% demand). Heteroskedasticity-
    robust (HC1) standard errors. Nothing is reported as an estimate unless the
    history supports it:
        INSUFFICIENT_DATA  < 30 days, < 5 distinct prices or price CV < 2%
        NOT_SIGNIFICANT    p ≥ 0.05 (point estimate shown, flagged, unused)
        ESTIMATED          p < 0.05 and ε < 0
    A significant positive ε is reported but flagged as implausible
    (usually confounding, e.g. prices raised during demand peaks).

Cross-price effects (pairs within a store/category)
    log E[q_i] = a + ε_ii·log p_i + ε_ij·log p_j + controls
    ε_ij > 0 ⇒ substitutes (j cheaper ⇒ i sells less, i.e. cannibalization),
    ε_ij < 0 ⇒ complements. Benjamini–Hochberg FDR control (10%) across every
    pair tested in the store (one family); only surviving pairs are stored.
"""

from __future__ import annotations

import warnings

import numpy as np
import pandas as pd
import statsmodels.api as sm

MIN_DAYS = 30
MIN_DISTINCT_PRICES = 5
MIN_PRICE_CV = 0.02
MIN_PAIR_DAYS = 60
ALPHA = 0.05
FDR = 0.10


def _design(df: pd.DataFrame, price_cols: list[str]) -> pd.DataFrame:
    X = pd.DataFrame(index=df.index)
    for c in price_cols:
        X[f"log_{c}"] = np.log(df[c].astype(float))
    d = pd.to_datetime(df["date"]) if "date" in df else pd.to_datetime(df.index)
    dow = pd.get_dummies(pd.Series(d.dayofweek if hasattr(d, "dayofweek") else d.dt.dayofweek, index=df.index),
                         prefix="dow", drop_first=True, dtype=float)
    months = pd.Series(d.month if hasattr(d, "month") else d.dt.month, index=df.index)
    if months.nunique() > 1:
        X = X.join(pd.get_dummies(months, prefix="m", drop_first=True, dtype=float))
    X = X.join(dow)
    if "days_to_expiry" in df and df["days_to_expiry"].notna().mean() > 0.9:
        X["days_to_expiry"] = df["days_to_expiry"].fillna(df["days_to_expiry"].median()).astype(float)
    if "event_flag" in df and df["event_flag"].nunique() > 1:
        X["event_flag"] = df["event_flag"].astype(float)
    return sm.add_constant(X, has_constant="add")


def own_price_elasticity(hist: pd.DataFrame) -> dict:
    """hist: daily rows with units, price (+ optional controls)."""
    h = hist.dropna(subset=["units", "price"])
    h = h[h["price"] > 0]
    n = int(len(h))
    distinct = int(h["price"].round(2).nunique())
    cv = float(h["price"].std() / h["price"].mean()) if n > 1 else 0.0
    base = {"n_obs": n, "distinct_prices": distinct, "price_cv": round(cv, 4), "method": "Poisson GLM (log-log), HC1 SE",
            "price_range": [round(float(h["price"].min()), 2), round(float(h["price"].max()), 2)] if n else None}
    if n < MIN_DAYS or distinct < MIN_DISTINCT_PRICES or cv < MIN_PRICE_CV:
        reasons = []
        if n < MIN_DAYS:
            reasons.append(f"only {n} days of history (need {MIN_DAYS})")
        if distinct < MIN_DISTINCT_PRICES:
            reasons.append(f"only {distinct} distinct prices (need {MIN_DISTINCT_PRICES})")
        if cv < MIN_PRICE_CV:
            reasons.append(f"prices barely varied (CV {cv:.1%}, need {MIN_PRICE_CV:.0%})")
        return {**base, "status": "INSUFFICIENT_DATA", "elasticity": None, "reason": "; ".join(reasons)}
    X = _design(h, ["price"])
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            res = sm.GLM(h["units"].astype(float), X, family=sm.families.Poisson()).fit(cov_type="HC1")
    except Exception as exc:  # singular designs etc.
        return {**base, "status": "INSUFFICIENT_DATA", "elasticity": None, "reason": f"model did not converge: {exc}"}
    e = float(res.params["log_price"])
    se = float(res.bse["log_price"])
    p = float(res.pvalues["log_price"])
    lo, hi = (float(v) for v in res.conf_int().loc["log_price"])
    pseudo_r2 = float(1 - res.deviance / res.null_deviance) if res.null_deviance > 0 else None
    status = "ESTIMATED" if p < ALPHA and e < 0 else "NOT_SIGNIFICANT"
    out = {**base, "status": status, "elasticity": round(e, 4), "std_error": round(se, 4), "p_value": round(p, 6),
           "ci_low": round(lo, 4), "ci_high": round(hi, 4), "pseudo_r2": round(pseudo_r2, 4) if pseudo_r2 is not None else None}
    if p < ALPHA and e >= 0:
        out["reason"] = "Significant but positive (demand rising with price) — likely confounded; not used for pricing"
    elif status == "NOT_SIGNIFICANT":
        out["reason"] = f"Price effect not statistically significant (p = {p:.3f})"
    else:
        out["interpretation"] = (f"A 1% price increase changes demand by about {e:.2f}% "
                                 f"(95% CI {lo:.2f}% to {hi:.2f}%)")
        out["elastic"] = e < -1
    return out


def _bh(pvals: list[float], q: float = FDR) -> list[bool]:
    """Benjamini–Hochberg: which hypotheses are rejected at FDR q."""
    m = len(pvals)
    if m == 0:
        return []
    order = np.argsort(pvals)
    thresh = [q * (k + 1) / m for k in range(m)]
    passed = np.zeros(m, dtype=bool)
    kmax = -1
    for rank, idx in enumerate(order):
        if pvals[idx] <= thresh[rank]:
            kmax = rank
    if kmax >= 0:
        passed[order[: kmax + 1]] = True
    return passed.tolist()


def cross_effects_for(panel: pd.DataFrame, target_id: str, candidate_ids: list[str]) -> list[dict]:
    """Effect of each candidate's price on the target's demand (ε_target,candidate)."""
    t = panel[panel["product_id"] == target_id].set_index("date")
    results = []
    for cid in candidate_ids:
        if cid == target_id:
            continue
        c = panel[panel["product_id"] == cid].set_index("date")[["price"]].rename(columns={"price": "price_other"})
        j = t.join(c, how="inner").dropna(subset=["units", "price", "price_other"])
        if len(j) < MIN_PAIR_DAYS or j["price_other"].std() / j["price_other"].mean() < MIN_PRICE_CV:
            continue
        j = j.reset_index()
        X = _design(j, ["price", "price_other"])
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                res = sm.GLM(j["units"].astype(float), X, family=sm.families.Poisson()).fit(cov_type="HC1")
        except Exception:
            continue
        results.append({
            "related_product_id": cid,
            "cross_elasticity": float(res.params["log_price_other"]),
            "std_error": float(res.bse["log_price_other"]),
            "p_value": float(res.pvalues["log_price_other"]),
            "n_obs": int(len(j)),
        })
    for r in results:
        r["relationship"] = "SUBSTITUTE" if r["cross_elasticity"] > 0 else "COMPLEMENT"
    return results


def apply_fdr(results: list[dict], q: float = FDR) -> list[dict]:
    """Mark results significant under Benjamini–Hochberg across the whole family."""
    for r, k in zip(results, _bh([r["p_value"] for r in results], q)):
        r["significant"] = bool(k)
    return results
