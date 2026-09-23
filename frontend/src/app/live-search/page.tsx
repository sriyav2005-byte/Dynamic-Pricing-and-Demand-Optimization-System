/**
 * app/live-search/page.tsx — Live Price Search Page
 * ==================================================
 * Real-time product price comparison across Blinkit, Zepto,
 * Swiggy Instamart, BigBasket, and Amazon Fresh.
 *
 * Features:
 *  - Animated search bar with cycling example queries
 *  - Platform filter chips
 *  - Premium result cards with live/estimated badges
 *  - Direct "View on Platform" links
 *  - Loading skeletons + empty / error states
 */

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Search,
  ExternalLink,
  Zap,
  RefreshCw,
  Tag,
  TrendingDown,
  AlertCircle,
  CheckCircle2,
  Info,
  X,
} from "lucide-react";
import { searchLivePrices, LiveSearchResult, LiveSearchResponse } from "@/lib/api";

// ── Platform display config (colours + icons matching backend) ─────────────
const PLATFORM_META: Record<
  string,
  { emoji: string; gradient: string; glow: string }
> = {
  blinkit: {
    emoji: "⚡",
    gradient: "linear-gradient(135deg, #F7CB45, #f0b800)",
    glow: "rgba(247, 203, 69, 0.3)",
  },
  zepto: {
    emoji: "🔵",
    gradient: "linear-gradient(135deg, #7B2FF7, #5b1fd4)",
    glow: "rgba(123, 47, 247, 0.3)",
  },
  instamart: {
    emoji: "🛒",
    gradient: "linear-gradient(135deg, #FC8019, #e06810)",
    glow: "rgba(252, 128, 25, 0.3)",
  },
  bigbasket: {
    emoji: "🧺",
    gradient: "linear-gradient(135deg, #84C225, #6aa31b)",
    glow: "rgba(132, 194, 37, 0.3)",
  },
  amazon_fresh: {
    emoji: "📦",
    gradient: "linear-gradient(135deg, #FF9900, #e07b00)",
    glow: "rgba(255, 153, 0, 0.3)",
  },
};

const ALL_PLATFORMS = [
  { key: "all",          label: "All Platforms", color: "#7c3aed" },
  { key: "blinkit",      label: "Blinkit",        color: "#F7CB45" },
  { key: "zepto",        label: "Zepto",           color: "#7B2FF7" },
  { key: "instamart",    label: "Swiggy Instamart",color: "#FC8019" },
  { key: "bigbasket",    label: "BigBasket",       color: "#84C225" },
  { key: "amazon_fresh", label: "Amazon Fresh",    color: "#FF9900" },
];

const EXAMPLE_QUERIES = [
  "amul butter 500g",
  "maggi noodles",
  "dove shampoo",
  "lay's chips",
  "britannia bread",
  "surf excel",
  "tropicana orange juice",
  "dettol soap",
];

// ── Sub-components ────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div
      className="rounded-2xl overflow-hidden animate-pulse"
      style={{
        background: "#ffffff",
        border: "1px solid rgba(0,0,0,0.06)",
        boxShadow: "0 4px 20px -2px rgba(0,0,0,0.04)",
      }}
    >
      <div className="h-2" style={{ background: "rgba(124,58,237,0.15)" }} />
      <div className="p-5 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-100" />
          <div className="flex-1 space-y-2">
            <div className="h-3 bg-slate-100 rounded w-3/4" />
            <div className="h-2 bg-slate-100 rounded w-1/2" />
          </div>
        </div>
        <div className="h-8 bg-slate-100 rounded w-1/3" />
        <div className="h-10 bg-slate-100 rounded-xl" />
      </div>
    </div>
  );
}

