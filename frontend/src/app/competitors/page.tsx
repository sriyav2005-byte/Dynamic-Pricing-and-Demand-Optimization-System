/**
 * app/competitors/page.tsx — Standalone Competitor Analysis
 * ==========================================================
 * A completely independent real-product search page that lets users
 * search for any real Indian grocery/FMCG product and compare estimated
 * prices across 6 quick-commerce platforms.
 *
 * Architecture
 * ------------
 * This page calls GET /competitors/search (independent service) — NOT
 * /competitor/market-overview (which is tied to the synthetic DB).
 *
 * It does NOT interact with:
 *   - The ML demand predictor
 *   - The contextual bandit pricing engine
 *   - The synthetic product catalog
 *   - The pricing engine
 *
 * Future Integration Points (marked with 🔗)
 * -------------------------------------------
 * 1. 🔗 Add product_id matching to link competitor results to inventory
 * 2. 🔗 Feed market_avg into ML demand predictor as extra feature
 * 3. 🔗 Pass cheapest_price to bandit engine for reward computation
 * 4. 🔗 Expose search results to AI agent for competitor Q&A
 */

"use client";

import { useState, useCallback } from "react";
import {
  ShieldCheck,
  RefreshCw,
  SortAsc,
  SortDesc,
  Filter,
  Tag,
  Award,
  TrendingDown,
  Zap,
  BarChart3,
  AlertTriangle,
  Info,
  ExternalLink,
} from "lucide-react";
import ProductSearchHero from "@/components/competitor/ProductSearchHero";
import PlatformPriceCards from "@/components/competitor/PlatformPriceCards";
import PriceComparisonBar from "@/components/competitor/PriceComparisonBar";
import {
  searchCompetitorPrices,
  ProductSearchResponse,
} from "@/lib/competitorsApi";

// Platform filter options
const ALL_PLATFORMS = [
  { key: "blinkit",          label: "⚡ Blinkit",           color: "#F8CB2E" },
  { key: "zepto",            label: "🟣 Zepto",              color: "#A855F7" },
  { key: "instamart",        label: "🛒 Swiggy Instamart",   color: "#FC8019" },
  { key: "bigbasket",        label: "🧺 BigBasket",          color: "#84CC16" },
  { key: "amazon_fresh",     label: "📦 Amazon Fresh",       color: "#F59E0B" },
  { key: "flipkart_minutes", label: "🛍️ Flipkart Minutes",  color: "#2563EB" },
];

type SortOrder = "asc" | "desc";

// ── Sub-components ────────────────────────────────────────────────────────────

