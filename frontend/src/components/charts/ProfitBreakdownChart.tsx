/**
 * components/charts/ProfitBreakdownChart.tsx — Top Products Bar Chart
 * =====================================================================
 * Renders a bar chart comparing cumulative profit across the top 5 products.
 * Used on the Analytics page below the trend chart.
 *
 * Data source: AnalyticsSummary.top_products
 *   [{ product_id: 7, total_profit: 4820.00 }, ...]
 *
 * Design
 * ------
 * Each bar gets a unique colour from a 5-colour palette so products are
 * visually distinct without needing a legend.
 * Bars have rounded top corners (radius={[6,6,0,0]}) for a modern look.
 * No vertical grid lines — horizontal grid only to keep it clean.
 */

"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

import { getProductName } from "@/lib/api";

interface Props {
  data: { product_id: number; product_name?: string; total_profit: number }[];
}

/** 5-colour palette — one per bar.  Stays consistent on re-renders. */
const COLORS = ["#6366f1", "#22d3ee", "#10b981", "#f59e0b", "#ec4899"];

/** Custom dark-themed tooltip showing product name, ID and profit. */
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const name = payload[0]?.payload?.product_name || getProductName(label);

  return (
    <div
      className="glass rounded-xl p-3"
      style={{ border: "1px solid rgba(99,102,241,0.3)" }}
    >
      <p className="text-xs text-slate-800 font-bold mb-0.5">{name}</p>
      <p className="text-[11px] text-slate-400 font-mono mb-1.5">Product #{label}</p>
      <p className="text-sm font-bold text-violet-600">₹{payload[0].value.toFixed(0)}</p>
    </div>
  );
};

export default function ProfitBreakdownChart({ data }: Props) {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>

        {/* Horizontal grid lines only — vertical=false removes the clutter */}
        <CartesianGrid stroke="rgba(148, 163, 184, 0.12)" vertical={false} />

        {/* X axis: product name (shortened) */}
        <XAxis
          dataKey="product_id"
          stroke="#475569"
          tick={{ fontSize: 10, fill: "#64748b" }}
          tickFormatter={(v) => {
            const entry = data.find((d) => d.product_id === v);
            const name = entry?.product_name || getProductName(v);
            // Shorten to first word or first 12 chars
            const short = name.split(" ")[0];
            return short.length > 12 ? short.slice(0, 11) + "…" : short;
          }}
          interval={0}
          angle={-15}
          textAnchor="end"
          height={50}
        />

        {/* Y axis: profit in ₹ — auto-scaled */}
        <YAxis stroke="#475569" tick={{ fontSize: 11, fill: "#64748b" }} />

        <Tooltip content={<CustomTooltip />} />

        {/* Single bar series coloured per product via Cell children */}
        <Bar dataKey="total_profit" radius={[6, 6, 0, 0]} name="Profit">
          {data.map((_, i) => (
            // Each bar gets a different colour from the COLORS palette
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
