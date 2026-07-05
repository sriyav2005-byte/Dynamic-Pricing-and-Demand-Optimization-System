/**
 * app/competitors/page.tsx — Competitor Analysis Dashboard
 * ==========================================================
 * Full competitor intelligence view with price comparison table,
 * competitiveness scores, and market overview metrics.
 */

"use client";

import { useEffect, useState } from "react";
import {
  getMarketOverview,
  MarketOverviewItem,
} from "@/lib/api";
import CompetitorTable from "@/components/competitor/CompetitorTable";
import CompetitivenessGauge from "@/components/competitor/CompetitivenessGauge";
import {
  ShieldCheck,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Target,
  Award,
} from "lucide-react";

export default function CompetitorsPage() {
  const [data, setData] = useState<MarketOverviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("");

  const loadData = async () => {
    setLoading(true);
    try {
      const overview = await getMarketOverview();
      setData(overview);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filtered = categoryFilter
    ? data.filter((d) => d.category === categoryFilter)
    : data;

  // Compute aggregate metrics
  const avgScore =
    filtered.length > 0
      ? filtered.reduce((s, d) => s + d.competitiveness_score, 0) / filtered.length
      : 0;
  const cheapestCount = filtered.filter((d) => d.price_position === "cheapest").length;
  const expensiveCount = filtered.filter(
    (d) => d.price_position === "most_expensive" || d.price_position === "above_average"
  ).length;
  const categories = [...new Set(data.map((d) => d.category))];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-slate-900 mb-2">
          <span className="gradient-text">Competitor Analysis</span>
        </h1>
        <p className="text-sm text-slate-500 font-medium">
          Price intelligence across Blinkit, Zepto, Instamart, and BigBasket
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="stat-card flex items-center gap-4">
          <CompetitivenessGauge score={avgScore} size={80} />
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">
              Avg Competitiveness
            </div>
            <div className="text-xl font-extrabold text-slate-800">
              {avgScore.toFixed(0)}/100
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center gap-2 mb-2">
            <Award size={16} className="text-emerald-500" />
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Cheapest Position
            </span>
          </div>
          <div className="text-2xl font-extrabold text-slate-800">{cheapestCount}</div>
          <div className="text-xs font-semibold text-emerald-600 mt-1">
            products priced lowest
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={16} className="text-red-500" />
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Above Market
            </span>
          </div>
          <div className="text-2xl font-extrabold text-slate-800">{expensiveCount}</div>
          <div className="text-xs font-semibold text-red-500 mt-1">
            products above avg
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center gap-2 mb-2">
            <Target size={16} className="text-cyan-500" />
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Platforms Tracked
            </span>
          </div>
          <div className="text-2xl font-extrabold text-slate-800">4</div>
          <div className="text-xs font-semibold text-cyan-600 mt-1">
            Blinkit · Zepto · Instamart · BigBasket
          </div>
        </div>
      </div>

      {/* Platform Legend */}
      <div className="bg-white border border-slate-200/60 rounded-2xl p-4 mb-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Platforms:
          </span>
          {[
            { name: "Blinkit", color: "#F7CB45" },
            { name: "Zepto", color: "#7B2FF7" },
            { name: "Swiggy Instamart", color: "#FC8019" },
            { name: "BigBasket", color: "#84C225" },
          ].map((p) => (
            <div key={p.name} className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
              <span className="text-xs font-semibold text-slate-600">{p.name}</span>
            </div>
          ))}

          <div className="ml-auto flex items-center gap-2">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 bg-white outline-none cursor-pointer focus:border-violet-500 transition-colors"
            >
              <option value="" className="bg-white text-slate-800">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c} className="bg-white text-slate-800 capitalize">{c}</option>
              ))}
            </select>

            <button
              onClick={loadData}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold glow-btn text-white cursor-pointer"
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Main Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="w-10 h-10 border-2 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-400">
              Fetching competitor prices...
            </p>
          </div>
        </div>
      ) : (
        <CompetitorTable data={filtered} />
      )}

      <div className="mt-4 text-xs text-slate-400 font-medium">
        Comparing {filtered.length} products across 4 platforms
      </div>
    </div>
  );
}
