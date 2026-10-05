"""
ml/features.py — feature engineering shared by training and inference.

Demand model v2 features (no raw product id, so the model generalizes to
products that were never in the training data):

    category_enc      label-encoded category (NaN if unseen)
    price, cost_price, mrp
    price_to_mrp      price / MRP
    margin            (price − cost) / price
    rel_price         price / mean price of the previous 28 days
    base_demand_28    mean daily units of the previous 28 days (lagged)
    base_demand_7     mean daily units of the previous 7 days (lagged)
    day_of_week, month, is_weekend
    days_to_expiry    NaN when unknown
    season_factor
    event_flag        1 inside a festival / national-holiday window
    days_to_event     days until the next such window (capped at 60; 0 inside)

All lag features use strictly earlier days (shift(1)) — no target leakage.
"""

from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd

FEATURES_V2 = [
    "category_enc", "price", "cost_price", "mrp", "price_to_mrp", "margin", "rel_price",
    "base_demand_28", "base_demand_7", "day_of_week", "month", "is_weekend",
    "days_to_expiry", "season_factor", "event_flag", "days_to_event",
]

# Economic prior: demand never increases with price (XGBoost monotone constraints).
MONOTONE_V2 = {"price": -1, "price_to_mrp": -1, "margin": -1, "rel_price": -1}

EVENT_HORIZON_CAP = 60


def add_lag_features(df: pd.DataFrame, group: str = "product_id") -> pd.DataFrame:
    """df needs [group, date, units, price]; returns a copy sorted by group/date."""
    df = df.sort_values([group, "date"]).copy()
    g = df.groupby(group, sort=False)
    df["base_demand_28"] = g["units"].transform(lambda s: s.shift(1).rolling(28, min_periods=7).mean())
    df["base_demand_7"] = g["units"].transform(lambda s: s.shift(1).rolling(7, min_periods=3).mean())
    price_mean = g["price"].transform(lambda s: s.shift(1).rolling(28, min_periods=7).mean())
    df["rel_price"] = df["price"] / price_mean
    return df


def event_features(dates: pd.Series, events: list[dict]) -> pd.DataFrame:
    """event_flag / days_to_event for each date given event windows."""
    windows = sorted((pd.Timestamp(e["start_date"]), pd.Timestamp(e["end_date"])) for e in events)
    flags, dist = [], []
    for d in pd.to_datetime(dates):
        inside = any(a <= d <= b for a, b in windows)
        nxt = [(a - d).days for a, _ in windows if a > d]
        flags.append(1 if inside else 0)
        dist.append(0 if inside else min(min(nxt) if nxt else EVENT_HORIZON_CAP, EVENT_HORIZON_CAP))
    return pd.DataFrame({"event_flag": flags, "days_to_event": dist}, index=dates.index)


def add_calendar_and_price(df: pd.DataFrame, events: list[dict], encoder: dict[str, int]) -> pd.DataFrame:
    d = pd.to_datetime(df["date"])
    df["day_of_week"] = d.dt.dayofweek
    df["month"] = d.dt.month
    df["is_weekend"] = (df["day_of_week"] >= 5).astype(int)
    df["price_to_mrp"] = df["price"] / df["mrp"]
    df["margin"] = (df["price"] - df["cost_price"]) / df["price"]
    df["category_enc"] = df["category"].str.lower().map(encoder).astype(float)
    ev = event_features(df["date"], events)
    df["event_flag"] = ev["event_flag"]
    df["days_to_event"] = ev["days_to_event"]
    for col in ("days_to_expiry", "season_factor"):
        if col not in df:
            df[col] = np.nan
    return df


# Training and inference must build features identically: both go through
# add_calendar_and_price(); training adds lags with add_lag_features(), while
# future_frame() freezes the same lags at the forecast origin.

def future_frame(
    hist: pd.DataFrame,
    dates: list[date],
    prices: list[float] | float,
    product: dict,
    events: list[dict],
    encoder: dict[str, int],
    days_to_expiry_at: dict | None = None,
) -> pd.DataFrame:
    """Build v2 feature rows for future dates from a product's history.

    Lag features are frozen at the end of the history (the forecast origin);
    days_to_expiry counts down from the product's current expiry date.
    """
    tail = hist.tail(28)
    base28 = float(tail["units"].mean()) if len(tail) >= 7 else np.nan
    tail7 = hist.tail(7)
    base7 = float(tail7["units"].mean()) if len(tail7) >= 3 else np.nan
    mean_price = float(tail["price"].mean()) if len(tail) >= 7 else np.nan
    n = len(dates)
    price_arr = np.full(n, prices, dtype=float) if np.isscalar(prices) else np.asarray(prices, dtype=float)
    df = pd.DataFrame({
        "date": pd.to_datetime(dates),
        "price": price_arr,
        "cost_price": product["cost_price"],
        "mrp": product["mrp"],
        "category": product["category"],
        "season_factor": product.get("season_factor", 1.0),
        "base_demand_28": base28,
        "base_demand_7": base7,
    })
    df["rel_price"] = df["price"] / mean_price if mean_price and not np.isnan(mean_price) else np.nan
    dte = product.get("days_to_expiry")
    if dte is not None and not pd.isna(dte):
        today = pd.Timestamp.now(tz=product.get("timezone") or "Asia/Kolkata").normalize().tz_localize(None)
        df["days_to_expiry"] = [float(dte - (pd.Timestamp(d) - today).days) for d in dates]
    else:
        df["days_to_expiry"] = np.nan
    return add_calendar_and_price(df, events, encoder)
