"""
services/live_search_service.py — Live Price Search Engine
===========================================================
Fetches real-time product prices from Indian quick-commerce platforms.

Strategy per platform
---------------------
- BigBasket   : httpx scrape of their public search JSON endpoint
                (returns real prices + product URLs)
- Blinkit     : Deep-link search URL + category-based price estimate
- Zepto       : Deep-link search URL + category-based price estimate
- Instamart   : Deep-link search URL + category-based price estimate
- Amazon Fresh: Deep-link search URL + category-based price estimate

The estimate engine uses the same competitor-profile fractions from
competitor_service.py applied to a typical category MRP so the numbers
are realistic and consistent with the rest of the system.

When BigBasket returns real data, results are flagged `is_live_data=True`.
All other platforms are flagged `is_live_data=False` with an honest
"Estimated" badge and a direct "Verify →" link.
"""

import asyncio
import hashlib
import random
import urllib.parse
from dataclasses import dataclass, field
from typing import List, Optional

import httpx

# ── Typical MRP ranges per category (₹) ──────────────────────────────────────
# Used to compute realistic price estimates when scraping isn't possible.
CATEGORY_MRP_MAP: dict[str, float] = {
    "beverages":     85.0,
    "dairy":         60.0,
    "snacks":        45.0,
    "personal_care": 180.0,
    "household":     120.0,
    "grocery":       90.0,
    "fruits":        70.0,
    "vegetables":    50.0,
    "meat":          350.0,
    "bakery":        55.0,
}
DEFAULT_MRP = 100.0

# ── Platform definitions ──────────────────────────────────────────────────────
PLATFORMS = {
    "blinkit": {
        "display_name": "Blinkit",
        "color": "#F7CB45",
        "text_color": "#1a1a1a",
        "logo_char": "⚡",
        "min_pct": 0.70, "max_pct": 0.93,
        "search_url": "https://blinkit.com/s/?q={query}",
        "tagline": "10-min delivery",
    },
    "zepto": {
        "display_name": "Zepto",
        "color": "#7B2FF7",
        "text_color": "#ffffff",
        "logo_char": "🔵",
        "min_pct": 0.75, "max_pct": 0.96,
        "search_url": "https://www.zeptonow.com/search?query={query}",
        "tagline": "10-min delivery",
    },
    "instamart": {
        "display_name": "Swiggy Instamart",
        "color": "#FC8019",
        "text_color": "#ffffff",
        "logo_char": "🛒",
        "min_pct": 0.73, "max_pct": 0.94,
        "search_url": "https://www.swiggy.com/instamart/search?query={query}",
        "tagline": "Fast delivery",
    },
    "bigbasket": {
        "display_name": "BigBasket",
        "color": "#84C225",
        "text_color": "#ffffff",
        "logo_char": "🧺",
        "min_pct": 0.68, "max_pct": 0.91,
        "search_url": "https://www.bigbasket.com/ps/?q={query}",
        "tagline": "Scheduled delivery",
    },
    "amazon_fresh": {
        "display_name": "Amazon Fresh",
        "color": "#FF9900",
        "text_color": "#1a1a1a",
        "logo_char": "📦",
        "min_pct": 0.74, "max_pct": 0.97,
        "search_url": "https://www.amazon.in/s?k={query}&i=nowstore",
        "tagline": "Same-day delivery",
    },
}

# ── BigBasket scraper headers ─────────────────────────────────────────────────
BB_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-IN,en-GB;q=0.9,en;q=0.8",
    "Referer": "https://www.bigbasket.com/",
    "Origin": "https://www.bigbasket.com",
    "x-channel": "BB-WEB",
    "x-tier": "prod",
}
BB_SEARCH_URL = (
    "https://www.bigbasket.com/listing-svc/v2/products"
    "?type=pc&slug={slug}&page=1&page_size=8&tab_type=%5B%22prd%22%5D"
)
BB_FALLBACK_URL = (
    "https://www.bigbasket.com/product/get-products/"
    "?slug={slug}&page=1"
)


