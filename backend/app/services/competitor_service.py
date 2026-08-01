"""
services/competitor_service.py — Competitor Price Intelligence Engine
=====================================================================
Generates realistic competitor prices for Indian quick-commerce platforms
and computes market intelligence metrics.

Platforms simulated
-------------------
- Blinkit   : Aggressive discounting on FMCG, tight margins
- Zepto     : Premium positioning with occasional flash deals
- Instamart : Mid-range pricing, stable
- BigBasket : Volume-based pricing, tends to be cheapest on staples

Pricing model
-------------
Each platform has a characteristic pricing range expressed as a
(min_pct, max_pct) of the product's MRP. We use seeded random
generation keyed on product_id so prices are deterministic across
API calls (no flickering on page refresh) but vary realistically
across products and platforms.

Competitiveness score
---------------------
    score = 100 × (1 - (our_price - min_market) / (max_market - min_market))
    Clamped to [0, 100]. 100 = cheapest, 0 = most expensive.
"""

import hashlib
import random
from typing import List, Optional

# ── Platform pricing profiles ────────────────────────────────────────────────
# (min_fraction_of_mrp, max_fraction_of_mrp)
# e.g. (0.72, 0.92) means prices range from 72% to 92% of MRP
PLATFORM_PROFILES = {
    "Blinkit": {
        "min_pct": 0.70, "max_pct": 0.93,
        "category_bias": {
            "beverages": -0.03, "dairy": -0.02, "snacks": -0.04,
            "personal_care": 0.02, "household": 0.0,
        },
        "display_name": "Blinkit",
        "color": "#F7CB45",
    },
    "Zepto": {
        "min_pct": 0.75, "max_pct": 0.96,
        "category_bias": {
            "beverages": -0.02, "dairy": 0.01, "snacks": -0.05,
            "personal_care": 0.03, "household": 0.01,
        },
        "display_name": "Zepto",
        "color": "#7B2FF7",
    },
    "Instamart": {
        "min_pct": 0.73, "max_pct": 0.94,
        "category_bias": {
            "beverages": 0.0, "dairy": -0.01, "snacks": -0.02,
            "personal_care": 0.01, "household": -0.01,
        },
        "display_name": "Swiggy Instamart",
        "color": "#FC8019",
    },
    "BigBasket": {
        "min_pct": 0.68, "max_pct": 0.91,
        "category_bias": {
            "beverages": -0.04, "dairy": -0.05, "snacks": -0.03,
            "personal_care": 0.0, "household": -0.03,
        },
        "display_name": "BigBasket",
        "color": "#84C225",
    },
}


def _seeded_price(product_id: int, platform: str, cost: float, mrp: float,
                  category: str) -> float:
    """
    Generate a deterministic but realistic price for a (product, platform) pair.

    Uses a hash-based seed so the price is stable across API calls but
    varies naturally across different products and platforms.
    """
    seed_str = f"{product_id}-{platform}-v2"
    seed_int = int(hashlib.md5(seed_str.encode()).hexdigest()[:8], 16)
    rng = random.Random(seed_int)

    profile = PLATFORM_PROFILES[platform]
    bias = profile["category_bias"].get(category, 0.0)

    min_pct = max(0.0, profile["min_pct"] + bias)
    max_pct = min(1.0, profile["max_pct"] + bias)

    # Price as fraction of MRP, but never below cost + 5% margin
    fraction = rng.uniform(min_pct, max_pct)
    price = mrp * fraction
    floor = cost * 1.05
    price = max(price, floor)

    return round(price, 2)


