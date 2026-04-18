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
// All API calls share the same base URL and Content-Type header.
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  headers: { "Content-Type": "application/json" },
});

// ─────────────────────────────────────────────────────────────────────────────
// TypeScript interfaces — mirror the Pydantic schemas in the backend
// ─────────────────────────────────────────────────────────────────────────────

/** A product row from the database — shown in the Dashboard table. */
export interface Product {
  id: number;
  product_id: number;
  category: string;
  cost_price: number;
  mrp: number;
  current_price: number;
  stock_level: number;
  days_to_expiry: number;
  season_factor: number;
}

/** One discrete price arm from the Thompson Sampling bandit. */
export interface PriceOption {
  arm: number;              // index 0–9
  price: number;            // price value in ₹
  expected_reward: number;  // Beta distribution mean = α/(α+β)
  predicted_demand: number; // XGBoost demand prediction at this price
  predicted_profit: number; // (price - cost) × predicted_demand
}

/** Full recommendation response from GET /pricing/recommend/{id}. */
export interface PriceRecommendation {
  product_id: number;
  current_price: number;
  recommended_price: number;  // price after bandit + constraints
  expected_demand: number;
  expected_profit: number;
  price_options: PriceOption[];        // all 10 arms for the chart
  constraint_applied: string | null;   // which constraint fired (if any)
}

/** Result from the price simulator (GET /pricing/simulate/{id}?price=X). */
export interface SimulationResult {
  product_id: number;
  simulated_price: number;
  expected_demand: number;
  expected_profit: number;
  margin_pct: number;  // ((price - cost) / cost) × 100
}

/** Payload for POST /update-sales. */
export interface SalePayload {
  product_id: number;
  price: number;
  units_sold: number;
}

/** Response from POST /update-sales — the recorded sale row. */
export interface SaleResponse {
  id: number;
  product_id: number;
  price_sold: number;
  units_sold: number;
  profit: number;
  sold_at: string;
}

/** KPI summary from GET /analytics/summary. */
export interface AnalyticsSummary {
  total_revenue: number;
  total_profit: number;
  total_units_sold: number;
  avg_margin_pct: number;
  products_at_risk: number;  // products with days_to_expiry < 7
  top_products: { product_id: number; total_profit: number }[];
}

/** One data point from GET /analytics/trends (daily aggregation). */
export interface TrendPoint {
  date: string;
  revenue: number;
  profit: number;
  units: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// API helper functions
// Each function wraps an Axios call and returns the typed response body.
// ─────────────────────────────────────────────────────────────────────────────

/** Fetch all products, optionally filtered by category / stock / expiry. */
export const getProducts = (params?: {
  category?: string;
  min_stock?: number;
  max_expiry?: number;
}) => api.get<Product[]>("/products/", { params }).then((r) => r.data);

/** Fetch a single product by product_id. */
export const getProduct = (id: number) =>
  api.get<Product>(`/products/${id}`).then((r) => r.data);

/** Fetch distinct category names for the filter dropdown. */
export const getCategories = () =>
  api.get<string[]>("/categories").then((r) => r.data);

/** Get the Thompson Sampling price recommendation for a product. */
export const getRecommendation = (id: number) =>
  api.get<PriceRecommendation>(`/pricing/recommend/${id}`).then((r) => r.data);

/** Simulate demand and profit at a specific price without updating the bandit. */
export const simulatePrice = (id: number, price: number) =>
  api
    .get<SimulationResult>(`/pricing/simulate/${id}`, { params: { price } })
    .then((r) => r.data);

/**
 * Record a sale and update the Thompson Sampling bandit.
 * Calling this closes the ML feedback loop:
 *   recommend → sell → update → better future recommendations
 */
export const updateSales = (payload: SalePayload) =>
  api.post<SaleResponse>("/update-sales", payload).then((r) => r.data);

/** Fetch aggregated KPI metrics for the Analytics page stat cards. */
export const getAnalyticsSummary = () =>
  api.get<AnalyticsSummary>("/analytics/summary").then((r) => r.data);

/** Fetch daily trend data (revenue, profit, units) for the area chart. */
export const getAnalyticsTrends = () =>
  api.get<TrendPoint[]>("/analytics/trends").then((r) => r.data);

export default api;
