/**
 * components/agent/MarketPriceCard.tsx
 * ======================================
 * Real-time market price comparison card for the AI Agent chat.
 *
 * Shows live prices fetched from Blinkit, Zepto, Swiggy Instamart,
 * BigBasket, Amazon, and more — in a premium platform grid layout.
 *
 * Features
 * --------
 * - Animated loading skeleton while the backend scrapes prices
 * - Per-platform price tiles with brand colors & emoji
 * - "Cheapest" green ribbon on the lowest-priced result
 * - Price range summary (min → max)
 * - Clickable "View" link to the actual product page
 * - Empty/error state when no results found
 */

"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ExternalLink,
  TrendingDown,
  Search,
  RefreshCw,
  AlertCircle,
  Zap,
} from "lucide-react";
import { searchMarketPrices, MarketPriceResult } from "@/lib/api";

interface Props {
  query: string;
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function PriceSkeleton() {
  return (
    <div className="mt-3 rounded-2xl overflow-hidden border border-slate-100 bg-white shadow-sm">
      {/* Header skeleton */}
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <div className="w-4 h-4 rounded bg-slate-200 animate-pulse" />
        <div className="h-3 w-32 rounded bg-slate-200 animate-pulse" />
        <div className="ml-auto h-3 w-20 rounded bg-slate-100 animate-pulse" />
      </div>
      {/* Grid skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="rounded-xl p-3 bg-slate-50 border border-slate-100 animate-pulse"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <div className="flex items-center gap-1.5 mb-2">
              <div className="w-5 h-5 rounded-full bg-slate-200" />
              <div className="h-2.5 w-16 rounded bg-slate-200" />
            </div>
            <div className="h-5 w-14 rounded bg-slate-200 mb-1" />
            <div className="h-2 w-10 rounded bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function NoResults({ query, onRetry }: { query: string; onRetry: () => void }) {
  return (
    <div className="mt-3 rounded-2xl border border-slate-100 bg-white p-6 text-center shadow-sm">
      <AlertCircle size={28} className="mx-auto mb-2 text-slate-300" />
      <p className="text-sm font-semibold text-slate-600 mb-1">
        No prices found for &ldquo;{query}&rdquo;
      </p>
      <p className="text-xs text-slate-400 mb-3">
        Try a more specific query like &ldquo;amul butter 500g&rdquo; or &ldquo;tata salt 1kg&rdquo;
      </p>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:scale-[1.02] cursor-pointer"
        style={{
          background: "rgba(124,58,237,0.08)",
          border: "1px solid rgba(124,58,237,0.15)",
          color: "#7c3aed",
        }}
      >
        <RefreshCw size={12} />
        Retry Search
      </button>
    </div>
  );
}

// ── Price tile ────────────────────────────────────────────────────────────────

function PriceTile({ result }: { result: MarketPriceResult }) {
  return (
    <a
      href={result.url !== "#" ? result.url : undefined}
      target="_blank"
      rel="noopener noreferrer"
      className="relative flex flex-col rounded-xl p-3 transition-all hover:scale-[1.02] hover:shadow-md cursor-pointer no-underline group"
      style={{
        background: result.bg || "#f8fafc",
        border: `1.5px solid ${result.color}22`,
      }}
    >
      {/* Cheapest badge */}
      {result.is_cheapest && (
        <div
          className="absolute -top-2 -right-2 flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold shadow-sm"
          style={{ background: "#10b981", color: "#fff" }}
        >
          <TrendingDown size={9} />
          Best
        </div>
      )}

      {/* Platform header */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-base leading-none">{result.emoji}</span>
        <span
          className="text-[11px] font-bold truncate"
          style={{ color: result.color }}
        >
          {result.platform}
        </span>
      </div>

      {/* Price */}
      <div
        className="text-lg font-extrabold leading-tight"
        style={{ color: result.is_cheapest ? "#10b981" : "#1e293b" }}
      >
        ₹{result.price.toFixed(2)}
      </div>

      {/* Unit */}
      {result.unit && (
        <div className="text-[10px] text-slate-400 font-medium mt-0.5 truncate">
          {result.unit}
        </div>
      )}

      {/* View link icon */}
      {result.url && result.url !== "#" && (
        <div className="mt-2 flex items-center gap-1 text-[10px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: result.color }}
        >
          <ExternalLink size={10} />
          View
        </div>
      )}
    </a>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MarketPriceCard({ query }: Props) {
  const [results, setResults] = useState<MarketPriceResult[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);

  const fetchPrices = useCallback(async () => {
    setLoading(true);
    setError(false);
    setResults(null);
    try {
      const data = await searchMarketPrices(query);
      setResults(data.results);
      setFetchedAt(new Date());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    fetchPrices();
  }, [fetchPrices]);

  if (loading) return <PriceSkeleton />;
  if (error || !results) return (
    <NoResults query={query} onRetry={fetchPrices} />
  );
  if (results.length === 0) return (
    <NoResults query={query} onRetry={fetchPrices} />
  );

  const cheapest = results.find((r) => r.is_cheapest);
  const prices = results.map((r) => r.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  return (
    <div
      className="mt-3 rounded-2xl overflow-hidden shadow-sm"
      style={{ border: "1px solid rgba(0,0,0,0.06)", background: "#fff" }}
    >
      {/* Header */}
      <div
        className="px-4 py-3 border-b flex items-center gap-2"
        style={{
          borderColor: "rgba(0,0,0,0.05)",
          background: "linear-gradient(135deg,rgba(124,58,237,0.04),rgba(34,211,238,0.04))",
        }}
      >
        <div
          className="w-6 h-6 rounded-lg flex items-center justify-center"
          style={{ background: "linear-gradient(135deg,#7c3aed,#22d3ee)" }}
        >
          <Zap size={12} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-slate-700 flex items-center gap-1">
            <Search size={10} className="text-slate-400" />
            Estimated prices for &ldquo;
            <span className="text-[#7c3aed]">{query}</span>&rdquo;
          </div>
          {fetchedAt && (
            <div className="text-[10px] text-slate-400 mt-0.5">
              Estimated at {fetchedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              &nbsp;·&nbsp;{results.length} platform{results.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>
        <button
          onClick={fetchPrices}
          className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-slate-100 transition-colors cursor-pointer"
          title="Refresh prices"
        >
          <RefreshCw size={11} className="text-slate-400" />
        </button>
      </div>

      {/* Price summary strip */}
      {cheapest && (
        <div
          className="px-4 py-2 flex items-center gap-3 text-xs"
          style={{ background: "rgba(16,185,129,0.04)", borderBottom: "1px solid rgba(16,185,129,0.08)" }}
        >
          <TrendingDown size={12} style={{ color: "#10b981" }} />
          <span className="font-semibold text-slate-600">
            Cheapest:&nbsp;
            <span style={{ color: "#10b981" }}>{cheapest.platform}</span>
            &nbsp;at&nbsp;
            <span className="font-extrabold" style={{ color: "#10b981" }}>
              ₹{cheapest.price.toFixed(2)}
            </span>
          </span>
          {minPrice !== maxPrice && (
            <span className="text-slate-400">
              Range: ₹{minPrice.toFixed(2)} – ₹{maxPrice.toFixed(2)}
            </span>
          )}
        </div>
      )}

      {/* Platform price grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3">
        {results.map((result, i) => (
          <PriceTile key={`${result.platform_key}-${i}`} result={result} />
        ))}
      </div>

      {/* Footer */}
      <div
        className="px-4 py-2 text-center border-t"
        style={{ borderColor: "rgba(0,0,0,0.04)" }}
      >
        <span className="text-[10px] text-slate-400">
          Estimated based on typical platform pricing · Not live-scraped data
        </span>
      </div>
    </div>
  );
}
