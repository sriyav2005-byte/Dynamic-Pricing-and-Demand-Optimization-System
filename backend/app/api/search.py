"""
api/search.py — Live Price Search API Router
=============================================
Provides endpoints for searching product prices across quick-commerce platforms.

Endpoints
---------
GET /search/live
    Query params:
      - query    : str  (required) — product search string
      - category : str  (optional) — category hint for better MRP estimation

    Returns a JSON response with:
      - query, results, total, live_platforms, estimated_platforms
"""

from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel
from typing import List, Optional

from app.services.live_search_service import search_product_prices

router = APIRouter(prefix="/search", tags=["Live Price Search"])


# ── Response schemas (Pydantic) ───────────────────────────────────────────────

class LiveSearchResultSchema(BaseModel):
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


class LiveSearchResponseSchema(BaseModel):
    query: str
    results: List[LiveSearchResultSchema]
    total: int
    live_platforms: List[str]
    estimated_platforms: List[str]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get(
    "/live",
    response_model=LiveSearchResponseSchema,
    summary="Search real-time product prices across platforms",
    description=(
        "Searches for a product across Blinkit, Zepto, Swiggy Instamart, "
        "BigBasket, and Amazon Fresh. Returns live-scraped data where available "
        "and realistic price estimates with direct verification links elsewhere."
    ),
)
async def live_price_search(
    query: str = Query(..., min_length=2, max_length=200,
                       description="Product name to search (e.g. 'amul butter 500g')"),
    category: Optional[str] = Query(
        None,
        description="Optional category hint (beverages, dairy, snacks, etc.)"
    ),
):
    """
    Search for a product's real-time prices across all supported platforms.
    """
    if not query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    result = await search_product_prices(query=query, category=category)

    return LiveSearchResponseSchema(
        query=result.query,
        results=[
            LiveSearchResultSchema(
                platform_key=r.platform_key,
                platform=r.platform,
                color=r.color,
                text_color=r.text_color,
                logo_char=r.logo_char,
                tagline=r.tagline,
                product_name=r.product_name,
                price=r.price,
                original_price=r.original_price,
                discount_pct=r.discount_pct,
                product_url=r.product_url,
                is_live_data=r.is_live_data,
                image_url=r.image_url,
                in_stock=r.in_stock,
                quantity=r.quantity,
            )
            for r in result.results
        ],
        total=result.total,
        live_platforms=result.live_platforms,
        estimated_platforms=result.estimated_platforms,
    )


@router.get(
    "/platforms",
    summary="List all supported platforms",
)
def get_supported_platforms():
    """Returns metadata for all supported quick-commerce platforms."""
    from app.services.live_search_service import PLATFORMS
    return [
        {
            "key": key,
            "name": pf["display_name"],
            "color": pf["color"],
            "text_color": pf["text_color"],
            "tagline": pf["tagline"],
        }
        for key, pf in PLATFORMS.items()
    ]
