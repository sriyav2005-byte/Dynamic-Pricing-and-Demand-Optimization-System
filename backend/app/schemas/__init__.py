# schemas package
from app.schemas.product import (
    ProductBase, ProductCreate, ProductUpdate,
    ProductResponse, PriceRecommendation, SimulationResult
)
from app.schemas.sale import SaleCreate, SaleResponse, AnalyticsSummary, TrendPoint
from app.schemas.competitor import CompetitorPriceResponse, MarketOverviewItem, PricingStrategyResponse
from app.schemas.agent import ChatMessage, ChatResponse, SuggestedQuestion
from app.schemas.forecasting import DemandForecast, ForecastOverviewItem
from app.schemas.inventory import InventoryOverview, ExpiryRiskItem, InventoryAlert
