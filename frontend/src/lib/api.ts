/**
 * lib/api.ts — typed client for the PriceIQ Go API (backend-go).
 *
 * Every request carries the session's bearer token (Supabase Auth access
 * token, or the local development token). Store-scoped endpoints take the
 * current store id explicitly. The browser never talks to the Python AI
 * service — the Go API authorizes and proxies every AI call.
 */

import axios, { AxiosError } from "axios";

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1";

let tokenProvider: () => Promise<string | null> = async () => null;
let unauthorizedHandler: () => void = () => {};

export function configureApi(opts: { getToken: () => Promise<string | null>; onUnauthorized: () => void }) {
  tokenProvider = opts.getToken;
  unauthorizedHandler = opts.onUnauthorized;
}

const http = axios.create({ baseURL: API_URL, timeout: 180_000 });

http.interceptors.request.use(async (cfg) => {
  const token = await tokenProvider();
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

http.interceptors.response.use(
  (r) => r,
  (err: AxiosError) => {
    if (err.response?.status === 401 && !String(err.config?.url).includes("/auth/")) unauthorizedHandler();
    return Promise.reject(err);
  },
);

/** Human-readable message from an API error (with field details when present). */
export function errorMessage(err: unknown): string {
  const e = err as AxiosError<{ error?: { message?: string; details?: unknown } }>;
  const body = e?.response?.data?.error;
  if (body?.message) {
    const d = body.details;
    if (d && typeof d === "object" && !Array.isArray(d)) {
      const parts = Object.entries(d as Record<string, unknown>).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`);
      if (parts.length) return `${body.message}: ${parts.join("; ")}`;
    }
    if (typeof d === "string") return `${body.message}: ${d}`;
    if (Array.isArray(d)) return `${body.message}: ${d.join("; ")}`;
    return body.message;
  }
  if (e?.code === "ERR_NETWORK") return "Cannot reach the PriceIQ API. Is backend-go running on port 8080?";
  return e?.message || "Something went wrong";
}

const get = <T,>(url: string, params?: object) => http.get<T>(url, { params }).then((r) => r.data);
const post = <T,>(url: string, body?: unknown) => http.post<T>(url, body).then((r) => r.data);
const patch = <T,>(url: string, body?: unknown) => http.patch<T>(url, body).then((r) => r.data);
const put = <T,>(url: string, body?: unknown) => http.put<T>(url, body).then((r) => r.data);
const del = (url: string, params?: object) => http.delete(url, { params }).then(() => undefined);

// ── Types ─────────────────────────────────────────────────────────────────────

export type Role = "VIEWER" | "ANALYST" | "STORE_MANAGER" | "ADMIN" | "SUPER_ADMIN";
export const ROLE_RANK: Record<Role, number> = { VIEWER: 1, ANALYST: 2, STORE_MANAGER: 3, ADMIN: 4, SUPER_ADMIN: 5 };
/** Provenance label of an external observation — see PROJECT_CONTEXT.md "Data honesty rules". */
export type DataStatus = "LIVE" | "MANUAL_VERIFIED" | "CACHED" | "ESTIMATED" | "UNAVAILABLE";
export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface Page<T> { data: T[]; page: number; page_size: number; total: number }

export interface StoreAccess {
  store_id: string; store_name: string; store_code: string; city: string | null; data_mode: "LIVE" | "SYNTHETIC";
  organization_id: string; organization_name: string; role: Role;
}
export interface Profile { id: string; email: string | null; full_name: string | null; phone: string | null; is_super_admin: boolean }
export interface Me { profile: Profile; stores: StoreAccess[] }
export interface Session { access_token: string; expires_at: string; user: Me }

export interface Product {
  id: string; store_id: string; legacy_product_id: number | null; sku: string; barcode: string | null; name: string;
  brand: string | null; category_id: string | null; category: string | null; subcategory: string | null;
  supplier_id: string | null; supplier: string | null; image_url: string | null;
  cost_price: number; selling_price: number; mrp: number; stock: number; reorder_level: number; safety_stock: number;
  expiry_date: string | null; days_to_expiry: number | null; batch_number: string | null; season_factor: number;
  is_perishable: boolean; is_active: boolean; is_synthetic: boolean; margin_pct: number; created_at: string; updated_at: string;
  /** Perishable / sensitivity attributes; null = not assessed. Sensitivities are 0–1. */
  pack_size: string | null; shelf_life_days: number | null; seasonal_sensitivity: number | null;
  festival_sensitivity: number | null; weather_sensitivity: number | null;
}
export type ProductInput = Partial<Omit<Product, "id" | "store_id" | "created_at" | "updated_at" | "margin_pct" | "days_to_expiry" | "is_synthetic" | "legacy_product_id">> & { reason?: string };
export interface Category { id: string; name: string; products: number }
export interface Supplier { id: string; name: string; contact_email: string | null; phone: string | null; lead_time_days: number }

export interface StoreSettings {
  store_id: string; pricing_mode: "MANUAL" | "SEMI_AUTOMATIC" | "AUTOMATIC"; min_margin_pct: number; max_price_change_pct: number;
  approval_threshold_pct: number; expiry_markdown_days: number; max_expiry_markdown_pct: number; allow_below_cost_clearance: boolean;
  low_stock_cover_days: number; overstock_cover_days: number; dead_stock_days: number; competitor_undercut_pct: number;
  rules: Record<string, unknown>; updated_at: string;
}

export interface ProductInventory {
  product_id: string; name: string; sku: string; category: string | null; stock: number; cost_price: number; selling_price: number;
  avg_daily_units: number; std_daily_units: number; days_with_sales_28d: number; data_sufficiency: "OK" | "LIMITED" | "NONE";
  last_sold_at: string | null; lead_time_days: number; days_of_cover: number | null; predicted_stockout_date: string | null;
  recommended_safety_stock: number | null; reorder_point: number | null; recommended_reorder_qty: number;
  configured_reorder_level: number; configured_safety_stock: number; expiry_date: string | null; days_to_expiry: number | null;
  expected_sales_before_expiry: number | null; units_at_expiry_risk: number | null;
  expiry_risk: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "EXPIRED"; value_at_cost: number; value_at_retail: number; statuses: string[];
  /** Share of the stock on hand (0–100) not expected to sell before expiry. */
  wastage_risk_pct: number | null; is_perishable: boolean; shelf_life_days: number | null;
}
export interface InventoryOverview {
  reference_time: string; data_mode: string; total_products: number; total_units: number; value_at_cost: number; value_at_retail: number;
  expiry_risk_value_at_cost: number; status_counts: Record<string, number>; expiry_risk_counts: Record<string, number>;
  categories: { category: string; products: number; units: number; value_at_cost: number; at_risk: number; health_pct: number }[];
  products: ProductInventory[];
}
export interface Movement { id: string; product_id: string; product_name: string; change: number; reason: string; stock_after: number; note: string | null; created_by: string | null; created_at: string }

export interface Sale { id: string; product_id: string; product_name: string; quantity: number; unit_price: number; unit_cost: number; revenue: number; profit: number; source: string; sold_at: string }
export interface Range { from: string; to: string }
export interface Totals { revenue: number; profit: number; units: number; orders: number; products_sold: number }
export interface Summary {
  range: Range; data_mode: string; data_from: string | null; data_to: string | null; current: Totals; previous: Totals;
  avg_margin_pct: number; revenue_change_pct: number | null; profit_change_pct: number | null; units_change_pct: number | null;
  inventory: { at_cost: number; at_retail: number; units: number }; at_risk_products: number;
  competitor_gap: { products_compared: number; avg_gap_pct: number | null; products_above_market: number; note: string };
  pending_recommendations: number; open_alerts: Record<string, number>;
}
export interface TrendPoint { date: string; revenue: number; profit: number; units: number }
export interface GroupPerf { key: string; name: string; revenue: number; profit: number; units: number; margin_pct: number }

export interface ConstraintApplied { rule: string; before: number; after: number; message: string }
export interface Factor { factor: string; label: string; detail: string; signal: "up" | "down" | "neutral"; [k: string]: unknown }
export interface ShapRow { feature: string; label: string; value: number | null; contribution: number; effect_pct: number | null; direction: string }
export interface Impact {
  horizon_days: number; demand_change_pct: number | null; revenue_change_pct: number | null; profit_change_pct: number | null;
  margin_change_pts: number; note?: string; current?: SimResult; recommended?: SimResult;
}
export interface Explanation {
  summary?: string; action?: string; factors?: Factor[]; impact?: Impact;
  shap?: { model_version: string; method: string; scale: string; baseline: number; top: ShapRow[] };
  elasticity?: Elasticity; bounds?: { lo: number; hi: number; expiry_window: boolean; conflict?: string; rules: { rule: string; kind: string; value: number; message: string }[] };
  policy?: { name: string; explored: boolean; greedy_price: number; shadow?: { policy: string; price: number; note?: string }; updates_from_feedback?: number; note?: string };
  model_optimum?: { price: number; profit_per_day: number }; data_provenance?: Record<string, string>; pricing_mode?: string;
}
export interface Recommendation {
  id: string; store_id: string; product_id: string; product_name: string; sku: string; current_price: number; recommended_price: number;
  model_price: number | null; change_pct: number; expected_demand: number | null; expected_revenue: number | null; expected_profit: number | null;
  expected_margin_pct: number | null; confidence: number | null; policy: string; model_version: string | null;
  constraints_applied: ConstraintApplied[]; explanation: Explanation; context: Record<string, unknown>;
  status: "PENDING" | "APPROVED" | "REJECTED" | "APPLIED" | "EXPIRED" | "SUPERSEDED"; requires_approval: boolean;
  created_by: string | null; reviewed_by: string | null; reviewed_at: string | null; review_note: string | null;
  applied_by: string | null; applied_at: string | null; created_at: string;
}
export interface SimResult {
  price: number; demand: number; units_over_horizon: number; revenue: number; profit: number; revenue_horizon: number;
  profit_horizon: number; waste_units: number; margin_pct: number; days_to_sell_out: number | null;
  risk?: { level: "LOW" | "MEDIUM" | "HIGH"; reason: string };
  competitor_position?: { vs_market_avg_pct: number; cheapest: boolean; market_avg: number } | null;
  vs_current?: { demand_pct: number | null; revenue_pct: number | null; profit_pct: number | null }; in_band?: boolean;
}
export interface Simulation {
  product_id: string; product_name: string; current_price: number; horizon_days: number; model_version: string;
  results: SimResult[]; current: SimResult;
  scenarios: { label?: string; scenario: { type: string; pct: number }; result?: SimResult; estimable?: boolean; note?: string; risk?: SimResult["risk"]; vs_current_profit_pct?: number | null; position_now?: unknown; position_after?: unknown }[];
  cross_effects: { affected_product: string; relationship: string; price: number; demand_change_pct: number; cross_elasticity: number }[];
  constraint_violations: Record<string, string[] | null>; bounds: { lo: number; hi: number }; notes: string[];
}
export interface PricePoint { old_price: number | null; new_price: number; source: string; recommendation_id: string | null; changed_by: string | null; reason: string | null; created_at: string }

export interface Elasticity {
  status: "ESTIMATED" | "NOT_SIGNIFICANT" | "INSUFFICIENT_DATA"; elasticity: number | null; std_error?: number; p_value?: number;
  ci_low?: number; ci_high?: number; pseudo_r2?: number; n_obs: number; distinct_prices?: number; price_cv?: number;
  method: string; reason?: string; interpretation?: string; elastic?: boolean; price_range?: [number, number];
}

export interface AppliedConsideration { id: string; name: string; kind: string; scope: string; start_date: string; end_date: string; stated_change_pct: number; weight: number; applied_change_pct: number; days_in_horizon: number; supply_condition: string; source: "MANUAL" }
export interface ForecastPoint { date: string; day_label: string; is_weekend: boolean; event: boolean; predicted_demand: number; model_demand?: number; lower_bound: number; upper_bound: number; expected_sales: number; days_to_expiry: number | null }
export interface Accuracy { n: number; mae: number | null; rmse: number | null; mape_pct: number | null; wape_pct: number | null; r2: number | null; bias?: number; protocol?: string }
export interface Forecast {
  product_id: string; product_name: string; horizon: number; price: number; model_version: string; training_data: string;
  points: ForecastPoint[]; total_predicted_demand: number; total_expected_sales: number; avg_daily_demand: number;
  recent_avg_daily_units: number | null; trend: string; trend_slope_per_day: number; peak: { date: string; demand: number } | null;
  stockout_date: string | null; interval: { level: number; method: string }; accuracy: Accuracy | null;
  confidence: "LOW" | "MEDIUM" | "HIGH"; history_days: number; warnings: string[]; cached?: boolean;
  considerations?: AppliedConsideration[];
}
export interface ForecastOverview {
  horizon: number; protocol: string; store_accuracy: Accuracy | null;
  items: { product_id: string; product_name: string; category: string; price: number; stock: number; total_predicted_demand: number; avg_daily_demand: number; recent_avg_daily_units: number | null; trend: string; peak: { date: string; demand: number } | null; stockout_date: string | null; confidence: string; mape_pct: number | null; error?: string }[];
}

export interface Platform { id: string; key: string; name: string; website: string | null; color: string | null }
export interface CompetitorObservation {
  competitor_key: string; competitor_name: string; color: string | null; linked: boolean; external_name: string | null; url: string | null;
  pack_size: string | null; price: number | null; mrp: number | null; discount_pct: number | null; in_stock: boolean | null; status: DataStatus;
  source: string | null; observed_at: string | null; age_minutes: number | null; diff_pct: number | null; error: string | null;
}
export interface MarketStats {
  our_price: number; observed_count: number; lowest: number | null; highest: number | null; average: number | null; lowest_platform: string | null;
  diff_vs_avg: number | null; diff_vs_avg_pct: number | null; position: string; note: string;
}
export interface ProductCompetitors { product_id: string; product_name: string; category: string | null; observations: CompetitorObservation[]; market: MarketStats }
export interface CompetitorOverview { products: ProductCompetitors[]; status_counts: Record<string, number>; products_with_market_data: number; products_above_market: number; avg_gap_pct: number | null }
export interface CompetitorHistory { range: string; sufficient_data: boolean; message?: string; observations: number; points: { time: string; ours: number | null; prices: Record<string, number>; market_avg: number | null; market_low: number | null }[]; volatility_pct: Record<string, number>; competitors: string[] }
export interface SearchListing { external_id: string | null; name: string; pack_size: string | null; price: number; mrp: number | null; discount_pct: number | null; in_stock: boolean | null; url: string | null; image_url: string | null }
export interface SearchPlatformResult { key: string; name: string; status: DataStatus; search_url: string; listings: SearchListing[]; reason: string | null; blocked_by?: string | null; fetched_at: string; method: string; attempts?: number; duration_ms?: number | null }
export interface SearchResponse {
  query: string; fetched_at: string; platforms: SearchPlatformResult[]; cache: { hit: boolean; cached_at?: string };
  location?: { lat: number; lon: number; source: "store" | "default" };
  summary: { live_platforms: string[]; unavailable_platforms: { name: string; reason: string }[]; listings: number; lowest: number | null; highest: number | null; average: number | null };
}

export interface Alert { id: string; store_id: string; product_id: string | null; product_name: string | null; alert_type: string; severity: Severity; title: string; message: string; metadata: Record<string, unknown>; status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED"; created_at: string; updated_at: string }
export interface Notification { id: string; store_id: string | null; alert_id: string | null; title: string; body: string; link: string | null; read_at: string | null; created_at: string }
export interface AuditEntry { id: number; user_email: string | null; action: string; entity_type: string; entity_id: string | null; old_value: Record<string, unknown> | null; new_value: Record<string, unknown> | null; reason: string | null; created_at: string }
export interface Member { membership_id: string; user_id: string; email: string | null; full_name: string | null; store_id: string | null; store_name: string | null; role: Role }
export type ConsiderationKind = "SEASON" | "FESTIVAL" | "EVENT" | "WEATHER";
export type SupplyCondition = "NORMAL" | "SURPLUS" | "LIMITED" | "SHORTAGE";
export type SensitivityLevel = "LOW" | "MEDIUM" | "HIGH";
/** A staff-entered planning assumption that the AI service applies (labelled MANUAL) when it evaluates prices. */
export interface Consideration {
  id: string; store_id: string; name: string; kind: ConsiderationKind; product_id: string | null; product_name: string | null;
  category_id: string | null; category_name: string | null; scope: "PRODUCT" | "CATEGORY" | "STORE"; start_date: string; end_date: string;
  expected_demand_change_pct: number; supply_condition: SupplyCondition; weather_sensitivity: SensitivityLevel | null;
  festival_sensitivity: SensitivityLevel | null; notes: string | null; is_active: boolean; phase: "UPCOMING" | "ACTIVE" | "ENDED";
  days_until: number; created_by_email: string | null; created_at: string; updated_at: string;
}
export interface ConsiderationInput {
  name: string; kind: ConsiderationKind; product_id?: string | null; category_id?: string | null; start_date: string; end_date: string;
  expected_demand_change_pct: number; supply_condition: SupplyCondition; weather_sensitivity?: SensitivityLevel | null;
  festival_sensitivity?: SensitivityLevel | null; notes?: string; is_active?: boolean;
}
export interface SeasonalEvent { id: string; name: string; event_type: string; start_date: string; end_date: string; is_date_approximate: boolean; notes: string | null; custom: boolean; days_until: number }

export interface ChatMessage { id: string; role: "user" | "assistant"; content: string; tool_calls: { tool: string; input: unknown; ok: boolean; error?: string }[]; sources: { title: string; source: string }[]; created_at: string }
export interface ChatReply { conversation_id: string; message: ChatMessage; mode: "llm" | "rule_based" | "error"; provider: string | null; model: string | null; warnings: string[] | null; reasoning_factors: string[] | null; data_sources: string[] | null }

// ── Auth & account ───────────────────────────────────────────────────────────

export const authConfig = () => get<{ provider: "local" | "supabase"; supabase_url: string }>("/auth/config");
export const localLogin = (email: string, password: string) => post<Session>("/auth/local/login", { email, password });
export const localRegister = (body: { email: string; password: string; full_name: string; phone?: string; store_name?: string; city?: string; state?: string; pincode?: string }) =>
  post<Session>("/auth/local/register", body);
export const getMe = () => get<Me>("/me");
export const updateMe = (body: { full_name?: string; phone?: string }) => patch<Me>("/me", body);
export const getNotifications = (unread = false) => get<{ unread: number; items: Notification[] }>("/notifications", { unread, limit: 30 });
export const readNotification = (id: string | "all") => post(`/notifications/${id}/read`);
export const getPlatforms = () => get<Platform[]>("/competitors/platforms");
export const getModels = () => get<Record<string, unknown>>("/models");

// ── Organization ─────────────────────────────────────────────────────────────

export const getMembers = (org: string) => get<Member[]>(`/organizations/${org}/members`);
export const addMember = (org: string, body: { email: string; role: Role; store_id?: string | null; reason?: string }) => post<Member>(`/organizations/${org}/members`, body);
export const changeMemberRole = (org: string, id: string, role: Role, reason?: string) => patch(`/organizations/${org}/members/${id}`, { role, reason });
export const removeMember = (org: string, id: string) => del(`/organizations/${org}/members/${id}`);
export const createStore = (org: string, body: { name: string; code?: string; city?: string; state?: string; pincode?: string }) => post(`/organizations/${org}/stores`, body);
export const orgAnalytics = (org: string, days = 30) =>
  get<{ store_id: string; store_name: string; data_mode: string; totals: Totals; margin_pct: number; inventory: { at_cost: number } }[]>(`/organizations/${org}/analytics`, { days });

// ── Store-scoped ─────────────────────────────────────────────────────────────

const S = (sid: string) => `/stores/${sid}`;

export const getSettings = (sid: string) => get<StoreSettings>(`${S(sid)}/settings`);
export const saveSettings = (sid: string, body: StoreSettings & { reason?: string }) => put<StoreSettings>(`${S(sid)}/settings`, body);

export interface ProductQuery { q?: string; category?: string; category_id?: string; stock_status?: string; expiring_within?: number; expired?: boolean; sort?: string; order?: "asc" | "desc"; page?: number; page_size?: number }
export const getProducts = (sid: string, q: ProductQuery = {}) => get<Page<Product>>(`${S(sid)}/products`, q);
export const getProduct = (sid: string, id: string) => get<Product>(`${S(sid)}/products/${id}`);
export const createProduct = (sid: string, body: ProductInput) => post<Product>(`${S(sid)}/products`, body);
export const updateProduct = (sid: string, id: string, body: ProductInput) => patch<Product>(`${S(sid)}/products/${id}`, body);
export const deleteProduct = (sid: string, id: string, reason?: string) => del(`${S(sid)}/products/${id}`, { reason });
export const getCategories = (sid: string) => get<Category[]>(`${S(sid)}/categories`);
export const getSuppliers = (sid: string) => get<Supplier[]>(`${S(sid)}/suppliers`);
export const importTemplateUrl = (sid: string) => `${API_URL}${S(sid)}/products/import/template`;
export async function importProducts(sid: string, file: File, opts: { dry_run?: boolean; update_existing?: boolean; skip_invalid?: boolean }) {
  const fd = new FormData();
  fd.append("file", file);
  Object.entries(opts).forEach(([k, v]) => v && fd.append(k, "true"));
  return http.post<{ dry_run: boolean; total_rows: number; created: number; updated: number; skipped: number; committed: boolean; errors: { row: number; sku: string; errors: Record<string, string> }[] }>(
    `${S(sid)}/products/import`, fd).then((r) => r.data);
}

export const getInventory = (sid: string) => get<InventoryOverview>(`${S(sid)}/inventory`);
export const getProductInventory = (sid: string, id: string) => get<ProductInventory>(`${S(sid)}/products/${id}/inventory`);
export const adjustStock = (sid: string, id: string, body: { change: number; reason: string; note?: string }) => post<{ stock: number }>(`${S(sid)}/products/${id}/stock-adjustments`, body);
export const getMovements = (sid: string, productId?: string) => get<Page<Movement>>(`${S(sid)}/inventory/movements`, { product_id: productId, page_size: 50 });
export const getExpiryOptimization = (sid: string) => get<{
  items: { product_id: string; product_name: string; category: string; stock: number; days_to_expiry: number; current_price: number; cost_price: number; expiry_risk: string;
    at_current_price: { price: number; expected_units_sold: number; liquidation_pct: number; waste_units: number; profit_net_of_waste: number };
    recommended: { markdown_pct: number; price: number; expected_units_sold: number; liquidation_pct: number; waste_units: number; profit_net_of_waste: number };
    waste_reduction_units: number; profit_gain: number; wastage_risk_pct?: number | null; is_perishable?: boolean; shelf_life_days?: number | null;
    considerations?: AppliedConsideration[] }[];
  window_days: number; max_markdown_pct: number; floor: string; method: string }>(`${S(sid)}/inventory/expiry-optimization`);

export interface RangeQuery { days?: number; from?: string; to?: string }
export const getSales = (sid: string, q: RangeQuery & { product_id?: string; page?: number; page_size?: number } = {}) => get<Page<Sale>>(`${S(sid)}/sales`, q);
export const recordSale = (sid: string, body: { product_id: string; quantity: number; unit_price?: number; recommendation_id?: string }) => post<Sale>(`${S(sid)}/sales`, body);
export const getSummary = (sid: string, q: RangeQuery = {}) => get<Summary>(`${S(sid)}/analytics/summary`, q);
export const getTrends = (sid: string, q: RangeQuery & { product_id?: string } = {}) => get<{ range: Range; points: TrendPoint[] }>(`${S(sid)}/analytics/trends`, q);
export const getCategoryPerformance = (sid: string, q: RangeQuery = {}) => get<{ range: Range; categories: GroupPerf[] }>(`${S(sid)}/analytics/categories`, q);
export const getProductPerformance = (sid: string, q: RangeQuery & { sort?: string; order?: string; limit?: number } = {}) =>
  get<{ range: Range; products: GroupPerf[] }>(`${S(sid)}/analytics/products`, q);
export const reportUrl = (sid: string, kind: string, q: RangeQuery) =>
  `${S(sid)}/reports/${kind}?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]))}`;
export async function downloadReport(sid: string, kind: string, q: RangeQuery) {
  const r = await http.get(reportUrl(sid, kind, q), { responseType: "blob" });
  const name = /filename="([^"]+)"/.exec(r.headers["content-disposition"] || "")?.[1] || `${kind}.csv`;
  const url = URL.createObjectURL(r.data);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

export const generateRecommendation = (sid: string, product_id: string) => post<Recommendation>(`${S(sid)}/pricing/recommendations`, { product_id });
export const batchRecommend = (sid: string, scope: "all" | "at_risk") =>
  post<{ requested: number; generated: number; failed: { product_id: string; error: string }[]; items: Recommendation[] }>(`${S(sid)}/pricing/recommendations/batch`, { scope });
export const getRecommendations = (sid: string, q: { status?: string; product_id?: string; page?: number; page_size?: number } = {}) =>
  get<Page<Recommendation>>(`${S(sid)}/pricing/recommendations`, q);
export const getRecommendation = (sid: string, id: string) => get<Recommendation>(`${S(sid)}/pricing/recommendations/${id}`);
export const approveRecommendation = (sid: string, id: string, note?: string, apply_now = false) => post<Recommendation>(`${S(sid)}/pricing/recommendations/${id}/approve`, { note, apply_now });
export const rejectRecommendation = (sid: string, id: string, note?: string) => post<Recommendation>(`${S(sid)}/pricing/recommendations/${id}/reject`, { note });
export const applyRecommendation = (sid: string, id: string, note?: string) => post<Recommendation>(`${S(sid)}/pricing/recommendations/${id}/apply`, { note });
export const simulate = (sid: string, body: { product_id: string; prices?: number[]; scenarios?: { type: string; pct: number }[]; horizon_days?: number }) =>
  post<Simulation>(`${S(sid)}/pricing/simulate`, body);
export const getPriceHistory = (sid: string, id: string, days = 90) => get<PricePoint[]>(`${S(sid)}/products/${id}/price-history`, { days });
export const getElasticity = (sid: string, id: string) => get<Elasticity & { cached?: boolean }>(`${S(sid)}/products/${id}/elasticity`);
export const getCrossEffects = (sid: string, id: string) =>
  get<{ relationships: { related_product: string; relationship: string; cross_elasticity: number; p_value: number; direction: string }[]; note: string; method: string }>(`${S(sid)}/products/${id}/cross-effects`);

export const getForecast = (sid: string, id: string, horizon: 7 | 14 | 30) => get<Forecast>(`${S(sid)}/products/${id}/forecast`, { horizon });
export const getForecastOverview = (sid: string, horizon: 7 | 14 | 30 = 7) => get<ForecastOverview>(`${S(sid)}/forecast`, { horizon });

export const getCompetitorOverview = (sid: string) => get<CompetitorOverview>(`${S(sid)}/competitors`);
export const getProductCompetitors = (sid: string, id: string) => get<ProductCompetitors>(`${S(sid)}/products/${id}/competitors`);
export const getCompetitorHistory = (sid: string, id: string, range: "24h" | "7d" | "30d" | "90d") => get<CompetitorHistory>(`${S(sid)}/products/${id}/competitors/history`, { range });
export const refreshCompetitors = (sid: string, id: string) => post<ProductCompetitors>(`${S(sid)}/products/${id}/competitors/refresh`);
export const recordCompetitorPrice = (sid: string, id: string, body: { competitor_key: string; price: number; mrp?: number; in_stock?: boolean; external_name?: string; url?: string; pack_size?: string }) =>
  post<ProductCompetitors>(`${S(sid)}/products/${id}/competitors/observations`, body);
export const linkCompetitor = (sid: string, id: string, body: { competitor_key: string; url: string; external_name?: string; external_id?: string | null; pack_size?: string | null }) =>
  post<ProductCompetitors>(`${S(sid)}/products/${id}/competitors/link`, body);
export const unlinkCompetitor = (sid: string, id: string, key: string) => del(`${S(sid)}/products/${id}/competitors/${key}`);
export const searchCompetitors = (sid: string, q: string) => get<SearchResponse>(`${S(sid)}/competitors/search`, { q });

export const getAlerts = (sid: string, q: { status?: string; severity?: string; type?: string; page?: number; page_size?: number } = {}) => get<Page<Alert>>(`${S(sid)}/alerts`, q);
export const updateAlert = (sid: string, id: string, status: string) => patch(`${S(sid)}/alerts/${id}`, { status });
export const scanAlerts = (sid: string) => post<{ detected: number; created: number; updated: number; resolved: number; by_type: Record<string, number>; warnings: string[] }>(`${S(sid)}/alerts/scan`);
export const getAuditLog = (sid: string, q: { entity_type?: string; entity_id?: string; page?: number; page_size?: number } = {}) => get<Page<AuditEntry>>(`${S(sid)}/audit-logs`, q);

export const getSeasonalEvents = (sid: string) => get<SeasonalEvent[]>(`${S(sid)}/seasonal/events`);
export const createSeasonalEvent = (sid: string, body: { name: string; start_date: string; end_date: string; notes?: string }) => post(`${S(sid)}/seasonal/events`, body);
export const getConsiderations = (sid: string, includeEnded = false) => get<Consideration[]>(`${S(sid)}/seasonal/considerations`, includeEnded ? { include_ended: true } : undefined);
export const createConsideration = (sid: string, body: ConsiderationInput) => post<Consideration>(`${S(sid)}/seasonal/considerations`, body);
export const updateConsideration = (sid: string, id: string, body: ConsiderationInput) => put<Consideration>(`${S(sid)}/seasonal/considerations/${id}`, body);
export const deleteConsideration = (sid: string, id: string) => del(`${S(sid)}/seasonal/considerations/${id}`);
export const getSeasonalInsights = (sid: string) => get<Record<string, any>>(`${S(sid)}/seasonal/insights`); // eslint-disable-line @typescript-eslint/no-explicit-any
export const getWeather = (sid: string) => get<{ status: DataStatus; source?: string; location?: { city: string | null; store_located: boolean }; days: { date: string; t_max: number; t_min: number; precipitation_mm: number; precipitation_probability: number | null; summary: string }[]; note: string; error?: string }>(`${S(sid)}/weather`);
export const getAnomalies = (sid: string) => get<{ anomalies: { product_id: string | null; kind: string; title: string; message: string; severity: Severity }[]; detectors: Record<string, string> }>(`${S(sid)}/anomalies`);

export const chat = (sid: string, message: string, conversation_id?: string) => post<ChatReply>(`${S(sid)}/copilot/chat`, { message, conversation_id });
export const getConversations = (sid: string) => get<{ id: string; title: string; updated_at: string }[]>(`${S(sid)}/copilot/conversations`);
export const getConversation = (sid: string, id: string) => get<ChatMessage[]>(`${S(sid)}/copilot/conversations/${id}`);

// ── Formatting helpers ───────────────────────────────────────────────────────

export const inr = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : `₹${n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
export const compactInr = (n: number | null | undefined) => {
  if (n === null || n === undefined) return "—";
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  if (a >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
};
export const pct = (n: number | null | undefined, digits = 1, signed = false) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : `${signed && n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
export const num = (n: number | null | undefined, digits = 0) => (n === null || n === undefined ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: digits }));
export const dateFmt = (s: string | null | undefined, withTime = false) =>
  !s ? "—" : new Date(s).toLocaleString("en-IN", withTime ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "short", year: "numeric" });
