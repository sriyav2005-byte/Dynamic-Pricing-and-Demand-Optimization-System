/**
 * app/forecasting/page.tsx — Demand Forecasting Dashboard
 * =========================================================
 * Forecast visualisation with area charts, confidence bands,
 * product selector, and forecast summary metrics.
 */

"use client";

import { useEffect, useState } from "react";
import {
  getProducts,
  getDemandForecast,
  getForecastOverview,
  getProductName,
  Product,
  DemandForecast,
  ForecastOverviewItem,
} from "@/lib/api";
import ForecastChart from "@/components/charts/ForecastChart";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Calendar,
  BarChart3,
  Sun,
  RefreshCw,
} from "lucide-react";

export default function ForecastingPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [horizon, setHorizon] = useState(7);
  const [forecast, setForecast] = useState<DemandForecast | null>(null);
  const [overview, setOverview] = useState<ForecastOverviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);

  // Initial load
  useEffect(() => {
    (async () => {
      try {
        const [prods, ov] = await Promise.all([
          getProducts(),
          getForecastOverview(),
        ]);
        setProducts(prods);
        setOverview(ov);

        if (prods.length > 0) {
          setSelectedId(prods[0].product_id);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Load forecast when product or horizon changes
  useEffect(() => {
    if (selectedId === null) return;
    setChartLoading(true);
    getDemandForecast(selectedId, horizon)
      .then(setForecast)
      .catch(console.error)
      .finally(() => setChartLoading(false));
  }, [selectedId, horizon]);

  const trendIcon = (dir: string) => {
    if (dir === "increasing") return <TrendingUp size={14} style={{ color: "#10b981" }} />;
    if (dir === "decreasing") return <TrendingDown size={14} style={{ color: "#ef4444" }} />;
    return <Minus size={14} style={{ color: "#94a3b8" }} />;
  };

  const trendColor = (dir: string) => {
    if (dir === "increasing") return "#10b981";
    if (dir === "decreasing") return "#ef4444";
    return "#94a3b8";
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-slate-900 mb-2">
          <span className="gradient-text">Demand Forecasting</span>
        </h1>
        <p className="text-sm text-slate-500 font-medium">
          XGBoost-powered demand predictions with confidence intervals
        </p>
      </div>

      {/* Controls */}
      <div className="bg-white border border-slate-200/60 rounded-2xl p-4 mb-6 flex flex-wrap gap-3 items-center shadow-sm">
        <div className="flex items-center gap-2">
          <BarChart3 size={16} className="text-slate-400" />
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">PRODUCT:</span>
        </div>
        <select
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(Number(e.target.value))}
          className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-700 bg-white outline-none cursor-pointer focus:border-violet-500 transition-colors"
        >
          {products.map((p) => {
            const name = p.name || p.product_name || getProductName(p.product_id, undefined, p.category);
            return (
              <option key={p.product_id} value={p.product_id} className="bg-white text-slate-800">
                {name} (#{p.product_id})
              </option>
            );
          })}
        </select>

        <div className="flex items-center gap-2 ml-4">
          <Calendar size={16} className="text-slate-400" />
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">HORIZON:</span>
        </div>
        <div className="flex gap-1">
          {[7, 14, 30].map((h) => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer"
              style={{
                background: horizon === h ? "rgba(124,58,237,0.12)" : "transparent",
                color: horizon === h ? "#7c3aed" : "#64748b",
                border: `1px solid ${horizon === h ? "rgba(124,58,237,0.2)" : "rgba(0,0,0,0.08)"}`,
              }}
            >
              {h}d
            </button>
          ))}
        </div>
      </div>

      {/* Forecast Summary Cards */}
      {forecast && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="stat-card">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Total Predicted</div>
            <div className="text-2xl font-extrabold text-slate-800">
              {forecast.total_predicted_demand.toFixed(0)}
            </div>
            <div className="text-[10px] font-semibold text-slate-500 mt-1">units over {horizon}d</div>
          </div>

          <div className="stat-card">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Daily Average</div>
            <div className="text-2xl font-extrabold text-slate-800">
              {forecast.avg_daily_demand.toFixed(1)}
            </div>
            <div className="text-[10px] font-semibold text-slate-500 mt-1">units/day</div>
          </div>

          <div className="stat-card">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Trend</div>
            <div className="flex items-center gap-2">
              {trendIcon(forecast.trend_direction)}
              <span className="text-lg font-bold capitalize" style={{ color: trendColor(forecast.trend_direction) }}>
                {forecast.trend_direction}
              </span>
            </div>
            <div className="text-[10px] font-semibold text-slate-500 mt-1">
              Peak: {forecast.peak_day}
            </div>
          </div>

          <div className="stat-card">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Season</div>
            <div className="flex items-center gap-2">
              <Sun size={16} className="text-[#f59e0b] fill-amber-100" />
              <span className="text-lg font-bold text-slate-800">
                ×{forecast.season_factor.toFixed(2)}
              </span>
            </div>
            <div className="text-[10px] font-semibold capitalize text-[#d97706] mt-1">
              {forecast.seasonal_impact.replace(/_/g, " ")}
            </div>
          </div>
        </div>
      )}

      {/* Forecast Chart */}
      {chartLoading ? (
        <div className="bg-white border border-slate-200/60 rounded-2xl flex items-center justify-center py-20 shadow-sm">
          <div className="text-center">
            <div className="w-10 h-10 border-2 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-400">Generating forecast...</p>
          </div>
        </div>
      ) : forecast ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <span>{forecast.product_name || getProductName(selectedId)}</span>
              <span className="text-xs font-mono font-normal text-slate-400">#{selectedId}</span>
            </h2>
            <span className="text-xs text-slate-400 font-medium">Daily Predicted Demand & Confidence Bounds</span>
          </div>
          <ForecastChart data={forecast.forecast_points} />
        </div>
      ) : null}

      {/* Overview Table */}
      <div className="mt-8">
        <h2 className="text-lg font-extrabold text-slate-800 mb-4">All Products — 7-Day Forecast Summary</h2>
        <div className="bg-white border border-slate-200/60 rounded-2xl overflow-hidden shadow-sm">
          <table className="data-table w-full">
            <thead>
              <tr>
                <th className="text-left">Product</th>
                <th className="text-left">Category</th>
                <th className="text-right">Price</th>
                <th className="text-right">7d Demand</th>
                <th className="text-right">Avg/Day</th>
                <th className="text-center">Trend</th>
                <th className="text-center">Season</th>
                <th className="text-left">Peak Day</th>
              </tr>
            </thead>
            <tbody>
              {overview.map((item) => (
                <tr
                  key={item.product_id}
                  className="cursor-pointer"
                  onClick={() => setSelectedId(item.product_id)}
                  style={{
                    background: selectedId === item.product_id ? "rgba(124,58,237,0.06)" : undefined,
                  }}
                >
                  <td className="font-semibold text-slate-800">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
                        style={{ background: "rgba(124,58,237,0.08)", color: "#7c3aed" }}
                      >
                        #{item.product_id}
                      </div>
                      <span className="line-clamp-1">
                        {item.product_name || getProductName(item.product_id, undefined, item.category)}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-blue capitalize">{item.category}</span>
                  </td>
                  <td className="text-right text-slate-700 font-semibold">
                    ₹{item.current_price.toFixed(2)}
                  </td>
                  <td className="text-right font-bold text-cyan-600">
                    {item.total_7d_demand.toFixed(0)}
                  </td>
                  <td className="text-right text-slate-500 font-medium">
                    {item.avg_daily_demand.toFixed(1)}
                  </td>
                  <td className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      {trendIcon(item.trend_direction)}
                      <span className="text-xs capitalize" style={{ color: trendColor(item.trend_direction) }}>
                        {item.trend_direction}
                      </span>
                    </div>
                  </td>
                  <td className="text-center">
                    <span
                      className="badge capitalize"
                      style={{
                        background: item.seasonal_impact === "high_season"
                          ? "rgba(245,158,11,0.12)"
                          : "rgba(0,0,0,0.02)",
                        color: item.seasonal_impact === "high_season" ? "#d97706" : "#64748b",
                        border: item.seasonal_impact === "high_season" ? "1px solid rgba(245,158,11,0.15)" : "1px solid rgba(0,0,0,0.05)"
                      }}
                    >
                      {item.seasonal_impact.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="text-xs text-slate-500 font-semibold">{item.peak_day}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
