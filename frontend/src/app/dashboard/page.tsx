"use client";

/** /dashboard — store KPIs, trends, inventory health, opportunities and alerts. */

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, Boxes, IndianRupee, LayoutDashboard, Percent, ShieldCheck, ShoppingCart, Tags, TrendingUp } from "lucide-react";
import {
  compactInr, dateFmt, getAlerts, getCategoryPerformance, getForecastOverview, getInventory, getRecommendations, getSummary, getTrends, inr, num, pct,
} from "@/lib/api";
import { useApp } from "@/components/providers/AppProvider";
import { Card, EmptyState, ErrorState, PageHeader, SeverityBadge, SkeletonCards, SkeletonRows, Tabs, Tile, useAsync } from "@/components/ui/kit";
import { HBarChart, MoneyTrendChart, StatusBarChart } from "@/components/charts/viz";

const RANGES = [{ id: "7", label: "7 days" }, { id: "30", label: "30 days" }, { id: "90", label: "90 days" }] as const;

export default function DashboardPage() {
  const { storeId, store } = useApp();
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const d = Number(days);
  const summary = useAsync(() => getSummary(storeId, { days: d }), [storeId, d]);
  const trends = useAsync(() => getTrends(storeId, { days: d }), [storeId, d]);
  const inv = useAsync(() => getInventory(storeId), [storeId]);
  const cats = useAsync(() => getCategoryPerformance(storeId, { days: d }), [storeId, d]);
  const recs = useAsync(() => getRecommendations(storeId, { status: "PENDING", page_size: 50 }), [storeId]);
  const alerts = useAsync(() => getAlerts(storeId, { page_size: 6 }), [storeId]);
  const outlook = useAsync(() => getForecastOverview(storeId, 7), [storeId]);

  const s = summary.data;
  const opportunities = (recs.data?.data ?? [])
    .map((r) => ({ ...r, uplift: r.explanation?.impact?.profit_change_pct ?? null }))
    .filter((r) => r.uplift !== null && Math.abs(r.recommended_price - r.current_price) > 0.004)
    .sort((a, b) => (b.uplift ?? 0) - (a.uplift ?? 0)).slice(0, 6);

  return (
    <>
      <PageHeader title="Dashboard" icon={LayoutDashboard}
        subtitle={s ? `${store?.store_name} · ${dateFmt(s.range.from)} – ${dateFmt(new Date(new Date(s.range.to).getTime() - 864e5).toISOString())}${s.data_mode === "SYNTHETIC" ? " (last days of the dataset)" : ""}` : store?.store_name}
        actions={<Tabs tabs={RANGES.map((r) => ({ id: r.id, label: r.label }))} value={days} onChange={setDays} />} />

      {summary.error ? <ErrorState message={summary.error} onRetry={summary.reload} /> : !s ? <SkeletonCards n={8} /> : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Revenue" value={compactInr(s.current.revenue)} icon={IndianRupee} delta={s.revenue_change_pct} sub="vs previous period" />
          <Tile label="Profit" value={compactInr(s.current.profit)} icon={TrendingUp} tone="green" delta={s.profit_change_pct} sub="vs previous period" />
          <Tile label="Average margin" value={pct(s.avg_margin_pct)} icon={Percent} tone="cyan" sub="profit ÷ revenue" />
          <Tile label="Units sold" value={num(s.current.units)} icon={ShoppingCart} tone="slate" delta={s.units_change_pct} sub={`${num(s.current.orders)} sales`} />
          <Tile label="Inventory value" value={compactInr(s.inventory.at_cost)} icon={Boxes} tone="violet" sub={`${compactInr(s.inventory.at_retail)} at retail · ${num(s.inventory.units)} units`} />
          <Tile label="At-risk products" value={s.at_risk_products} icon={AlertTriangle} tone="amber" sub={<Link className="text-violet-700 hover:underline" href="/inventory">view inventory</Link>} />
          <Tile label="Competitor price gap" icon={ShieldCheck} tone="cyan"
            value={s.competitor_gap.avg_gap_pct === null ? "No data" : pct(s.competitor_gap.avg_gap_pct, 1, true)}
            sub={s.competitor_gap.products_compared ? `${s.competitor_gap.products_compared} products · observed prices only` : s.competitor_gap.note} />
          <Tile label="Pricing opportunities" value={s.pending_recommendations} icon={Tags} tone="violet" sub={<Link className="text-violet-700 hover:underline" href="/pricing">review queue</Link>} />
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Revenue & profit" subtitle="Daily totals (₹). Profit = revenue − cost of goods sold." className="xl:col-span-2">
          {trends.error ? <ErrorState message={trends.error} onRetry={trends.reload} /> : !trends.data ? <SkeletonRows rows={6} cols={1} /> :
            trends.data.points.every((p) => p.revenue === 0) ? <EmptyState title="No sales in this period" /> : <MoneyTrendChart points={trends.data.points} />}
        </Card>
        <Card title="Inventory health" subtitle="Products per status (a product can have several)">
          {inv.error ? <ErrorState message={inv.error} onRetry={inv.reload} /> : !inv.data ? <SkeletonRows rows={6} cols={1} /> : (
            <>
              <StatusBarChart counts={inv.data.status_counts} />
              <p className="mt-2 text-xs text-slate-500">Stock at expiry risk: <span className="font-semibold text-slate-700">{inr(inv.data.expiry_risk_value_at_cost, 0)}</span> at cost</p>
            </>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card title="Biggest pricing opportunities" subtitle="Pending recommendations by expected profit change"
          actions={<Link href="/pricing" className="btn-ghost text-xs">Open queue →</Link>}>
          {recs.error ? <ErrorState message={recs.error} /> : !recs.data ? <SkeletonRows rows={4} cols={4} /> : opportunities.length === 0 ? (
            <EmptyState title="No pending price changes" message="Generate recommendations on the Pricing page to find opportunities." />
          ) : (
            <div className="table-wrap"><table className="data-table">
              <thead><tr><th>Product</th><th>Current</th><th>Recommended</th><th>Profit impact</th></tr></thead>
              <tbody>{opportunities.map((r) => (
                <tr key={r.id}>
                  <td><Link className="font-medium text-violet-700 hover:underline" href={`/product/${r.product_id}`}>{r.product_name}</Link></td>
                  <td className="num">{inr(r.current_price)}</td><td className="num font-semibold">{inr(r.recommended_price)}</td>
                  <td className={`num font-semibold ${(r.uplift ?? 0) >= 0 ? "text-emerald-700" : "text-red-700"}`}>{pct(r.uplift, 1, true)}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </Card>
        <Card title="Open alerts" actions={<Link href="/alerts" className="btn-ghost text-xs">All alerts →</Link>}>
          {alerts.error ? <ErrorState message={alerts.error} /> : !alerts.data ? <SkeletonRows rows={4} cols={2} /> : alerts.data.data.length === 0 ? (
            <EmptyState title="No open alerts" message="Alert scans run every 15 minutes, or on demand from the Alerts page." />
          ) : (
            <ul className="divide-y divide-slate-100">{alerts.data.data.map((a) => (
              <li key={a.id} className="flex items-start gap-3 py-2.5">
                <SeverityBadge severity={a.severity} />
                <div className="min-w-0"><p className="text-sm font-medium text-slate-700">{a.title}</p><p className="truncate text-xs text-slate-500">{a.message}</p></div>
              </li>))}</ul>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card title="Category performance" subtitle="Revenue in the selected period">
          {cats.error ? <ErrorState message={cats.error} /> : !cats.data ? <SkeletonRows rows={4} cols={1} /> : cats.data.categories.length === 0 ? <EmptyState title="No sales in this period" /> : (
            <HBarChart rows={cats.data.categories.map((c) => ({ name: c.name, revenue: Math.round(c.revenue) }))} valueKey="revenue" label="Revenue" />
          )}
        </Card>
        <Card title="Demand outlook — next 7 days" subtitle="Demand-model forecast at current prices"
          actions={<Link href="/forecasting" className="btn-ghost text-xs">Forecasting →</Link>}>
          {outlook.error ? <ErrorState message={outlook.error} onRetry={outlook.reload} /> : !outlook.data ? <SkeletonRows rows={5} cols={3} /> : (() => {
            const items = outlook.data.items.filter((i) => !i.error);
            const total = items.reduce((a, i) => a + i.total_predicted_demand, 0);
            const stockouts = items.filter((i) => i.stockout_date);
            const rising = [...items].filter((i) => i.recent_avg_daily_units).sort((a, b) => (b.avg_daily_demand / (b.recent_avg_daily_units || 1)) - (a.avg_daily_demand / (a.recent_avg_daily_units || 1))).slice(0, 4);
            return (
              <div className="space-y-3 text-sm">
                <p><span className="text-2xl font-bold text-slate-800">{num(total)}</span> <span className="text-slate-500">units expected across {items.length} products</span></p>
                <p className="text-slate-600">{stockouts.length ? `${stockouts.length} product(s) may run out of stock within 7 days.` : "No stock-outs expected within 7 days."}</p>
                <p className="text-xs font-semibold uppercase text-slate-500">Highest expected demand vs recent sales</p>
                <ul className="space-y-1">{rising.map((i) => (
                  <li key={i.product_id} className="flex justify-between"><Link href={`/product/${i.product_id}`} className="text-violet-700 hover:underline">{i.product_name}</Link>
                    <span className="num text-slate-600">{i.avg_daily_demand.toFixed(1)}/day vs {i.recent_avg_daily_units?.toFixed(1)}/day <span className="text-xs text-slate-400">({i.confidence.toLowerCase()} confidence)</span></span></li>))}</ul>
                {outlook.data.store_accuracy && <p className="text-xs text-slate-500">Out-of-sample backtest: MAE {outlook.data.store_accuracy.mae?.toFixed(2)} units/day · WAPE {pct(outlook.data.store_accuracy.wape_pct)}</p>}
              </div>
            );
          })()}
        </Card>
      </div>
    </>
  );
}
