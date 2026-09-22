/**
 * lib/api.ts — Typed API Client for the FastAPI Backend
 * =======================================================
 * Centralises all HTTP calls to the backend in one place.
 *
 * Uses Axios for HTTP (handles errors, headers, base URL config).
 * All response shapes are typed with TypeScript interfaces so the
 * components get full autocomplete and compile-time safety.
 *
 * Configuration
 * -------------
 * Base URL is read from the NEXT_PUBLIC_API_URL env variable:
 *   .env.local → NEXT_PUBLIC_API_URL=http://localhost:8000
 *
 * In production, set NEXT_PUBLIC_API_URL to your deployed backend URL.
 */

import axios from "axios";

// ── Axios instance ────────────────────────────────────────────────────────────
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  headers: { "Content-Type": "application/json" },
});

// ── Product Names ─────────────────────────────────────────────────────────────
export { getProductName, PRODUCT_NAMES } from "./products";

// ─────────────────────────────────────────────────────────────────────────────
// TypeScript interfaces — mirror the Pydantic schemas in the backend
// ─────────────────────────────────────────────────────────────────────────────

// ── Products ─────────────────────────────────────────────────────────────────

/** A product row from the database — shown in the Dashboard table. */
export interface Product {
  id: number;
  product_id: number;
  name?: string;
  product_name?: string;
  category: string;
  cost_price: number;
  mrp: number;
  current_price: number;
  stock_level: number;
  days_to_expiry: number;
  season_factor: number;
}

// ── Pricing ──────────────────────────────────────────────────────────────────

/** One discrete price arm from the Thompson Sampling bandit. */
export interface PriceOption {
  arm: number;
  price: number;
  expected_reward: number;
  predicted_demand: number;
  predicted_profit: number;
}

/** Full recommendation response from GET /pricing/recommend/{id}. */
export interface PriceRecommendation {
  product_id: number;
  product_name?: string;
  current_price: number;
  recommended_price: number;
  expected_demand: number;
  expected_profit: number;
  price_options: PriceOption[];
  constraint_applied: string | null;
}

/** Result from the price simulator (GET /pricing/simulate/{id}?price=X). */
export interface SimulationResult {
  product_id: number;
  product_name?: string;
  simulated_price: number;
  expected_demand: number;
  expected_profit: number;
  margin_pct: number;
}

// ── Sales ────────────────────────────────────────────────────────────────────

export interface SalePayload {
  product_id: number;
  price: number;
  units_sold: number;
}

export interface SaleResponse {
  id: number;
  product_id: number;
  product_name?: string;
  price_sold: number;
  units_sold: number;
  profit: number;
  sold_at: string;
}

// ── Analytics ────────────────────────────────────────────────────────────────

export interface AnalyticsSummary {
  total_revenue: number;
  total_profit: number;
  total_units_sold: number;
  avg_margin_pct: number;
  products_at_risk: number;
  top_products: { product_id: number; product_name?: string; total_profit: number }[];
}

export interface TrendPoint {
  date: string;
  revenue: number;
  profit: number;
  units: number;
}

// ── Competitor Intelligence ──────────────────────────────────────────────────

export interface CompetitorPrice {
  platform: string;
  platform_key: string;
  price: number;
  diff_pct: number;
  color: string;
}

export interface CompetitorPriceResponse {
  product_id: number;
  product_name?: string;
  our_price: number;
  competitors: CompetitorPrice[];
  market_avg: number;
  cheapest_platform: string;
  most_expensive_platform: string;
  competitiveness_score: number;
  price_position: string;
}

export interface MarketOverviewItem extends CompetitorPriceResponse {
  category: string;
  cost_price: number;
  mrp: number;
  stock_level: number;
  days_to_expiry: number;
}

export interface PricingStrategy {
  product_id: number;
  product_name?: string;
  strategy: string;
  current_price: number;
  target_price: number;
  market_avg: number;
  competitiveness_score: number;
  reason: string;
  impact_pct: number;
  competitors: CompetitorPrice[];
}

// ── AI Agent ─────────────────────────────────────────────────────────────────

export interface ChatResponse {
  intent: string;
  response_text: string;
  data: unknown;
  data_type: string | null;
  confidence: number;
  suggestions: string[];
}

export interface SuggestedQuestion {
  text: string;
  category: string;
  icon: string;
}

// ── Demand Forecasting ───────────────────────────────────────────────────────

export interface ForecastPoint {
  date: string;
  day_label: string;
  day_of_week: number;
  is_weekend: boolean;
  predicted_demand: number;
  lower_bound: number;
  upper_bound: number;
  days_to_expiry: number;
}

export interface DemandForecast {
  product_id: number;
  product_name?: string;
  horizon: number;
  forecast_points: ForecastPoint[];
  total_predicted_demand: number;
  avg_daily_demand: number;
  peak_day: string;
  trend_direction: string;
  seasonal_impact: string;
  current_price: number;
  season_factor: number;
}

export interface ForecastOverviewItem {
  product_id: number;
  product_name?: string;
  category: string;
  current_price: number;
  total_7d_demand: number;
  avg_daily_demand: number;
  trend_direction: string;
  seasonal_impact: string;
  peak_day: string;
}

// ── Inventory Intelligence ───────────────────────────────────────────────────

