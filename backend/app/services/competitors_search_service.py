"""
services/competitors_search_service.py — Standalone Competitor Search Service
==============================================================================
Accepts a free-text product query (e.g. "Amul Taaza Milk 500ml") and returns
structured, multi-platform price data for Blinkit, Zepto, Swiggy Instamart,
BigBasket, Amazon Fresh, and Flipkart Minutes.

Includes:
  - Real-time live web scraping engine using async HTTP queries across search indexes
  - Known MRP reference catalog for accurate base prices
  - Dynamic fallback calculation if live platform scraping is rate-limited
"""

import asyncio
import hashlib
import logging
import re
import urllib.parse
from datetime import datetime
from typing import Optional, List, Dict, Any
import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# ── Supported platform registry ───────────────────────────────────────────────
PLATFORM_REGISTRY = {
    "blinkit": {
        "name": "Blinkit",
        "display_name": "Blinkit",
        "emoji": "⚡",
        "color": "#F8CB2E",
        "bg": "#FFFBEB",
        "delivery_time": "8-12 min",
        "base_discount": 0.10,
        "search_url": "https://blinkit.com/s/?q={query}",
        "domains": ["blinkit.com", "grofers.com"],
        "logo_initial": "B",
    },
    "zepto": {
        "name": "Zepto",
        "display_name": "Zepto",
        "emoji": "🟣",
        "color": "#A855F7",
        "bg": "#FAF5FF",
        "delivery_time": "10-15 min",
        "base_discount": 0.06,
        "search_url": "https://www.zeptonow.com/search?q={query}",
        "domains": ["zeptonow.com", "zepto.com"],
        "logo_initial": "Z",
    },
    "instamart": {
        "name": "Swiggy Instamart",
        "display_name": "Swiggy Instamart",
        "emoji": "🛒",
        "color": "#FC8019",
        "bg": "#FFF7ED",
        "delivery_time": "12-18 min",
        "base_discount": 0.08,
        "search_url": "https://www.swiggy.com/instamart/search?custom_back=true&query={query}",
        "domains": ["swiggy.com"],
        "logo_initial": "I",
    },
    "bigbasket": {
        "name": "BigBasket",
        "display_name": "BigBasket",
        "emoji": "🧺",
        "color": "#84CC16",
        "bg": "#F7FEE7",
        "delivery_time": "2-4 hrs",
        "base_discount": 0.14,
        "search_url": "https://www.bigbasket.com/ps/?q={query}",
        "domains": ["bigbasket.com"],
        "logo_initial": "BB",
    },
    "amazon_fresh": {
        "name": "Amazon Fresh",
        "display_name": "Amazon Fresh",
        "emoji": "📦",
        "color": "#F59E0B",
        "bg": "#FFFBEB",
        "delivery_time": "2 hrs",
        "base_discount": 0.12,
        "search_url": "https://www.amazon.in/s?k={query}",
        "domains": ["amazon.in", "amazon.com"],
        "logo_initial": "A",
    },
    "flipkart_minutes": {
        "name": "Flipkart Minutes",
        "display_name": "Flipkart Minutes",
        "emoji": "🛍️",
        "color": "#2563EB",
        "bg": "#EFF6FF",
        "delivery_time": "10-15 min",
        "base_discount": 0.11,
        "search_url": "https://www.flipkart.com/search?q={query}",
        "domains": ["flipkart.com"],
        "logo_initial": "FK",
    },
}

# ── HTTP Headers for Live Scraping ────────────────────────────────────────────
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-IN,en-GB;q=0.9,en;q=0.8",
}

