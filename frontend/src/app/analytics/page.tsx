/**
 * app/analytics/page.tsx — Analytics & Reporting Page
 * ====================================================
 * Business intelligence view showing the cumulative impact of the
 * pricing system.  All data is derived from the `sales` table which
 * is populated every time a recommendation is applied.
 *
 * Sections
 * --------
 * 1. KPI cards (5)     : Revenue, Profit, Units Sold, Avg Margin, At-Risk
 * 2. Revenue & Profit trend chart (2/3 width) + Top Products leaderboard (1/3)
 * 3. Profit Breakdown bar chart — top 5 products side by side
 *
 * Empty state
 * -----------
 * If no sales have been recorded yet (fresh install), the trend chart
 * shows a placeholder message.  Once the user applies at least one
 * recommendation from the Dashboard, data starts appearing here.
 *
 * Currency formatting
 * -------------------
 * `fmtCurrency` shortens large numbers: ₹42500 → ₹42.5K
 * to prevent number overflow in the narrow KPI card labels.
 */
"use client";
import { useEffect, useState } from "react";
import { getAnalyticsSummary, getAnalyticsTrends, getProductName, AnalyticsSummary, TrendPoint } from "@/lib/api";
import StatCard from "@/components/ui/StatCard";
import SalesTrendChart from "@/components/charts/SalesTrendChart";
import ProfitBreakdownChart from "@/components/charts/ProfitBreakdownChart";
import {
  DollarSign,
  TrendingUp,
  ShoppingCart,
  Percent,
  AlertTriangle,
  BarChart3,
  Package,
  RefreshCw,
} from "lucide-react";

export default function AnalyticsPage() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);

  /**
   * Fetch both summary KPIs and trend time-series in parallel.
   * Both endpoints are independent reads so firing them together halves latency.
   */
  const load = async () => {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([getAnalyticsSummary(), getAnalyticsTrends()]);
      setSummary(s);
      setTrends(t);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  /** Compact currency formatter: values ≥ ₹1000 are shown as e.g. "₹42.5K". */
  const fmtCurrency = (n: number) =>
    n >= 1000 ? `₹${(n / 1000).toFixed(1)}K` : `₹${n.toFixed(0)}`;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 mb-1">
            <span className="gradient-text">Analytics</span>
          </h1>
          <p className="text-sm text-slate-500 font-medium">Sales performance, trends, and inventory insights</p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold glow-btn text-white cursor-pointer"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <div className="w-12 h-12 border-2 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-sm text-slate-400 font-medium">Loading analytics...</p>
          </div>
        </div>
      ) : (
        <>
          {/*
           * KPI stat cards — 5 across on large screens, 2-per-row on mobile.
           * The "At Risk" card turns red if any products are expiring soon,
           * giving store managers an immediate visual alert.
           */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
            {summary && (
              <>
                <StatCard
                  title="Total Revenue"
                  value={fmtCurrency(summary.total_revenue)}
                  icon={DollarSign}
                  accentColor="#7c3aed"
                  trend="up"
                  trendValue="Live"
                />
                <StatCard
                  title="Total Profit"
                  value={fmtCurrency(summary.total_profit)}
                  icon={TrendingUp}
                  accentColor="#10b981"
                  trend="up"
                />
                <StatCard
                  title="Units Sold"
                  value={summary.total_units_sold.toLocaleString()}
                  icon={ShoppingCart}
                  accentColor="#22d3ee"
                />
                <StatCard
                  title="Avg Margin"
                  value={`${summary.avg_margin_pct.toFixed(1)}%`}
                  icon={Percent}
                  accentColor="#f59e0b"
                />
                <StatCard
                  title="At Risk"
                  value={summary.products_at_risk}
                  subtitle="Expiring < 7 days"
                  icon={AlertTriangle}
                  accentColor={summary.products_at_risk > 0 ? "#ef4444" : "#10b981"}
                />
              </>
            )}
          </div>

          <div className="grid grid-cols-3 gap-6 mb-6">
            {/* Sales Trend */}
            <div className="col-span-2 bg-white border border-slate-200/60 rounded-2xl p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-5">
                <BarChart3 size={18} className="text-violet-600" />
                <h2 className="font-extrabold text-slate-800 text-base">Revenue & Profit Trend</h2>
                {trends.length === 0 && (
                  <span className="ml-auto badge badge-amber">No data yet — apply some recommendations!</span>
                )}
              </div>
              {trends.length > 0 ? (
                <SalesTrendChart data={trends} />
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <BarChart3 size={40} className="mb-3 opacity-30" />
                  <p className="text-sm">Sales data will appear here after applying price recommendations.</p>
                </div>
              )}
            </div>

            {/* Top Products */}
            <div className="bg-white border border-slate-200/60 rounded-2xl p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-5">
                <Package size={18} className="text-cyan-600" />
                <h2 className="font-extrabold text-slate-800 text-base">Top Products</h2>
              </div>
              {/*
               * Leaderboard: rank badge (gold/silver/bronze) + product name
               * + gradient progress bar scaled to the #1 product's profit
               * + profit value.  Only shown when sales data exists.
               */}
              {summary && summary.top_products.length > 0 ? (
                <div className="space-y-3">
                  {summary.top_products.map((p, i) => (
                    <div key={p.product_id} className="flex items-center gap-3">
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                        style={{
                          background: `rgba(${i === 0 ? "245,158,11" : i === 1 ? "148,163,184" : "180,100,60"},0.12)`,
                          color: i === 0 ? "#d97706" : i === 1 ? "#475569" : "#b46c3c",
                          border: `1px solid rgba(${i === 0 ? "245,158,11" : i === 1 ? "148,163,184" : "180,100,60"},0.15)`
                        }}
                      >
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-800 truncate" title={p.product_name || getProductName(p.product_id)}>
                          {p.product_name || getProductName(p.product_id)}
                        </div>
                        <div className="w-full h-1 rounded-full mt-1 bg-slate-100">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${(p.total_profit / summary.top_products[0].total_profit) * 100}%`,
                              background: "linear-gradient(90deg, #7c3aed, #22d3ee)",
                            }}
                          />
                        </div>
                      </div>
                      <div className="text-sm font-bold text-emerald-600">
                        ₹{p.total_profit.toFixed(0)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-slate-400">
                  <Package size={32} className="mx-auto mb-2 opacity-45" />
                  <p className="text-sm">No sales data yet</p>
                </div>
              )}
            </div>
          </div>

          {/* Profit Breakdown Bar Chart */}
          {summary && summary.top_products.length > 0 && (
            <div className="bg-white border border-slate-200/60 rounded-2xl p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-5">
                <TrendingUp size={18} className="text-emerald-500" />
                <h2 className="font-extrabold text-slate-800 text-base">Profit Breakdown by Product</h2>
              </div>
              <ProfitBreakdownChart data={summary.top_products} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
