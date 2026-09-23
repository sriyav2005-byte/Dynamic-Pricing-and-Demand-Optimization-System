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
import { usePathname, useRouter } from "next/navigation";
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
  Sparkles,
  LogOut,
  ChevronRight,
} from "lucide-react";

const NAV = [
  { href: "/dashboard",    label: "Dashboard",    icon: LayoutDashboard, badge: null },
  { href: "/products",     label: "Products",     icon: Package,         badge: null },
  { href: "/competitors",  label: "Competitors",  icon: ShieldCheck,     badge: null },
  { href: "/forecasting",  label: "Forecasting",  icon: TrendingUp,      badge: null },
  { href: "/inventory",    label: "Inventory",    icon: Warehouse,       badge: null },
  { href: "/seasonal",     label: "Seasonal",     icon: Sparkles,        badge: "SOON" },
  { href: "/live-search",  label: "Live Search",  icon: Search,          badge: "LIVE" },
  { href: "/agent",        label: "AI Agent",     icon: MessageSquare,   badge: "AI" },
  { href: "/analytics",    label: "Analytics",    icon: BarChart3,       badge: null },
];

// ── Dummy user (mirrors the demo login account) ───────────────────────────────
const DEMO_USER = {
  name: "Demo User",
  email: "demo@priceiq.ai",
  role: "Store Manager",
  // avatar color gradient — derived from name
  avatarGradient: "linear-gradient(135deg, #7c3aed, #22d3ee)",
};

export default function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();

  const initial = DEMO_USER.name.charAt(0).toUpperCase();

  const handleLogout = () => {
    localStorage.removeItem("priceiq_auth");
    router.push("/login");
  };

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
            const isSeasonal = href === "/seasonal";

            const activeBg = isAgent
              ? "rgba(34, 211, 238, 0.08)"
              : isLiveSearch
              ? "rgba(239, 68, 68, 0.08)"
              : isSeasonal
              ? "rgba(245, 158, 11, 0.08)"
              : "rgba(124, 58, 237, 0.08)";
            const activeColor = isAgent
              ? "#0891b2"
              : isLiveSearch
              ? "#dc2626"
              : isSeasonal
              ? "#d97706"
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
                          : isSeasonal
                          ? "rgba(245, 158, 11, 0.12)"
                          : "rgba(34, 211, 238, 0.12)",
                        color: isLiveSearch ? "#dc2626" : isSeasonal ? "#d97706" : "#0891b2",
                      }}
                    >
                      {isLiveSearch && (
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />
                      )}
                      {isSeasonal && (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse inline-block" />
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

      {/* ── System status ─────────────────────────────────────────────────── */}
      <div className="px-4 pb-3" style={{ borderTop: "1px solid rgba(0,0,0,0.04)" }}>
        <div className="glass rounded-xl p-3 mt-3">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-bold text-emerald-600">API Connected</span>
          </div>
          <div className="text-xs font-medium" style={{ color: "#475569" }}>Thompson Sampling Active</div>
          <div className="text-xs font-medium mt-0.5" style={{ color: "#475569" }}>XGBoost v3 Model</div>
          <div className="text-xs font-medium mt-0.5" style={{ color: "#475569" }}>5 Platform Search</div>
        </div>
      </div>

      {/* ── User profile ──────────────────────────────────────────────────── */}
      <div
        className="p-4"
        style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}
      >
        <div
          className="flex items-center gap-3 p-3 rounded-2xl group transition-all duration-200 cursor-default"
          style={{ background: "rgba(124,58,237,0.04)", border: "1px solid rgba(124,58,237,0.1)" }}
        >
          {/* Avatar — first letter of name */}
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white font-extrabold text-base select-none"
            style={{
              background: DEMO_USER.avatarGradient,
              boxShadow: "0 0 16px rgba(124,58,237,0.3)",
              letterSpacing: "0.05em",
            }}
          >
            {initial}
          </div>

          {/* Name + role */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-800 truncate leading-none mb-0.5">
              {DEMO_USER.name}
            </p>
            <p className="text-[11px] truncate" style={{ color: "#94a3b8" }}>
              {DEMO_USER.role}
            </p>
          </div>

          {/* Logout button */}
          <button
            onClick={handleLogout}
            title="Sign out"
            className="w-8 h-8 flex items-center justify-center rounded-xl transition-all duration-150 flex-shrink-0"
            style={{ color: "#94a3b8" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.08)";
              (e.currentTarget as HTMLButtonElement).style.color = "#ef4444";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8";
            }}
          >
            <LogOut size={15} />
          </button>
        </div>

        {/* Demo badge */}
        <div className="flex items-center justify-center gap-1.5 mt-2">
          <ChevronRight size={10} style={{ color: "#cbd5e1" }} />
          <span className="text-[10px] font-semibold" style={{ color: "#cbd5e1" }}>
            Demo Account · PriceIQ v4.0
          </span>
          <ChevronRight size={10} style={{ color: "#cbd5e1" }} />
        </div>
      </div>
    </aside>
  );
}
