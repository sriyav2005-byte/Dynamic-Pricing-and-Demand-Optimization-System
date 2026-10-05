"use client";

/** /pricing — recommendation queue: generate, review, approve/reject and apply. */

import Link from "next/link";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Sparkles, Tags } from "lucide-react";
import { batchRecommend, getRecommendations, getSettings, inr, pct } from "@/lib/api";
import { useApp } from "@/components/providers/AppProvider";
import { Card, EmptyState, ErrorState, Notice, PageHeader, Pill, RoleGate, SkeletonRows, Spinner, Tabs, useAsync } from "@/components/ui/kit";
import RecommendationCard from "@/components/pricing/RecommendationCard";

const STATUSES = ["PENDING", "APPROVED", "APPLIED", "REJECTED", "EXPIRED", "SUPERSEDED", ""] as const;
type S = (typeof STATUSES)[number];
const MODE_TEXT = {
  MANUAL: "Manual — the AI recommends; a store manager applies prices.",
  SEMI_AUTOMATIC: "Semi-automatic — every recommendation needs manager approval before it can be applied.",
  AUTOMATIC: "Automatic — low-risk changes within the approval threshold are applied by the system; larger ones wait for approval.",
};

export default function PricingPage() {
  const { storeId, toast, toastError, confirm } = useApp();
  const [status, setStatus] = useState<S>("PENDING");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const settings = useAsync(() => getSettings(storeId), [storeId]);
  const list = useAsync(() => getRecommendations(storeId, { status: status || undefined, page, page_size: 10 }), [storeId, status, page]);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / 10)) : 1;

  async function batch(scope: "all" | "at_risk") {
    const r = await confirm({ title: scope === "all" ? "Generate recommendations for every product?" : "Generate recommendations for at-risk products?",
      message: "Runs the pricing model for each product (a few seconds per product). No prices are changed unless the store is in automatic mode and a change is low-risk.", confirmLabel: "Generate" });
    if (!r.ok) return;
    setBusy(true);
    try {
      const res = await batchRecommend(storeId, scope);
      toast(`${res.generated} of ${res.requested} recommendations generated${res.failed.length ? `, ${res.failed.length} failed` : ""}`, res.failed.length ? "warning" : "success");
      setStatus("PENDING");
      list.reload();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Pricing" icon={Tags} subtitle="AI recommendations → manager review → approve / reject → apply"
        actions={<RoleGate min="ANALYST">
          <button className="btn-secondary" disabled={busy} onClick={() => batch("at_risk")}>{busy ? <Spinner /> : <Sparkles size={15} />} At-risk products</button>
          <button className="btn-primary" disabled={busy} onClick={() => batch("all")}>{busy ? <Spinner /> : <Sparkles size={15} />} All products</button>
        </RoleGate>} />

      {settings.data && (
        <Notice>
          <b>Pricing mode:</b> {MODE_TEXT[settings.data.pricing_mode]} Limits: minimum margin {pct(settings.data.min_margin_pct * 100, 0)}, max change {pct(settings.data.max_price_change_pct * 100, 0)} per update,
          approval threshold {pct(settings.data.approval_threshold_pct * 100, 0)}. <Link href="/settings" className="text-violet-700 underline">Settings</Link>
        </Notice>
      )}

      <div className="my-5 overflow-x-auto">
        <Tabs tabs={STATUSES.map((s) => ({ id: s, label: s ? s.charAt(0) + s.slice(1).toLowerCase() : "All" }))} value={status} onChange={(v) => { setStatus(v); setPage(1); }} />
      </div>

      {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : !list.data ? <Card><SkeletonRows rows={6} cols={4} /></Card> : list.data.data.length === 0 ? (
        <EmptyState title={status === "PENDING" ? "Nothing waiting for review" : "No recommendations with this status"}
          message="Generate recommendations with the buttons above, or from a product's page." icon={Tags} />
      ) : (
        <div className="space-y-4">
          {list.data.data.map((r) => (
            <div key={r.id}>
              <div className="mb-1 flex items-center gap-2 text-sm">
                <Link href={`/product/${r.product_id}`} className="font-semibold text-violet-700 hover:underline">{r.product_name}</Link>
                <span className="text-xs text-slate-400">{r.sku}</span>
                {r.explanation?.impact?.profit_change_pct != null && <Pill tone={r.explanation.impact.profit_change_pct >= 0 ? "green" : "red"}>profit {pct(r.explanation.impact.profit_change_pct, 1, true)}</Pill>}
                <span className="ml-auto text-xs text-slate-400">{inr(r.current_price)} → {inr(r.recommended_price)}</span>
              </div>
              <RecommendationCard rec={r} compact onChanged={() => list.reload()} />
            </div>
          ))}
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>{list.data.total} recommendation(s)</span>
            <div className="flex gap-2">
              <button className="btn-secondary !py-1" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={14} /> Prev</button>
              <button className="btn-secondary !py-1" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next <ChevronRight size={14} /></button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