def get_competitor_prices(product_id: int, cost_price: float, mrp: float,
                          category: str, our_price: float) -> dict:
    """
    Generate competitor prices for all platforms and compute market metrics.

    Returns
    -------
    dict with keys:
        product_id, our_price, competitors (list),
        market_avg, cheapest_platform, most_expensive_platform,
        competitiveness_score, price_position
    """
    competitors = []

    for key, profile in PLATFORM_PROFILES.items():
        price = _seeded_price(product_id, key, cost_price, mrp, category)
        diff_pct = round(((price - our_price) / our_price) * 100, 1)
        competitors.append({
            "platform": profile["display_name"],
            "platform_key": key,
            "price": price,
            "diff_pct": diff_pct,
            "color": profile["color"],
        })

    # Market metrics
    all_prices = [c["price"] for c in competitors]
    market_avg = round(sum(all_prices) / len(all_prices), 2)
    cheapest = min(competitors, key=lambda c: c["price"])
    most_expensive = max(competitors, key=lambda c: c["price"])

    # Competitiveness score: 100 = we are cheapest, 0 = we are most expensive
    all_with_ours = all_prices + [our_price]
    min_p = min(all_with_ours)
    max_p = max(all_with_ours)
    spread = max_p - min_p

    if spread > 0:
        score = round(100 * (1 - (our_price - min_p) / spread), 1)
    else:
        score = 100.0

    score = max(0.0, min(100.0, score))

    # Price position label
    if our_price <= cheapest["price"]:
        position = "cheapest"
    elif our_price >= most_expensive["price"]:
        position = "most_expensive"
    elif our_price <= market_avg:
        position = "below_average"
    else:
        position = "above_average"

    return {
        "product_id": product_id,
        "our_price": our_price,
        "competitors": competitors,
        "market_avg": market_avg,
        "cheapest_platform": cheapest["platform"],
        "most_expensive_platform": most_expensive["platform"],
        "competitiveness_score": score,
        "price_position": position,
    }


def get_pricing_strategy(product_id: int, cost_price: float, mrp: float,
                         category: str, our_price: float,
                         days_to_expiry: int, stock_level: int) -> dict:
    """
    Generate a pricing strategy recommendation based on competitor data
    and product context.

    Strategies
    ----------
    - aggressive_discount : Expiring soon or heavily overstocked
    - undercut           : We're above market average, reduce to gain share
    - match              : We're close to market average, hold position
    - premium            : Strong position, can maintain or raise slightly
    """
    comp_data = get_competitor_prices(product_id, cost_price, mrp, category, our_price)
    score = comp_data["competitiveness_score"]
    market_avg = comp_data["market_avg"]

    # Urgency factors
    expiring = days_to_expiry < 7
    overstocked = stock_level > 150

    if expiring:
        strategy = "aggressive_discount"
        target_price = round(cost_price * 1.10, 2)
        reason = (f"Product expires in {days_to_expiry} days. "
                  "Aggressive markdown recommended to minimise waste.")
        impact_pct = round(((target_price - our_price) / our_price) * 100, 1)
    elif score < 30:
        strategy = "undercut"
        target_price = round(market_avg * 0.97, 2)
        target_price = max(target_price, cost_price * 1.10)
        reason = (f"Competitiveness score is low ({score}/100). "
                  "Price 3% below market average to capture demand.")
        impact_pct = round(((target_price - our_price) / our_price) * 100, 1)
    elif score < 60:
        strategy = "match"
        target_price = round(market_avg, 2)
        target_price = max(target_price, cost_price * 1.12)
        reason = (f"Price is above market average. Match market price "
                  f"of ₹{market_avg} to stay competitive.")
        impact_pct = round(((target_price - our_price) / our_price) * 100, 1)
    else:
        strategy = "premium"
        target_price = our_price
        reason = (f"Strong competitive position (score: {score}/100). "
                  "Maintain current pricing to maximise margins.")
        impact_pct = 0.0

    # Ensure target never exceeds MRP or drops below cost+margin
    target_price = min(target_price, mrp)
    target_price = max(target_price, cost_price * 1.05)
    target_price = round(target_price, 2)

    return {
        "product_id": product_id,
        "strategy": strategy,
        "current_price": our_price,
        "target_price": target_price,
        "market_avg": market_avg,
        "competitiveness_score": score,
        "reason": reason,
        "impact_pct": impact_pct,
        "competitors": comp_data["competitors"],
    }


