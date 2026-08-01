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
  Zap,
} from "lucide-react";

const NAV = [
  { href: "/dashboard",   label: "Dashboard",    icon: LayoutDashboard },
  { href: "/products",    label: "Products",     icon: Package },
  { href: "/competitors", label: "Competitors",  icon: ShieldCheck },
  { href: "/forecasting", label: "Forecasting",  icon: TrendingUp },
  { href: "/inventory",   label: "Inventory",    icon: Warehouse },
  { href: "/agent",       label: "AI Agent",     icon: MessageSquare },
  { href: "/analytics",   label: "Analytics",    icon: BarChart3 },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="fixed top-0 left-0 h-screen w-64 flex flex-col z-50"
      style={{
        background: "rgba(255, 255, 255, 0.92)",
        borderRight: "1px solid rgba(124, 58, 237, 0.08)",
        backdropFilter: "blur(24px)",
        boxShadow: "4px 0 24px rgba(0, 0, 0, 0.04)",
      }}
    >
      {/* ── Brand / Logo ─────────────────────────────────────────────────── */}
      <div
        className="p-5 border-b"
        style={{ borderColor: "rgba(124, 58, 237, 0.08)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: "linear-gradient(135deg, #7c3aed, #22d3ee)",
              boxShadow: "0 0 20px rgba(124, 58, 237, 0.35)",
            }}
          >
            <Cpu size={18} className="text-white" />
          </div>
          <div className="min-w-0">
            <div className="font-extrabold text-slate-900 text-base leading-tight tracking-tight">
              PriceIQ
            </div>
            <div
              className="text-[10px] font-semibold uppercase tracking-widest mt-0.5"
              style={{ color: "#94a3b8" }}
            >
              Pricing Intelligence
            </div>
          </div>
          {/* Version badge */}
          <span
            className="ml-auto text-[9px] font-extrabold px-1.5 py-0.5 rounded-full flex-shrink-0"
            style={{
              background: "linear-gradient(135deg, rgba(124,58,237,0.12), rgba(34,211,238,0.12))",
              color: "#7c3aed",
              border: "1px solid rgba(124,58,237,0.2)",
            }}
          >
            v4.0
          </span>
        </div>
      </div>

      {/* ── Navigation links ────────────────────────────────────────────── */}
      <nav className="flex-1 p-4 overflow-y-auto">
        <div
          className="mb-3 px-2 text-[10px] font-bold uppercase tracking-widest"
          style={{ color: "#cbd5e1" }}
        >
          Navigation
        </div>
        <ul className="space-y-0.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            const isAgent = href === "/agent";

            return (
              <li key={href}>
                <Link
                  href={href}
                  className="group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200"
                  style={
                    active
                      ? {
                          background: isAgent
                            ? "linear-gradient(135deg, rgba(34,211,238,0.1), rgba(34,211,238,0.05))"
                            : "linear-gradient(135deg, rgba(124,58,237,0.1), rgba(124,58,237,0.05))",
                          color: isAgent ? "#0891b2" : "#7c3aed",
                          borderLeft: `2px solid ${isAgent ? "#22d3ee" : "#7c3aed"}`,
                          boxShadow: isAgent
                            ? "inset 0 0 12px rgba(34,211,238,0.05)"
                            : "inset 0 0 12px rgba(124,58,237,0.05)",
                        }
                      : { color: "#64748b" }
                  }
                >
                  {/* Icon */}
                  <span
                    className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-200"
                    style={
                      active
                        ? {
                            background: isAgent
                              ? "rgba(34,211,238,0.15)"
                              : "rgba(124,58,237,0.12)",
                          }
                        : { background: "transparent" }
                    }
                  >
                    <Icon size={15} />
                  </span>
                  {label}
                  {isAgent && (
                    <span
                      className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
                      style={{
                        background: "rgba(34, 211, 238, 0.12)",
                        color: "#0891b2",
                      }}
                    >
                      <Zap size={7} />
                      AI
                    </span>
                  )}
                  {/* Active dot indicator */}
                  {active && !isAgent && (
                    <span
                      className="ml-auto w-1.5 h-1.5 rounded-full"
                      style={{ background: "#7c3aed", opacity: 0.6 }}
                    />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* ── System status panel ──────────────────────────────────────────── */}
      <div
        className="p-4 border-t"
        style={{ borderColor: "rgba(124, 58, 237, 0.08)" }}
      >
        <div
          className="rounded-xl p-3"
          style={{
            background: "linear-gradient(135deg, rgba(124,58,237,0.04), rgba(34,211,238,0.03))",
            border: "1px solid rgba(124,58,237,0.08)",
          }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-bold text-emerald-600">API Connected</span>
          </div>
          <div className="space-y-0.5">
            {["Thompson Sampling Active", "XGBoost v3 Model", "6 Competitor Feeds"].map((txt) => (
              <div
                key={txt}
                className="text-[11px] font-medium flex items-center gap-1.5"
                style={{ color: "#64748b" }}
              >
                <span
                  className="w-1 h-1 rounded-full inline-block"
                  style={{ background: "rgba(124,58,237,0.4)" }}
                />
                {txt}
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