# ── Reference Catalog ─────────────────────────────────────────────────────────
PRODUCT_CATALOG: list[dict] = [
    # Dairy
    {"name": "Amul Taaza Milk",   "brand": "Amul",     "category": "dairy",      "mrp": 54.0,   "variants": ["500ml", "1L", "1.5L"]},
    {"name": "Amul Full Cream Milk", "brand": "Amul",  "category": "dairy",      "mrp": 68.0,   "variants": ["1L", "500ml"]},
    {"name": "Amul Butter",        "brand": "Amul",    "category": "dairy",      "mrp": 275.0,  "variants": ["100g", "200g", "500g"]},
    {"name": "Amul Gold Milk",     "brand": "Amul",    "category": "dairy",      "mrp": 74.0,   "variants": ["1L", "500ml"]},
    {"name": "Mother Dairy Milk",  "brand": "Mother Dairy", "category": "dairy", "mrp": 62.0,   "variants": ["1L", "500ml"]},
    {"name": "Nandini Milk",       "brand": "Nandini", "category": "dairy",      "mrp": 58.0,   "variants": ["1L", "500ml"]},
    {"name": "Amul Cheese",        "brand": "Amul",    "category": "dairy",      "mrp": 220.0,  "variants": ["200g", "400g"]},
    {"name": "Amul Dahi",          "brand": "Amul",    "category": "dairy",      "mrp": 60.0,   "variants": ["200g", "400g", "1kg"]},
    {"name": "Paneer",             "brand": "Amul",    "category": "dairy",      "mrp": 115.0,  "variants": ["200g", "500g"]},
    # Staples & Grains
    {"name": "Tata Salt",          "brand": "Tata",    "category": "staples",    "mrp": 28.0,   "variants": ["1kg", "2kg"]},
    {"name": "Aashirvaad Atta",    "brand": "ITC",     "category": "staples",    "mrp": 260.0,  "variants": ["1kg", "5kg", "10kg"]},
    {"name": "Fortune Chakki Atta","brand": "Fortune", "category": "staples",    "mrp": 240.0,  "variants": ["1kg", "5kg"]},
    {"name": "India Gate Basmati Rice", "brand": "India Gate", "category": "staples", "mrp": 380.0, "variants": ["1kg", "5kg"]},
    {"name": "Dawat Basmati Rice", "brand": "Dawat",   "category": "staples",    "mrp": 310.0,  "variants": ["1kg", "5kg"]},
    # Oils
    {"name": "Fortune Sunflower Oil", "brand": "Fortune", "category": "oils",   "mrp": 170.0,  "variants": ["1L", "5L"]},
    {"name": "Saffola Gold Oil",   "brand": "Saffola", "category": "oils",       "mrp": 185.0,  "variants": ["1L", "5L"]},
    {"name": "Dhara Mustard Oil",  "brand": "Dhara",   "category": "oils",       "mrp": 180.0,  "variants": ["1L", "5L"]},
    # Beverages
    {"name": "Coca Cola",          "brand": "Coca-Cola", "category": "beverages","mrp": 90.0,   "variants": ["750ml", "1.25L", "2L"]},
    {"name": "Pepsi",              "brand": "PepsiCo", "category": "beverages",  "mrp": 85.0,   "variants": ["750ml", "1.25L", "2L"]},
    {"name": "Tata Tea Gold",      "brand": "Tata",    "category": "beverages",  "mrp": 290.0,  "variants": ["250g", "500g", "1kg"]},
    {"name": "Red Label Tea",      "brand": "Brooke Bond", "category": "beverages","mrp": 310.0, "variants": ["250g", "500g"]},
    {"name": "Nescafe Classic",    "brand": "Nestlé",  "category": "beverages",  "mrp": 340.0,  "variants": ["50g", "100g", "200g"]},
    {"name": "Bru Coffee",         "brand": "HUL",     "category": "beverages",  "mrp": 220.0,  "variants": ["50g", "100g"]},
    # Snacks
    {"name": "Lays Classic",       "brand": "PepsiCo", "category": "snacks",     "mrp": 20.0,   "variants": ["26g", "50g", "120g"]},
    {"name": "Doritos Nacho Cheese","brand": "PepsiCo","category": "snacks",      "mrp": 50.0,   "variants": ["82.5g"]},
    {"name": "Haldirams Bhujia",   "brand": "Haldiram's", "category": "snacks",  "mrp": 80.0,   "variants": ["150g", "400g"]},
    {"name": "Parle-G Biscuits",   "brand": "Parle",   "category": "snacks",     "mrp": 25.0,   "variants": ["100g", "250g", "800g"]},
    {"name": "Good Day Biscuits",  "brand": "Britannia","category": "snacks",    "mrp": 35.0,   "variants": ["75g", "200g"]},
    {"name": "Maggi Noodles",      "brand": "Nestlé",  "category": "snacks",     "mrp": 56.0,   "variants": ["70g", "280g (4 pack)", "560g"]},
    # Personal Care
    {"name": "Colgate Toothpaste", "brand": "Colgate", "category": "personal_care","mrp": 120.0,"variants": ["100g", "150g", "200g"]},
    {"name": "Dove Shampoo",       "brand": "HUL",     "category": "personal_care","mrp": 350.0,"variants": ["180ml", "340ml"]},
    {"name": "Dettol Soap",        "brand": "Reckitt", "category": "personal_care","mrp": 160.0,"variants": ["75g", "125g", "3×125g"]},
    {"name": "Pantene Shampoo",    "brand": "P&G",     "category": "personal_care","mrp": 320.0,"variants": ["180ml", "340ml"]},
    # Household
    {"name": "Surf Excel",         "brand": "HUL",     "category": "household",  "mrp": 215.0,  "variants": ["500g", "1kg", "3kg"]},
    {"name": "Ariel Powder",       "brand": "P&G",     "category": "household",  "mrp": 195.0,  "variants": ["500g", "1kg"]},
    {"name": "Colin Glass Cleaner","brand": "Reckitt", "category": "household",  "mrp": 140.0,  "variants": ["500ml", "1L"]},
]

