"""
services/competitors/service.py — live search and refresh of linked listings.

search(query, store_id)
    Queries every platform concurrently for the store's delivery location;
    each platform reports LIVE (with the listings it returned) or UNAVAILABLE
    (with the reason). Platforms are isolated from each other: a crash or
    timeout in one adapter becomes that platform's UNAVAILABLE result and the
    others are still returned. The market summary uses LIVE listings only.

refresh(store_id, product_id)
    For every competitor listing a user has linked to the product, re-reads
    the platform and records the observation:
      * success → competitor_prices upserted as LIVE + a history row
      * failure → the previous observation is kept (it ages into CACHED) and
                  the error is recorded; if there never was one, an
                  UNAVAILABLE row without a price is stored.
    Manually verified prices (source MANUAL) are never overwritten by a failed
    read. Unlinked platforms are not auto-matched: pack sizes and variants
    differ, so a wrong automatic match could mislead pricing. The response
    includes candidate listings the user can link explicitly.

No code path here invents, interpolates or estimates a competitor price.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from rapidfuzz import fuzz
from sqlalchemy import text

from app import db
from app.config import get_settings
from app.services import data
from app.services.competitors.adapters import ADAPTERS, Adapter, Listing, Location, PlatformResult, unavailable

log = logging.getLogger("priceiq.competitors")


def location_for(store: dict | None) -> Location:
    """Delivery location used for platform reads: the store's own coordinates,
    or the configured default when the store has none."""
    if store and store.get("latitude") is not None and store.get("longitude") is not None:
        return Location(float(store["latitude"]), float(store["longitude"]), "store")
    s = get_settings()
    return Location(s.store_lat, s.store_lon, "default")


async def _safe(adapter: Adapter, query: str, location: Location) -> PlatformResult:
    """Run one adapter so that nothing it does can break the other platforms."""
    budget = get_settings().scrape_timeout_s * 2 + 30      # two attempts + back-off
    try:
        return await asyncio.wait_for(adapter.search(query, location), timeout=budget)
    except asyncio.TimeoutError:
        return unavailable(adapter.key, adapter.name, adapter.search_url(query), f"No answer within {int(budget)} s")
    except Exception as exc:  # defensive: adapters are expected to catch their own errors
        log.exception("adapter %s crashed", adapter.key)
        return unavailable(adapter.key, adapter.name, adapter.search_url(query), f"Internal error while reading ({type(exc).__name__})")


def _summary(results: list[PlatformResult]) -> dict:
    prices = [l.price for r in results if r.status == "LIVE" for l in r.listings]
    return {
        "live_platforms": [r.name for r in results if r.status == "LIVE"],
        "unavailable_platforms": [{"name": r.name, "reason": r.reason, "blocked_by": r.blocked_by} for r in results if r.status != "LIVE"],
        "listings": len(prices),
        "lowest": min(prices) if prices else None,
        "highest": max(prices) if prices else None,
        "average": round(sum(prices) / len(prices), 2) if prices else None,
    }


async def search(query: str, store_id: str | None = None) -> dict:
    q = " ".join(query.split())
    loc = location_for(data.store(store_id) if store_id else None)
    results = list(await asyncio.gather(*(_safe(a, q, loc) for a in ADAPTERS.values())))
    flat = []
    for r in results:
        if r.status == "LIVE":
            for l in r.listings:
                flat.append({"platform_key": r.key, "platform": r.name, "status": "LIVE", **l.__dict__})
        else:
            flat.append({"platform_key": r.key, "platform": r.name, "status": "UNAVAILABLE", "reason": r.reason,
                         "url": r.search_url, "price": None})
    return {
        "query": q,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "location": {"lat": loc.lat, "lon": loc.lon, "source": loc.source},
        "platforms": [r.as_dict() for r in results],
        "results": flat,
        "summary": _summary(results),
        "labels": {"LIVE": "Read from the platform during this request, for the store's delivery location",
                   "CACHED": "Served from cache — may be up to 30 minutes old",
                   "MANUAL_VERIFIED": "Looked up and recorded by a staff member within the last 24 hours",
                   "UNAVAILABLE": "Platform could not be read; no price shown — record a verified price manually"},
    }


def _find(listings: list[Listing], external_id: str | None, name: str | None) -> Listing | None:
    """The linked listing among fresh results: by platform id, else a near-exact name match."""
    if external_id:
        for l in listings:
            if l.external_id == external_id:
                return l
    if name:
        best = max(listings, key=lambda l: fuzz.token_set_ratio(l.name.lower(), name.lower()), default=None)
        if best is not None and fuzz.token_set_ratio(best.name.lower(), name.lower()) >= 95:
            return best
    return None


def _record(cp_id: str, store_id: str, listing: Listing | None, error: str | None) -> str:
    """Persist the outcome of one platform read; returns the resulting label."""
    with db.transaction() as c:
        if listing is not None:
            c.execute(text("""
                insert into competitor_prices(competitor_product_id, store_id, price, mrp, discount_pct, in_stock, data_status, source, observed_at, error)
                values (:cp, :s, :p, :m, :d, :i, 'LIVE', 'SCRAPE', now(), null)
                on conflict (competitor_product_id) do update set price = excluded.price, mrp = excluded.mrp,
                    discount_pct = excluded.discount_pct, in_stock = excluded.in_stock, data_status = 'LIVE',
                    source = 'SCRAPE', observed_at = now(), error = null"""),
                {"cp": cp_id, "s": store_id, "p": listing.price, "m": listing.mrp, "d": listing.discount_pct, "i": listing.in_stock})
            c.execute(text("""insert into competitor_price_history(competitor_product_id, store_id, price, mrp, discount_pct, in_stock, source)
                              values (:cp, :s, :p, :m, :d, :i, 'SCRAPE')"""),
                      {"cp": cp_id, "s": store_id, "p": listing.price, "m": listing.mrp, "d": listing.discount_pct, "i": listing.in_stock})
            c.execute(text("""update competitor_products set external_name = coalesce(external_name, :n),
                              pack_size = coalesce(pack_size, :ps), updated_at = now() where id = :cp"""),
                      {"cp": cp_id, "n": listing.name, "ps": listing.pack_size})
            return "LIVE"
        existing = c.execute(text("select price is not null as has_price from competitor_prices where competitor_product_id = :cp"),
                             {"cp": cp_id}).first()
        if existing:
            # Keep the last real observation (scraped or manual); only note why the refresh failed.
            c.execute(text("update competitor_prices set error = :e where competitor_product_id = :cp"), {"cp": cp_id, "e": error})
            return "CACHED" if existing.has_price else "UNAVAILABLE"
        c.execute(text("""insert into competitor_prices(competitor_product_id, store_id, price, data_status, source, observed_at, error)
                          values (:cp, :s, null, 'UNAVAILABLE', 'SCRAPE', now(), :e)"""), {"cp": cp_id, "s": store_id, "e": error})
        return "UNAVAILABLE"


async def refresh(store_id: str, product_id: str) -> dict:
    product = data.product(store_id, product_id)
    if product is None:
        raise LookupError("product not found")
    loc = location_for(product)
    links = db.fetch_all(
        """select cp.id::text, k.key, cp.external_id, cp.external_name, cp.url
           from competitor_products cp join competitors k on k.id = cp.competitor_id
           where cp.product_id = :p and cp.store_id = :s and k.is_active""", p=product_id, s=store_id)
    by_key = {l["key"]: l for l in links}
    query = " ".join(x for x in [product.get("brand") or "", product["name"]] if x).strip()
    if product.get("brand") and product["name"].lower().startswith(product["brand"].lower()):
        query = product["name"]

    async def one(key: str):
        link = by_key.get(key)
        term = (link or {}).get("external_name") or query
        return key, await _safe(ADAPTERS[key], term, loc)

    results = dict(await asyncio.gather(*(one(k) for k in ADAPTERS)))
    outcome, candidates = [], {}
    for key, res in results.items():
        link = by_key.get(key)
        if link is None:
            if res.status == "LIVE":
                scored = sorted(res.listings, key=lambda l: -fuzz.token_set_ratio(l.name.lower(), product["name"].lower()))[:3]
                candidates[key] = [{**l.__dict__, "match_score": fuzz.token_set_ratio(l.name.lower(), product["name"].lower())} for l in scored]
            outcome.append({"platform": key, "linked": False, "status": res.status, "reason": res.reason})
            continue
        listing = _find(res.listings, link.get("external_id"), link.get("external_name")) if res.status == "LIVE" else None
        err = None if listing else (res.reason or "Linked listing not found in the platform's current results")
        try:
            status = _record(link["id"], store_id, listing, err)
        except Exception as exc:  # a failed write for one platform must not lose the others
            log.exception("recording %s observation failed", key)
            status, err = "UNAVAILABLE", f"Could not store the observation ({type(exc).__name__})"
        outcome.append({"platform": key, "linked": True, "status": status, "price": listing.price if listing else None, "reason": err})
    return {"product_id": product_id, "query": query, "platforms": outcome, "link_candidates": candidates,
            "location": {"lat": loc.lat, "lon": loc.lon, "source": loc.source},
            "note": "Only listings you link are tracked; candidates are suggestions from LIVE platform results."}