function PriceCard({ result }: { result: LiveSearchResult }) {
  const meta = PLATFORM_META[result.platform_key] ?? {
    emoji: "🏪",
    gradient: "linear-gradient(135deg, #64748b, #475569)",
    glow: "rgba(100,116,139,0.3)",
  };

  const discountBig = result.discount_pct >= 15;
  const savings = (result.original_price - result.price).toFixed(2);

  return (
    <div
      className="rounded-2xl overflow-hidden group transition-all duration-300"
      style={{
        background: "#ffffff",
        border: "1px solid rgba(0,0,0,0.06)",
        boxShadow: "0 4px 20px -2px rgba(0,0,0,0.04)",
        transform: "translateY(0)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(-4px)";
        (e.currentTarget as HTMLDivElement).style.boxShadow = `0 16px 40px -8px ${meta.glow}`;
        (e.currentTarget as HTMLDivElement).style.borderColor = result.color;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
        (e.currentTarget as HTMLDivElement).style.boxShadow =
          "0 4px 20px -2px rgba(0,0,0,0.04)";
        (e.currentTarget as HTMLDivElement).style.borderColor =
          "rgba(0,0,0,0.06)";
      }}
    >
      {/* Coloured top bar */}
      <div className="h-1.5" style={{ background: meta.gradient }} />

      <div className="p-5">
        {/* Platform header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold shadow-sm"
              style={{ background: meta.gradient, boxShadow: `0 4px 12px ${meta.glow}` }}
            >
              {meta.emoji}
            </div>
            <div>
              <div className="font-bold text-slate-900 text-sm leading-tight">
                {result.platform}
              </div>
              <div className="text-[11px] text-slate-400 font-medium">
                {result.tagline}
              </div>
            </div>
          </div>

          {/* Live / Estimated badge */}
          {result.is_live_data ? (
            <span
              className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full"
              style={{
                background: "rgba(16,185,129,0.1)",
                color: "#059669",
                border: "1px solid rgba(16,185,129,0.2)",
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              LIVE
            </span>
          ) : (
            <span
              className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full"
              style={{
                background: "rgba(245,158,11,0.1)",
                color: "#b45309",
                border: "1px solid rgba(245,158,11,0.2)",
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              EST.
            </span>
          )}
        </div>

        {/* Product name */}
        <p
          className="text-xs font-semibold text-slate-600 mb-4 leading-relaxed"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            minHeight: "2.5rem",
          }}
        >
          {result.product_name}
        </p>

        {/* Price section */}
        <div className="mb-4">
          <div className="flex items-end gap-2 mb-1">
            <span
              className="text-3xl font-extrabold"
              style={{ color: "#0f172a", letterSpacing: "-0.03em" }}
            >
              ₹{result.price.toFixed(2)}
            </span>
            {result.discount_pct > 0 && (
              <span className="text-sm text-slate-400 line-through font-medium mb-1">
                ₹{result.original_price.toFixed(2)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {result.discount_pct > 0 && (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full"
                style={{
                  background: discountBig
                    ? "rgba(16,185,129,0.12)"
                    : "rgba(124,58,237,0.10)",
                  color: discountBig ? "#059669" : "#7c3aed",
                }}
              >
                <TrendingDown size={10} />
                {result.discount_pct.toFixed(1)}% off
              </span>
            )}
            {result.discount_pct > 0 && (
              <span className="text-[11px] font-semibold text-emerald-600">
                Save ₹{savings}
              </span>
            )}
            {result.quantity && (
              <span className="text-[11px] font-medium text-slate-400">
                {result.quantity}
              </span>
            )}
          </div>

          {/* Out of stock */}
          {!result.in_stock && (
            <div className="mt-2 text-[11px] font-semibold text-red-500 flex items-center gap-1">
              <AlertCircle size={11} /> Out of stock
            </div>
          )}
        </div>

        {/* CTA button */}
        <a
          href={result.product_url}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 cursor-pointer"
          style={{
            background: result.is_live_data
              ? meta.gradient
              : "transparent",
            color: result.is_live_data ? result.text_color : "#475569",
            border: result.is_live_data
              ? "none"
              : "1.5px solid rgba(0,0,0,0.12)",
            boxShadow: result.is_live_data
              ? `0 4px 14px ${meta.glow}`
              : "none",
            textDecoration: "none",
          }}
          onMouseEnter={(e) => {
            if (!result.is_live_data) {
              (e.currentTarget as HTMLAnchorElement).style.borderColor = result.color;
              (e.currentTarget as HTMLAnchorElement).style.color = result.color;
            }
          }}
          onMouseLeave={(e) => {
            if (!result.is_live_data) {
              (e.currentTarget as HTMLAnchorElement).style.borderColor =
                "rgba(0,0,0,0.12)";
              (e.currentTarget as HTMLAnchorElement).style.color = "#475569";
            }
          }}
        >
          <ExternalLink size={14} />
          {result.is_live_data ? `Buy on ${result.platform}` : `Search on ${result.platform}`}
        </a>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function LiveSearchPage() {
  const [query, setQuery] = useState("");
  const [activePlatform, setActivePlatform] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<LiveSearchResponse | null>(null);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cycle placeholder text
  useEffect(() => {
    const id = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % EXAMPLE_QUERIES.length);
    }, 2500);
    return () => clearInterval(id);
  }, []);

  const handleSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || trimmed.length < 2) return;

    setLoading(true);
    setError(null);
    setActivePlatform("all");

    try {
      const res = await searchLivePrices(trimmed);
      setResponse(res);
      setRecentSearches((prev) => {
        const updated = [trimmed, ...prev.filter((s) => s !== trimmed)].slice(0, 5);
        return updated;
      });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string };
      setError(
        err?.response?.data?.detail ||
          err?.message ||
          "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch(query);
  };

  // Filter by platform
  const filteredResults =
    response?.results.filter(
      (r) => activePlatform === "all" || r.platform_key === activePlatform
    ) ?? [];

  const lowestPrice =
    filteredResults.length > 0
      ? Math.min(...filteredResults.map((r) => r.price))
      : null;

  return (
    <div className="min-h-screen" style={{ background: "#f8f9fd" }}>
      {/* ── Hero section ─────────────────────────────────────────────────── */}
      <div
        className="relative overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, #0f0c29 0%, #1a0533 40%, #24243e 100%)",
          paddingBottom: "3rem",
        }}
      >
        {/* Animated background orbs */}
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
        >
          <div
            className="absolute rounded-full opacity-20 blur-3xl"
            style={{
              width: 500,
              height: 500,
              top: -100,
              left: -100,
              background: "radial-gradient(circle, #7c3aed 0%, transparent 70%)",
              animation: "pulse 6s ease-in-out infinite",
            }}
          />
          <div
            className="absolute rounded-full opacity-15 blur-3xl"
            style={{
              width: 400,
              height: 400,
              top: 0,
              right: -80,
              background: "radial-gradient(circle, #22d3ee 0%, transparent 70%)",
              animation: "pulse 8s ease-in-out infinite 2s",
            }}
          />
          <div
            className="absolute rounded-full opacity-10 blur-2xl"
            style={{
              width: 250,
              height: 250,
              bottom: -50,
              left: "40%",
              background: "radial-gradient(circle, #F7CB45 0%, transparent 70%)",
              animation: "pulse 5s ease-in-out infinite 1s",
            }}
          />
        </div>

        <div className="relative px-8 pt-12 pb-0">
          {/* Page title */}
          <div className="mb-2 inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold"
            style={{ background: "rgba(239,68,68,0.15)", color: "#f87171" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
            LIVE PRICE TRACKER
          </div>
          <h1 className="text-4xl font-extrabold text-white mb-3 leading-tight">
            Compare Prices Across
            <span
              className="block"
              style={{
                background: "linear-gradient(90deg, #F7CB45, #FC8019, #7B2FF7, #22d3ee)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              India's Top Quick Commerce
            </span>
          </h1>
          <p className="text-slate-400 text-sm mb-8 max-w-xl">
            Search any product and instantly see prices from Blinkit, Zepto,
            Swiggy Instamart, BigBasket &amp; Amazon Fresh — with direct links to buy.
          </p>

          {/* Platform pills in hero */}
          <div className="flex flex-wrap gap-2 mb-8">
            {ALL_PLATFORMS.slice(1).map((p) => {
              const meta = PLATFORM_META[p.key];
              return (
                <div
                  key={p.key}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    color: "rgba(255,255,255,0.75)",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  <span>{meta.emoji}</span>
                  {p.label}
                </div>
              );
            })}
          </div>

          {/* ── Search bar ──────────────────────────────────────────────── */}
          <form onSubmit={onSubmit} className="relative max-w-2xl">
            <div
              className="flex items-center rounded-2xl overflow-hidden transition-all duration-300"
              style={{
                background: "rgba(255,255,255,0.95)",
                boxShadow: "0 8px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(124,58,237,0.3)",
              }}
            >
              <Search
                size={20}
                className="ml-5 shrink-0"
                style={{ color: "#7c3aed" }}
              />
              <input
                ref={inputRef}
                id="live-search-input"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Try "${EXAMPLE_QUERIES[placeholderIdx]}"…`}
                className="flex-1 px-4 py-4 text-sm font-medium text-slate-800 bg-transparent outline-none placeholder:text-slate-400"
                autoComplete="off"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="mr-2 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  <X size={14} style={{ color: "#94a3b8" }} />
                </button>
              )}
              <button
                id="live-search-btn"
                type="submit"
                disabled={loading || query.trim().length < 2}
                className="m-2 flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: "linear-gradient(135deg, #7c3aed, #6d28d9)",
                  boxShadow: "0 4px 14px rgba(124,58,237,0.4)",
                }}
              >
                {loading ? (
                  <RefreshCw size={15} className="animate-spin" />
                ) : (
                  <Zap size={15} />
                )}
                {loading ? "Searching…" : "Search"}
              </button>
            </div>
          </form>

          {/* Recent searches */}
          {recentSearches.length > 0 && !loading && (
            <div className="flex items-center gap-2 mt-4 flex-wrap">
              <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">
                Recent:
              </span>
              {recentSearches.map((s) => (
                <button
                  key={s}
                  onClick={() => { setQuery(s); handleSearch(s); }}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-full transition-all duration-150 cursor-pointer"
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    color: "rgba(255,255,255,0.65)",
                    border: "1px solid rgba(255,255,255,0.12)",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Content area ─────────────────────────────────────────────────── */}
      <div className="px-8 py-8">

        {/* ── Initial empty state ──────────────────────────────────────── */}
        {!response && !loading && !error && (
          <div className="text-center py-16">
            <div
              className="w-20 h-20 rounded-3xl mx-auto mb-5 flex items-center justify-center text-4xl"
              style={{
                background: "linear-gradient(135deg, rgba(124,58,237,0.1), rgba(34,211,238,0.1))",
                border: "1px solid rgba(124,58,237,0.15)",
              }}
            >
              🔍
            </div>
            <h3 className="text-lg font-bold text-slate-700 mb-2">
              Search for any product
            </h3>
            <p className="text-sm text-slate-400 max-w-sm mx-auto">
              Type a product name above and compare prices instantly across
              5 quick-commerce platforms.
            </p>
            {/* Popular searches */}
            <div className="mt-8">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
                Popular searches
              </div>
              <div className="flex flex-wrap gap-2 justify-center">
                {EXAMPLE_QUERIES.map((q) => (
                  <button
                    key={q}
                    onClick={() => { setQuery(q); handleSearch(q); }}
                    className="px-4 py-2 rounded-full text-sm font-semibold transition-all duration-200 cursor-pointer"
                    style={{
                      background: "#ffffff",
                      border: "1px solid rgba(124,58,237,0.2)",
                      color: "#7c3aed",
                      boxShadow: "0 2px 8px rgba(124,58,237,0.08)",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background =
                        "rgba(124,58,237,0.06)";
                      (e.currentTarget as HTMLButtonElement).style.transform =
                        "translateY(-1px)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background =
                        "#ffffff";
                      (e.currentTarget as HTMLButtonElement).style.transform =
                        "translateY(0)";
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Error state ─────────────────────────────────────────────── */}
        {error && (
          <div
            className="flex items-center gap-3 p-5 rounded-2xl mb-6 max-w-2xl"
            style={{
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.2)",
            }}
          >
            <AlertCircle size={20} style={{ color: "#ef4444" }} className="shrink-0" />
            <div>
              <div className="font-semibold text-red-600 text-sm">Search failed</div>
              <div className="text-xs text-red-500 mt-0.5">{error}</div>
            </div>
          </div>
        )}

        {/* ── Loading skeletons ─────────────────────────────────────── */}
        {loading && (
          <div>
            <div className="flex items-center gap-2 mb-6">
              <RefreshCw size={16} className="animate-spin text-violet-500" />
              <span className="text-sm font-semibold text-slate-500">
                Fetching prices across platforms…
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          </div>
        )}

        {/* ── Results ──────────────────────────────────────────────── */}
        {response && !loading && (
          <>
            {/* Results header */}
            <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-slate-900">
                  Results for{" "}
                  <span
                    style={{
                      background: "linear-gradient(135deg, #7c3aed, #22d3ee)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      backgroundClip: "text",
                    }}
                  >
                    &quot;{response.query}&quot;
                  </span>
                </h2>
                <p className="text-xs text-slate-400 font-medium mt-0.5">
                  {response.total} result{response.total !== 1 ? "s" : ""} across{" "}
                  {response.live_platforms.length > 0
                    ? `${response.live_platforms.length} live + ${response.estimated_platforms.length} estimated`
                    : `${response.estimated_platforms.length} platforms`}
                </p>
              </div>

              {/* Data quality legend */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <CheckCircle2 size={13} className="text-emerald-500" />
                  <span>Live — scraped in real-time</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Info size={13} className="text-amber-500" />
                  <span>Est. — click to verify on platform</span>
                </div>
              </div>
            </div>

            {/* Best price banner */}
            {lowestPrice !== null && activePlatform === "all" && (
              <div
                className="flex items-center gap-3 p-4 rounded-2xl mb-5"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(16,185,129,0.08), rgba(5,150,105,0.05))",
                  border: "1px solid rgba(16,185,129,0.2)",
                }}
              >
                <Tag size={18} className="text-emerald-500 shrink-0" />
                <div>
                  <span className="text-sm font-bold text-emerald-700">
                    Best price found:{" "}
                    <span className="text-xl">₹{lowestPrice.toFixed(2)}</span>
                  </span>
                  <span className="text-xs text-emerald-600 ml-2">
                    on{" "}
                    {
                      filteredResults.find((r) => r.price === lowestPrice)
                        ?.platform
                    }
                  </span>
                </div>
              </div>
            )}

            {/* Platform filter chips */}
            <div className="flex flex-wrap gap-2 mb-6">
              {ALL_PLATFORMS.map((p) => {
                const isActive = activePlatform === p.key;
                const count =
                  p.key === "all"
                    ? response.results.length
                    : response.results.filter((r) => r.platform_key === p.key)
                        .length;
                return (
                  <button
                    key={p.key}
                    id={`filter-${p.key}`}
                    onClick={() => setActivePlatform(p.key)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all duration-150 cursor-pointer"
                    style={{
                      background: isActive ? p.color : "rgba(255,255,255,0.9)",
                      color: isActive
                        ? p.key === "blinkit" || p.key === "amazon_fresh"
                          ? "#1a1a1a"
                          : "#ffffff"
                        : "#475569",
                      border: isActive
                        ? `1.5px solid ${p.color}`
                        : "1.5px solid rgba(0,0,0,0.08)",
                      boxShadow: isActive
                        ? `0 4px 12px rgba(0,0,0,0.15)`
                        : "none",
                      transform: isActive ? "scale(1.05)" : "scale(1)",
                    }}
                  >
                    {p.key !== "all" && (
                      <span>{PLATFORM_META[p.key]?.emoji}</span>
                    )}
                    {p.label}
                    <span
                      className="ml-0.5 text-[10px] opacity-80"
                    >
                      ({count})
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Results grid */}
            {filteredResults.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <p className="text-sm font-medium">No results for this filter.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {filteredResults.map((result, idx) => (
                  <PriceCard key={`${result.platform_key}-${idx}`} result={result} />
                ))}
              </div>
            )}

            {/* Disclaimer */}
            <div
              className="flex items-start gap-2 mt-8 p-4 rounded-xl"
              style={{
                background: "rgba(241,245,249,0.8)",
                border: "1px solid rgba(0,0,0,0.05)",
              }}
            >
              <Info size={14} className="text-slate-400 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-400 font-medium leading-relaxed">
                <strong className="text-slate-500">Data accuracy:</strong>{" "}
                BigBasket prices are scraped live and may occasionally differ
                from the platform due to location-based pricing. Prices for
                Blinkit, Zepto, Instamart, and Amazon Fresh are smart estimates
                based on category pricing models — click{" "}
                <em>&quot;Search on [Platform]&quot;</em> to verify the exact price
                directly. Prices may vary by pincode, time, and availability.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
