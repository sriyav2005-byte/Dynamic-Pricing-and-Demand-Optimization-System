"use client";

/** /competitors — market position of every product across platforms. */

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search, ShieldCheck } from "lucide-react";
import { getCompetitorOverview, inr, pct, ProductCompetitors } from "@/lib/api";
import { useApp } from "@/components/providers/AppProvider";
import { Card, DataStatusBadge, EmptyState, ErrorState, Modal, Notice, PageHeader, SkeletonRows, Tile, useAsync } from "@/components/ui/kit";
import CompetitorPanel from "@/components/competitors/CompetitorPanel";

export default function CompetitorsPage() {
  const { storeId } = useApp();
  const ov = useAsync(() => getCompetitorOverview(storeId), [storeId]);
  const [filter, setFilter] = useState<"all" | "with" | "above">("all");
  const [open, setOpen] = useState<ProductCompetitors | null>(null);
  const platforms = useMemo(() => ov.data?.products[0]?.observations.map((o) => ({ key: o.competitor_key, name: o.competitor_name })) ?? [], [ov.data]);
  const rows = (ov.data?.products ?? []).filter((p) => filter === "all" || (filter === "with" ? p.market.observed_count > 0 : (p.market.diff_vs_avg_pct ?? 0) > 0));

  return (
    <>
      <PageHeader title="Competitor intelligence" icon={ShieldCheck} subtitle="Blinkit · Zepto · Swiggy Instamart · BigBasket"
        actions={<Link href="/live-search" className="btn-primary"><Search size={15} /> Search & link listings</Link>} />
      <Notice>
        Every price carries a status: <DataStatusBadge status="LIVE" /> read from the platform within 6 h, <DataStatusBadge status="MANUAL_VERIFIED" /> recorded by staff within 24 h,{" "}
        <DataStatusBadge status="CACHED" /> an older real observation, <DataStatusBadge status="UNAVAILABLE" /> could not be read (no price is shown or guessed). Market averages use observed prices only.
        Automated reading works for Blinkit at this store&apos;s delivery location; Zepto, Swiggy Instamart and BigBasket block automated access, so open a product and use <b>Record observed price</b> for them.
      </Notice>

      {ov.error ? <div className="mt-4"><ErrorState message={ov.error} onRetry={ov.reload} /></div> : !ov.data ? <div className="mt-4"><SkeletonRows rows={8} cols={6} /></div> : (
        <>
          <div className="my-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Products with market data" value={`${ov.data.products_with_market_data} / ${ov.data.products.length}`} />
            <Tile label="Priced above market avg" value={ov.data.products_above_market} tone="amber" />
            <Tile label="Average gap vs market" value={ov.data.avg_gap_pct === null ? "No data" : pct(ov.data.avg_gap_pct, 1, true)} tone="cyan" />
            <Tile label="Observations by status" value={Object.values(ov.data.status_counts).reduce((a, b) => a + b, 0)} tone="slate"
              sub={Object.entries(ov.data.status_counts).map(([k, v]) => `${k} ${v}`).join(" · ")} />
          </div>
          <Card title="Price comparison" actions={
            <select className="select !w-auto" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter products">
              <option value="all">All products</option><option value="with">With market data</option><option value="above">Priced above market</option>
            </select>}>
            {rows.length === 0 ? <EmptyState title="No products match" message="Link competitor listings from Competitor Search or record observed prices on a product." /> : (
              <div className="table-wrap"><table className="data-table">
                <thead><tr><th>Product</th><th className="text-right">Our price</th>{platforms.map((p) => <th key={p.key} className="text-right">{p.name}</th>)}
                  <th className="text-right">Market avg</th><th className="text-right">Lowest</th><th className="text-right">Difference</th></tr></thead>
                <tbody>{rows.map((p) => (
                  <tr key={p.product_id} className="cursor-pointer" onClick={() => setOpen(p)}>
                    <td className="min-w-[190px]"><span className="font-medium text-violet-700">{p.product_name}</span><div className="text-xs text-slate-400">{p.category}</div></td>
                    <td className="num text-right font-semibold">{inr(p.market.our_price)}</td>
                    {p.observations.map((o) => (
                      <td key={o.competitor_key} className="num text-right">{!o.linked ? <span className="text-xs text-slate-400" title="No listing linked or price recorded for this platform">no data</span> : o.price === null ? <DataStatusBadge status={o.status} /> : <><div>{inr(o.price)}</div><DataStatusBadge status={o.status} /></>}</td>
                    ))}
                    <td className="num text-right">{inr(p.market.average)}</td>
                    <td className="num text-right">{p.market.lowest === null ? "—" : <>{inr(p.market.lowest)}<div className="text-[10px] text-slate-400">{p.market.lowest_platform}</div></>}</td>
                    <td className={`num text-right font-semibold ${(p.market.diff_vs_avg_pct ?? 0) > 0 ? "text-red-700" : "text-emerald-700"}`}>{pct(p.market.diff_vs_avg_pct, 1, true)}</td>
                  </tr>))}</tbody>
              </table></div>
            )}
          </Card>
        </>
      )}
      <Modal open={!!open} title={open?.product_name ?? ""} onClose={() => { setOpen(null); ov.reload(); }} wide>
        {open && <CompetitorPanel data={open} onChange={setOpen} />}
      </Modal>
    </>
  );
}
