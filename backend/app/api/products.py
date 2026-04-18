"""
api/products.py — Product CRUD Endpoints
==========================================
Exposes the product catalogue to the frontend.

Routes
------
GET  /products/               → paginated, filterable product list
GET  /products/{product_id}   → single product detail
PATCH /products/{product_id}  → update mutable fields (stock, expiry, price, season)
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from app.database import get_db
from app.models.product import Product
from app.schemas.product import ProductResponse, ProductCreate, ProductUpdate

# All routes in this router are prefixed with /products
router = APIRouter(prefix="/products", tags=["products"])


@router.get("/", response_model=List[ProductResponse])
def list_products(
    db: Session = Depends(get_db),
    category: Optional[str] = Query(None, description="Filter by category name"),
    min_stock: Optional[int] = Query(None, description="Minimum stock level"),
    max_expiry: Optional[int] = Query(None, description="Maximum days to expiry"),
    skip: int = 0,
    limit: int = 100,
):
    """
    Return a list of products, optionally filtered by category, stock, or expiry.

    Filters are applied as AND conditions (all must match).
    Used by:
      - Dashboard product table (with the filter dropdowns)
      - Any frontend component that needs the full product catalogue
    """
    query = db.query(Product)

    # Optional filters — each is skipped if the parameter is not provided
    if category:
        query = query.filter(Product.category == category)
    if min_stock is not None:
        query = query.filter(Product.stock_level >= min_stock)
    if max_expiry is not None:
        query = query.filter(Product.days_to_expiry <= max_expiry)

    # Pagination: skip/limit allow the frontend to page through large catalogues
    return query.offset(skip).limit(limit).all()


@router.get("/{product_id}", response_model=ProductResponse)
def get_product(product_id: int, db: Session = Depends(get_db)):
    """
    Return a single product by its business product_id.

    Raises 404 if the product doesn't exist.
    Used by the Product Detail page to load context for the chart and simulator.
    """
    product = db.query(Product).filter(Product.product_id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@router.patch("/{product_id}", response_model=ProductResponse)
def update_product(
    product_id: int,
    payload: ProductUpdate,
    db: Session = Depends(get_db),
):
    """
    Partially update a product's mutable operational fields.

    Only fields provided in the request body are updated (PATCH semantics).
    Updatable fields: current_price, stock_level, days_to_expiry, season_factor.

    This endpoint is useful for:
      - Manually adjusting stock counts
      - Updating expiry dates as products age
      - Overriding the season factor for promotional periods
    """
    product = db.query(Product).filter(Product.product_id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    # `exclude_unset=True` skips fields not included in the request,
    # preventing accidental overwrites with default values
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(product, field, value)

    db.commit()
    db.refresh(product)
    return product
