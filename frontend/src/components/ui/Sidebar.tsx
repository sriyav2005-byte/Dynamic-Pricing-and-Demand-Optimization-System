"use client";

/**
 * Sidebar — navigation, store switcher, notifications and profile.
 * Collapses into a drawer below the lg breakpoint.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bell, BarChart3, Bot, Calculator, ClipboardCheck, Cpu, FileDown, LayoutDashboard, LogOut, Package, Search, Settings,
  ShieldCheck, Siren, Sparkles, Store, Tags, TrendingUp, Warehouse, X,
} from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { getNotifications, Notification, readNotification, dateFmt } from "@/lib/api";

const NAV = [
  { group: "Overview", items: [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/analytics", label: "Analytics", icon: BarChart3 },
    { href: "/alerts", label: "Alerts", icon: Siren },
  ]},
  { group: "Pricing", items: [
    { href: "/pricing", label: "Pricing", icon: Tags },
    { href: "/simulator", label: "Price Simulator", icon: Calculator },
    { href: "/competitors", label: "Competitors", icon: ShieldCheck },
    { href: "/live-search", label: "Competitor Search", icon: Search },
  ]},
  { group: "Operations", items: [
    { href: "/products", label: "Products", icon: Package },
    { href: "/inventory", label: "Inventory", icon: Warehouse },
    { href: "/forecasting", label: "Forecasting", icon: TrendingUp },
    { href: "/seasonal", label: "Seasonal Intelligence", icon: Sparkles },
  ]},
  { group: "Assist", items: [
    { href: "/agent", label: "AI Copilot", icon: Bot },
    { href: "/reports", label: "Reports", icon: FileDown },
    { href: "/audit", label: "Audit Log", icon: ClipboardCheck },
    { href: "/settings", label: "Settings", icon: Settings },
  ]},
];

export default function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, storeId, setStoreId, logout, role } = useApp();
  const [notes, setNotes] = useState<{ unread: number; items: Notification[] } | null>(null);
  const [showNotes, setShowNotes] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => getNotifications().then((n) => alive && setNotes(n)).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  useEffect(() => { onClose(); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = me?.profile.full_name || me?.profile.email || "User";
  const orgs = Array.from(new Set(me?.stores.map((s) => s.organization_name) ?? []));

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-slate-900/30 lg:hidden" onClick={onClose} aria-hidden />}
      <aside className={`fixed left-0 top-0 z-50 flex h-screen w-64 flex-col border-r border-slate-100 bg-white transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
        aria-label="Main navigation">
        <div className="flex items-center justify-between px-5 pb-3 pt-5">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: "linear-gradient(135deg,#7c3aed,#22d3ee)" }}><Cpu size={18} className="text-white" /></div>
            <div>
              <p className="font-bold leading-none gradient-text">PriceIQ</p>
              <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-400">Retail Intelligence</p>
            </div>
          </Link>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 lg:hidden" aria-label="Close navigation"><X size={18} /></button>
        </div>

        <div className="px-4 pb-3">
          <label className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400" htmlFor="store-switch"><Store size={11} /> Store</label>
          <select id="store-switch" className="select !py-1.5 text-sm" value={storeId} onChange={(e) => { setStoreId(e.target.value); router.refresh(); }}>
            {orgs.map((org) => (
              <optgroup key={org} label={org}>
                {me?.stores.filter((s) => s.organization_name === org).map((s) => (
                  <option key={s.store_id} value={s.store_id}>{s.store_name}{s.data_mode === "SYNTHETIC" ? " (demo data)" : ""}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {role && <p className="mt-1 text-[11px] text-slate-500">Your role: <span className="font-semibold text-violet-700">{role.replace("_", " ")}</span></p>}
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {NAV.map((g) => (
            <div key={g.group} className="mt-3">
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{g.group}</p>
              {g.items.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(href + "/") || (href === "/products" && pathname.startsWith("/product/"));
                return (
                  <Link key={href} href={href} aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${active ? "bg-violet-50 text-violet-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}>
                    <Icon size={17} />{label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="relative border-t border-slate-100 p-3">
          <button onClick={() => setShowNotes((v) => !v)} className="mb-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50" aria-expanded={showNotes}>
            <Bell size={16} /> Notifications
            {!!notes?.unread && <span className="ml-auto rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{notes.unread}</span>}
          </button>
          {showNotes && (
            <div className="absolute bottom-full left-3 right-3 mb-2 max-h-96 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
              <div className="flex items-center justify-between px-2 py-1">
                <p className="text-xs font-semibold text-slate-600">Notifications</p>
                {!!notes?.unread && <button className="text-xs text-violet-700 hover:underline" onClick={async () => { await readNotification("all"); setNotes(await getNotifications()); }}>Mark all read</button>}
              </div>
              {!notes?.items.length && <p className="px-2 py-4 text-center text-xs text-slate-400">No notifications</p>}
              {notes?.items.map((n) => (
                <button key={n.id} className={`block w-full rounded-lg px-2 py-2 text-left hover:bg-slate-50 ${n.read_at ? "opacity-60" : ""}`}
                  onClick={async () => { await readNotification(n.id).catch(() => {}); setShowNotes(false); router.push("/alerts"); setNotes(await getNotifications()); }}>
                  <p className="text-xs font-semibold text-slate-700">{n.title}</p>
                  <p className="line-clamp-2 text-[11px] text-slate-500">{n.body}</p>
                  <p className="mt-0.5 text-[10px] text-slate-400">{dateFmt(n.created_at, true)}</p>
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: "linear-gradient(135deg,#7c3aed,#22d3ee)" }}>{name.charAt(0).toUpperCase()}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-700">{name}</p>
              <p className="truncate text-[11px] text-slate-400">{me?.profile.email}</p>
            </div>
            <button onClick={logout} aria-label="Sign out" title="Sign out" className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>
    </>
  );
}