@dataclass
class LiveSearchResult:
    platform_key: str
    platform: str
    color: str
    text_color: str
    logo_char: str
    tagline: str
    product_name: str
    price: float
    original_price: float
    discount_pct: float
    product_url: str
    is_live_data: bool
    image_url: Optional[str] = None
    in_stock: bool = True
    quantity: Optional[str] = None


@dataclass
class LiveSearchResponse:
    query: str
    results: List[LiveSearchResult] = field(default_factory=list)
    total: int = 0
    live_platforms: List[str] = field(default_factory=list)
    estimated_platforms: List[str] = field(default_factory=list)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _query_to_slug(query: str) -> str:
    """Convert a search query to a URL-friendly slug."""
    return query.strip().lower().replace(" ", "-").replace("'", "")


def _encoded_query(query: str) -> str:
    return urllib.parse.quote_plus(query.strip())


def _seed_price(query: str, platform_key: str, mrp: float,
                min_pct: float, max_pct: float) -> float:
    """
    Deterministic but realistic estimated price for (query, platform).
    Same seed logic as competitor_service for consistency.
    """
    seed_str = f"{query.lower()}-{platform_key}-live-v1"
    seed_int = int(hashlib.md5(seed_str.encode()).hexdigest()[:8], 16)
    rng = random.Random(seed_int)
    fraction = rng.uniform(min_pct, max_pct)
    return round(mrp * fraction, 2)


def _estimate_mrp(query: str, category: Optional[str]) -> float:
    """Guess a realistic MRP for the query based on category or keyword matching."""
    if category:
        for key, val in CATEGORY_MRP_MAP.items():
            if key in category.lower():
                return val

    q = query.lower()
    for cat_key, mrp in CATEGORY_MRP_MAP.items():
        if cat_key in q:
            return mrp

    # keyword heuristics
    if any(w in q for w in ["milk", "curd", "paneer", "butter", "cheese"]):
        return CATEGORY_MRP_MAP["dairy"]
    if any(w in q for w in ["juice", "water", "cola", "drink", "tea", "coffee"]):
        return CATEGORY_MRP_MAP["beverages"]
    if any(w in q for w in ["chips", "biscuit", "cookie", "namkeen", "popcorn"]):
        return CATEGORY_MRP_MAP["snacks"]
    if any(w in q for w in ["shampoo", "soap", "facewash", "toothpaste", "cream"]):
        return CATEGORY_MRP_MAP["personal_care"]
    if any(w in q for w in ["detergent", "cleaner", "mop", "brush", "tissue"]):
        return CATEGORY_MRP_MAP["household"]
    if any(w in q for w in ["apple", "banana", "mango", "orange", "grape"]):
        return CATEGORY_MRP_MAP["fruits"]
    if any(w in q for w in ["tomato", "potato", "onion", "carrot", "spinach"]):
        return CATEGORY_MRP_MAP["vegetables"]
    if any(w in q for w in ["chicken", "mutton", "fish", "egg", "prawn"]):
        return CATEGORY_MRP_MAP["meat"]

    return DEFAULT_MRP


def _build_estimated_result(
    query: str,
    platform_key: str,
    mrp: float,
) -> LiveSearchResult:
    """Build a price-estimated (non-live) result for a platform."""
    pf = PLATFORMS[platform_key]
    price = _seed_price(query, platform_key, mrp, pf["min_pct"], pf["max_pct"])
    discount_pct = round((1 - price / mrp) * 100, 1) if mrp > 0 else 0.0
    encoded = _encoded_query(query)
    url = pf["search_url"].format(query=encoded)

    return LiveSearchResult(
        platform_key=platform_key,
        platform=pf["display_name"],
        color=pf["color"],
        text_color=pf["text_color"],
        logo_char=pf["logo_char"],
        tagline=pf["tagline"],
        product_name=f'{query.title()} — {pf["display_name"]} Search Results',
        price=price,
        original_price=mrp,
        discount_pct=discount_pct,
        product_url=url,
        is_live_data=False,
        image_url=None,
        in_stock=True,
    )


# ── BigBasket live scraper ────────────────────────────────────────────────────

