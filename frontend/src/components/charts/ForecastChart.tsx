/**
 * components/charts/ForecastChart.tsx
 * =====================================
 * Area chart with forecast line + confidence bands.
 * Uses Recharts AreaChart with gradient fills.
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
  ReferenceLine,
} from "recharts";
import { ForecastPoint } from "@/lib/api";

interface Props {
  data: ForecastPoint[];
  height?: number;
}

export default function ForecastChart({ data, height = 400 }: Props) {
  return (
    <div className="glass rounded-2xl p-6">
      <ResponsiveContainer width="100%" height={height} minWidth={0}>
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="forecastGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="confidenceGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.12)" />

          <XAxis
            dataKey="day_label"
            stroke="#475569"
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke="#475569"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            label={{
              value: "Units",
              angle: -90,
              position: "insideLeft",
              style: { fill: "#64748b", fontSize: 11 },
            }}
          />

          <Tooltip
            contentStyle={{
              background: "rgba(255, 255, 255, 0.95)",
              border: "1px solid rgba(124, 58, 237, 0.15)",
              borderRadius: "12px",
              fontSize: 12,
              color: "#0f172a",
            }}
            formatter={(value, name) => {
              const labels: Record<string, string> = {
                upper_bound: "Upper Bound",
                lower_bound: "Lower Bound",
                predicted_demand: "Predicted Demand",
              };
              return [Number(value).toFixed(1), labels[String(name)] || String(name)];
            }}
          />

          {/* Confidence upper bound */}
          <Area
            type="monotone"
            dataKey="upper_bound"
            stroke="transparent"
            fill="url(#confidenceGradient)"
            fillOpacity={1}
          />

          {/* Confidence lower bound (rendered as a white overlay boundary) */}
          <Area
            type="monotone"
            dataKey="lower_bound"
            stroke="rgba(34,211,238,0.3)"
            strokeDasharray="4 4"
            fill="transparent"
            strokeWidth={1}
          />

          {/* Main forecast line */}
          <Area
            type="monotone"
            dataKey="predicted_demand"
            stroke="#6366f1"
            strokeWidth={2.5}
            fill="url(#forecastGradient)"
            fillOpacity={1}
            dot={{ r: 3, fill: "#6366f1", stroke: "#0a0f1e", strokeWidth: 2 }}
            activeDot={{ r: 5, fill: "#818cf8" }}
          />

          {/* Upper bound line */}
          <Area
            type="monotone"
            dataKey="upper_bound"
            stroke="rgba(34,211,238,0.3)"
            strokeDasharray="4 4"
            fill="transparent"
            strokeWidth={1}
          />

          {/* Weekend markers */}
          {data
            .filter((d) => d.is_weekend)
            .map((d) => (
              <ReferenceLine
                key={d.date}
                x={d.day_label}
                stroke="rgba(245,158,11,0.2)"
                strokeDasharray="3 3"
              />
            ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
