"""
models/product.py — Product ORM Model
=======================================
Defines the `products` table schema using SQLAlchemy's declarative style.

Each row represents one unique product in the retail inventory.
The system reads the latest state of each product from this table when:
  - Listing products on the Dashboard
  - Fetching context for ML demand prediction
  - Calculating price recommendations via the bandit
"""

from sqlalchemy import Column, Integer, Float, String, DateTime
from sqlalchemy.sql import func
from app.database import Base


class Product(Base):
    """
    SQLAlchemy model for the `products` table.

    Columns
    -------
    product_id    : Integer, unique business ID (from the dataset).
    category      : Product category string (e.g. "beverages", "snacks").
    cost_price    : Wholesale cost — used as floor for pricing constraints.
    mrp           : Maximum Retail Price — hard ceiling for all price actions.
    current_price : The price currently active in the store.
    stock_level   : Units currently in inventory (affects demand prediction).
    days_to_expiry: Days until the product expires (triggers discount logic
                    when < 7 days via the pricing engine constraint).
    season_factor : Multiplier representing seasonal demand (e.g. 1.1 = 10%
                    demand boost during peak season).
    created_at    : Row creation timestamp (auto-set by the database).
    updated_at    : Last update timestamp (auto-set on every PATCH call).
    """

    __tablename__ = "products"

    # Internal auto-increment primary key (not the same as product_id)
    id = Column(Integer, primary_key=True, index=True)

    # Business product identifier — must be unique across the table
    product_id = Column(Integer, unique=True, index=True, nullable=False)

    # Real-world product details for fast commerce intelligence
    name  = Column(String(255), nullable=True)
    brand = Column(String(100), nullable=True)

    category = Column(String(100), nullable=False)

    # Economic bounds — cost is the minimum viable price, mrp is the maximum
    cost_price = Column(Float, nullable=False)
    mrp = Column(Float, nullable=False)

    # The price currently shown to customers
    current_price = Column(Float, nullable=False)

    # Inventory and freshness fields fed into the ML model
    stock_level    = Column(Integer, default=100)
    days_to_expiry = Column(Integer, default=30)
    season_factor  = Column(Float, default=1.0)

    # Audit timestamps — set automatically by the database engine
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

