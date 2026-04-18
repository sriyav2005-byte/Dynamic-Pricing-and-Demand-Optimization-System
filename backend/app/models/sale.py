"""
models/sale.py — Sale ORM Model
=================================
Defines the `sales` table schema.

Every time the frontend clicks "Apply Recommendation" or the user calls
POST /update-sales, a new row is inserted here.  This table drives:
  - The /analytics/summary endpoint (total revenue, profit, top products)
  - The /analytics/trends endpoint (daily time-series)
  - The bandit reward update (profit is normalised and fed back to Thompson Sampling)
"""

from sqlalchemy import Column, Integer, Float, String, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.database import Base


class Sale(Base):
    """
    SQLAlchemy model for the `sales` table.

    Columns
    -------
    product_id  : Foreign key to products.product_id — links each sale to
                  a product so analytics can aggregate per product.
    price_sold  : The actual price the product was sold at.
    units_sold  : Number of units in this transaction.
    profit      : Pre-computed profit = (price_sold - cost_price) × units_sold.
                  Stored for fast aggregation without re-joining products.
    sold_at     : Timestamp of the sale (auto-set by DB; used for trend charts).
    """

    __tablename__ = "sales"

    id = Column(Integer, primary_key=True, index=True)

    # Foreign key to products.product_id (not products.id)
    product_id = Column(
        Integer,
        ForeignKey("products.product_id"),
        nullable=False,
        index=True,   # indexed for fast GROUP BY in analytics queries
    )

    price_sold = Column(Float, nullable=False)
    units_sold = Column(Integer, nullable=False)

    # profit is denormalised here so analytics queries avoid a join
    profit = Column(Float, nullable=False)

    # Auto-set by the database engine on INSERT
    sold_at = Column(DateTime(timezone=True), server_default=func.now())
