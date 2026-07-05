/**
 * app/dashboard/page.tsx — Main Pricing Dashboard
 * =================================================
 * The primary view of the application.  Displays all products in a table
 * alongside their current price, ML-recommended price, expected profit,
 * and expiry status.  Managers can apply a recommendation with one click.
 *
 * Data flow
 * ---------
 * 1. On mount, `loadData()` fetches products + categories in parallel.
 * 2. After the product list arrives, all recommendations are fetched in
 *    parallel (one GET /pricing/recommend/{id} per product).
 * 3. When a manager clicks "Apply", updateSales() is called which:
 *      a. Records the sale in the DB
 *      b. Updates product.current_price
 *      c. Feeds the bandit reward → the model learns
 *    Then loadData() re-runs so the table refreshes with the new state.
 *
 * Filters (applied client-side for search, server-side for category/expiry)
 * --------------------------------------------------------------------------
 * - Text search  : Filters displayed rows by product_id or category.
 * - Category     : Passed to GET /products/?category=X  (server-side).
 * - Max expiry   : Passed to GET /products/?max_expiry=N (server-side).
 *
 * PriceDelta helper component
 * ----------------------------
 * A tiny inline component that renders the % difference between current
 * and recommended price with green/red colouring and a trend arrow icon.
 */

"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  getProducts,
  getCategories,
  getRecommendation,
  updateSales,
  Product,
  PriceRecommendation,
} from "@/lib/api";
import {
  Search,
  RefreshCw,
  ChevronRight,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Package,
  Zap,
} from "lucide-react";

/**
 * Extends Product with an optional recommendation from the bandit.
 * `recLoading` is used to show a spinner in the Apply button while
 * a recommendation is being fetched for that specific product.
 */
interface ProductWithRec extends Product {
  recommendation?: PriceRecommendation;
  recLoading?:     boolean;
}

/** Format a number as an Indian Rupee price string. */
const fmt = (n: number) => `₹${n.toFixed(2)}`;

/**
 * Inline component: renders the % price change between current and recommended.
 * Green + TrendingUp  →  recommendation is higher (price increase)
 * Red + TrendingDown  →  recommendation is lower  (price decrease / discount)
 * Grey dash           →  negligible change (within ±0.1%)
 */
function PriceDelta({ current, recommended }: { current: number; recommended: number }) {
  const diff = ((recommended - current) / current) * 100;
  const up   = diff >  0.1;
  const down = diff < -0.1;
  const color = up ? "#10b981" : down ? "#ef4444" : "#94a3b8";
  const Icon  = up ? TrendingUp : down ? TrendingDown : null;

  return (
    <div className="flex items-center gap-1" style={{ color }}>
      {Icon && <Icon size={13} />}
      <span className="text-sm font-semibold">
        {diff >= 0 ? "+" : ""}{diff.toFixed(1)}%
      </span>
    </div>
  );
}

