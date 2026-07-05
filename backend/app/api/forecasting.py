"""
api/forecasting.py — Demand Forecasting Endpoints
===================================================
Routes
------
GET /forecasting/demand/{product_id}  → Demand forecast with confidence bands
GET /forecasting/overview             → All-products forecast summary
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models.product import Product
from app.schemas.forecasting import DemandForecast, ForecastOverviewItem
from app.services.forecasting_service import generate_forecast, get_forecast_overview

router = APIRouter(prefix="/forecasting", tags=["forecasting"])


@router.get("/demand/{product_id}", response_model=DemandForecast)
def demand_forecast(
    product_id: int,
    horizon: int = Query(7, ge=1, le=30, description="Forecast horizon in days"),
    db: Session = Depends(get_db),
):
    """
    Generate a demand forecast for a product over the next `horizon` days.

    Returns daily predicted demand with confidence intervals (lower/upper bounds),
    plus aggregate metrics: total demand, trend direction, seasonal impact.
    """
    product = db.query(Product).filter(Product.product_id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found")

    return generate_forecast(
        product_id=product.product_id,
        category=product.category,
        cost_price=product.cost_price,
        mrp=product.mrp,
        current_price=product.current_price,
        stock_level=product.stock_level,
        days_to_expiry=product.days_to_expiry,
        season_factor=product.season_factor,
        horizon=horizon,
    )


@router.get("/overview", response_model=List[ForecastOverviewItem])
def forecast_overview(db: Session = Depends(get_db)):
    """
    Get a summary 7-day forecast for all products.

    Used by the Forecasting page overview table.
    """
    products = db.query(Product).all()
    return get_forecast_overview(products)
