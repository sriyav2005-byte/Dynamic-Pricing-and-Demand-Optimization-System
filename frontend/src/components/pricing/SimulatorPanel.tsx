"use client";

/** SimulatorPanel — what-if analysis for test prices and scenarios. */

import { useState } from "react";
import { Calculator, Plus, X } from "lucide-react";
import { errorMessage, inr, num, pct, simulate, Simulation } from "@/lib/api";
import { useApp } from "@/components/providers/AppProvider";
import { EmptyState, Notice, Pill, Spinner } from "@/components/ui/kit";
import { PriceCurveChart } from "@/components/charts/viz";

type Scn = { type: "our_price_change" | "demand_change" | "competitor_price_change"; pct: number; on: boolean };

export default function SimulatorPanel({ productId, currentPrice, mrp }: { productId: string; currentPrice: number; mrp: number }) {
  const { storeId, can } = useApp();
  const [prices, setPrices] = useState<number[]>(() => [0.9, 0.95, 1, 1.05].map((m) => Math.round(Math.min(currentPrice * m, mrp) * 100) / 100));
  const [draft, setDraft] = useState("");
  const [scn, setScn] = useState<Scn[]>([
    { type: "our_price_change", pct: -5, on: true },
    { type: "competitor_price_change", pct: -10, on: true },
    { type: "demand_change", pct: 20, on: true },
  ]);
  const [horizon, setHorizon] = useState<number | "">("");
  const [res, setRes] = useState<Simulation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    try {
      setRes(await simulate(storeId, {
        product_id: productId, prices: [...new Set(prices)].sort((a, b) => a - b),
        scenarios: scn.filter((s) => s.on).map(({ type, pct }) => ({ type, pct })), horizon_days: horizon || undefined,
      }));
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  if (!can("ANALYST")) return <Notice>Simulations require the Analyst role or higher.</Notice>;

  const labels = { our_price_change: "Our price changes by", competitor_price_change: "Competitor prices change by", demand_change: "Demand changes by" };
  const addPrice = () => {
    const v = Number(draft);
    if (v > 0 && v <= mrp * 3) setPrices((p) => [...p, Math.round(v * 100) / 100]);
    setDraft("");
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <p className="text-sm font-semibold text-slate-700">Test prices <span className="font-normal text-slate-400">(current {inr(currentPrice)}, MRP {inr(mrp)})</span></p>
          <div className="mt-2 flex flex-wrap gap-2">
            {prices.map((p, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-sm text-violet-800 num">
                {inr(p)}<button aria-label={`Remove ${p}`} onClick={() => setPrices(prices.filter((_, j) => j !== i))}><X size={12} /></button>
              </span>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input className="input !w-36" inputMode="decimal" placeholder="Add price ₹" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPrice()} aria-label="Add test price" />
            <button className="btn-secondary" onClick={addPrice}><Plus size={14} /> Add</button>
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-700">Scenarios</p>
          <div className="mt-2 space-y-2">
            {scn.map((s, i) => (
              <label key={s.type} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={s.on} onChange={(e) => setScn(scn.map((x, j) => j === i ? { ...x, on: e.target.checked } : x))} />
                <span className="w-56 text-slate-600">{labels[s.type]}</span>
                <input className="input !w-20 !py-1" inputMode="decimal" value={s.pct} onChange={(e) => setScn(scn.map((x, j) => j === i ? { ...x, pct: Number(e.target.value) || 0 } : x))} aria-label={`${labels[s.type]} percent`} />%
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm text-slate-600">Horizon
              <input className="input !w-20 !py-1" inputMode="numeric" placeholder="auto" value={horizon} onChange={(e) => setHorizon(e.target.value ? Math.min(90, Math.max(1, Number(e.target.value))) : "")} aria-label="Horizon days" /> days
              <span className="text-xs text-slate-400">(auto = until expiry, else 7)</span>
            </label>
          </div>
        </div>
      </div>
      <button className="btn-primary" onClick={run} disabled={busy || prices.length === 0}>{busy ? <Spinner /> : <Calculator size={15} />} Run simulation</button>
      {error && <Notice tone="danger">{error}</Notice>}

      {!res && !busy && <EmptyState title="Run a simulation" message="See predicted demand, revenue, profit, margin, waste and risk for each price." icon={Calculator} />}
      {res && (
        <div className="space-y-5">
          <p className="text-xs text-slate-500">{res.model_version} · horizon {res.horizon_days} day(s) · per-day figures averaged over the horizon; profit is net of expected waste. Allowed band {inr(res.bounds.lo)} – {inr(res.bounds.hi)}.</p>
          <div className="table-wrap"><table className="data-table">
            <thead><tr><th>Price</th><th className="text-right">Demand/day</th><th className="text-right">Revenue/day</th><th className="text-right">Profit/day</th><th className="text-right">Margin</th>
              <th className="text-right">Waste (units)</th><th className="text-right">Sells out in</th><th>vs market</th><th>Risk</th><th>Constraints</th></tr></thead>
            <tbody>{res.results.map((r) => {
              const v = res.constraint_violations[r.price.toFixed(2)] ?? [];
              const isCur = Math.abs(r.price - res.current_price) < 0.005;
              return (
                <tr key={r.price} className={isCur ? "bg-violet-50/60" : ""}>
                  <td className="num font-semibold">{inr(r.price)}{isCur && <span className="ml-1 text-[10px] text-violet-700">current</span>}</td>
                  <td className="num text-right">{r.demand.toFixed(1)} <span className="text-[11px] text-slate-400">{pct(r.vs_current?.demand_pct ?? null, 0, true)}</span></td>
                  <td className="num text-right">{inr(r.revenue)}</td>
                  <td className={`num text-right font-semibold ${r.profit < 0 ? "text-red-700" : ""}`}>{inr(r.profit)}</td>
                  <td className="num text-right">{pct(r.margin_pct)}</td>
                  <td className="num text-right">{num(r.waste_units, 1)}</td>
                  <td className="num text-right">{r.days_to_sell_out ? `${r.days_to_sell_out} d` : "—"}</td>
                  <td>{r.competitor_position ? pct(r.competitor_position.vs_market_avg_pct, 1, true) : <span className="text-xs text-slate-400">no data</span>}</td>
                  <td><Pill tone={r.risk?.level === "HIGH" ? "red" : r.risk?.level === "MEDIUM" ? "amber" : "green"} title={r.risk?.reason}>{r.risk?.level}</Pill></td>
                  <td className="text-xs">{v.length ? <span className="text-red-700">{v.join("; ")}</span> : <span className="text-emerald-700">OK</span>}</td>
                </tr>);
            })}</tbody>
          </table></div>
          {res.results.length > 2 && (
            <div className="grid gap-5 lg:grid-cols-2">
              <div><p className="text-sm font-semibold text-slate-700">Demand vs price</p>
                <PriceCurveChart candidates={res.results.map((r) => ({ price: r.price, demand: r.demand, profit: r.profit }))} metric="demand" band={res.bounds} current={res.current_price} /></div>
              <div><p className="text-sm font-semibold text-slate-700">Profit vs price</p>
                <PriceCurveChart candidates={res.results.map((r) => ({ price: r.price, demand: r.demand, profit: r.profit }))} metric="profit" band={res.bounds} current={res.current_price} /></div>
            </div>
          )}
          {res.scenarios.length > 0 && (
            <div className="grid gap-3 md:grid-cols-3">
              {res.scenarios.map((s, i) => (
                <div key={i} className="rounded-xl border border-slate-100 bg-white p-4">
                  <p className="text-sm font-semibold text-slate-700">{s.label ?? s.scenario.type}</p>
                  {s.result ? (
                    <ul className="mt-2 space-y-0.5 text-sm text-slate-600">
                      <li>Demand {s.result.demand.toFixed(1)}/day (now {res.current.demand.toFixed(1)})</li>
                      <li>Profit {inr(s.result.profit)}/day (now {inr(res.current.profit)})</li>
                      <li>Margin {pct(s.result.margin_pct)} · waste {num(s.result.waste_units, 1)}</li>
                      {s.risk && <li><Pill tone={s.risk.level === "HIGH" ? "red" : s.risk.level === "MEDIUM" ? "amber" : "green"}>{s.risk.level} risk</Pill> <span className="text-xs">{s.risk.reason}</span></li>}
                    </ul>
                  ) : null}
                  {s.estimable === false && <Notice tone="warning">{s.note}</Notice>}
                  {s.result && s.note && <p className="mt-1 text-xs text-slate-500">{s.note}</p>}
                </div>
              ))}
            </div>
          )}
          <div>
            <p className="text-sm font-semibold text-slate-700">Effect on other products</p>
            {res.cross_effects.length === 0 ? <p className="text-sm text-slate-500">No statistically supported substitute or complement relationships for this product, so no cannibalization effect is assumed.</p> : (
              <ul className="mt-1 space-y-1 text-sm">{res.cross_effects.map((c, i) => (
                <li key={i}>At {inr(c.price)}: {c.affected_product} ({c.relationship.toLowerCase()}) demand {pct(c.demand_change_pct, 1, true)}</li>))}</ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