// ── Price Data Source Disclaimer Banner ──────────────────────────────────────
function EstimatedDataBanner({ hasLive }: { hasLive?: boolean }) {
  if (hasLive) {
    return (
      <div
        className="flex flex-col sm:flex-row items-start gap-3 p-4 rounded-2xl mb-6"
        style={{
          background: "linear-gradient(135deg, rgba(16,185,129,0.08), rgba(52,211,153,0.05))",
          border: "1.5px solid rgba(16,185,129,0.3)",
        }}
      >
        <div
          className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center mt-0.5"
          style={{ background: "rgba(16,185,129,0.15)" }}
        >
          <Zap size={16} style={{ color: "#10b981" }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-extrabold" style={{ color: "#065f46" }}>
              Live Price Data Retrieved
            </span>
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse"
              style={{ background: "rgba(16,185,129,0.2)", color: "#047857" }}
            >
              LIVE WEB SCRAPED
            </span>
          </div>
          <p className="text-xs font-medium" style={{ color: "#064e3b" }}>
            Real-time scraped prices were successfully extracted for platforms tagged with{" "}
            <strong className="text-emerald-700">● LIVE</strong>. Fallback platform estimates apply for any platform where live search endpoints rate-limited request calls.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col sm:flex-row items-start gap-3 p-4 rounded-2xl mb-6"
      style={{
        background: "linear-gradient(135deg, rgba(245,158,11,0.08), rgba(251,191,36,0.05))",
        border: "1.5px solid rgba(245,158,11,0.3)",
      }}
    >
      <div
        className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center mt-0.5"
        style={{ background: "rgba(245,158,11,0.15)" }}
      >
        <AlertTriangle size={16} style={{ color: "#d97706" }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-extrabold" style={{ color: "#92400e" }}>
            Live Price Scraping Notice
          </span>
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: "rgba(245,158,11,0.2)", color: "#b45309" }}
          >
            ESTIMATED FALLBACK
          </span>
        </div>
        <p className="text-xs font-medium" style={{ color: "#78350f" }}>
          Indian quick-commerce apps (Blinkit, Zepto, Instamart, BigBasket) use heavy JavaScript rendering, Cloudflare bot protection, and require a city/pincode to show prices. Live web search scraper attempted live queries and loaded estimated fallback prices for rate-limited endpoints.
        </p>
        <p className="text-xs font-semibold mt-1.5" style={{ color: "#92400e" }}>
          ✅ Click <span className="underline">"Check Live on [Platform]"</span> on any card to view real-time prices directly on the platform store.
        </p>
      </div>
    </div>
  );
}

function LoadingState({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="relative mb-6">
        <div className="w-16 h-16 rounded-full border-2 border-violet-100 flex items-center justify-center">
          <ShieldCheck size={24} className="text-violet-300" />
        </div>
        <div className="absolute inset-0 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
      </div>
      <p className="text-sm font-bold text-slate-700 mb-1">Generating price estimates…</p>
      <p className="text-xs text-slate-400 font-medium">
        Calculating estimated prices for &ldquo;{query}&rdquo; across 6 platforms
      </p>
      <div className="flex gap-4 mt-6">
        {["⚡", "🟣", "🛒", "🧺", "📦", "🛍️"].map((emoji, i) => (
          <span
            key={emoji}
            className="text-xl animate-pulse"
            style={{ animationDelay: `${i * 120}ms` }}
          >
            {emoji}
          </span>
        ))}
      </div>
    </div>
  );
}

function ErrorState({ query, onRetry }: { query: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)" }}
      >
        <Info size={22} className="text-red-400" />
      </div>
      <p className="text-sm font-bold text-slate-700 mb-1">Failed to fetch prices</p>
      <p className="text-xs text-slate-400 font-medium mb-4">
        Could not retrieve data for &ldquo;{query}&rdquo;. The backend may be offline.
      </p>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-all hover:scale-[1.03]"
        style={{ background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.2)", color: "#7c3aed" }}
      >
        <RefreshCw size={13} />
        Try Again
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="rounded-3xl p-12 text-center"
      style={{
        background: "linear-gradient(135deg,rgba(124,58,237,0.03),rgba(34,211,238,0.02))",
        border: "1.5px dashed rgba(124,58,237,0.2)",
      }}
    >
      <div
        className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-5"
        style={{ background: "linear-gradient(135deg,rgba(124,58,237,0.08),rgba(34,211,238,0.06))" }}
      >
        <ShieldCheck size={32} className="text-violet-400" />
      </div>
      <h3 className="text-lg font-extrabold text-slate-800 mb-2">
        Search for any product
      </h3>
      <p className="text-sm text-slate-500 font-medium max-w-md mx-auto">
        Type a product name above — like &ldquo;Amul Taaza Milk 1L&rdquo; or &ldquo;Tata Salt 1kg&rdquo; — to compare
        estimated prices across Blinkit, Zepto, Swiggy Instamart, BigBasket, Amazon Fresh, and Flipkart Minutes.
      </p>
      {/* Platform icons strip */}
      <div className="flex items-center justify-center gap-3 mt-6">
        {ALL_PLATFORMS.map((p) => (
          <div
            key={p.key}
            className="flex flex-col items-center gap-1"
          >
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-base"
              style={{ background: `${p.color}15`, border: `1.5px solid ${p.color}30` }}
            >
              {p.label.split(" ")[0]}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-center gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full bg-violet-400" />
        <span className="text-[11px] text-slate-400 font-medium">
          6 platforms · Estimated pricing · Not live-scraped
        </span>
        <div className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
      </div>
    </div>
  );
}

// ── KPI Cards strip ────────────────────────────────────────────────────────────

function KpiStrip({ result }: { result: ProductSearchResponse }) {
  const cheapest = result.platforms.find((p) => p.is_cheapest);
  const highest = result.platforms.find((p) => p.is_highest);

  const kpis = [
    {
      icon: TrendingDown,
      iconColor: "#10b981",
      label: "Cheapest Platform",
      value: cheapest?.platform ?? "—",
      sub: cheapest ? `₹${cheapest.price.toFixed(2)}` : "",
    },
    {
      icon: BarChart3,
      iconColor: "#7c3aed",
      label: "Market Average",
      value: `₹${result.market_avg.toFixed(2)}`,
      sub: `${result.platforms.length} platforms`,
    },
    {
      icon: Tag,
      iconColor: "#f59e0b",
      label: "Avg Discount off MRP",
      value: `${result.discount_from_mrp.toFixed(1)}%`,
      sub: `MRP ₹${result.mrp.toFixed(2)}`,
    },
    {
      icon: Award,
      iconColor: "#0891b2",
      label: "Price Spread",
      value: `₹${result.price_spread.toFixed(2)}`,
      sub: "cheapest → highest",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      {kpis.map(({ icon: Icon, iconColor, label, value, sub }) => (
        <div
          key={label}
          className="rounded-2xl p-4 transition-all hover:-translate-y-0.5"
          style={{
            background: "#fff",
            border: "1px solid rgba(0,0,0,0.06)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.02)",
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Icon size={15} style={{ color: iconColor }} />
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
          </div>
          <div className="text-lg font-extrabold text-slate-800 leading-tight">{value}</div>
          <div className="text-xs font-medium text-slate-400 mt-0.5">{sub}</div>
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CompetitorsPage() {
  const [searchResult, setSearchResult] = useState<ProductSearchResponse | null>(null);
  const [activeQuery, setActiveQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  // Controls
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [activePlatforms, setActivePlatforms] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const handleSearch = useCallback(async (query: string) => {
    setLoading(true);
    setError(false);
    setActiveQuery(query);
    setSearchResult(null);
    try {
      const result = await searchCompetitorPrices(query);
      setSearchResult(result);
    } catch (e) {
      console.error("Competitor search failed:", e);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRetry = useCallback(() => {
    if (activeQuery) handleSearch(activeQuery);
  }, [activeQuery, handleSearch]);

  const togglePlatform = (key: string) => {
    setActivePlatforms((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const searchedAt = searchResult?.searched_at
    ? new Date(searchResult.searched_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="p-6 md:p-8 max-w-screen-xl mx-auto">

      {/* ── Page header ───────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg,#7c3aed,#22d3ee)", boxShadow: "0 0 16px rgba(124,58,237,0.25)" }}
            >
              <ShieldCheck size={16} className="text-white" />
            </div>
            <h1 className="text-2xl font-extrabold text-slate-900">
              <span className="gradient-text">Competitor Analysis</span>
            </h1>
            <span
              className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: "rgba(124,58,237,0.08)", color: "#7c3aed", border: "1px solid rgba(124,58,237,0.15)" }}
            >
              <Zap size={9} />
              Standalone Module
            </span>
          </div>
          <p className="text-sm text-slate-500 font-medium">
            Search any real retail product to compare estimated prices across 6 quick-commerce platforms
          </p>
        </div>

        {/* Controls — only shown after a search */}
        {searchResult && (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Sort toggle */}
            <button
              onClick={() => setSortOrder((s) => s === "asc" ? "desc" : "asc")}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer hover:scale-[1.02]"
              style={{
                background: "rgba(124,58,237,0.07)",
                border: "1px solid rgba(124,58,237,0.18)",
                color: "#7c3aed",
              }}
              title={sortOrder === "asc" ? "Sorted: Low → High" : "Sorted: High → Low"}
            >
              {sortOrder === "asc" ? <SortAsc size={13} /> : <SortDesc size={13} />}
              {sortOrder === "asc" ? "Price: Low → High" : "Price: High → Low"}
            </button>

            {/* Filter toggle */}
            <button
              onClick={() => setShowFilters((f) => !f)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer hover:scale-[1.02]"
              style={{
                background: showFilters ? "rgba(124,58,237,0.12)" : "rgba(0,0,0,0.04)",
                border: showFilters ? "1px solid rgba(124,58,237,0.25)" : "1px solid rgba(0,0,0,0.08)",
                color: showFilters ? "#7c3aed" : "#64748b",
              }}
            >
              <Filter size={13} />
              Filter Platforms
              {activePlatforms.length > 0 && (
                <span
                  className="w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold text-white"
                  style={{ background: "#7c3aed" }}
                >
                  {activePlatforms.length}
                </span>
              )}
            </button>

            {/* Refresh */}
            <button
              onClick={handleRetry}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer hover:scale-[1.02] disabled:opacity-50"
              style={{ background: "rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.08)", color: "#64748b" }}
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        )}
      </div>

      {/* ── Platform filter chips ─────────────────────────────────────── */}
      {searchResult && showFilters && (
        <div
          className="flex flex-wrap items-center gap-2 mb-6 p-4 rounded-2xl"
          style={{ background: "rgba(124,58,237,0.04)", border: "1px solid rgba(124,58,237,0.1)" }}
        >
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mr-1">Platforms:</span>
          {ALL_PLATFORMS.map((p) => {
            const active = activePlatforms.length === 0 || activePlatforms.includes(p.key);
            const toggled = activePlatforms.includes(p.key);
            return (
              <button
                key={p.key}
                onClick={() => togglePlatform(p.key)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer hover:scale-[1.03]"
                style={{
                  background: toggled ? `${p.color}20` : active ? "rgba(0,0,0,0.04)" : "rgba(0,0,0,0.02)",
                  border: `1.5px solid ${toggled ? p.color + "60" : "rgba(0,0,0,0.08)"}`,
                  color: toggled ? p.color : "#64748b",
                  opacity: activePlatforms.length > 0 && !toggled ? 0.5 : 1,
                }}
              >
                {p.label}
              </button>
            );
          })}
          {activePlatforms.length > 0 && (
            <button
              onClick={() => setActivePlatforms([])}
              className="px-3 py-1.5 rounded-full text-xs font-semibold text-slate-400 hover:text-slate-600 cursor-pointer transition-colors"
              style={{ border: "1.5px dashed rgba(0,0,0,0.12)" }}
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* ── Search hero ───────────────────────────────────────────────── */}
      <ProductSearchHero
        onSearch={handleSearch}
        loading={loading}
        initialQuery={activeQuery}
      />

      {/* ── Results area ─────────────────────────────────────────────── */}
      {loading && <LoadingState query={activeQuery} />}

      {error && !loading && <ErrorState query={activeQuery} onRetry={handleRetry} />}

      {!loading && !error && !searchResult && <EmptyState />}

      {!loading && !error && searchResult && (
        <div>
          {/* Price Data Source Banner */}
          <EstimatedDataBanner hasLive={searchResult.has_live} />

          {/* Product header */}
          <div
            className="rounded-2xl p-5 mb-6 flex flex-col sm:flex-row sm:items-center gap-4"
            style={{
              background: "linear-gradient(135deg,rgba(124,58,237,0.04),rgba(34,211,238,0.03))",
              border: "1px solid rgba(124,58,237,0.12)",
            }}
          >
            {/* Category icon */}
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0"
              style={{ background: "rgba(124,58,237,0.08)", border: "1.5px solid rgba(124,58,237,0.15)" }}
            >
              {searchResult.category === "dairy" ? "🥛"
                : searchResult.category === "beverages" ? "🥤"
                : searchResult.category === "snacks" ? "🍪"
                : searchResult.category === "oils" ? "🫙"
                : searchResult.category === "staples" ? "🌾"
                : searchResult.category === "personal_care" ? "🧴"
                : searchResult.category === "household" ? "🧹"
                : "🛒"}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h2 className="text-lg font-extrabold text-slate-900 truncate">
                  {searchResult.product_name}
                </h2>
                <span
                  className="badge badge-blue capitalize"
                  style={{ fontSize: "10px" }}
                >
                  {searchResult.category.replace("_", " ")}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 font-medium">
                {searchResult.brand !== "Unknown" && (
                  <span className="flex items-center gap-1">
                    <Award size={11} className="text-slate-400" />
                    Brand: <strong className="text-slate-700">{searchResult.brand}</strong>
                  </span>
                )}
                {searchResult.variant && (
                  <span className="flex items-center gap-1">
                    <Tag size={11} className="text-slate-400" />
                    Variant: <strong className="text-slate-700">{searchResult.variant}</strong>
                  </span>
                )}
                {searchedAt && (
                  <span className="text-slate-400 ml-auto">
                    Last updated {searchedAt}
                  </span>
                )}
              </div>
            </div>

            {/* New search button */}
            <button
              onClick={() => { setSearchResult(null); setActiveQuery(""); setError(false); }}
              className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-all hover:scale-[1.02]"
              style={{ background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.2)", color: "#7c3aed" }}
            >
              <RefreshCw size={12} />
              Search Again
            </button>
          </div>

          {/* KPI cards */}
          <KpiStrip result={searchResult} />

          {/* Platform price cards */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-extrabold text-slate-700 uppercase tracking-wider">
                Platform Prices
              </h3>
              <div className="flex-1 h-px bg-slate-100" />
            </div>
            <PlatformPriceCards
              platforms={searchResult.platforms}
              sortOrder={sortOrder}
              visiblePlatforms={activePlatforms}
            />
          </div>

          {/* Price comparison bar */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-extrabold text-slate-700 uppercase tracking-wider">
                Price Range Analysis
              </h3>
              <div className="flex-1 h-px bg-slate-100" />
            </div>
            <PriceComparisonBar
              platforms={searchResult.platforms}
              mrp={searchResult.mrp}
              marketAvg={searchResult.market_avg}
            />
          </div>

          {/* Comparison table */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-extrabold text-slate-700 uppercase tracking-wider">
                Detailed Comparison
              </h3>
              <div className="flex-1 h-px bg-slate-100" />
            </div>
            <div
              className="rounded-2xl overflow-hidden"
              style={{ border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 4px 16px rgba(0,0,0,0.03)" }}
            >
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr style={{ background: "rgba(124,58,237,0.04)" }}>
                      {["Platform", "Selling Price", "MRP", "Discount", "Availability", "Delivery"].map((h) => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider"
                          style={{ color: "#475569" }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...searchResult.platforms]
                      .sort((a, b) => sortOrder === "desc" ? b.price - a.price : a.price - b.price)
                      .filter((p) => activePlatforms.length === 0 || activePlatforms.includes(p.platform_key))
                      .map((p, i) => (
                        <tr
                          key={p.platform_key}
                          style={{
                            background: p.is_cheapest
                              ? "rgba(16,185,129,0.03)"
                              : i % 2 === 0
                              ? "#fff"
                              : "rgba(0,0,0,0.01)",
                            borderBottom: "1px solid rgba(0,0,0,0.05)",
                          }}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="text-base">{p.emoji}</span>
                              <span className="text-sm font-bold" style={{ color: p.color }}>
                                {p.platform}
                              </span>
                              {p.is_cheapest && (
                                <span
                                  className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full"
                                  style={{ background: "rgba(16,185,129,0.12)", color: "#10b981" }}
                                >
                                  BEST
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className="text-sm font-extrabold"
                              style={{ color: p.is_cheapest ? "#10b981" : p.is_highest ? "#ef4444" : "#1e293b" }}
                            >
                              ₹{p.price.toFixed(2)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-400 line-through font-medium">
                            ₹{p.mrp.toFixed(2)}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className="text-xs font-bold px-2 py-0.5 rounded-full"
                              style={{ background: "rgba(16,185,129,0.1)", color: "#10b981" }}
                            >
                              {p.discount_pct}% off
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: "#10b981" }}>
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                              {p.availability}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs font-medium text-slate-500">
                            {p.delivery_time}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Footer note */}
          <div
            className="flex items-start gap-2 px-4 py-3 rounded-xl text-xs font-medium text-slate-400"
            style={{ background: "rgba(0,0,0,0.02)", border: "1px dashed rgba(0,0,0,0.08)" }}
          >
            <Info size={13} className="flex-shrink-0 mt-0.5" />
            <span>
              Prices shown are <strong>estimates</strong> derived from known MRP data and platform discount profiles.
              They are <strong>not live-scraped</strong> (platform APIs block server-side scraping).
              Deterministic per (query × platform) — refresh to see the same estimate.
              For live verification, click &ldquo;View on&rdquo; links to open the actual platform.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}