def get_market_overview(products: list) -> list:
    """
    Generate competitor comparison data for all products.

    Parameters
    ----------
    products : list of Product ORM objects

    Returns
    -------
    list of dicts, one per product, each containing competitor prices
    and competitiveness metrics.
    """
    overview = []
    for p in products:
        data = get_competitor_prices(
            product_id=p.product_id,
            cost_price=p.cost_price,
            mrp=p.mrp,
            category=p.category,
            our_price=p.current_price,
        )
        data["category"] = p.category
        data["cost_price"] = p.cost_price
        data["mrp"] = p.mrp
        data["stock_level"] = p.stock_level
        data["days_to_expiry"] = p.days_to_expiry
        data["is_live"] = False
        data["live_fetched_at"] = None
        overview.append(data)
    return overview


# ── Real-Time Live Scrape Competitor Functions ───────────────────────────────

async def fetch_live_competitor_prices(product) -> dict:
    """
    Fetch live fast-commerce prices for a single product ORM object or product dict.
    Calculates live market metrics & competitiveness scores dynamically.
    """
    from datetime import datetime
    from app.services.market_scraper import search_product_prices

    product_id = getattr(product, "product_id", 0)
    category = getattr(product, "category", "grocery")
    our_price = getattr(product, "current_price", getattr(product, "mrp", 100.0))
    cost_price = getattr(product, "cost_price", 80.0)
    mrp = getattr(product, "mrp", 120.0)
    stock_level = getattr(product, "stock_level", 50)
    days_to_expiry = getattr(product, "days_to_expiry", 15)

    query = f"{category} product {product_id}"
    # Use product attribute name if present
    if hasattr(product, "name") and getattr(product, "name"):
        query = getattr(product, "name")
    elif hasattr(product, "title") and getattr(product, "title"):
        query = getattr(product, "title")
    else:
        query = f"{category} {product_id}"

    live_results = await search_product_prices(query)
    now_str = datetime.now().strftime("%I:%M %p")

    if not live_results:
        # Fallback to simulated
        base = get_competitor_prices(product_id, cost_price, mrp, category, our_price)
        base["category"] = category
        base["cost_price"] = cost_price
        base["mrp"] = mrp
        base["stock_level"] = stock_level
        base["days_to_expiry"] = days_to_expiry
        base["is_live"] = False
        base["live_fetched_at"] = None
        return base

    # Map scraped live results to competitor format
    competitors = []
    for r in live_results:
        diff_pct = round(((r["price"] - our_price) / our_price) * 100, 1)
        competitors.append({
            "platform": r["platform"],
            "platform_key": r["platform_key"],
            "price": r["price"],
            "diff_pct": diff_pct,
            "color": r["color"],
            "url": r.get("url", "#"),
            "unit": r.get("unit", ""),
        })

    all_prices = [c["price"] for c in competitors]
    market_avg = round(sum(all_prices) / len(all_prices), 2)
    cheapest = min(competitors, key=lambda c: c["price"])
    most_expensive = max(competitors, key=lambda c: c["price"])

    all_with_ours = all_prices + [our_price]
    min_p = min(all_with_ours)
    max_p = max(all_with_ours)
    spread = max_p - min_p

    if spread > 0:
        score = round(100 * (1 - (our_price - min_p) / spread), 1)
    else:
        score = 100.0

    score = max(0.0, min(100.0, score))

    if our_price <= cheapest["price"]:
        position = "cheapest"
    elif our_price >= most_expensive["price"]:
        position = "most_expensive"
    elif our_price <= market_avg:
        position = "below_average"
    else:
        position = "above_average"

    return {
        "product_id": product_id,
        "our_price": our_price,
        "competitors": competitors,
        "market_avg": market_avg,
        "cheapest_platform": cheapest["platform"],
        "most_expensive_platform": most_expensive["platform"],
        "competitiveness_score": score,
        "price_position": position,
        "category": category,
        "cost_price": cost_price,
        "mrp": mrp,
        "stock_level": stock_level,
        "days_to_expiry": days_to_expiry,
        "is_live": True,
        "live_fetched_at": now_str,
    }


async def fetch_all_live_market_overview(products: list) -> list:
    """Fetch live market prices for all products in parallel."""
    import asyncio
    tasks = [fetch_live_competitor_prices(p) for p in products]
    return await asyncio.gather(*tasks)

