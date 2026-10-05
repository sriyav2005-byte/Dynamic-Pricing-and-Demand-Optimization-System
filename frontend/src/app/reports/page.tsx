"use client";

/** /reports — CSV exports for sales, pricing changes, inventory and recommendations. */

import { useState } from "react";
import { FileDown } from "lucide-react";
import { downloadReport } from "@/lib/api";
import { useApp } from "@/components/providers/AppProvider";
import { Card, Field, Notice, PageHeader, Spinner } from "@/components/ui/kit";

const REPORTS = [
  { kind: "sales", title: "Sales", desc: "Every sale with price, cost, revenue, profit and source.", ranged: true },
  { kind: "pricing", title: "Price changes", desc: "Price history with old/new price, source (manual, recommendation, automatic, import), user and reason.", ranged: true },
  { kind: "recommendations", title: "Recommendations", desc: "AI recommendations with status, policy, expected profit and reviewer.", ranged: true },
  { kind: "inventory", title: "Inventory snapshot", desc: "Current stock, prices and value at cost for every active product.", ranged: false },
];

export default function ReportsPage() {
  const { storeId, can, toastError } = useApp();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [days, setDays] = useState("30");
  const [busy, setBusy] = useState<string | null>(null);

  async function get(kind: string) {
    setBusy(kind);
    try { await downloadReport(storeId, kind, from || to ? { from: from || undefined, to: to || undefined, days: 30 } : { days: Number(days) }); }
    catch (e) { toastError(e); } finally { setBusy(null); }
  }

  return (
    <>
      <PageHeader title="Reports" icon={FileDown} subtitle="CSV exports (UTF-8, opens in Excel) — all figures come straight from the database" />
      {!can("ANALYST") ? <Notice>Report exports require the Analyst role or higher.</Notice> : (
        <>
          <Card title="Period">
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="Last N days" hint="Relative to the store's latest data"><input className="input" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
              <Field label="or from"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label="to"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            </div>
          </Card>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {REPORTS.map((r) => (
              <Card key={r.kind} title={r.title} subtitle={r.desc}>
                <button className="btn-primary" onClick={() => get(r.kind)} disabled={!!busy}>{busy === r.kind ? <Spinner /> : <FileDown size={15} />} Download CSV</button>
                {!r.ranged && <p className="mt-2 text-xs text-slate-500">Not period-based.</p>}
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}
