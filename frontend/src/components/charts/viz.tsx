"use client";

/**
 * components/charts/viz.tsx — every chart in PriceIQ.
 *
 * Rules (see dataviz method): colour follows the entity in a fixed order and
 * is never cycled; one y-axis per chart (demand and money are never mixed on
 * a dual axis); 2px lines; recessive grid; tooltips on hover; legends for
 * ≥2 series. The categorical palette below was validated for CVD separation
 * (worst adjacent ΔE 9.1); three slots are < 3:1 against white, so every
 * multi-series chart carries a legend/tooltip and a table view nearby.
 */

import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, ReferenceArea, ReferenceDot, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { compactInr, inr } from "@/lib/api";

export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"] as const;
/** Fixed identity colours: our price is always slot 1, platforms follow in a fixed order. */
export const ENTITY_COLOR: Record<string, string> = {
  ours: SERIES[0], blinkit: SERIES[1], zepto: SERIES[2], instamart: SERIES[3], bigbasket: SERIES[4],
};
const GRID = "#eef1f5";
const AXIS = { fontSize: 11, fill: "#64748b" };
const TIP = { contentStyle: { borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12, boxShadow: "0 8px 24px -12px rgba(15,23,42,.25)" } };

const shortDate = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

// ── Forecast with 80% interval ──────────────────────────────────────────────