export default function DashboardPage() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [products,   setProducts]   = useState<ProductWithRec[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState("");       // client-side text filter
  const [category,   setCategory]   = useState("");       // server-side filter
  const [maxExpiry,  setMaxExpiry]  = useState<number | "">("");  // server-side filter
  const [applyingId, setApplyingId] = useState<number | null>(null); // tracks loading per row

  /**
   * Fetch products + recommendations.
   * Wrapped in useCallback so it doesn't change identity on every render,
   * preventing infinite loops in the useEffect dependency array.
   */
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch products (filtered) and categories in parallel for speed
      const [prods, cats] = await Promise.all([
        getProducts({
          category:   category   || undefined,
          max_expiry: maxExpiry !== "" ? maxExpiry : undefined,
        }),
        getCategories(),
      ]);

      setCategories(cats);
      // Show products immediately (without recommendations) to avoid blank screen
      setProducts(prods.map((p) => ({ ...p, recLoading: false })));

      // Then fetch all recommendations in parallel (one API call per product)
      // Individual failures are caught so one bad product doesn't block the rest
      const recs = await Promise.all(
        prods.map((p) => getRecommendation(p.product_id).catch(() => null))
      );
      setProducts(prods.map((p, i) => ({ ...p, recommendation: recs[i] ?? undefined })));

    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [category, maxExpiry]); // re-fetches when server-side filters change

  // Initial data load + re-load when filters change
  useEffect(() => { loadData(); }, [loadData]);

  /**
   * Apply the recommended price by recording a sale at that price.
   * This closes the ML feedback loop: the bandit updates its Beta distribution
   * for the chosen arm based on the resulting profit reward.
   */
  const handleApply = async (p: ProductWithRec) => {
    if (!p.recommendation) return;
    setApplyingId(p.product_id);   // show "..." in this row's button
    try {
      await updateSales({
        product_id: p.product_id,
        price:      p.recommendation.recommended_price,
        units_sold: Math.round(p.recommendation.expected_demand),
      });
      await loadData(); // refresh table so new current_price is shown
    } finally {
      setApplyingId(null);
    }
  };

  /**
   * Client-side text search — applied on top of server-side filters.
   * Matches against product_id string or category name.
   */
  const filtered = products.filter((p) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      String(p.product_id).includes(s) ||
      p.category.toLowerCase().includes(s)
    );
  });

  return (
    <div className="p-8">
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-slate-900 mb-2">
          <span className="gradient-text">Pricing Dashboard</span>
        </h1>
        <p className="text-sm text-slate-500 font-medium">
          ML-recommended prices with Thompson Sampling bandit
        </p>
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200/60 rounded-2xl p-4 mb-6 flex flex-wrap gap-3 items-center shadow-sm">

        {/* Text search (client-side) */}
        <div className="relative flex-1 min-w-48">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 bg-white outline-none focus:border-violet-500 transition-colors"
          />
        </div>

        {/* Category filter — triggers a new API call via loadData() */}
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-700 bg-white outline-none cursor-pointer focus:border-violet-500 transition-colors"
        >
          <option value="" className="bg-white text-slate-800">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c} className="bg-white text-slate-800 capitalize">{c}</option>
          ))}
        </select>

        {/* Expiry filter — highlights at-risk products */}
        <select
          value={maxExpiry}
          onChange={(e) => setMaxExpiry(e.target.value === "" ? "" : parseInt(e.target.value))}
          className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-700 bg-white outline-none cursor-pointer focus:border-violet-500 transition-colors"
        >
          <option value="" className="bg-white text-slate-800">Any Expiry</option>
          <option value="7"  className="bg-white text-slate-800">Expiring ≤ 7 days</option>
          <option value="14" className="bg-white text-slate-800">Expiring ≤ 14 days</option>
        </select>

        {/* Manual refresh button — spinning icon shows loading state */}
        <button
          onClick={loadData}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold glow-btn text-white cursor-pointer"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* ── Products table ──────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200/60 rounded-2xl overflow-hidden shadow-sm">
        {loading ? (
          // Full-table loading spinner
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="w-10 h-10 border-2 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-slate-400">Loading products...</p>
            </div>
          </div>
        ) : (
          <table className="data-table w-full">
            <thead>
              <tr>
                <th className="text-left">Product</th>
                <th className="text-left">Category</th>
                <th className="text-right">Stock</th>
                <th className="text-right">Cost</th>
                <th className="text-right">Current Price</th>
                <th className="text-right">Recommended</th>
                <th className="text-right">Δ%</th>
                <th className="text-right">Exp. Profit</th>
                <th className="text-left">Expiry</th>
                <th className="text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const rec      = p.recommendation;
                const expiring = p.days_to_expiry < 7;   // triggers red badge
                const lowStock = p.stock_level < 30;      // triggers red stock number

                return (
                  <tr key={p.product_id}>
                    {/* Product ID chip + link to detail page */}
                    <td>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold"
                          style={{ background: "rgba(124,58,237,0.08)", color: "#7c3aed" }}
                        >
                          #{p.product_id}
                        </div>
                        <Link
                          href={`/product/${p.product_id}`}
                          className="font-semibold text-slate-800 hover:text-violet-600 transition-colors flex items-center gap-1"
                        >
                          Product {p.product_id}
                          <ChevronRight size={12} className="text-slate-400" />
                        </Link>
                      </div>
                    </td>

                    {/* Category badge */}
                    <td>
                      <span className="badge badge-blue capitalize">{p.category}</span>
                    </td>

                    {/* Stock — red if low */}
                    <td className="text-right">
                      <span className={lowStock ? "text-red-500 font-bold" : "text-slate-700 font-medium"}>
                        {p.stock_level}
                      </span>
                    </td>

                    <td className="text-right text-slate-500 font-medium">{fmt(p.cost_price)}</td>
                    <td className="text-right font-bold text-slate-800">{fmt(p.current_price)}</td>

                    {/* Recommended price — violet, or dash if still loading */}
                    <td className="text-right">
                      {rec
                        ? <span className="font-bold text-violet-600">{fmt(rec.recommended_price)}</span>
                        : <span className="text-slate-400">—</span>
                      }
                    </td>

                    {/* % change indicator with colour + arrow */}
                    <td className="text-right">
                      {rec
                        ? <PriceDelta current={p.current_price} recommended={rec.recommended_price} />
                        : "—"
                      }
                    </td>

                    {/* Expected profit from the recommendation */}
                    <td className="text-right">
                      {rec
                        ? <span className="font-bold text-emerald-600">₹{rec.expected_profit.toFixed(0)}</span>
                        : "—"
                      }
                    </td>

                    {/* Expiry badge — red if < 7 days (at-risk) */}
                    <td>
                      <div className="flex items-center gap-1">
                        {expiring && <AlertTriangle size={12} className="text-red-500 animate-pulse" />}
                        <span className={`badge ${expiring ? "badge-red" : "badge-green"}`}>
                          {p.days_to_expiry}d
                        </span>
                      </div>
                    </td>

                    {/* Apply button — disabled if no recommendation loaded yet */}
                    <td className="text-center">
                      <button
                        onClick={() => handleApply(p)}
                        disabled={!rec || applyingId === p.product_id}
                        className="flex items-center gap-1 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all mx-auto"
                        style={{
                          background: rec ? "rgba(124,58,237,0.12)" : "rgba(0,0,0,0.02)",
                          color:      rec ? "#7c3aed" : "#94a3b8",
                          border:     `1px solid ${rec ? "rgba(124,58,237,0.2)" : "rgba(0,0,0,0.05)"}`,
                          cursor:     rec ? "pointer" : "not-allowed",
                        }}
                      >
                        <Zap size={11} className={rec ? "text-violet-600 fill-violet-200 animate-pulse" : ""} />
                        {applyingId === p.product_id ? "..." : "Apply"}
                      </button>
                    </td>
                  </tr>
                );
              })}

              {/* Empty state */}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center py-12 text-slate-400">
                    <Package size={32} className="mx-auto mb-2 opacity-45" />
                    No products found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Row count */}
      <div className="mt-4 text-xs text-slate-400 font-medium">
        Showing {filtered.length} of {products.length} products
      </div>
    </div>
  );
}
