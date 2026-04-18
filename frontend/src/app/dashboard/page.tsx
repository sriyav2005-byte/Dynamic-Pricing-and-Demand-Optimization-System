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
        <h1 className="text-3xl font-bold text-white mb-2">
          <span className="gradient-text">Pricing Dashboard</span>
        </h1>
        <p className="text-sm" style={{ color: "#64748b" }}>
          ML-recommended prices with Thompson Sampling bandit
        </p>
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────── */}
      <div className="glass rounded-2xl p-4 mb-6 flex flex-wrap gap-3 items-center">

        {/* Text search (client-side) */}
        <div className="relative flex-1 min-w-48">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "#64748b" }} />
          <input
            type="text"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm text-white placeholder-gray-500 bg-transparent outline-none"
            style={{ border: "1px solid rgba(255,255,255,0.1)" }}
          />
        </div>

        {/* Category filter — triggers a new API call via loadData() */}
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="px-4 py-2.5 rounded-xl text-sm text-white bg-transparent outline-none cursor-pointer"
          style={{ border: "1px solid rgba(255,255,255,0.1)" }}
        >
          <option value="" className="bg-gray-900">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c} className="bg-gray-900 capitalize">{c}</option>
          ))}
        </select>

        {/* Expiry filter — highlights at-risk products */}
        <select
          value={maxExpiry}
          onChange={(e) => setMaxExpiry(e.target.value === "" ? "" : parseInt(e.target.value))}
          className="px-4 py-2.5 rounded-xl text-sm text-white bg-transparent outline-none cursor-pointer"
          style={{ border: "1px solid rgba(255,255,255,0.1)" }}
        >
          <option value="" className="bg-gray-900">Any Expiry</option>
          <option value="7"  className="bg-gray-900">Expiring ≤ 7 days</option>
          <option value="14" className="bg-gray-900">Expiring ≤ 14 days</option>
        </select>

        {/* Manual refresh button — spinning icon shows loading state */}
        <button
          onClick={loadData}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium glow-btn"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* ── Products table ──────────────────────────────────────────────── */}
      <div className="glass rounded-2xl overflow-hidden">
        {loading ? (
          // Full-table loading spinner
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm" style={{ color: "#64748b" }}>Loading products...</p>
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
                          style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}
                        >
                          #{p.product_id}
                        </div>
                        <Link
                          href={`/product/${p.product_id}`}
                          className="font-medium text-white hover:text-indigo-400 transition-colors flex items-center gap-1"
                        >
                          Product {p.product_id}
                          <ChevronRight size={12} />
                        </Link>
                      </div>
                    </td>

                    {/* Category badge */}
                    <td>
                      <span className="badge badge-blue capitalize">{p.category}</span>
                    </td>

                    {/* Stock — red if low */}
                    <td className="text-right">
                      <span style={{ color: lowStock ? "#ef4444" : "#e2e8f0" }}>
                        {p.stock_level}
                      </span>
                    </td>

                    <td className="text-right text-gray-400">{fmt(p.cost_price)}</td>
                    <td className="text-right font-medium text-white">{fmt(p.current_price)}</td>

                    {/* Recommended price — cyan, or dash if still loading */}
                    <td className="text-right">
                      {rec
                        ? <span className="font-bold" style={{ color: "#22d3ee" }}>{fmt(rec.recommended_price)}</span>
                        : <span className="text-gray-600">—</span>
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
                        ? <span className="font-semibold" style={{ color: "#10b981" }}>₹{rec.expected_profit.toFixed(0)}</span>
                        : "—"
                      }
                    </td>

                    {/* Expiry badge — red if < 7 days (at-risk) */}
                    <td>
                      <div className="flex items-center gap-1">
                        {expiring && <AlertTriangle size={12} style={{ color: "#ef4444" }} />}
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
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all mx-auto"
                        style={{
                          background: rec ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.05)",
                          color:      rec ? "#818cf8" : "#475569",
                          border:     `1px solid ${rec ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.05)"}`,
                          cursor:     rec ? "pointer" : "not-allowed",
                        }}
                      >
                        <Zap size={11} />
                        {applyingId === p.product_id ? "..." : "Apply"}
                      </button>
                    </td>
                  </tr>
                );
              })}

              {/* Empty state */}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center py-12" style={{ color: "#64748b" }}>
                    <Package size={32} className="mx-auto mb-2 opacity-40" />
                    No products found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Row count */}
      <div className="mt-4 text-xs" style={{ color: "#475569" }}>
        Showing {filtered.length} of {products.length} products
      </div>
    </div>
  );
}
