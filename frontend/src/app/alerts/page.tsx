"use client";

/** /alerts — inventory, competitor, demand, pricing and anomaly alerts. */

import Link from "next/link";
import { useState } from "react";
import { Check, CheckCheck, RefreshCw, Siren } from "lucide-react";
import { dateFmt, getAlerts, scanAlerts, updateAlert } from "@/lib/api";
import { useApp } from "@/components/providers/AppProvider";
import { Card, EmptyState, ErrorState, PageHeader, Pill, RoleGate, SeverityBadge, SkeletonRows, Spinner, useAsync } from "@/components/ui/kit";

const TYPES = ["", "LOW_STOCK", "PREDICTED_STOCKOUT", "OVERSTOCK", "DEAD_STOCK", "EXPIRY", "COMPETITOR_UNDERCUT", "COMPETITOR_PRICE_CHANGE", "DEMAND_SPIKE", "DEMAND_DROP", "PRICING_OPPORTUNITY", "ANOMALY"];

export default function AlertsPage() {
  const { storeId, toast, toastError, can } = useApp();
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [type, setType] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useAsync(() => getAlerts(storeId, { status, severity, type, page_size: 100 }), [storeId, status, severity, type]);

  async function scan() {
    setBusy(true);
    try {
      const r = await scanAlerts(storeId);
      toast(`Scan complete: ${r.created} new, ${r.updated} updated, ${r.resolved} resolved${r.warnings.length ? ` (${r.warnings.join("; ")})` : ""}`, r.warnings.length ? "warning" : "success");
      list.reload();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  }
  async function setAlertStatus(id: string, s: string) {
    try { await updateAlert(storeId, id, s); list.reload(); } catch (e) { toastError(e); }
  }

  return (
    <>
      <PageHeader title="Alerts" icon={Siren} subtitle="Detected every 15 minutes; resolved automatically when the condition clears. HIGH and CRITICAL alerts notify managers."
        actions={<RoleGate min="ANALYST"><button className="btn-primary" onClick={scan} disabled={busy}>{busy ? <Spinner /> : <RefreshCw size={15} />} Scan now</button></RoleGate>} />
      <Card>
        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Open & acknowledged</option><option value="OPEN">Open</option><option value="ACKNOWLEDGED">Acknowledged</option><option value="RESOLVED">Resolved</option><option value="ALL">All</option></select>
          <select className="select" value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity">
            <option value="">All severities</option>{["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((s) => <option key={s}>{s}</option>)}</select>
          <select className="select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
            {TYPES.map((t) => <option key={t} value={t}>{t ? t.replace(/_/g, " ").toLowerCase() : "All types"}</option>)}</select>
        </div>
        {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : !list.data ? <SkeletonRows rows={8} cols={4} /> : list.data.data.length === 0 ? (
          <EmptyState title="No alerts" message="Nothing needs attention with these filters." icon={Siren} />
        ) : (
          <ul className="divide-y divide-slate-100">{list.data.data.map((a) => (
            <li key={a.id} className="flex flex-col gap-2 py-3 md:flex-row md:items-start">
              <div className="w-28 shrink-0"><SeverityBadge severity={a.severity} /></div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-800">{a.title}</p>
                <p className="text-sm text-slate-600">{a.message}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <Pill>{a.alert_type.replace(/_/g, " ").toLowerCase()}</Pill>{a.status !== "OPEN" && <Pill tone="sky">{a.status.toLowerCase()}</Pill>}
                  first seen {dateFmt(a.created_at, true)} · updated {dateFmt(a.updated_at, true)}
                  {a.product_id && <Link href={`/product/${a.product_id}`} className="text-violet-700 hover:underline">open product →</Link>}
                </p>
              </div>
              {can("ANALYST") && a.status !== "RESOLVED" && (
                <div className="flex shrink-0 gap-1">
                  {a.status === "OPEN" && <button className="btn-secondary !py-1 text-xs" onClick={() => setAlertStatus(a.id, "ACKNOWLEDGED")}><Check size={13} /> Acknowledge</button>}
                  <button className="btn-secondary !py-1 text-xs" onClick={() => setAlertStatus(a.id, "RESOLVED")}><CheckCheck size={13} /> Resolve</button>
                </div>
              )}
            </li>))}</ul>
        )}
      </Card>
    </>
  );
}