_AVAILABILITY_BY_PLATFORM = {
    "blinkit":          "In Stock",
    "zepto":            "In Stock",
    "instamart":        "In Stock",
    "bigbasket":        "Available",
    "amazon_fresh":     "In Stock",
    "flipkart_minutes": "In Stock",
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def _extract_unit(text: str) -> str:
    m = re.search(
        r"\b(\d+(?:\.\d+)?\s*(?:kg|g|gm|ml|l|ltr|litre|liters?|pcs?|pieces?|pack|nos?))\b",
        text, re.IGNORECASE,
    )
    return m.group(1).strip() if m else ""


def _match_catalog(query: str) -> Optional[dict]:
    q = query.lower()
    best = None
    best_score = 0
    for item in PRODUCT_CATALOG:
        score = 0
        if item["name"].lower() in q or q in item["name"].lower():
            score += 3
        if item["brand"].lower() in q:
            score += 2
        name_words = item["name"].lower().split()
        for w in name_words:
            if len(w) > 2 and w in q:
                score += 1
        if score > best_score:
            best_score = score
            best = item
    return best if best_score >= 2 else None


def _derive_mrp(query: str, catalog_match: Optional[dict]) -> float:
    if catalog_match:
        return catalog_match["mrp"]
    price_m = re.search(r"(?:₹|rs\.?\s*)(\d+(?:\.\d+)?)", query, re.IGNORECASE)
    if price_m:
        return float(price_m.group(1))
    seed = int(hashlib.md5(query.lower().strip().encode()).hexdigest()[:6], 16)
    return round(40.0 + (seed % 380), 0)


def _seeded_platform_price(query: str, platform_key: str, mrp: float) -> float:
    plat = PLATFORM_REGISTRY[platform_key]
    seed_str = f"{query.lower().strip()}-{platform_key}-v1"
    seed_val = int(hashlib.md5(seed_str.encode()).hexdigest()[:6], 16)
    variation = ((seed_val % 100) - 50) / 1000.0
    discount = max(0.02, min(0.28, plat["base_discount"] + variation))
    return round(mrp * (1.0 - discount), 2)


def _extract_inr_prices(text: str) -> List[float]:
    """Extract valid INR price values from scraped snippet text."""
    matches = re.findall(r"(?:₹|Rs\.?\s*|INR\s*)(\d+(?:\.\d{1,2})?)", text, re.IGNORECASE)
    prices = []
    for m in matches:
        try:
            val = float(m)
            if 5.0 <= val <= 25000.0:
                prices.append(val)
        except ValueError:
            pass
    return prices


# ── Real-Time Async Scraper ───────────────────────────────────────────────────

async def _scrape_live_prices(query: str) -> Dict[str, dict]:
    """
    Scrape real-time prices for quick-commerce platforms using public search queries.
    Returns a dict mapping platform_key -> {"price": float, "url": str, "source": "live_scraped"}
    """
    found: Dict[str, dict] = {}
    encoded_q = urllib.parse.quote(f"{query} price india blinkit zepto instamart bigbasket amazon flipkart")
    url = f"https://html.duckduckgo.com/html/?q={encoded_q}"

    try:
        async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=3.0) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, "html.parser")
                for result in soup.select(".result"):
                    title_el = result.select_one(".result__title")
                    snippet_el = result.select_one(".result__snippet")
                    link_el = result.select_one("a.result__url, a.result__a")
                    
                    title = title_el.get_text(strip=True) if title_el else ""
                    snippet = snippet_el.get_text(strip=True) if snippet_el else ""
                    href = link_el.get("href", "") if link_el else ""
                    combined = f"{title} {snippet} {href}".lower()

                    for key, plat in PLATFORM_REGISTRY.items():
                        if key in found:
                            continue
                        if any(d in combined for d in plat["domains"]):
                            prices = _extract_inr_prices(f"{title} {snippet}")
                            if prices:
                                found[key] = {
                                    "price": prices[0],
                                    "url": href if href and "http" in href else plat["search_url"].format(query=urllib.parse.quote(query)),
                                    "source": "live_scraped",
                                }
    except Exception as e:
        logger.debug("Live price scraping error: %s", e)

    return found


