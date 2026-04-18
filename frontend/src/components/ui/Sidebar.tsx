/**
 * components/ui/Sidebar.tsx — Fixed Navigation Sidebar
 * ======================================================
 * Renders the left-hand navigation that persists across all pages.
 * Uses Next.js `usePathname()` to highlight the active route with an
 * indigo accent border and background tint.
 *
 * Layout
 * ------
 * ┌─────────────────┐
 * │ Logo + Brand    │  ← gradient icon + "PriceIQ" wordmark
 * ├─────────────────┤
 * │ Nav links       │  ← Dashboard, Analytics (expandable)
 * ├─────────────────┤
 * │ Status panel    │  ← live API + ML model status indicators
 * └─────────────────┘
 *
 * Styling: glassmorphism (backdrop-filter blur) with a translucent dark
 * background so page content is visible slightly behind the sidebar.
 */

"use client"; // required because usePathname() is a client-side hook

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  BarChart3,
  Cpu,
} from "lucide-react";

/** Navigation items — add new pages here to auto-include them in the sidebar. */
const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/analytics", label: "Analytics",  icon: BarChart3 },
];

export default function Sidebar() {
  // Track the current URL path to apply the active style to the matching nav link
  const pathname = usePathname();

  return (
    <aside
      className="fixed top-0 left-0 h-screen w-64 flex flex-col"
      style={{
        background: "rgba(10,15,30,0.95)",
        borderRight: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(20px)",  // glassmorphism effect
      }}
    >
      {/* ── Brand / Logo ─────────────────────────────────────────────────── */}
      <div className="p-6 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <div className="flex items-center gap-3">
          {/* Gradient icon bubble */}
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{
              background: "linear-gradient(135deg, #6366f1, #22d3ee)",
              boxShadow: "0 0 24px rgba(99,102,241,0.5)",
            }}
          >
            <Cpu size={18} className="text-white" />
          </div>
          <div>
            <div className="font-bold text-white text-base leading-tight">PriceIQ</div>
            <div className="text-xs" style={{ color: "#64748b" }}>ML Pricing Engine</div>
          </div>
        </div>
      </div>

      {/* ── Navigation links ────────────────────────────────────────────── */}
      <nav className="flex-1 p-4">
        <div
          className="mb-2 px-3 text-xs font-semibold uppercase tracking-widest"
          style={{ color: "#475569" }}
        >
          Navigation
        </div>
        <ul className="space-y-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            // A link is "active" if the pathname exactly matches or starts with its href.
            // The second condition handles nested routes like /product/[id].
            const active = pathname === href || pathname.startsWith(href + "/");

            return (
              <li key={href}>
                <Link
                  href={href}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200"
                  style={
                    active
                      ? {
                          background: "rgba(99,102,241,0.15)",
                          color: "#818cf8",
                          borderLeft: "2px solid #6366f1", // active indicator stripe
                        }
                      : { color: "#94a3b8" }
                  }
                >
                  <Icon size={18} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* ── System status panel ──────────────────────────────────────────── */}
      {/* Shows at a glance that the API is live and which ML models are active */}
      <div className="p-4 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <div className="glass rounded-xl p-3">
          <div className="flex items-center gap-2 mb-1">
            {/* Pulsing green dot = live API connection */}
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-semibold text-emerald-400">API Connected</span>
          </div>
          <div className="text-xs" style={{ color: "#64748b" }}>Thompson Sampling Active</div>
          <div className="text-xs mt-1" style={{ color: "#64748b" }}>XGBoost v3 Model</div>
        </div>
      </div>
    </aside>
  );
}
