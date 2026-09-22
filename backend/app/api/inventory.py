"""
api/inventory.py — Inventory Intelligence Endpoints
=====================================================
Routes
------
GET /inventory/overview     → Full inventory health dashboard data
GET /inventory/expiry-risk  → Products at expiry risk with markdown recs
GET /inventory/alerts       → Prioritised inventory alerts
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models.product import Product
from app.schemas.inventory import InventoryOverview, ExpiryRiskItem, InventoryAlert
from app.services.inventory_service import (
    get_inventory_overview,
    get_expiry_risk,
    get_inventory_alerts,
)

router = APIRouter(prefix="/inventory", tags=["inventory"])


@router.get("/overview", response_model=InventoryOverview)
def inventory_overview(db: Session = Depends(get_db)):
    """
    Comprehensive inventory health dashboard.

    Returns total metrics, risk/stock distributions, expiry timeline,
    and per-category health scores.
    """
    products = db.query(Product).all()
    return get_inventory_overview(products)


@router.get("/expiry-risk", response_model=List[ExpiryRiskItem])
def expiry_risk(db: Session = Depends(get_db)):
    """
    Products at expiry risk with recommended markdown percentages.

    Sorted by days_to_expiry ascending (most urgent first).
    """
    products = db.query(Product).all()
    return get_expiry_risk(products)


@router.get("/alerts", response_model=List[InventoryAlert])
def inventory_alerts(db: Session = Depends(get_db)):
    """
    Prioritised inventory alerts: critical, warning, and info.

    Used to render alert cards on the Inventory page.
    """
    products = db.query(Product).all()
    return get_inventory_alerts(products)
