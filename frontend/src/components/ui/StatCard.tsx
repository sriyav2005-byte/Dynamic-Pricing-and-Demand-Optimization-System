/**
 * components/ui/StatCard.tsx — KPI Metric Card
 * ==============================================
 * Reusable card for displaying a single business metric.
 * Used on the Analytics page for: Revenue, Profit, Units, Margin, At-Risk.
 *
 * Features
 * --------
 * - Accent-coloured icon bubble with a soft glow background
 * - Optional trend indicator (green ↑ / red ↓ / neutral —)
 * - Glow blob in the top-right corner for depth
 * - Hover: slight upward translate + border brightens (CSS `.stat-card`)
 *
 * Props
 * -----
 * title       : Metric label shown below the value (e.g. "Total Revenue")
 * value       : The formatted metric value (e.g. "₹42.5K", "89.3%")
 * subtitle    : Optional secondary line below the title
 * icon        : Lucide icon component to display in the colour bubble
 * trend       : "up" | "down" | "neutral" — drives the trend arrow colour
 * trendValue  : Text shown next to the trend arrow (e.g. "+3.2%", "Live")
 * accentColor : CSS colour for the icon, glow, and trend (default: indigo)
 * glowColor   : Unused (kept for future use — remove if preferred)
 */

import { LucideIcon, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  accentColor?: string;
  glowColor?: string;
}

export default function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  trendValue,
  accentColor = "#6366f1",  // default: indigo
  glowColor   = "rgba(99,102,241,0.2)",
}: StatCardProps) {
  // Pick the right icon and colour for the trend direction
  const TrendIcon  = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendColor = trend === "up" ? "#10b981"   : trend === "down" ? "#ef4444"   : "#94a3b8";

  return (
    <div className="stat-card relative overflow-hidden" style={{ borderRadius: "16px" }}>

      {/* Decorative glow blob — clipped by overflow-hidden */}
      <div
        className="absolute top-0 right-0 w-24 h-24 rounded-full opacity-20 blur-2xl"
        style={{ background: accentColor, transform: "translate(30%, -30%)" }}
      />

      {/* Card content sits above the glow blob (relative z-index) */}
      <div className="relative">

        {/* Top row: icon bubble + optional trend badge */}
        <div className="flex items-start justify-between mb-4">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center"
            style={{
              background: `linear-gradient(135deg, ${accentColor}33, ${accentColor}15)`,
              border:     `1px solid ${accentColor}30`,
            }}
          >
            <Icon size={20} style={{ color: accentColor }} />
          </div>

          {/* Trend badge — only shown if both `trend` and `trendValue` are provided */}
          {trend && trendValue && (
            <div className="flex items-center gap-1" style={{ color: trendColor }}>
              <TrendIcon size={14} />
              <span className="text-xs font-semibold">{trendValue}</span>
            </div>
          )}
        </div>

        {/* Metric value (large), label, optional subtitle */}
        <div className="text-2xl font-bold text-slate-800 mb-1">{value}</div>
        <div className="text-sm font-medium" style={{ color: "#94a3b8" }}>{title}</div>
        {subtitle && (
          <div className="text-xs mt-1" style={{ color: "#64748b" }}>{subtitle}</div>
        )}
      </div>
    </div>
  );
}
