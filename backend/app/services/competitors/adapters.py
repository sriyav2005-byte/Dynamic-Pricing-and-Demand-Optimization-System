"""
services/competitors/adapters.py — per-platform price fetchers.

Status semantics (never mixed up):
    LIVE         parsed from the platform's own response during this request,
                 for the store's delivery location
    UNAVAILABLE  the platform could not be read (blocked, timeout, parse error,
                 location not confirmed) — no price is returned
Estimated/synthetic prices are never produced here.

Ground rules
    * We behave like an ordinary browser: no stealth plugins, no fingerprint
      spoofing, no CAPTCHA/WAF-challenge solving, no proxies. If a platform
      answers with a bot challenge or an access-denied page we stop, report
      the reason and fall back to manual entry (MANUAL_VERIFIED observations).
    * Quick-commerce prices depend on the delivery location, so every read is
      made for the store's coordinates and is rejected if the platform did not
      serve that location (otherwise another city's prices would be shown).
    * One slow or broken platform must never affect the others: every adapter
      returns a PlatformResult and never raises.

Access findings (verified from the development machine, Oct 2026)
    Blinkit           plain HTTP → 403; a normal headless Chromium session loads
                      the search page and its /v1/layout/search JSON → LIVE.
                      Without a delivery location it serves a default store in
                      another city, so the location cookies are set first.
    Zepto             AWS WAF JavaScript challenge (HTTP 202) → UNAVAILABLE.
    Swiggy Instamart  AWS WAF JavaScript challenge (HTTP 202) → UNAVAILABLE.
    BigBasket         Akamai "Access Denied" (HTTP 403)       → UNAVAILABLE.
Add an adapter here when a platform offers an official feed / partner API.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import logging
import re
import threading
import time
import urllib.parse
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

import httpx

from app.config import get_settings

log = logging.getLogger("priceiq.competitors")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/128.0.0.0 Safari/537.36")

PROBE_TTL_S = 30 * 60        # how long a "platform blocks automated access" verdict is reused
LIVE_TTL_S = 10 * 60         # identical (platform, query, location) reads within this window are reused
MAX_ATTEMPTS = 2             # one retry for transient failures (timeouts, navigation errors)
LOCATION_TOLERANCE_DEG = 0.05  # ≈ 5 km: the platform must have served this neighbourhood


@dataclass(frozen=True)
class Location:
    lat: float
    lon: float
    source: str = "store"     # "store" = the store's coordinates, "default" = DEFAULT_LAT/LON fallback

    def key(self) -> str:
        return f"{self.lat:.3f},{self.lon:.3f}"


@dataclass
class Listing:
    external_id: str | None
    name: str
    pack_size: str | None
    price: float
    mrp: float | None
    discount_pct: float | None
    in_stock: bool | None
    url: str | None
    image_url: str | None = None


@dataclass
class PlatformResult:
    key: str
    name: str
    status: str                       # LIVE | UNAVAILABLE
    search_url: str
    listings: list[Listing] = field(default_factory=list)
    reason: str | None = None
    blocked_by: str | None = None     # e.g. "AWS WAF bot challenge" — set when the platform refuses automation
    fetched_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    method: str = ""
    location: dict | None = None      # delivery location the prices are valid for
    attempts: int = 1
    duration_ms: int | None = None
    manual_entry_supported: bool = True

    def as_dict(self) -> dict:
        return asdict(self)


def unavailable(key: str, name: str, search_url: str, reason: str, method: str = "") -> PlatformResult:
    return PlatformResult(key, name, "UNAVAILABLE", search_url, reason=reason, method=method)


def _rupees(text: str | None) -> float | None:
    if not text:
        return None
    m = re.search(r"(\d[\d,]*\.?\d*)", str(text).replace("₹", ""))
    return float(m.group(1).replace(",", "")) if m else None


class _TTLStore:
    """Tiny thread-safe in-process cache for platform results."""

    def __init__(self) -> None:
        self._data: dict[str, tuple[float, PlatformResult]] = {}
        self._lock = threading.Lock()

    def get(self, key: str, ttl: float) -> PlatformResult | None:
        with self._lock:
            hit = self._data.get(key)
            if hit and time.time() - hit[0] < ttl:
                return hit[1]
            self._data.pop(key, None)
            return None

    def put(self, key: str, value: PlatformResult) -> None:
        with self._lock:
            if len(self._data) > 500:          # bound memory: drop the oldest half
                for k in sorted(self._data, key=lambda k: self._data[k][0])[:250]:
                    self._data.pop(k, None)
            self._data[key] = (time.time(), value)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()


_results = _TTLStore()


# ── Headless browser worker ─────────────────────────────────────────────────
# Playwright's sync API runs in one dedicated thread (its objects are
# thread-bound and it needs a subprocess-capable event loop on Windows).
# A single worker also serialises page loads, which keeps us to one request
# at a time per platform.

class BrowserWorker:
    def __init__(self) -> None:
        self._exec = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="browser")
        self._pw = None
        self._browser = None

    def _ensure(self):
        if self._browser is not None and not self._browser.is_connected():
            self._browser = None               # Chromium crashed or was killed: relaunch
        if self._browser is None:
            from playwright.sync_api import sync_playwright
            if self._pw is None:
                self._pw = sync_playwright().start()
            self._browser = self._pw.chromium.launch(headless=True)
        return self._browser

    def run(self, fn, location: Location | None = None):
        def job():
            browser = self._ensure()
            kwargs = dict(locale="en-IN", timezone_id="Asia/Kolkata", user_agent=UA, viewport={"width": 1366, "height": 900})
            if location is not None:
                kwargs.update(geolocation={"latitude": location.lat, "longitude": location.lon}, permissions=["geolocation"])
            ctx = browser.new_context(**kwargs)
            # Prices come from JSON; skipping images/fonts/media makes a read ~2× faster.
            ctx.route("**/*", lambda route: route.abort() if route.request.resource_type in ("image", "media", "font")
                      else route.continue_())
            try:
                return fn(ctx)
            finally:
                ctx.close()
        return self._exec.submit(job)

    def shutdown(self) -> None:
        def stop():
            if self._browser:
                self._browser.close()
            if self._pw:
                self._pw.stop()
        try:
            self._exec.submit(stop).result(timeout=10)
        except Exception:
            pass
        self._exec.shutdown(wait=False)


_worker: BrowserWorker | None = None


def browser() -> BrowserWorker:
    global _worker
    if _worker is None:
        _worker = BrowserWorker()
    return _worker


# ── Adapters ────────────────────────────────────────────────────────────────

class Adapter:
    key = ""
    name = ""
    search_template = ""

    def search_url(self, query: str) -> str:
        return self.search_template.format(q=urllib.parse.quote(query))

    async def search(self, query: str, location: Location) -> PlatformResult:  # pragma: no cover - interface
        raise NotImplementedError


class BlinkitAdapter(Adapter):
    key, name = "blinkit", "Blinkit"
    search_template = "https://blinkit.com/s/?q={q}"

    @staticmethod
    def _product_nodes(node):
        """Yield every dict that looks like a product card, wherever it is nested.

        Blinkit's layout JSON changes shape between releases (snippets, grids,
        carousels); a product card is recognised by its fields, not its position.
        """
        if isinstance(node, dict):
            name, price = node.get("name"), node.get("normal_price")
            if isinstance(name, dict) and name.get("text") and isinstance(price, dict) and price.get("text"):
                yield node
            else:
                for v in node.values():
                    yield from BlinkitAdapter._product_nodes(v)
        elif isinstance(node, list):
            for v in node:
                yield from BlinkitAdapter._product_nodes(v)

    @classmethod
    def parse(cls, payload: dict) -> list[Listing]:
        out, seen = [], set()
        for d in cls._product_nodes(payload.get("response") or payload):
            name = d["name"]["text"]
            price = _rupees(d["normal_price"]["text"])
            if price is None or price <= 0:
                continue
            mrp = _rupees((d.get("mrp") or {}).get("text")) or price
            if mrp < price:                    # a malformed card must not produce a negative discount
                mrp = price
            pid = (d.get("identity") or {}).get("id") or d.get("product_id")
            pack = (d.get("variant") or {}).get("text")
            dedupe = (str(pid), name, pack)
            if dedupe in seen:
                continue
            seen.add(dedupe)
            slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
            inv = d.get("inventory")
            out.append(Listing(
                external_id=str(pid) if pid else None, name=name, pack_size=pack,
                price=price, mrp=mrp, discount_pct=round((1 - price / mrp) * 100, 1) if mrp > 0 else None,
                in_stock=(inv > 0) if isinstance(inv, (int, float)) else None,
                url=f"https://blinkit.com/prn/{slug}/prid/{pid}" if pid else None,
                image_url=(d.get("image") or {}).get("url"),
            ))
        return out

    async def search(self, query: str, location: Location) -> PlatformResult:
        url = self.search_url(query)
        method = "headless browser (Playwright)"
        loc = {"lat": location.lat, "lon": location.lon, "source": location.source}
        s = get_settings()
        if not s.playwright_enabled:
            return unavailable(self.key, self.name, url, "Browser automation disabled (PLAYWRIGHT_ENABLED=false)", method)
        cache_key = f"{self.key}|{query.lower()}|{location.key()}"
        cached = _results.get(cache_key, LIVE_TTL_S)
        if cached is not None:
            return cached
        timeout_ms = int(s.scrape_timeout_s * 1000)

        def job(ctx):
            # Tell Blinkit which delivery location we are shopping for — the same
            # cookies its own location picker writes. Without them it answers
            # with a default store in another city.
            ctx.add_cookies([{"name": n, "value": v, "domain": "blinkit.com", "path": "/"}
                             for n, v in (("gr_1_lat", f"{location.lat:.6f}"), ("gr_1_lon", f"{location.lon:.6f}"),
                                          ("gr_1_locality", "1"))])
            page = ctx.new_page()
            first_page = lambda r: "/v1/layout/search" in r.url and "offset=" not in r.url and r.status == 200  # noqa: E731
            with page.expect_response(first_page, timeout=timeout_ms) as info:
                page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            resp = info.value
            hdr = resp.request.headers
            return resp.json(), hdr.get("lat"), hdr.get("lon")

        res = PlatformResult(self.key, self.name, "UNAVAILABLE", url, method=method, location=loc)
        started = time.time()
        for attempt in range(1, MAX_ATTEMPTS + 1):
            res.attempts = attempt
            try:
                fut = browser().run(job, location)
                payload, served_lat, served_lon = await asyncio.wait_for(asyncio.wrap_future(fut), timeout=s.scrape_timeout_s + 10)
            except ModuleNotFoundError:
                res.reason = "Playwright is not installed (pip install playwright && python -m playwright install chromium)"
                break
            except NotImplementedError:
                res.reason = "Browser automation needs a subprocess-capable event loop (run uvicorn without --reload on Windows)"
                break
            except Exception as exc:
                # Timeouts and navigation errors are usually transient: retry once with a fresh context.
                kind = "timed out" if "Timeout" in type(exc).__name__ else f"failed ({type(exc).__name__})"
                res.reason = f"Reading Blinkit {kind} after {attempt} attempt(s)"
                log.warning("blinkit search attempt %d failed: %s", attempt, (str(exc).splitlines() or [""])[0][:200])
                if attempt < MAX_ATTEMPTS:
                    await asyncio.sleep(1.5 * attempt)
                continue
            try:
                ok_location = (abs(float(served_lat) - location.lat) <= LOCATION_TOLERANCE_DEG
                               and abs(float(served_lon) - location.lon) <= LOCATION_TOLERANCE_DEG)
            except (TypeError, ValueError):
                ok_location = False
            if not ok_location:
                # Prices for another city would be misleading — report nothing instead.
                res.reason = "Blinkit did not confirm the store's delivery location; prices for another area are not shown"
                break
            res.listings = self.parse(payload)
            if res.listings:
                res.status, res.reason = "LIVE", None
            else:
                res.reason = "No products found for this query at the store's location"
            break
        res.duration_ms = int((time.time() - started) * 1000)
        if res.status == "LIVE":
            _results.put(cache_key, res)
        return res


class ProbeAdapter(Adapter):
    """Platforms that refuse automated access: report why, never guess a price.

    A light HTTP probe classifies the refusal. The verdict is cached per
    platform (PROBE_TTL_S) so searches and background refreshes do not keep
    hitting a site that has already said no.
    """

    def probe_url(self, query: str) -> str:
        return self.search_url(query)

    @staticmethod
    def classify(status: int, headers, body: str) -> tuple[str | None, str]:
        """→ (blocked_by, human-readable reason)."""
        low = body.lower()
        if headers.get("x-amzn-waf-action") or "awswaf" in low or "aws-waf" in low or (status == 202 and len(body.strip()) < 3000):
            return "AWS WAF bot challenge", (f"The platform answered with a JavaScript bot challenge (HTTP {status}). "
                                             "PriceIQ does not solve or bypass bot challenges")
        if status == 403 and ("access denied" in low or "edgesuite" in low or "akamai" in (headers.get("server") or "").lower()):
            return "Akamai access control", f"The platform denies automated access (HTTP {status} Access Denied)"
        if status in (401, 403, 429) or "captcha" in low or "automated" in low or "unusual traffic" in low:
            return "bot protection", f"Blocked by the platform's bot protection (HTTP {status})"
        if status >= 500:
            return None, f"The platform returned a server error (HTTP {status})"
        return None, (f"Prices are rendered client-side for a logged-in delivery location (HTTP {status}); "
                      "no supported data feed for this platform yet")

    async def search(self, query: str, location: Location) -> PlatformResult:
        url = self.search_url(query)
        cached = _results.get(f"{self.key}|probe", PROBE_TTL_S)
        if cached is not None:
            # Same verdict, but point the deep link at this query for manual checks.
            return PlatformResult(self.key, self.name, "UNAVAILABLE", url, reason=cached.reason, blocked_by=cached.blocked_by,
                                  method="HTTP probe (verdict cached)", fetched_at=cached.fetched_at)
        res = PlatformResult(self.key, self.name, "UNAVAILABLE", url, method="HTTP probe")
        started = time.time()
        try:
            async with httpx.AsyncClient(headers={"User-Agent": UA, "Accept-Language": "en-IN,en;q=0.9"},
                                         timeout=12, follow_redirects=True) as c:
                r = await c.get(self.probe_url(query), headers={"Accept": "text/html,application/json"})
            res.blocked_by, res.reason = self.classify(r.status_code, r.headers, r.text[:6000])
        except httpx.TimeoutException:
            res.reason = "The platform did not respond within 12 s"
        except Exception as exc:
            res.reason = f"Platform unreachable ({type(exc).__name__})"
        res.reason = (res.reason or "Unavailable") + ". Record a verified price manually instead."
        res.duration_ms = int((time.time() - started) * 1000)
        if res.blocked_by:                      # only cache definite refusals, not transient network errors
            _results.put(f"{self.key}|probe", res)
        return res


class BigBasketAdapter(ProbeAdapter):
    key, name = "bigbasket", "BigBasket"
    search_template = "https://www.bigbasket.com/ps/?q={q}"


class ZeptoAdapter(ProbeAdapter):
    key, name = "zepto", "Zepto"
    search_template = "https://www.zeptonow.com/search?query={q}"


class InstamartAdapter(ProbeAdapter):
    key, name = "instamart", "Swiggy Instamart"
    search_template = "https://www.swiggy.com/instamart/search?custom_back=true&query={q}"


ADAPTERS: dict[str, Adapter] = {a.key: a for a in (BlinkitAdapter(), BigBasketAdapter(), ZeptoAdapter(), InstamartAdapter())}
