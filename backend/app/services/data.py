"""
services/data.py — read models used by the ML layer.

The central structure is a *daily panel*: one row per (product, day) from the
product's first observation to the store's reference date, with

    units, revenue          from sales (days without sales ⇒ 0 units)
    price                   from daily snapshots, else reconstructed from pricing_history
    cost_price, mrp         from snapshots, else the product's current values
    days_to_expiry, stock,
    season_factor           from snapshots (NaN when not recorded)

Days are bucketed in the store's timezone.
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from datetime import date
from typing import Any, Callable, Iterator

import numpy as np
import pandas as pd

from app import db
from app.utils.cache import ttl_cache


# ── Batch scope ─────────────────────────────────────────────────────────────
# Store-wide computations (forecast overview, expiry optimization) run the
# single-product code path once per product. Inside `with batch():` the
# per-product lookups below are answered from one store-level query each
# instead of one query per product — with a hosted database that is the
# difference between ~3 and ~240 network round trips. The scope lives only for
# the duration of the call, so nothing stale survives it.
_batch: ContextVar[dict | None] = ContextVar("priceiq_batch", default=None)


@contextmanager
def batch() -> Iterator[None]:
    token = _batch.set({})
    try:
        yield
    finally:
        _batch.reset(token)


def batch_memo(key: tuple, load: Callable[[], Any]) -> Any:
    """load() once per batch scope; outside a scope it runs every time."""
    memo = _batch.get()
    if memo is None:
        return load()
    if key not in memo:
        memo[key] = load()
    return memo[key]


def product(store_id: str, product_id: str) -> dict | None:
    if _batch.get() is not None:
        rows = batch_memo(("products", store_id), lambda: {
            r["id"]: r for r in db.fetch_all(_PRODUCT_SQL + " where p.store_id = :sid", sid=store_id)})
        return rows.get(product_id)
    return db.fetch_one(_PRODUCT_SQL + " where p.store_id = :sid and p.id = :pid", sid=store_id, pid=product_id)


_PRODUCT_SQL = """
        select p.id::text, p.store_id::text, p.legacy_product_id, p.sku, p.name, p.brand,
               coalesce(c.name, 'Uncategorised') as category, p.category_id::text as category_id,
               p.cost_price::float8 as cost_price, p.selling_price::float8 as price, p.mrp::float8 as mrp,
               p.stock, p.reorder_level, p.safety_stock, p.expiry_date, (p.expiry_date - current_date) as days_to_expiry,
               p.season_factor::float8 as season_factor, p.is_perishable, p.is_synthetic,
               p.shelf_life_days, p.seasonal_sensitivity::float8 as seasonal_sensitivity,
               p.festival_sensitivity::float8 as festival_sensitivity, p.weather_sensitivity::float8 as weather_sensitivity,
               s.data_mode, s.timezone, s.organization_id::text as organization_id, s.latitude, s.longitude,
               s.name as store_name, app.store_reference_time(s.id) as reference_time
        from products p
        join stores s on s.id = p.store_id
        left join categories c on c.id = p.category_id
        """


def store(store_id: str) -> dict | None:
    return db.fetch_one(
        """select id::text, organization_id::text, name, city, latitude, longitude, timezone, data_mode,
                  app.store_reference_time(id) as reference_time
           from stores where id = :sid""",
        sid=store_id,
    )


def store_products(store_id: str) -> list[dict]:
    return db.fetch_all(
        """
        select p.id::text, p.name, p.sku, p.legacy_product_id, coalesce(c.name, 'Uncategorised') as category,
               p.cost_price::float8 as cost_price, p.selling_price::float8 as price, p.mrp::float8 as mrp,
               p.stock, (p.expiry_date - current_date) as days_to_expiry, p.season_factor::float8 as season_factor
        from products p left join categories c on c.id = p.category_id
        where p.store_id = :sid and p.is_active order by p.name
        """,
        sid=store_id,
    )


def panel(store_id: str, product_ids: list[str] | None = None) -> pd.DataFrame:
    """Daily (product × day) panel for a store; optionally restricted to products.

    Cached for 60 s (a copy is returned, so callers may mutate it)."""
    return _panel_cached(store_id, tuple(product_ids) if product_ids else None).copy()


@ttl_cache(60)
def _panel_cached(store_id: str, product_ids: tuple[str, ...] | None) -> pd.DataFrame:
    product_ids = list(product_ids) if product_ids else None
    st = store(store_id)
    if st is None:
        return pd.DataFrame()
    tz = st["timezone"] or "Asia/Kolkata"
    ref_day = pd.Timestamp(st["reference_time"]).tz_convert(tz).normalize().tz_localize(None)
    pid_filter = "and product_id = any(cast(:pids as uuid[]))" if product_ids else ""
    params: dict[str, Any] = {"sid": store_id, "tz": tz}
    if product_ids:
        params["pids"] = product_ids

    sales = db.fetch_df(
        f"""select product_id::text, (sold_at at time zone :tz)::date as d,
                   sum(quantity)::float8 as units, sum(revenue)::float8 as revenue
            from sales where store_id = :sid {pid_filter} group by 1, 2""",
        **params,
    )
    snaps = db.fetch_df(
        f"""select product_id::text, snapshot_date as d, price::float8 as price, cost_price::float8 as cost_price,
                   mrp::float8 as mrp, stock::float8 as stock, days_to_expiry::float8 as days_to_expiry,
                   season_factor::float8 as season_factor
            from product_daily_snapshots where store_id = :sid {pid_filter}""",
        **params,
    )
    changes = db.fetch_df(
        f"""select product_id::text, (created_at at time zone :tz) as t, new_price::float8 as price
            from pricing_history where store_id = :sid {pid_filter} order by created_at""",
        **params,
    )
    prods = pd.DataFrame(store_products(store_id))
    if prods.empty:
        return pd.DataFrame()
    if product_ids:
        prods = prods[prods["id"].isin(product_ids)]

    frames = []
    for _, p in prods.iterrows():
        pid = p["id"]
        s = sales[sales.product_id == pid]
        sn = snaps[snaps.product_id == pid]
        ch = changes[changes.product_id == pid]
        starts = [pd.Timestamp(x) for x in (s.d.min() if len(s) else None, sn.d.min() if len(sn) else None,
                                            ch.t.min().normalize() if len(ch) else None) if x is not None and not pd.isna(x)]
        if not starts:
            continue
        idx = pd.date_range(min(starts), ref_day, freq="D")
        if len(idx) == 0:
            continue
        f = pd.DataFrame(index=idx)
        f.index.name = "date"
        if len(s):
            sv = s.assign(d=pd.to_datetime(s.d)).set_index("d")
            f["units"] = sv["units"].reindex(idx).fillna(0.0)
            f["revenue"] = sv["revenue"].reindex(idx).fillna(0.0)
        else:
            f["units"] = 0.0
            f["revenue"] = 0.0
        if len(sn):
            snv = sn.assign(d=pd.to_datetime(sn.d)).set_index("d")
            for col in ["price", "cost_price", "mrp", "stock", "days_to_expiry", "season_factor"]:
                f[col] = snv[col].reindex(idx)
        else:
            for col in ["price", "cost_price", "mrp", "stock", "days_to_expiry", "season_factor"]:
                f[col] = np.nan
        # Fill price gaps from the price-change log (last change on or before day end).
        if f["price"].isna().any() and len(ch):
            cht = ch.assign(day=ch.t.dt.normalize()).groupby("day")["price"].last()
            f["price"] = f["price"].fillna(cht.reindex(idx).ffill())
        f["price"] = f["price"].ffill().bfill().fillna(p["price"])
        f["cost_price"] = f["cost_price"].ffill().fillna(p["cost_price"])
        f["mrp"] = f["mrp"].ffill().fillna(p["mrp"])
        f["season_factor"] = f["season_factor"].fillna(p["season_factor"])
        f["product_id"] = pid
        f["category"] = p["category"]
        f["legacy_product_id"] = p["legacy_product_id"]
        frames.append(f.reset_index())
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def history(store_id: str, product_id: str) -> pd.DataFrame:
    df = panel(store_id, [product_id])
    return df.set_index("date") if not df.empty else df


def histories(store_id: str) -> dict[str, pd.DataFrame]:
    """Date-indexed history of every product from ONE store-wide panel load.

    Store-level jobs (forecast overview, expiry optimization) use this instead
    of calling history() per product, which costs four queries per product.
    """
    df = panel(store_id)
    if df.empty:
        return {}
    return {pid: g.set_index("date") for pid, g in df.groupby("product_id", sort=False)}


LIVE_HOURS, MANUAL_HOURS = 6, 24   # keep in sync with LiveTTL / ManualTTL in backend-go/services/competitors.go


def market(product_id: str) -> dict:
    """Real competitor observations for a product (estimates and failed reads excluded).

    Label per observation: LIVE (scraped ≤ 6 h ago), MANUAL_VERIFIED (entered by
    staff ≤ 24 h ago) or CACHED (older). All three are real prices and count
    towards the market statistics; nothing is ever interpolated or guessed.
    """
    rows = db.fetch_all(
        """
        select k.key, k.name, pr.price::float8 as price, pr.mrp::float8 as mrp, pr.in_stock, pr.source,
               pr.observed_at, extract(epoch from now() - pr.observed_at) / 3600.0 as age_hours
        from competitor_prices pr
        join competitor_products cp on cp.id = pr.competitor_product_id
        join competitors k on k.id = cp.competitor_id
        where cp.product_id = :pid and pr.price is not null and pr.data_status = 'LIVE'
        order by pr.price
        """,
        pid=product_id,
    )
    for r in rows:
        manual = r["source"] == "MANUAL"
        fresh = r["age_hours"] <= (MANUAL_HOURS if manual else LIVE_HOURS)
        r["status"] = "CACHED" if not fresh else ("MANUAL_VERIFIED" if manual else "LIVE")
    prices = [r["price"] for r in rows]
    return {
        "observations": rows,
        "count": len(rows),
        "avg": float(np.mean(prices)) if prices else None,
        "min": float(min(prices)) if prices else None,
        "max": float(max(prices)) if prices else None,
    }


def seasonal_events(org_id: str | None, start: date, end: date) -> list[dict]:
    return batch_memo(("events", org_id, start, end), lambda: _seasonal_events(org_id, start, end))


def _seasonal_events(org_id: str | None, start: date, end: date) -> list[dict]:
    return db.fetch_all(
        """select name, event_type, start_date, end_date, is_date_approximate
           from seasonal_events
           where (organization_id is null or organization_id = cast(:org as uuid))
             and end_date >= :a and start_date <= :b and event_type <> 'SEASON'
           order by start_date""",
        org=org_id, a=start, b=end,
    )


def settings(store_id: str) -> dict | None:
    return db.fetch_one(
        """select pricing_mode::text, min_margin_pct::float8, max_price_change_pct::float8,
                  approval_threshold_pct::float8, expiry_markdown_days, max_expiry_markdown_pct::float8,
                  allow_below_cost_clearance, rules
           from store_settings where store_id = :sid""",
        sid=store_id,
    )