# ── Public API ────────────────────────────────────────────────────────────────

def get_platform_list() -> list[dict]:
    return [
        {
            "key": key,
            "name": p["display_name"],
            "emoji": p["emoji"],
            "color": p["color"],
            "bg": p["bg"],
            "delivery_time": p["delivery_time"],
        }
        for key, p in PLATFORM_REGISTRY.items()
    ]


async def search_competitor_prices(query: str) -> dict:
    """
    Search multi-platform prices for a real retail product query.
    Attempts live web price scraping first, falling back to deterministic MRP math.
    """
    if not query or not query.strip():
        return {}

    q = query.strip()
    catalog = _match_catalog(q)
    mrp = _derive_mrp(q, catalog)
    unit = _extract_unit(q) or (catalog["variants"][0] if catalog and catalog.get("variants") else "1 unit")
    product_name = catalog["name"] if catalog else q.title()
    brand = catalog["brand"] if catalog else _guess_brand(q)
    category = catalog["category"] if catalog else "grocery"

    encoded_q = urllib.parse.quote(q)

    # Attempt real-time live price scraping
    live_prices = await _scrape_live_prices(q)
    platform_results = []
    has_live = False

    for key, plat in PLATFORM_REGISTRY.items():
        if key in live_prices:
            price = live_prices[key]["price"]
            url = live_prices[key]["url"]
            is_live = True
            source = "live_scraped"
            has_live = True
        else:
            price = _seeded_platform_price(q, key, mrp)
            url = plat["search_url"].format(query=encoded_q)
            is_live = False
            source = "estimated"

        discount_pct = round(((mrp - price) / mrp) * 100, 1) if mrp > 0 else 0.0

        platform_results.append({
            "platform_key": key,
            "platform": plat["display_name"],
            "emoji": plat["emoji"],
            "color": plat["color"],
            "bg": plat["bg"],
            "price": price,
            "mrp": mrp,
            "discount_pct": discount_pct,
            "availability": _AVAILABILITY_BY_PLATFORM.get(key, "In Stock"),
            "delivery_time": plat["delivery_time"],
            "unit": unit,
            "url": url,
            "is_live": is_live,
            "source": source,
            "is_cheapest": False,
            "is_highest": False,
        })

    # Sort by price ascending
    platform_results.sort(key=lambda r: r["price"])
    if platform_results:
        platform_results[0]["is_cheapest"] = True
        platform_results[-1]["is_highest"] = True

    prices = [r["price"] for r in platform_results]
    market_avg = round(sum(prices) / len(prices), 2) if prices else 0.0
    price_spread = round(max(prices) - min(prices), 2) if prices else 0.0
    discount_from_mrp = round(((mrp - market_avg) / mrp) * 100, 1) if mrp > 0 else 0.0

    cheapest = platform_results[0] if platform_results else {}
    highest  = platform_results[-1] if platform_results else {}

    return {
        "query": q,
        "product_name": product_name,
        "brand": brand,
        "variant": unit,
        "category": category,
        "mrp": mrp,
        "market_avg": market_avg,
        "cheapest_platform": cheapest.get("platform_key", ""),
        "highest_platform": highest.get("platform_key", ""),
        "price_spread": price_spread,
        "discount_from_mrp": discount_from_mrp,
        "platforms": platform_results,
        "searched_at": datetime.now().isoformat(),
        "is_estimated": not has_live,
        "has_live": has_live,
    }


def _guess_brand(query: str) -> str:
    brands = [
        "Amul", "Tata", "Nestlé", "Nestle", "HUL", "ITC", "P&G", "Reckitt",
        "Britannia", "Parle", "Haldiram", "Fortune", "Saffola", "Colgate",
        "Dove", "Dettol", "Ariel", "Surf", "Mother Dairy", "Nandini",
        "India Gate", "Dawat", "PepsiCo", "Coca-Cola", "Brooke Bond",
    ]
    q_lower = query.lower()
    for brand in brands:
        if brand.lower() in q_lower:
            return brand
    return "Unknown"
