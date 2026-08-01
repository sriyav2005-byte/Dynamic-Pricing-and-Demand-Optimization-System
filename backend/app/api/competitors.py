"""
api/competitors.py — Standalone Competitor Search API
=======================================================
Independent of the pricing engine, ML models, and synthetic product database.

Routes
------
GET  /competitors/search?query=<str>  → Multi-platform estimated prices
GET  /competitors/platforms           → List of supported platforms

Architecture
------------
This router intentionally uses competitors_search_service (plural),
NOT competitor_service (singular). The singular service is tied to the
synthetic DB and ML pipeline. Keep them separate.

Future Integration
------------------
When ready to connect to the pricing engine, add optional parameters here:
  - ?product_id=<int>  to match a catalog product and return competitiveness score
  - ?compare=true      to return delta against our current price
"""

from fastapi import APIRouter, HTTPException, Query

from app.services.competitors_search_service import (
    search_competitor_prices,
    get_platform_list,
)

router = APIRouter(prefix="/competitors", tags=["competitor-search"])


@router.get("/search")
async def search_products(
    query: str = Query(
        ...,
        min_length=1,
        max_length=200,
        description="Product name to search across platforms (e.g. 'Amul Taaza Milk 500ml')",
    ),
):
    """
    Search prices for a real retail product across all supported
    quick-commerce and e-commerce platforms with live web scraping.
    """
    if not query.strip():
        raise HTTPException(status_code=422, detail="Query must not be blank")

    result = await search_competitor_prices(query.strip())
    if not result:
        raise HTTPException(status_code=404, detail="No results could be generated")

    return result


@router.get("/platforms")
def list_platforms():
    """
    Return the list of all supported quick-commerce / e-commerce platforms
    with their display metadata (name, emoji, brand color, delivery time).

    Use this to populate filter dropdowns and platform legend in the UI.
    """
    return get_platform_list()