async def _scrape_bigbasket(query: str, mrp: float) -> List[LiveSearchResult]:
    """
    Attempt to scrape BigBasket's search endpoint.
    Returns a list of LiveSearchResult (is_live_data=True) on success,
    or a single estimated result on failure.
    """
    slug = _query_to_slug(query)
    encoded = _encoded_query(query)
    pf = PLATFORMS["bigbasket"]
    results: List[LiveSearchResult] = []

    try:
        async with httpx.AsyncClient(
            headers=BB_HEADERS, timeout=8.0, follow_redirects=True
        ) as client:
            url = BB_SEARCH_URL.format(slug=slug)
            resp = await client.get(url)

            if resp.status_code == 200:
                try:
                    data = resp.json()
                    # BigBasket listing-svc returns tabs → products
                    tabs = data.get("tabs", [])
                    products = []
                    for tab in tabs:
                        prds = tab.get("product_info", {}).get("products", [])
                        products.extend(prds)

                    for p in products[:5]:
                        mrp_val = float(p.get("mrp", 0) or p.get("w", {}).get("mrp", 0) or mrp)
                        sp = float(p.get("sp", 0) or p.get("w", {}).get("sp", 0) or (mrp_val * 0.82))
                        if sp <= 0:
                            sp = mrp_val * 0.82
                        disc = round((1 - sp / mrp_val) * 100, 1) if mrp_val > 0 else 0.0

                        name = (
                            p.get("desc", "")
                            or p.get("brand", "")
                            or query.title()
                        )
                        img = p.get("img", {})
                        img_url = (
                            img.get("s", img.get("m", "")) if isinstance(img, dict) else ""
                        ) or None

                        prod_url_slug = p.get("absolute_url", "")
                        prod_url = (
                            f"https://www.bigbasket.com{prod_url_slug}"
                            if prod_url_slug
                            else pf["search_url"].format(query=encoded)
                        )

                        results.append(LiveSearchResult(
                            platform_key="bigbasket",
                            platform=pf["display_name"],
                            color=pf["color"],
                            text_color=pf["text_color"],
                            logo_char=pf["logo_char"],
                            tagline=pf["tagline"],
                            product_name=name or query.title(),
                            price=round(sp, 2),
                            original_price=round(mrp_val, 2),
                            discount_pct=disc,
                            product_url=prod_url,
                            is_live_data=True,
                            image_url=img_url if img_url and img_url.startswith("http") else None,
                            in_stock=p.get("in_stock", True),
                            quantity=p.get("pack_desc", None),
                        ))
                except Exception:
                    pass  # fall through to estimate
    except Exception:
        pass  # network error — fall through to estimate

    if not results:
        results.append(_build_estimated_result(query, "bigbasket", mrp))

    return results


# ── Main entry point ──────────────────────────────────────────────────────────

async def search_product_prices(
    query: str,
    category: Optional[str] = None,
) -> LiveSearchResponse:
    """
    Fetch live/estimated prices for a product query across all platforms.

    Parameters
    ----------
    query    : User's product search string (e.g. "amul butter 500g")
    category : Optional product category hint for better MRP estimation

    Returns
    -------
    LiveSearchResponse with results, live_platforms, estimated_platforms
    """
    query = query.strip()
    mrp = _estimate_mrp(query, category)

    # Run BigBasket scrape + build estimates for all others concurrently
    non_bb_platforms = ["blinkit", "zepto", "instamart", "amazon_fresh"]

    bb_task = asyncio.create_task(_scrape_bigbasket(query, mrp))
    est_results = [_build_estimated_result(query, pk, mrp) for pk in non_bb_platforms]

    bb_results = await bb_task

    # Determine if BB data is live
    bb_is_live = any(r.is_live_data for r in bb_results)

    # Combine: show BB first then others
    all_results = bb_results + est_results

    live_platforms = [PLATFORMS["bigbasket"]["display_name"]] if bb_is_live else []
    est_platforms = (
        [PLATFORMS[pk]["display_name"] for pk in non_bb_platforms]
        + ([] if bb_is_live else [PLATFORMS["bigbasket"]["display_name"]])
    )

    return LiveSearchResponse(
        query=query,
        results=all_results,
        total=len(all_results),
        live_platforms=live_platforms,
        estimated_platforms=est_platforms,
    )
