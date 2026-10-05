"use client";

/** /analytics — sales performance, categories, products and store comparison. */

import Link from "next/link";
import { useState } from "react";
import { BarChart3 } from "lucide-react";
import {
  compactInr, getCategoryPerformance, getProductPerformance, getSummary, getTrends, inr, num, orgAnalytics, pct, RangeQuery,
} from "@/lib/api";
import { useApp } from "@/components/providers/AppProvider";
import { Card, EmptyState, ErrorState, Field, PageHeader, SkeletonCards, SkeletonRows, Tabs, Tile, useAsync } from "@/components/ui/kit";
import { HBarChart, MoneyTrendChart, UnitsTrendChart } from "@/components/charts/viz";

export default function AnalyticsPage() {
  const { storeId, store, me } = useApp();
  const [preset, setPreset] = useState<"7" | "30" | "90" | "custom">("30");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [metric, setMetric] = useState<"revenue" | "profit" | "units" | "margin">("profit");
  const q: RangeQuery = preset === "custom" ? { from: from || undefined, to: to || undefined, days: 30 } : { days: Number(preset) };
  const key = JSON.stringify(q);
  const summary = useAsync(() => getSummary(storeId, q), [storeId, key]);
  const trends = useAsync(() => getTrends(storeId, q), [storeId, key]);
  const cats = useAsync(() => getCategoryPerformance(storeId, q), [storeId, key]);
  const top = useAsync(() => getProductPerformance(storeId, { ...q, sort: metric, order: "desc", limit: 10 }), [storeId, key, metric]);
  const bottom = useAsync(() => getProductPerformance(storeId, { ...q, sort: metric, order: "asc", limit: 5 }), [storeId, key, metric]);
  const orgStores = me?.stores.filter((s) => s.organization_id === store?.organization_id) ?? [];
  const org = useAsync(() => orgAnalytics(store!.organization_id, preset === "custom" ? 30 : Number(preset)), [store?.organization_id, preset], orgStores.length > 1);
  const s = summary.data;

  return (
    <>
      <PageHeader title="Analytics" icon={BarChart3} subtitle={s ? `${s.range.from.slice(0, 10)} → ${s.range.to.slice(0, 10)} (exclusive)` : undefined}
        actions={<>
          <Tabs tabs={[{ id: "7", label: "7d" }, { id: "30", label: "30d" }, { id: "90", label: "90d" }, { id: "custom", label: "Custom" }]} value={preset} onChange={setPreset} />
          {preset === "custom" && <div className="flex items-end gap-2">
            <Field label="From"><input type="date" className="input !py-1" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To"><input type="date" className="input !py-1" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>}
        </>} />
      {s?.data_from && <p className="-mt-3 mb-4 text-xs text-slate-500">Sales data available from {s.data_from.slice(0, 10)} to {s.data_to?.slice(0, 10)}.</p>}

      {summary.error ? <ErrorState message={summary.error} onRetry={summary.reload} /> : !s ? <SkeletonCards n={4} /> : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Revenue" value={compactInr(s.current.revenue)} delta={s.revenue_change_pct} sub={`prev. ${compactInr(s.previous.revenue)}`} />
          <Tile label="Profit" value={compactInr(s.current.profit)} tone="green" delta={s.profit_change_pct} sub={`prev. ${compactInr(s.previous.profit)}`} />
          <Tile label="Margin" value={pct(s.avg_margin_pct)} tone="cyan" sub={`${num(s.current.orders)} sales`} />
          <Tile label="Units sold" value={num(s.current.units)} tone="slate" delta={s.units_change_pct} sub={`${s.current.products_sold} products sold`} />
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Revenue & profit trend" className="xl:col-span-2">
          {trends.error ? <ErrorState message={trends.error} /> : !trends.data ? <SkeletonRows rows={6} cols={1} /> : <MoneyTrendChart points={trends.data.points} />}
        </Card>
        <Card title="Units sold per day">
          {trends.error ? <ErrorState message={trends.error} /> : !trends.data ? <SkeletonRows rows={6} cols={1} /> : <UnitsTrendChart points={trends.data.points} height={260} />}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card title="Category performance">
          {cats.error ? <ErrorState message={cats.error} /> : !cats.data ? <SkeletonRows rows={5} cols={4} /> : cats.data.categories.length === 0 ? <EmptyState title="No sales in this period" /> : (
            <>
              <HBarChart rows={cats.data.categories.map((c) => ({ name: c.name, profit: Math.round(c.profit) }))} valueKey="profit" label="Profit" />
              <div className="table-wrap mt-3"><table className="data-table">
                <thead><tr><th>Category</th><th className="text-right">Revenue</th><th className="text-right">Profit</th><th className="text-right">Units</th><th className="text-right">Margin</th></tr></thead>
                <tbody>{cats.data.categories.map((c) => <tr key={c.key}><td>{c.name}</td><td className="num text-right">{inr(c.revenue, 0)}</td><td className="num text-right">{inr(c.profit, 0)}</td><td className="num text-right">{num(c.units)}</td><td className="num text-right">{pct(c.margin_pct)}</td></tr>)}</tbody>
              </table></div>
            </>
          )}
        </Card>
        <Card title="Product performance" actions={<select className="select !w-auto" value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)} aria-label="Rank by">
          <option value="profit">By profit</option><option value="revenue">By revenue</option><option value="units">By units</option><option value="margin">By margin</option></select>}>
          {top.error ? <ErrorState message={top.error} /> : !top.data ? <SkeletonRows rows={6} cols={4} /> : (
            <>
              <p className="text-xs font-semibold uppercase text-slate-500">Top 10</p>
              <ProductTable rows={top.data.products} />
              <p className="mt-4 text-xs font-semibold uppercase text-slate-500">Bottom 5</p>
              {bottom.data && <ProductTable rows={bottom.data.products} />}
            </>
          )}
        </Card>
      </div>

      {orgStores.length > 1 && (
        <Card title={`${store?.organization_name} — store comparison`} subtitle="Organization-level view of the stores you can access" className="mt-6">
          {org.error ? <ErrorState message={org.error} /> : !org.data ? <SkeletonRows rows={3} cols={5} /> : (
            <div className="table-wrap"><table className="data-table">
              <thead><tr><th>Store</th><th className="text-right">Revenue</th><th className="text-right">Profit</th><th className="text-right">Margin</th><th className="text-right">Units</th><th className="text-right">Inventory (cost)</th></tr></thead>
              <tbody>{org.data.map((r) => <tr key={r.store_id}><td>{r.store_name}{r.data_mode === "SYNTHETIC" && <span className="ml-1 text-[10px] text-amber-700">demo data</span>}</td>
                <td className="num text-right">{inr(r.totals.revenue, 0)}</td><td className="num text-right">{inr(r.totals.profit, 0)}</td><td className="num text-right">{pct(r.margin_pct)}</td>
                <td className="num text-right">{num(r.totals.units)}</td><td className="num text-right">{inr(r.inventory.at_cost, 0)}</td></tr>)}</tbody>
            </table></div>
          )}
        </Card>
      )}
    </>
  );
}

function ProductTable({ rows }: { rows: { key: string; name: string; revenue: number; profit: number; units: number; margin_pct: number }[] }) {
  return (
    <div className="table-wrap mt-1"><table className="data-table">
      <thead><tr><th>Product</th><th className="text-right">Revenue</th><th className="text-right">Profit</th><th className="text-right">Units</th><th className="text-right">Margin</th></tr></thead>
      <tbody>{rows.map((p) => <tr key={p.key}><td><Link href={`/product/${p.key}`} className="text-violet-700 hover:underline">{p.name}</Link></td>
        <td className="num text-right">{inr(p.revenue, 0)}</td><td className="num text-right">{inr(p.profit, 0)}</td><td className="num text-right">{num(p.units)}</td><td className="num text-right">{pct(p.margin_pct)}</td></tr>)}</tbody>
    </table></div>
  );
}
