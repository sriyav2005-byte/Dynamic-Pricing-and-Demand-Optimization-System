# schemas package
from app.schemas.product import (
    ProductBase, ProductCreate, ProductUpdate,
    ProductResponse, PriceRecommendation, SimulationResult
)
from app.schemas.sale import SaleCreate, SaleResponse, AnalyticsSummary, TrendPoint
