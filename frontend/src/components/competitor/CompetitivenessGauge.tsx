/**
 * components/competitor/CompetitivenessGauge.tsx
 * ===============================================
 * Radial gauge showing a competitiveness score (0-100).
 * Uses Recharts RadialBarChart with color gradients.
 */

"use client";

import {
  RadialBarChart,
  RadialBar,
  ResponsiveContainer,
} from "recharts";

interface Props {
  score: number;
  size?: number;
  label?: string;
}

export default function CompetitivenessGauge({ score, size = 120, label }: Props) {
  const color =
    score >= 70 ? "#10b981" : score >= 40 ? "#f59e0b" : "#ef4444";

  const data = [
    { name: "score", value: score, fill: color },
  ];

  return (
    <div className="flex flex-col items-center">
      <div style={{ width: size, height: size, position: "relative" }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            cx="50%"
            cy="50%"
            innerRadius="70%"
            outerRadius="100%"
            startAngle={225}
            endAngle={-45}
            data={data}
            barSize={8}
          >
            <RadialBar
              dataKey="value"
              cornerRadius={4}
              background={{ fill: "rgba(148, 163, 184, 0.15)" }}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <div
          className="absolute inset-0 flex flex-col items-center justify-center"
          style={{ pointerEvents: "none" }}
        >
          <span className="text-2xl font-bold" style={{ color }}>
            {Math.round(score)}
          </span>
          <span className="text-xs" style={{ color: "#64748b" }}>
            /100
          </span>
        </div>
      </div>
      {label && (
        <span className="text-xs mt-1" style={{ color: "#94a3b8" }}>
          {label}
        </span>
      )}
    </div>
  );
}
