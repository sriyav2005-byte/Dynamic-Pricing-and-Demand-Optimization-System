"use client";

/**
 * RecommendationCard — an AI price recommendation with its full explanation
 * and the approval workflow (approve / reject / apply) gated by role & status.
 */

import { useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Check, ChevronDown, ChevronUp, Lock, ShieldCheck, Sparkles, X } from "lucide-react";
import {
  applyRecommendation, approveRecommendation, dateFmt, inr, pct, Recommendation, rejectRecommendation,
} from "@/lib/api";
import { useApp } from "@/components/providers/AppProvider";
import { Notice, Pill, Spinner } from "@/components/ui/kit";
import { EffectBars, PriceCurveChart } from "@/components/charts/viz";

const STATUS_TONE = { PENDING: "amber", APPROVED: "sky", APPLIED: "green", REJECTED: "red", EXPIRED: "slate", SUPERSEDED: "slate" } as const;

export default function RecommendationCard({ rec, onChanged, compact = false }: { rec: Recommendation; onChanged: (r: Recommendation) => void; compact?: boolean }) {
  const { storeId, can, confirm, toast, toastError } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(!compact);
  const ex = rec.explanation ?? {};
  const change = rec.recommended_price - rec.current_price;
  const Arrow = Math.abs(change) < 0.005 ? ArrowRight : change > 0 ? ArrowUpRight : ArrowDownRight;
  const candidates = (rec.context?.candidates as { price: number; demand: number; profit: number }[] | undefined) ?? [];

  async function act(kind: "approve" | "reject" | "apply" | "approve_apply") {
    const titles = { approve: "Approve recommendation?", reject: "Reject recommendation?", apply: `Apply ${inr(rec.recommended_price)}?`, approve_apply: `Approve and apply ${inr(rec.recommended_price)}?` };
    const r = await confirm({
      title: titles[kind],
      message: kind === "reject" ? `${rec.product_name} stays at ${inr(rec.current_price)}.` :
        `${rec.product_name}: ${inr(rec.current_price)} → ${inr(rec.recommended_price)} (${pct(rec.change_pct, 1, true)}).${kind !== "approve" ? "\nThe price is re-validated against all constraints before it is changed." : ""}`,
      confirmLabel: kind === "reject" ? "Reject" : kind === "approve" ? "Approve" : "Apply price", danger: kind === "reject", reasonLabel: "Note",
    });
    if (!r.ok) return;
    setBusy(kind);
    try {
      const out = kind === "reject" ? await rejectRecommendation(storeId, rec.id, r.reason)
        : kind === "approve" ? await approveRecommendation(storeId, rec.id, r.reason)
        : kind === "approve_apply" ? await approveRecommendation(storeId, rec.id, r.reason, true)
        : await applyRecommendation(storeId, rec.id, r.reason);
      toast(kind === "reject" ? "Recommendation rejected" : kind === "approve" ? "Recommendation approved" : "New price applied");
      onChanged(out);
    } catch (e) { toastError(e); } finally { setBusy(null); }
  }

  const canApply = can("STORE_MANAGER") && (rec.status === "APPROVED" || (rec.status === "PENDING" && !rec.requires_approval));
  const canReview = can("STORE_MANAGER") && rec.status === "PENDING";
  const isHold = Math.abs(change) < 0.005;

  return (
    <div className="rounded-2xl border border-violet-100 bg-gradient-to-br from-white to-violet-50/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-violet-700"><Sparkles size={13} /> AI recommendation
            <Pill tone={STATUS_TONE[rec.status]}>{rec.status}</Pill>{rec.requires_approval && rec.status === "PENDING" && <Pill tone="amber"><Lock size={10} /> needs approval</Pill>}</p>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="text-slate-400 line-through num">{inr(rec.current_price)}</span>
            <Arrow size={18} className={isHold ? "text-slate-400" : change > 0 ? "text-emerald-600" : "text-amber-600"} />
            <span className="text-3xl font-bold text-slate-800 num">{inr(rec.recommended_price)}</span>
            <span className={`text-sm font-semibold ${isHold ? "text-slate-500" : change > 0 ? "text-emerald-700" : "text-amber-700"}`}>{isHold ? "hold" : pct(rec.change_pct, 1, true)}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">{compact ? rec.product_name + " · " : ""}{dateFmt(rec.created_at, true)} · {rec.policy} · {rec.model_version}
            {rec.confidence !== null && <> · confidence <span className="font-semibold">{(rec.confidence * 100).toFixed(0)}%</span></>}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canReview && rec.requires_approval && <button className="btn-primary" disabled={!!busy} onClick={() => act("approve_apply")}>{busy === "approve_apply" ? <Spinner /> : <Check size={15} />} Approve & apply</button>}
          {canReview && rec.requires_approval && <button className="btn-secondary" disabled={!!busy} onClick={() => act("approve")}>Approve only</button>}
          {canApply && !isHold && <button className="btn-primary" disabled={!!busy} onClick={() => act("apply")}>{busy === "apply" ? <Spinner /> : <Check size={15} />} Apply price</button>}
          {canReview && <button className="btn-secondary !text-red-700" disabled={!!busy} onClick={() => act("reject")}><X size={15} /> Reject</button>}
        </div>
      </div>

      {ex.summary && <p className="mt-3 text-sm text-slate-700">{ex.summary}</p>}
      {rec.review_note && <p className="mt-1 text-xs text-slate-500">Review note: {rec.review_note} {rec.reviewed_by && `— ${rec.reviewed_by}`}</p>}
      {rec.status === "APPLIED" && <p className="mt-1 text-xs text-emerald-700">Applied {dateFmt(rec.applied_at, true)} by {rec.applied_by ?? "the system (automatic pricing)"}</p>}

      {ex.impact && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
          {[
            ["Demand", pct(ex.impact.demand_change_pct, 1, true), `${rec.expected_demand?.toFixed(1) ?? "—"} units/day`],
            ["Revenue", pct(ex.impact.revenue_change_pct, 1, true), `${inr(rec.expected_revenue)} / day`],
            ["Profit", pct(ex.impact.profit_change_pct, 1, true), `${inr(rec.expected_profit)} / day`],
            ["Margin", `${ex.impact.margin_change_pts > 0 ? "+" : ""}${ex.impact.margin_change_pts.toFixed(1)} pts`, `${pct(rec.expected_margin_pct)} at new price`],
          ].map(([k, v, sub]) => (
            <div key={k} className="rounded-xl border border-slate-100 bg-white p-3">
              <p className="text-[11px] uppercase text-slate-500">{k} vs current</p><p className="text-lg font-bold text-slate-800">{v}</p><p className="text-[11px] text-slate-500">{sub}</p>
            </div>
          ))}
        </div>
      )}
      {ex.impact?.note && <p className="mt-1 text-[11px] text-slate-500">Over the next {ex.impact.horizon_days} day(s). {ex.impact.note}</p>}

      {compact && <button className="btn-ghost mt-2 text-xs" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {open ? "Hide" : "Show"} explanation</button>}

      {open && (
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-700">Why this price</h3>
              <ul className="mt-2 space-y-2">{(ex.factors ?? []).map((f) => (
                <li key={f.factor} className="flex gap-2 text-sm">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${f.signal === "up" ? "bg-emerald-500" : f.signal === "down" ? "bg-amber-500" : "bg-slate-300"}`} aria-hidden />
                  <span><span className="font-medium text-slate-700">{f.label}:</span> <span className="text-slate-600">{f.detail}</span></span>
                </li>))}</ul>
            </div>
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700"><ShieldCheck size={14} /> Business constraints</h3>
              {rec.constraints_applied?.length ? (
                <ul className="mt-2 space-y-1">{rec.constraints_applied.map((c, i) => (
                  <li key={i} className="text-sm text-slate-600"><Pill tone="violet">{c.rule.replace(/_/g, " ")}</Pill> {inr(c.before)} → {inr(c.after)} — {c.message}</li>))}</ul>
              ) : <p className="mt-1 text-sm text-slate-500">No constraint had to change the model&apos;s preferred price.</p>}
              {ex.bounds && <p className="mt-1 text-xs text-slate-500">Allowed band: {inr(ex.bounds.lo)} – {inr(ex.bounds.hi)}{ex.bounds.expiry_window ? " (expiry clearance rules active)" : ""}.</p>}
              {ex.bounds?.conflict && <Notice tone="warning">{ex.bounds.conflict}</Notice>}
            </div>
            {ex.policy && (
              <div className="text-xs text-slate-500">
                <p>Policy <b>{ex.policy.name}</b>{ex.policy.explored ? ` explored this price (best-known price: ${inr(ex.policy.greedy_price)})` : " chose its best-known price"}; {ex.policy.updates_from_feedback ?? 0} learning update(s) from real sales so far.</p>
                {ex.policy.shadow && <p>Shadow policy {ex.policy.shadow.policy} would choose {inr(ex.policy.shadow.price)} (not applied).</p>}
                {ex.model_optimum && <p>Without business rules the model would pick {inr(ex.model_optimum.price)}.</p>}
              </div>
            )}
            {ex.data_provenance && (
              <div className="flex flex-wrap gap-1.5">{Object.entries(ex.data_provenance).map(([k, v]) => <Pill key={k} tone={String(v).includes("Synthetic") || String(v).includes("SYNTHETIC") ? "amber" : "slate"}>{k.replace(/_/g, " ")}: {v}</Pill>)}</div>
            )}
          </div>
          <div className="space-y-4">
            {ex.shap?.top?.length ? (
              <div>
                <h3 className="text-sm font-semibold text-slate-700">What drives predicted demand at {inr(rec.recommended_price)}</h3>
                <p className="text-[11px] text-slate-500">{ex.shap.method} · {ex.shap.model_version} · % change in demand vs the model baseline</p>
                <EffectBars rows={ex.shap.top.slice(0, 7).filter((s) => s.effect_pct !== null).map((s) => ({ label: s.label, value: s.effect_pct as number }))} />
              </div>
            ) : null}
            {candidates.length > 2 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-700">Expected profit by price</h3>
                <PriceCurveChart candidates={candidates} metric="profit" band={ex.bounds ? { lo: ex.bounds.lo, hi: ex.bounds.hi } : undefined}
                  current={rec.current_price} recommended={rec.recommended_price} height={200} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
