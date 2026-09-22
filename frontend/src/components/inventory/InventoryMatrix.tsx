/**
 * components/inventory/InventoryMatrix.tsx
 * ==========================================
 * Scatter plot: X = days_to_expiry, Y = stock_level
 * Dots colored by risk zone (red/amber/green).
 */

"use client";

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts";
import { Product, getProductName } from "@/lib/api";

interface Props {
  products: Product[];
  height?: number;
}

export default function InventoryMatrix({ products, height = 400 }: Props) {
  // Classify products into risk zones
  const critical = products
    .filter((p) => p.days_to_expiry < 7 && p.stock_level > 50)
    .map((p) => ({
      x: p.days_to_expiry,
      y: p.stock_level,
      id: p.product_id,
      name: p.name || p.product_name || getProductName(p.product_id, undefined, p.category),
      category: p.category,
    }));

  const warning = products
    .filter(
      (p) =>
        (p.days_to_expiry < 7 && p.stock_level <= 50) ||
        (p.days_to_expiry >= 7 && p.days_to_expiry < 14 && p.stock_level > 100)
    )
    .map((p) => ({
      x: p.days_to_expiry,
      y: p.stock_level,
      id: p.product_id,
      name: p.name || p.product_name || getProductName(p.product_id, undefined, p.category),
      category: p.category,
    }));

  const healthy = products
    .filter(
      (p) =>
        !critical.some((c) => c.id === p.product_id) &&
        !warning.some((w) => w.id === p.product_id)
    )
    .map((p) => ({
      x: p.days_to_expiry,
      y: p.stock_level,
      id: p.product_id,
      name: p.name || p.product_name || getProductName(p.product_id, undefined, p.category),
      category: p.category,
    }));

  return (
    <div className="glass rounded-2xl p-6">
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.12)" />

          <XAxis
            type="number"
            dataKey="x"
            name="Days to Expiry"
            stroke="#475569"
            fontSize={11}
            tickLine={false}
            label={{
              value: "Days to Expiry →",
              position: "insideBottom",
              offset: -5,
              style: { fill: "#64748b", fontSize: 11 },
            }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="Stock Level"
            stroke="#475569"
            fontSize={11}
            tickLine={false}
            label={{
              value: "Stock Level →",
              angle: -90,
              position: "insideLeft",
              style: { fill: "#64748b", fontSize: 11 },
            }}
          />

          {/* Background risk zones */}
          <ReferenceArea
            x1={0}
            x2={7}
            y1={50}
            y2={200}
            fill="rgba(239,68,68,0.06)"
            stroke="rgba(239,68,68,0.15)"
            strokeDasharray="4 4"
          />
          <ReferenceArea
            x1={0}
            x2={7}
            y1={0}
            y2={50}
            fill="rgba(245,158,11,0.06)"
            stroke="rgba(245,158,11,0.15)"
            strokeDasharray="4 4"
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
              if (String(name) === "x") return [Number(value), "Days to Expiry"];
              if (String(name) === "y") return [Number(value), "Stock Level"];
              return [Number(value), String(name)];
            }}
            labelFormatter={(_, payload) => {
              if (payload && payload[0]) {
                const d = payload[0].payload;
                return `${d.name || getProductName(d.id)} (#${d.id} · ${d.category})`;
              }
              return "";
            }}
          />

          <Scatter name="Critical" data={critical} fill="#ef4444" opacity={0.8} />
          <Scatter name="Warning" data={warning} fill="#f59e0b" opacity={0.8} />
          <Scatter name="Healthy" data={healthy} fill="#10b981" opacity={0.6} />
        </ScatterChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 mt-4">
        {[
          { label: "Critical (expiring + high stock)", color: "#ef4444" },
          { label: "Warning", color: "#f59e0b" },
          { label: "Healthy", color: "#10b981" },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ background: item.color }} />
            <span className="text-xs" style={{ color: "#94a3b8" }}>
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
