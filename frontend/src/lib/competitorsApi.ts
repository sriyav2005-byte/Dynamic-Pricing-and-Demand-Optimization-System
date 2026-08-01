/**
 * lib/competitorsApi.ts — Standalone Competitor Search API Client
 * ================================================================
 * Completely independent from lib/api.ts and the existing competitor
 * endpoints that are tied to the synthetic product database.
 *
 * Use this file for all /competitors/* calls (the standalone module).
 * Do NOT use this for /competitor/* calls (those are the DB-tied ones).
 *
 * Future Integration
 * ------------------
 * When you're ready to match competitor results against your inventory:
 *   1. Pass a `product_id` param to `searchCompetitorPrices()`
 *   2. The backend will return a `competitiveness_score` vs. your price
 *   3. Feed `market_avg` from the response into the ML feature pipeline
 */

import axios from "axios";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const competitorsApi = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
});

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single platform's price result. */
export interface PlatformPriceResult {
  platform_key: string;
  platform: string;
  emoji: string;
  color: string;
  bg: string;
  price: number;
  mrp: number;
  discount_pct: number;
  availability: string;
  delivery_time: string;
  unit: string;
  url: string;
  is_cheapest: boolean;
  is_highest: boolean;
  is_live?: boolean;
  source?: string;
}

/** Full product search response from GET /competitors/search */
export interface ProductSearchResponse {
  query: string;
  product_name: string;
  brand: string;
  variant: string;
  category: string;
  mrp: number;
  market_avg: number;
  cheapest_platform: string;
  highest_platform: string;
  price_spread: number;
  discount_from_mrp: number;
  platforms: PlatformPriceResult[];
  searched_at: string;
  is_estimated: boolean;
  has_live?: boolean;
}

/** Platform metadata from GET /competitors/platforms */
export interface PlatformInfo {
  key: string;
  name: string;
  emoji: string;
  color: string;
  bg: string;
  delivery_time: string;
}

// ── API functions ─────────────────────────────────────────────────────────────

/**
 * Search estimated prices for a real product across all supported platforms.
 * @param query - Free-text product search, e.g. "Amul Taaza Milk 500ml"
 */
export const searchCompetitorPrices = (query: string): Promise<ProductSearchResponse> =>
  competitorsApi
    .get<ProductSearchResponse>("/competitors/search", { params: { query } })
    .then((r) => r.data);

/**
 * Get the list of all supported platforms with display metadata.
 * Use for populating filter dropdowns and platform legends.
 */
export const getPlatforms = (): Promise<PlatformInfo[]> =>
  competitorsApi
    .get<PlatformInfo[]>("/competitors/platforms")
    .then((r) => r.data);

// ── Autocomplete suggestions ──────────────────────────────────────────────────
// Curated list of popular Indian FMCG products for the search autocomplete.
// This runs client-side — no backend call needed.

export const POPULAR_SEARCHES = [
  "Amul Taaza Milk 1L",
  "Amul Butter 500g",
  "Tata Salt 1kg",
  "Aashirvaad Atta 5kg",
  "Fortune Sunflower Oil 1L",
  "Maggi Noodles 280g",
  "Coca Cola 1.25L",
  "Nescafe Classic 100g",
  "Tata Tea Gold 500g",
  "Parle-G Biscuits 250g",
  "Colgate Toothpaste 150g",
  "Surf Excel 1kg",
  "Dettol Soap 125g",
  "Lays Classic 50g",
  "Haldirams Bhujia 150g",
  "Amul Gold Milk 1L",
  "Dove Shampoo 340ml",
  "India Gate Basmati Rice 1kg",
  "Saffola Gold Oil 1L",
  "Good Day Biscuits 200g",
];

export const AUTOCOMPLETE_CATALOG = [
  // Dairy
  "Amul Taaza Milk 500ml", "Amul Taaza Milk 1L", "Amul Taaza Milk 1.5L",
  "Amul Full Cream Milk 1L", "Amul Butter 100g", "Amul Butter 200g", "Amul Butter 500g",
  "Amul Gold Milk 1L", "Amul Gold Milk 500ml", "Amul Cheese 200g", "Amul Dahi 400g",
  "Mother Dairy Milk 1L", "Mother Dairy Milk 500ml", "Paneer 200g", "Paneer 500g",
  // Staples
  "Tata Salt 1kg", "Tata Salt 2kg", "Aashirvaad Atta 1kg", "Aashirvaad Atta 5kg",
  "Fortune Chakki Atta 5kg", "India Gate Basmati Rice 1kg", "India Gate Basmati Rice 5kg",
  "Dawat Basmati Rice 1kg",
  // Oils
  "Fortune Sunflower Oil 1L", "Fortune Sunflower Oil 5L",
  "Saffola Gold Oil 1L", "Dhara Mustard Oil 1L",
  // Beverages
  "Coca Cola 750ml", "Coca Cola 1.25L", "Pepsi 750ml", "Pepsi 1.25L",
  "Tata Tea Gold 250g", "Tata Tea Gold 500g", "Red Label Tea 500g",
  "Nescafe Classic 100g", "Nescafe Classic 200g", "Bru Coffee 100g",
  // Snacks
  "Lays Classic 26g", "Lays Classic 50g", "Doritos Nacho Cheese 82.5g",
  "Haldirams Bhujia 150g", "Haldirams Bhujia 400g",
  "Parle-G Biscuits 250g", "Good Day Biscuits 200g", "Maggi Noodles 70g", "Maggi Noodles 280g",
  // Personal Care
  "Colgate Toothpaste 150g", "Colgate Toothpaste 200g",
  "Dove Shampoo 180ml", "Dove Shampoo 340ml", "Dettol Soap 125g",
  "Pantene Shampoo 340ml",
  // Household
  "Surf Excel 1kg", "Surf Excel 3kg", "Ariel Powder 1kg", "Colin Glass Cleaner 500ml",
];
