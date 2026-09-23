/**
 * components/ui/Sidebar.tsx — Fixed Navigation Sidebar
 * ======================================================
 * Renders the left-hand navigation that persists across all pages.
 * Uses Next.js `usePathname()` to highlight the active route.
 *
 * Navigation items:
 *   Dashboard, Products, Competitors, Forecasting,
 *   Inventory, AI Agent, Analytics
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  BarChart3,
  Cpu,
  Package,
  ShieldCheck,
  TrendingUp,
  Warehouse,
  MessageSquare,
  Search,
} from "lucide-react";

const NAV = [
  { href: "/dashboard",    label: "Dashboard",    icon: LayoutDashboard, badge: null },
  { href: "/products",     label: "Products",     icon: Package,         badge: null },
  { href: "/competitors",  label: "Competitors",  icon: ShieldCheck,     badge: null },
  { href: "/forecasting",  label: "Forecasting",  icon: TrendingUp,      badge: null },
  { href: "/inventory",    label: "Inventory",    icon: Warehouse,       badge: null },
  { href: "/live-search",  label: "Live Search",  icon: Search,          badge: "LIVE" },
  { href: "/agent",        label: "AI Agent",     icon: MessageSquare,   badge: "AI" },
  { href: "/analytics",    label: "Analytics",    icon: BarChart3,       badge: null },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="fixed top-0 left-0 h-screen w-64 flex flex-col z-50"
      style={{
        background: "rgba(255, 255, 255, 0.9)",
        borderRight: "1px solid rgba(0, 0, 0, 0.05)",
        backdropFilter: "blur(20px)",
      }}
    >
      {/* ── Brand / Logo ─────────────────────────────────────────────────── */}
      <div className="p-6 border-b" style={{ borderColor: "rgba(0, 0, 0, 0.05)" }}>
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{
              background: "linear-gradient(135deg, #7c3aed, #22d3ee)",
              boxShadow: "0 0 24px rgba(124, 58, 237, 0.3)",
            }}
          >
            <Cpu size={18} className="text-white" />
          </div>
          <div>
            <div className="font-bold text-slate-900 text-base leading-tight">PriceIQ</div>
            <div className="text-xs" style={{ color: "#64748b" }}>Pricing Intelligence</div>
          </div>
        </div>
      </div>

      {/* ── Navigation links ────────────────────────────────────────────── */}
      <nav className="flex-1 p-4 overflow-y-auto">
        <div
          className="mb-2 px-3 text-xs font-semibold uppercase tracking-widest"
          style={{ color: "#94a3b8" }}
        >
          Navigation
        </div>
        <ul className="space-y-1">
          {NAV.map(({ href, label, icon: Icon, badge }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            const isAgent = href === "/agent";
            const isLiveSearch = href === "/live-search";

            const activeBg = isAgent
              ? "rgba(34, 211, 238, 0.08)"
              : isLiveSearch
              ? "rgba(239, 68, 68, 0.08)"
              : "rgba(124, 58, 237, 0.08)";
            const activeColor = isAgent
              ? "#0891b2"
              : isLiveSearch
              ? "#dc2626"
              : "#7c3aed";

            return (
              <li key={href}>
                <Link
                  href={href}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200"
                  style={
                    active
                      ? {
                          background: activeBg,
                          color: activeColor,
                          borderLeft: `2px solid ${activeColor}`,
                        }
                      : { color: "#64748b" }
                  }
                >
                  <Icon size={18} />
                  {label}
                  {badge && (
                    <span
                      className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-1"
                      style={{
                        background: isLiveSearch
                          ? "rgba(239, 68, 68, 0.12)"
                          : "rgba(34, 211, 238, 0.12)",
                        color: isLiveSearch ? "#dc2626" : "#0891b2",
                      }}
                    >
                      {isLiveSearch && (
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />
                      )}
                      {badge}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* ── System status panel ──────────────────────────────────────────── */}
      <div className="p-4 border-t" style={{ borderColor: "rgba(0, 0, 0, 0.05)" }}>
        <div className="glass rounded-xl p-3">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-bold text-emerald-600">API Connected</span>
          </div>
          <div className="text-xs font-medium" style={{ color: "#475569" }}>Thompson Sampling Active</div>
          <div className="text-xs font-medium mt-0.5" style={{ color: "#475569" }}>XGBoost v3 Model</div>
          <div className="text-xs font-medium mt-0.5" style={{ color: "#475569" }}>5 Platform Search</div>
        </div>
      </div>
    </aside>
  );
}
