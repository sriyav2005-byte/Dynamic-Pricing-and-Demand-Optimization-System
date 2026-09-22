/**
 * components/charts/SalesTrendChart.tsx — Revenue & Profit Area Chart
 * =====================================================================
 * Renders a time-series area chart showing daily revenue and profit.
 * Used on the Analytics page.
 *
 * Library: Recharts (built on SVG via D3 scales)
 *
 * Data shape (from GET /analytics/trends):
 *   [{ date: "2024-01-15", revenue: 12340.50, profit: 3210.00, units: 87 }, ...]
 *
 * Design choices
 * --------------
 * - Area (filled) chart rather than line-only to give visual weight to
 *   the trend and make the revenue vs profit gap easy to read.
 * - Gradient fills (top 30% opacity → 0%) so charts don't look "heavy".
 * - Custom tooltip renders inside a glass-morphism card to match the app theme.
 * - Revenue = indigo (#6366f1), Profit = cyan (#22d3ee) — consistent with
 *   the colour palette used everywhere in the dashboard.
 */

"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface Props {
  data: { date: string; revenue: number; profit: number; units: number }[];
}

/**
 * Custom tooltip component — replaces Recharts' default tooltip.
 * Renders a dark glass card positioned near the hovered data point.
 */
const CustomTooltip = ({ active, payload, label }: any) => {
  // `active` is false when the mouse is not over the chart
  if (!active || !payload?.length) return null;

  return (
    <div
      className="glass rounded-xl p-3"
      style={{ border: "1px solid rgba(99,102,241,0.3)" }}
    >
      <p className="text-xs text-slate-500 font-bold mb-2">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="text-sm font-semibold" style={{ color: p.color }}>
          {/* Units are displayed as a plain number; currency values get ₹ prefix */}
          {p.name}: {p.dataKey === "units" ? p.value : `₹${p.value.toFixed(0)}`}
        </p>
      ))}
    </div>
  );
};

export default function SalesTrendChart({ data }: Props) {
  return (
    /*
     * ResponsiveContainer makes the SVG fill its parent's width automatically.
     * Height is fixed at 300px — adjust in the parent if needed.
     */
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>

        {/* ── SVG gradient definitions ────────────────────────────────── */}
        {/* These gradients are referenced by fill="url(#id)" on each Area */}
        <defs>
          <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="profGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#22d3ee" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* Subtle grid lines — very low opacity to avoid visual clutter */}
        <CartesianGrid stroke="rgba(148, 163, 184, 0.12)" />

        {/* X axis: date strings, dark slate colour to match the theme */}
        <XAxis dataKey="date" stroke="#475569" tick={{ fontSize: 11, fill: "#64748b" }} />

        {/* Y axis: auto-scaled to fit data range */}
        <YAxis stroke="#475569" tick={{ fontSize: 11, fill: "#64748b" }} />

        <Tooltip content={<CustomTooltip />} />
        <Legend wrapperStyle={{ fontSize: "12px", color: "#94a3b8" }} />

        {/* Revenue area — indigo, sits behind profit visually */}
        <Area
          type="monotone"
          dataKey="revenue"
          stroke="#6366f1"
          strokeWidth={2}
          fill="url(#revGrad)"
          name="Revenue"
        />

        {/* Profit area — cyan, smaller magnitude than revenue */}
        <Area
          type="monotone"
          dataKey="profit"
          stroke="#22d3ee"
          strokeWidth={2}
          fill="url(#profGrad)"
          name="Profit"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