export function ForecastChart({ points, height = 280 }: {
  points: { date: string; predicted_demand: number; lower_bound: number; upper_bound: number; expected_sales: number; is_weekend?: boolean }[]; height?: number;
}) {
  const data = points.map((p) => ({ ...p, band: [p.lower_bound, p.upper_bound] as [number, number] }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS} axisLine={false} tickLine={false} minTickGap={16} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} width={40} label={{ value: "units/day", angle: -90, position: "insideLeft", style: AXIS }} />
        <Tooltip {...TIP} labelFormatter={(d) => new Date(d as string).toDateString()}
          formatter={(v, n) => Array.isArray(v) ? [`${Number(v[0]).toFixed(1)} – ${Number(v[1]).toFixed(1)}`, "80% interval"] : [Number(v).toFixed(1), n as string]} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Area dataKey="band" name="80% interval" stroke="none" fill={SERIES[0]} fillOpacity={0.14} isAnimationActive={false} />
        <Line dataKey="predicted_demand" name="Predicted demand" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
        <Line dataKey="expected_sales" name="Expected sales (stock/expiry limited)" stroke={SERIES[1]} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Revenue / profit trend (both ₹ ⇒ one axis) ──────────────────────────────

export function MoneyTrendChart({ points, height = 260 }: { points: { date: string; revenue: number; profit: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS} axisLine={false} tickLine={false} minTickGap={24} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} width={56} tickFormatter={(v) => compactInr(v)} />
        <Tooltip {...TIP} labelFormatter={(d) => new Date(d as string).toDateString()} formatter={(v, n) => [inr(Number(v)), n as string]} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line dataKey="revenue" name="Revenue" stroke={SERIES[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line dataKey="profit" name="Profit" stroke={SERIES[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function UnitsTrendChart({ points, height = 200 }: { points: { date: string; units: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS} axisLine={false} tickLine={false} minTickGap={24} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} width={40} />
        <Tooltip {...TIP} labelFormatter={(d) => new Date(d as string).toDateString()} formatter={(v) => [Number(v).toLocaleString("en-IN"), "Units sold"]} />
        <Bar dataKey="units" name="Units sold" fill={SERIES[0]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Horizontal bars (category / product performance) ───────────────────────

export function HBarChart({ rows, valueKey, label, money = true, height }: {
  rows: { name: string; [k: string]: number | string }[]; valueKey: string; label: string; money?: boolean; height?: number;
}) {
  const h = height ?? Math.max(160, rows.length * 30 + 30);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }} barCategoryGap={6}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => (money ? compactInr(v) : String(v))} />
        <YAxis type="category" dataKey="name" tick={AXIS} axisLine={false} tickLine={false} width={150} />
        <Tooltip {...TIP} formatter={(v) => [money ? inr(Number(v)) : Number(v).toLocaleString("en-IN"), label]} />
        <Bar dataKey={valueKey} name={label} fill={SERIES[0]} radius={[0, 4, 4, 0]} isAnimationActive={false}>
          {rows.map((r, i) => <Cell key={i} fill={Number(r[valueKey]) < 0 ? "#dc2626" : SERIES[0]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Our price vs competitors over time ──────────────────────────────────────

export function PriceHistoryChart({ points, competitors, names, height = 280 }: {
  points: { time: string; ours: number | null; prices: Record<string, number>; market_avg: number | null }[];
  competitors: string[]; names: Record<string, string>; height?: number;
}) {
  const data = points.map((p) => ({ time: p.time, ours: p.ours, market_avg: p.market_avg, ...p.prices }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="time" tickFormatter={shortDate} tick={AXIS} axisLine={false} tickLine={false} minTickGap={24} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} width={56} tickFormatter={(v) => `₹${v}`} domain={["auto", "auto"]} />
        <Tooltip {...TIP} labelFormatter={(d) => new Date(d as string).toLocaleString("en-IN")} formatter={(v, n) => [inr(Number(v)), n as string]} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line dataKey="ours" name="PriceIQ (our price)" stroke={ENTITY_COLOR.ours} strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
        {competitors.map((k) => (
          <Line key={k} dataKey={k} name={names[k] ?? k} stroke={ENTITY_COLOR[k] ?? "#64748b"} strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
        ))}
        <Line dataKey="market_avg" name="Market average" stroke="#334155" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function OwnPriceHistoryChart({ points, height = 220 }: { points: { t: string; price: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="t" tickFormatter={shortDate} tick={AXIS} axisLine={false} tickLine={false} minTickGap={24} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} width={56} tickFormatter={(v) => `₹${v}`} domain={["auto", "auto"]} />
        <Tooltip {...TIP} labelFormatter={(d) => new Date(d as string).toLocaleString("en-IN")} formatter={(v) => [inr(Number(v)), "Price"]} />
        <Line type="stepAfter" dataKey="price" name="Selling price" stroke={SERIES[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Price response curves (separate charts: demand and profit) ──────────────

export function PriceCurveChart({ candidates, metric, band, current, recommended, height = 220 }: {
  candidates: { price: number; demand: number; profit: number; revenue?: number }[]; metric: "demand" | "profit";
  band?: { lo: number; hi: number }; current?: number; recommended?: number; height?: number;
}) {
  const data = [...candidates].sort((a, b) => a.price - b.price);
  const label = metric === "demand" ? "Expected demand (units/day)" : "Expected profit per day (net of waste)";
  const at = (p?: number) => (p === undefined ? undefined : data.reduce((best, c) => (Math.abs(c.price - p) < Math.abs(best.price - p) ? c : best), data[0]));
  const rec = at(recommended);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="price" type="number" domain={["dataMin", "dataMax"]} tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${Number(v).toFixed(0)}`} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => (metric === "profit" ? compactInr(v) : Number(v).toFixed(0))} />
        <Tooltip {...TIP} labelFormatter={(p) => `Price ${inr(Number(p))}`} formatter={(v) => [metric === "profit" ? inr(Number(v)) : Number(v).toFixed(1), label]} />
        {band && <ReferenceArea x1={band.lo} x2={band.hi} fill="#7c3aed" fillOpacity={0.07} ifOverflow="extendDomain" label={{ value: "allowed band", position: "insideBottom", fontSize: 10, fill: "#6d28d9" }} />}
        {current !== undefined && <ReferenceLine x={current} stroke="#64748b" strokeDasharray="4 4" label={{ value: "current", position: "top", fontSize: 10, fill: "#475569" }} />}
        <Line dataKey={metric} name={label} stroke={metric === "demand" ? SERIES[0] : SERIES[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
        {rec && <ReferenceDot x={rec.price} y={rec[metric]} r={6} fill="#7c3aed" stroke="#fff" strokeWidth={2} />}
        {metric === "profit" && <ReferenceLine y={0} stroke="#cbd5e1" />}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Status distribution (counts; status colours reserved) ───────────────────

const STATUS_COLORS: Record<string, string> = {
  OUT_OF_STOCK: "#b91c1c", LOW_STOCK: "#d97706", PREDICTED_STOCKOUT: "#ea580c", OVERSTOCK: "#0369a1", DEAD_STOCK: "#475569", EXPIRY_RISK: "#be123c",
};

export function StatusBarChart({ counts, height = 220 }: { counts: Record<string, number>; height?: number }) {
  const order = ["OUT_OF_STOCK", "LOW_STOCK", "PREDICTED_STOCKOUT", "EXPIRY_RISK", "DEAD_STOCK", "OVERSTOCK"];
  const data = order.map((k) => ({ name: k.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()), key: k, count: counts[k] ?? 0 }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }} barCategoryGap={6}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" tick={AXIS} axisLine={false} tickLine={false} width={130} />
        <Tooltip {...TIP} formatter={(v) => [`${v} product(s)`, "Count"]} />
        <Bar dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive={false} label={{ position: "right", fontSize: 11, fill: "#334155" }}>
          {data.map((d) => <Cell key={d.key} fill={STATUS_COLORS[d.key]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Diverging bars for SHAP effects ─────────────────────────────────────────

export function EffectBars({ rows, height }: { rows: { label: string; value: number }[]; height?: number }) {
  const h = height ?? rows.length * 28 + 20;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const fmt = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
  // Value labels sit outside the bar end on both sides; the symmetric domain leaves room for them.
  const renderLabel = (props: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: unknown }) => {
    const x = Number(props.x), y = Number(props.y), w = Number(props.width), hh = Number(props.height), v = Number(props.value);
    const neg = v < 0;
    return <text x={neg ? x + w - 4 : x + w + 4} y={y + hh / 2} dy={4} fontSize={10} fill="#334155" textAnchor={neg ? "end" : "start"}>{fmt(v)}</text>;
  };
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }} barCategoryGap={5}>
        <XAxis type="number" hide domain={[-max * 1.35, max * 1.35]} />
        <YAxis type="category" dataKey="label" tick={AXIS} axisLine={false} tickLine={false} width={150} />
        <ReferenceLine x={0} stroke="#94a3b8" />
        <Tooltip {...TIP} formatter={(v) => [fmt(Number(v)), "Effect on demand"]} />
        <Bar dataKey="value" radius={4} isAnimationActive={false} label={renderLabel}>
          {rows.map((r, i) => <Cell key={i} fill={r.value >= 0 ? SERIES[2] : SERIES[1]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