export interface CategoryHealth {
  category: string;
  total_products: number;
  healthy: number;
  at_risk: number;
  critical: number;
  total_stock: number;
  avg_days_to_expiry: number;
  health_pct: number;
}

export interface InventoryOverview {
  total_products: number;
  total_stock_value: number;
  risk_distribution: { critical: number; warning: number; healthy: number };
  stock_distribution: { low_stock: number; optimal: number; overstock: number };
  expiry_timeline: Record<string, number>;
  category_health: CategoryHealth[];
}

export interface ExpiryRiskItem {
  product_id: number;
  product_name?: string;
  category: string;
  current_price: number;
  cost_price: number;
  stock_level: number;
  days_to_expiry: number;
  risk_level: string;
  urgency: string;
  markdown_pct: number;
  suggested_price: number;
  potential_waste_value: number;
}

export interface InventoryAlert {
  type: string;
  product_id: number;
  product_name?: string;
  category: string;
  title: string;
  message: string;
  metric_value: number;
  metric_label: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// API helper functions
// ─────────────────────────────────────────────────────────────────────────────

// ── Products ─────────────────────────────────────────────────────────────────

export const getProducts = (params?: {
  category?: string;
  min_stock?: number;
  max_expiry?: number;
}) => api.get<Product[]>("/products/", { params }).then((r) => r.data);

export const getProduct = (id: number) =>
  api.get<Product>(`/products/${id}`).then((r) => r.data);

export const getCategories = () =>
  api.get<string[]>("/categories").then((r) => r.data);

// ── Pricing ──────────────────────────────────────────────────────────────────

export const getRecommendation = (id: number) =>
  api.get<PriceRecommendation>(`/pricing/recommend/${id}`).then((r) => r.data);

export const simulatePrice = (id: number, price: number) =>
  api
    .get<SimulationResult>(`/pricing/simulate/${id}`, { params: { price } })
    .then((r) => r.data);

// ── Sales ────────────────────────────────────────────────────────────────────

export const updateSales = (payload: SalePayload) =>
  api.post<SaleResponse>("/update-sales", payload).then((r) => r.data);

// ── Analytics ────────────────────────────────────────────────────────────────

export const getAnalyticsSummary = () =>
  api.get<AnalyticsSummary>("/analytics/summary").then((r) => r.data);

export const getAnalyticsTrends = () =>
  api.get<TrendPoint[]>("/analytics/trends").then((r) => r.data);

// ── Competitor Intelligence ──────────────────────────────────────────────────

export const getCompetitorPrices = (id: number) =>
  api
    .get<CompetitorPriceResponse>(`/competitor/prices/${id}`)
    .then((r) => r.data);

export const getMarketOverview = () =>
  api.get<MarketOverviewItem[]>("/competitor/market-overview").then((r) => r.data);

export const getCompetitorStrategy = (id: number) =>
  api
    .get<PricingStrategy>(`/competitor/strategy/${id}`)
    .then((r) => r.data);

// ── AI Agent ─────────────────────────────────────────────────────────────────

export const sendChatMessage = (message: string) =>
  api
    .post<ChatResponse>("/agent/chat", { message })
    .then((r) => r.data);

export const getAgentSuggestions = () =>
  api.get<SuggestedQuestion[]>("/agent/suggestions").then((r) => r.data);

// ── Demand Forecasting ───────────────────────────────────────────────────────

export const getDemandForecast = (id: number, horizon: number = 7) =>
  api
    .get<DemandForecast>(`/forecasting/demand/${id}`, {
      params: { horizon },
    })
    .then((r) => r.data);

export const getForecastOverview = () =>
  api.get<ForecastOverviewItem[]>("/forecasting/overview").then((r) => r.data);

// ── Inventory Intelligence ───────────────────────────────────────────────────

export const getInventoryOverview = () =>
  api.get<InventoryOverview>("/inventory/overview").then((r) => r.data);

export const getExpiryRisk = () =>
  api.get<ExpiryRiskItem[]>("/inventory/expiry-risk").then((r) => r.data);

export const getInventoryAlerts = () =>
  api.get<InventoryAlert[]>("/inventory/alerts").then((r) => r.data);

// ── Live Price Search ─────────────────────────────────────────────────────────

/** A single product result from one quick-commerce platform. */
export interface LiveSearchResult {
  platform_key: string;
  platform: string;
  color: string;
  text_color: string;
  logo_char: string;
  tagline: string;
  product_name: string;
  price: number;
  original_price: number;
  discount_pct: number;
  product_url: string;
  is_live_data: boolean;
  image_url: string | null;
  in_stock: boolean;
  quantity: string | null;
}

/** Full response from GET /search/live. */
export interface LiveSearchResponse {
  query: string;
  results: LiveSearchResult[];
  total: number;
  live_platforms: string[];
  estimated_platforms: string[];
}

/** Platform metadata from GET /search/platforms. */
export interface SearchPlatform {
  key: string;
  name: string;
  color: string;
  text_color: string;
  tagline: string;
}

export const searchLivePrices = (
  query: string,
  category?: string
): Promise<LiveSearchResponse> =>
  api
    .get<LiveSearchResponse>("/search/live", {
      params: { query, ...(category ? { category } : {}) },
    })
    .then((r) => r.data);

export const getSearchPlatforms = (): Promise<SearchPlatform[]> =>
  api.get<SearchPlatform[]>("/search/platforms").then((r) => r.data);

export default api;
