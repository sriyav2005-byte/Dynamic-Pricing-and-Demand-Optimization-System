/**
 * app/products/page.tsx — Products Catalogue
 * =============================================
 * Enhanced product catalogue with card grid layout.
 * Shows product cards with pricing info, stock, expiry, and quick actions.
 */

"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  getProducts,
  getCategories,
  getRecommendation,
  getProductName,
  Product,
  PriceRecommendation,
} from "@/lib/api";
import {
  Search,
  Package,
  RefreshCw,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  ArrowRight,
} from "lucide-react";

interface ProductWithRec extends Product {
  recommendation?: PriceRecommendation;
}

const fmt = (n: number) => `₹${n.toFixed(2)}`;

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductWithRec[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [sortBy, setSortBy] = useState<"id" | "price" | "stock" | "expiry">("id");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [prods, cats] = await Promise.all([
        getProducts({ category: category || undefined }),
        getCategories(),
      ]);
      setCategories(cats);
      setProducts(prods);

      // Fetch recommendations in background
      const recs = await Promise.all(
        prods.map((p) => getRecommendation(p.product_id).catch(() => null))
      );
      setProducts(prods.map((p, i) => ({ ...p, recommendation: recs[i] ?? undefined })));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filtered = products
    .filter((p) => {
      if (!search) return true;
      const s = search.toLowerCase();
      const productName = p.name || p.product_name || getProductName(p.product_id, undefined, p.category);
      return (
        String(p.product_id).includes(s) ||
        productName.toLowerCase().includes(s) ||
        p.category.toLowerCase().includes(s)
      );
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "price": return a.current_price - b.current_price;
        case "stock": return a.stock_level - b.stock_level;
        case "expiry": return a.days_to_expiry - b.days_to_expiry;
        default: return a.product_id - b.product_id;
      }
    });

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-slate-900 mb-2">
          <span className="gradient-text">Products</span>
        </h1>
        <p className="text-sm text-slate-500 font-medium">
          Complete product catalogue with AI pricing recommendations
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200/60 rounded-2xl p-4 mb-6 flex flex-wrap gap-3 items-center shadow-sm">
        <div className="relative flex-1 min-w-48">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by product name, category, or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 bg-white outline-none focus:border-violet-500 transition-colors"
          />
        </div>

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

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-700 bg-white outline-none cursor-pointer focus:border-violet-500 transition-colors"
        >
          <option value="id" className="bg-white text-slate-800">Sort: ID</option>
          <option value="price" className="bg-white text-slate-800">Sort: Price ↑</option>
          <option value="stock" className="bg-white text-slate-800">Sort: Stock ↑</option>
          <option value="expiry" className="bg-white text-slate-800">Sort: Expiry ↑</option>
        </select>

        <button
          onClick={loadData}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold glow-btn text-white cursor-pointer"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Product Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="w-10 h-10 border-2 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-400">Loading products...</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((p) => {
            const rec = p.recommendation;
            const expiring = p.days_to_expiry < 7;
            const lowStock = p.stock_level < 30;
            const diff = rec
              ? ((rec.recommended_price - p.current_price) / p.current_price) * 100
              : 0;

            return (
              <Link
                key={p.product_id}
                href={`/product/${p.product_id}`}
                className="bg-white border border-slate-200/60 rounded-3xl p-5 hover:border-violet-500/40 transition-all duration-300 group shadow-sm hover:shadow-md flex flex-col justify-between"
                style={{ borderColor: expiring ? "rgba(239,68,68,0.3)" : undefined }}
              >
                <div>
                  {/* Header */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold"
                        style={{ background: "rgba(124,58,237,0.08)", color: "#7c3aed" }}
                      >
                        #{p.product_id}
                      </div>
                      <span className="badge badge-blue capitalize">{p.category}</span>
                    </div>
                    <ArrowRight
                      size={16}
                      className="opacity-0 group-hover:opacity-100 transition-all text-violet-500 translate-x-[-4px] group-hover:translate-x-0"
                    />
                  </div>

                  {/* Product Title */}
                  <h3 className="font-bold text-slate-800 text-base mb-3 line-clamp-1 group-hover:text-violet-600 transition-colors" title={p.name || p.product_name || getProductName(p.product_id, undefined, p.category)}>
                    {p.name || p.product_name || getProductName(p.product_id, undefined, p.category)}
                  </h3>

                  {/* Price Range */}
                  <div className="mb-4">
                    <div className="text-xs mb-1 text-slate-400 font-semibold">Price Range</div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 font-medium">
                        {fmt(p.cost_price)}
                      </span>
                      <div className="flex-1 h-1.5 rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${((p.current_price - p.cost_price) / (p.mrp - p.cost_price)) * 100}%`,
                            background: "linear-gradient(90deg, #7c3aed, #22d3ee)",
                          }}
                        />
                      </div>
                      <span className="text-xs text-slate-500 font-medium">
                        {fmt(p.mrp)}
                      </span>
                    </div>
                    <div className="text-center mt-2.5">
                      <span className="text-lg font-bold text-slate-800">{fmt(p.current_price)}</span>
                    </div>
                  </div>

                  {/* Recommendation */}
                  {rec && (
                    <div
                      className="rounded-2xl px-3 py-2.5 mb-3 flex items-center justify-between border border-cyan-100"
                      style={{ background: "rgba(34,211,238,0.08)" }}
                    >
                      <div>
                        <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">AI Recommended</div>
                        <div className="text-sm font-bold text-cyan-600">
                          {fmt(rec.recommended_price)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1" style={{
                        color: diff > 0.1 ? "#10b981" : diff < -0.1 ? "#ef4444" : "#64748b"
                      }}>
                        {diff > 0.1 ? <TrendingUp size={12} /> : diff < -0.1 ? <TrendingDown size={12} /> : null}
                        <span className="text-xs font-bold">
                          {diff >= 0 ? "+" : ""}{diff.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer Metrics */}
                <div className="grid grid-cols-3 gap-2 border-t border-slate-100 pt-3.5">
                  <div className="text-center">
                    <div className="text-[10px] text-slate-400 font-bold">Stock</div>
                    <div className={`text-xs font-bold ${lowStock ? "text-red-500" : "text-slate-700"}`}>
                      {p.stock_level}
                    </div>
                  </div>
                  <div className="text-center border-x border-slate-100">
                    <div className="text-[10px] text-slate-400 font-bold">Expiry</div>
                    <div className={`text-xs font-bold flex items-center justify-center gap-0.5 ${expiring ? "text-red-500" : "text-slate-700"}`}>
                      {expiring && <AlertTriangle size={10} className="animate-pulse" />}
                      {p.days_to_expiry}d
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-[10px] text-slate-400 font-bold">Season</div>
                    <div className="text-xs font-bold text-slate-700">
                      ×{p.season_factor.toFixed(1)}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}

          {filtered.length === 0 && (
            <div className="col-span-full text-center py-20 text-slate-400">
              <Package size={40} className="mx-auto mb-3 opacity-45" />
              <p className="text-sm">No products found</p>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 text-xs text-slate-400 font-medium">
        Showing {filtered.length} of {products.length} products
      </div>
    </div>
  );
}
