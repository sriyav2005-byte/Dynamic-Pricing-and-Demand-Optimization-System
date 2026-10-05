"""ml/evaluation/metrics.py — regression / forecast accuracy metrics."""

from __future__ import annotations

import numpy as np


def regression_metrics(y_true, y_pred) -> dict:
    """MAE, RMSE, MAPE (on non-zero actuals), WAPE and R².

    MAPE is undefined for zero actuals, so those days are excluded and the
    number of days used is reported. WAPE (Σ|e| / Σy) is robust to zeros.
    """
    y = np.asarray(y_true, dtype=float)
    p = np.asarray(y_pred, dtype=float)
    mask = ~(np.isnan(y) | np.isnan(p))
    y, p = y[mask], p[mask]
    n = int(len(y))
    if n == 0:
        return {"n": 0, "mae": None, "rmse": None, "mape_pct": None, "wape_pct": None, "r2": None}
    err = y - p
    nz = y > 0
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    return {
        "n": n,
        "mae": round(float(np.mean(np.abs(err))), 4),
        "rmse": round(float(np.sqrt(np.mean(err ** 2))), 4),
        "mape_pct": round(float(np.mean(np.abs(err[nz] / y[nz])) * 100), 2) if nz.any() else None,
        "mape_days": int(nz.sum()),
        "wape_pct": round(float(np.sum(np.abs(err)) / np.sum(y) * 100), 2) if y.sum() > 0 else None,
        "r2": round(1 - float(np.sum(err ** 2)) / ss_tot, 4) if ss_tot > 0 else None,
        "bias": round(float(np.mean(p - y)), 4),
    }


def confidence_label(mape_pct: float | None, n_days: int) -> str:
    """Human-readable forecast confidence from backtest accuracy and history."""
    if mape_pct is None or n_days < 28:
        return "LOW"
    if mape_pct <= 25 and n_days >= 60:
        return "HIGH"
    if mape_pct <= 40:
        return "MEDIUM"
    return "LOW"
