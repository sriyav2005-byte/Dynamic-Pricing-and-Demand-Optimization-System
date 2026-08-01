/**
 * components/agent/AgentResponseCard.tsx
 * ========================================
 * Rich response card for structured agent data.
 * Renders metric highlights and action items.
 */

"use client";

import { AlertTriangle, Tag } from "lucide-react";
import MarketPriceCard from "@/components/agent/MarketPriceCard";

interface Props {
  data: Record<string, unknown> | unknown[] | null;
  dataType: string | null;
}

export default function AgentResponseCard({ data, dataType }: Props) {
  if (!data || !dataType) return null;

  // ── Live Market Price Search ────────────────────────────────────────────────
  if (dataType === "market_price_search") {
    const d = data as Record<string, unknown>;
    const query = typeof d.query === "string" ? d.query : "";
    if (!query) return null;
    return <MarketPriceCard query={query} />;
  }

  if (dataType === "pricing") {
    const d = data as Record<string, unknown>;
    return (
      <div className="glass rounded-xl p-4 mt-3 space-y-2">
        <div className="grid grid-cols-3 gap-3">
          <MetricChip
            label="Current"
            value={`₹${d.current_price}`}
            color="#64748b"
          />
          <MetricChip
            label="Recommended"
            value={`₹${d.recommended_price}`}
            color="#7c3aed"
          />
          <MetricChip
            label="Exp. Profit"
            value={`₹${d.expected_profit}`}
            color="#10b981"
          />
        </div>
        {d.constraint && d.constraint !== "none" ? (
          <div className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg"
            style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b" }}>
            <AlertTriangle size={12} />
            Constraint: {String(d.constraint).replace(/_/g, " ")}
          </div>
        ) : null}
      </div>
    );
  }

  if (dataType === "discount_table" && Array.isArray(data)) {
    const items = data as Array<Record<string, unknown>>;
    if (items.length === 0) return null;
    return (
      <div className="glass rounded-xl p-4 mt-3">
        <div className="space-y-2">
          {items.slice(0, 5).map((item, i) => (
            <div
              key={i}
              className="flex items-center justify-between px-3 py-2 rounded-lg"
              style={{ background: "rgba(0,0,0,0.02)" }}
            >
              <div className="flex items-center gap-2">
                <Tag size={12} style={{ color: "#f59e0b" }} />
                <span className="text-sm text-slate-800 font-semibold">
                  #{String(item.product_id)}
                </span>
                <span className="badge badge-blue capitalize text-xs">
                  {String(item.category)}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold" style={{ color: "#64748b" }}>
                  ₹{Number(item.current_price).toFixed(2)} → ₹{Number(item.suggested_price).toFixed(2)}
                </span>
                <span
                  className="badge"
                  style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444" }}
                >
                  -{String(item.markdown_pct)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (dataType === "expiry_table" && Array.isArray(data)) {
    const items = data as Array<Record<string, unknown>>;
    if (items.length === 0) return null;
    return (
      <div className="glass rounded-xl p-4 mt-3">
        <div className="space-y-2">
          {items.slice(0, 5).map((item, i) => {
            const level = String(item.risk_level);
            const color = level === "critical" ? "#ef4444" : level === "warning" ? "#f59e0b" : "#7c3aed";
            return (
              <div
                key={i}
                className="flex items-center justify-between px-3 py-2 rounded-lg"
                style={{ background: "rgba(0,0,0,0.02)" }}
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle size={12} style={{ color }} />
                  <span className="text-sm text-slate-800 font-semibold">
                    #{String(item.product_id)}
                  </span>
                  <span className="badge capitalize text-xs"
                    style={{ background: `${color}22`, color }}>
                    {level}
                  </span>
                </div>
                <div className="text-xs font-semibold" style={{ color: "#64748b" }}>
                  {String(item.days_to_expiry)}d left · {String(item.stock_level)} units
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return null;
}

function MetricChip({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      className="rounded-lg px-3 py-2 text-center"
      style={{ background: "rgba(0,0,0,0.03)" }}
    >
      <div className="text-xs mb-0.5" style={{ color: "#64748b" }}>
        {label}
      </div>
      <div className="text-sm font-bold" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
