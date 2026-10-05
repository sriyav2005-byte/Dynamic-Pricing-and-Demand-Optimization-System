"use client";

/** /audit — who changed what, when and why (store managers and above). */

import { useState } from "react";
import { ChevronLeft, ChevronRight, ClipboardCheck } from "lucide-react";
import { dateFmt, getAuditLog } from "@/lib/api";
import { useApp } from "@/components/providers/AppProvider";
import { Card, EmptyState, ErrorState, Notice, PageHeader, Pill, SkeletonRows, useAsync } from "@/components/ui/kit";

const fmt = (v: unknown) => (v === null || v === undefined ? "∅" : typeof v === "object" ? JSON.stringify(v) : String(v));

export default function AuditPage() {
  const { storeId, can } = useApp();
  const [entity, setEntity] = useState("");
  const [page, setPage] = useState(1);
  const log = useAsync(() => getAuditLog(storeId, { entity_type: entity || undefined, page, page_size: 50 }), [storeId, entity, page], can("STORE_MANAGER"));
  const pages = log.data ? Math.max(1, Math.ceil(log.data.total / 50)) : 1;

  if (!can("STORE_MANAGER")) return <><PageHeader title="Audit log" icon={ClipboardCheck} /><Notice>The audit log is visible to store managers and admins.</Notice></>;
  return (
    <>
      <PageHeader title="Audit log" icon={ClipboardCheck} subtitle="Written by database triggers — every change is captured whichever path made it"
        actions={<select className="select !w-auto" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} aria-label="Entity type">
          <option value="">All entities</option>{["products", "pricing_recommendations", "store_settings", "memberships", "stores", "suppliers", "categories"].map((e) => <option key={e} value={e}>{e.replace(/_/g, " ")}</option>)}</select>} />
      <Card>
        {log.error ? <ErrorState message={log.error} onRetry={log.reload} /> : !log.data ? <SkeletonRows rows={10} cols={5} /> : log.data.data.length === 0 ? <EmptyState title="No audit entries" /> : (
          <div className="table-wrap"><table className="data-table">
            <thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Changes</th><th>Reason</th></tr></thead>
            <tbody>{log.data.data.map((e) => (
              <tr key={e.id} className="align-top">
                <td className="whitespace-nowrap text-xs">{dateFmt(e.created_at, true)}</td>
                <td className="text-xs">{e.user_email ?? <span className="text-slate-400">system</span>}</td>
                <td><Pill tone={e.action === "delete" ? "red" : e.action === "insert" ? "green" : "sky"}>{e.action}</Pill></td>
                <td className="text-xs">{e.entity_type.replace(/_/g, " ")}<div className="text-[10px] text-slate-400">{e.entity_id?.slice(0, 8)}</div></td>
                <td className="max-w-md text-xs">{e.action === "update" && e.new_value ? Object.keys(e.new_value).map((k) => (
                  <div key={k}><span className="font-medium text-slate-600">{k}</span>: <span className="text-red-700 line-through">{fmt(e.old_value?.[k])}</span> → <span className="text-emerald-700">{fmt(e.new_value?.[k])}</span></div>
                )) : <span className="text-slate-400">{e.action === "insert" ? "created" : "deleted"}</span>}</td>
                <td className="text-xs text-slate-600">{e.reason ?? ""}</td>
              </tr>))}</tbody>
          </table></div>
        )}
        {log.data && log.data.total > 50 && (
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-secondary !py-1" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={14} /></button>
            <span className="self-center text-sm text-slate-500">page {page} / {pages}</span>
            <button className="btn-secondary !py-1" disabled={page >= pages} onClick={() => setPage(page + 1)}><ChevronRight size={14} /></button>
          </div>
        )}
      </Card>
    </>
  );
}
