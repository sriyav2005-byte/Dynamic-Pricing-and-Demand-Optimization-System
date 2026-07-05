/**
 * app/inventory/page.tsx — Inventory Management Dashboard
 * =========================================================
 * Inventory health overview with risk matrix, alerts, category health,
 * and expiry timeline.
 */

"use client";

import { useEffect, useState } from "react";
import {
  getProducts,
  getInventoryOverview,
  getExpiryRisk,
  getInventoryAlerts,
  Product,
  InventoryOverview,
  ExpiryRiskItem,
  InventoryAlert,
} from "@/lib/api";
import InventoryMatrix from "@/components/inventory/InventoryMatrix";
import {
  Warehouse,
  AlertTriangle,
  AlertCircle,
  Info,
  Package,
  Clock,
  TrendingDown,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";

export default function InventoryPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [overview, setOverview] = useState<InventoryOverview | null>(null);
  const [expiryRisk, setExpiryRisk] = useState<ExpiryRiskItem[]>([]);
  const [alerts, setAlerts] = useState<InventoryAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const [prods, ov, risk, alts] = await Promise.all([
        getProducts(),
        getInventoryOverview(),
        getExpiryRisk(),
        getInventoryAlerts(),
      ]);
      setProducts(prods);
      setOverview(ov);
      setExpiryRisk(risk);
      setAlerts(alts);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const alertIcon = (type: string) => {
    if (type === "critical") return <AlertTriangle size={14} style={{ color: "#ef4444" }} />;
    if (type === "warning") return <AlertCircle size={14} style={{ color: "#f59e0b" }} />;
    return <Info size={14} style={{ color: "#22d3ee" }} />;
  };

  const alertStyle = (type: string) => ({
    background:
      type === "critical"
        ? "rgba(239,68,68,0.04)"
        : type === "warning"
        ? "rgba(245,158,11,0.04)"
        : "rgba(34,211,238,0.04)",
    borderLeft: `3px solid ${
      type === "critical" ? "#ef4444" : type === "warning" ? "#f59e0b" : "#0891b2"
    }`,
    border: "1px solid rgba(0, 0, 0, 0.05)"
  });

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400 font-medium">Loading inventory data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 mb-2">
            <span className="gradient-text">Inventory Intelligence</span>
          </h1>
          <p className="text-sm text-slate-500 font-medium">
            Stock levels, expiry risk analysis, and inventory health scoring
          </p>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold glow-btn text-white cursor-pointer"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* KPI Cards */}
      {overview && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
          <div className="stat-card">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Total Products</div>
            <div className="text-2xl font-extrabold text-slate-800">{overview.total_products}</div>
          </div>
          <div className="stat-card">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Stock Value</div>
            <div className="text-2xl font-extrabold text-slate-800">
              ₹{(overview.total_stock_value / 1000).toFixed(1)}K
            </div>
          </div>
          <div className="stat-card">
            <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-red-500 mb-1">
              <AlertTriangle size={12} /> Critical
            </div>
            <div className="text-2xl font-extrabold text-red-500">
              {overview.risk_distribution.critical}
            </div>
          </div>
          <div className="stat-card">
            <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-500 mb-1">
              <AlertCircle size={12} /> Warning
            </div>
            <div className="text-2xl font-extrabold text-amber-500">
              {overview.risk_distribution.warning}
            </div>
          </div>
          <div className="stat-card">
            <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-500 mb-1">
              <Package size={12} /> Healthy
            </div>
            <div className="text-2xl font-extrabold text-emerald-500">
              {overview.risk_distribution.healthy}
            </div>
          </div>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Risk Matrix */}
        <div className="lg:col-span-2">
          <h2 className="text-lg font-extrabold text-slate-800 mb-4 flex items-center gap-2">
            <ShieldAlert size={18} className="text-violet-600" />
            Risk Matrix
          </h2>
          <InventoryMatrix products={products} height={350} />
        </div>

        {/* Alerts */}
        <div>
          <h2 className="text-lg font-extrabold text-slate-800 mb-4 flex items-center gap-2">
            <AlertTriangle size={18} className="text-[#f59e0b]" />
            Active Alerts ({alerts.length})
          </h2>
          <div className="space-y-2 max-h-[430px] overflow-y-auto pr-1">
            {alerts.slice(0, 15).map((alert, i) => (
              <div
                key={i}
                className="rounded-xl px-4 py-3"
                style={alertStyle(alert.type)}
              >
                <div className="flex items-center gap-2 mb-1">
                  {alertIcon(alert.type)}
                  <span className="text-xs font-bold text-slate-800">
                    {alert.title}
                  </span>
                </div>
                <p className="text-xs text-slate-500 font-medium">
                  {alert.message}
                </p>
              </div>
            ))}
            {alerts.length === 0 && (
              <div className="text-center py-8 text-slate-400">
                <Package size={24} className="mx-auto mb-2 opacity-45" />
                <p className="text-sm font-medium">No active alerts</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Category Health + Expiry Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Category Health Bars */}
        {overview && (
          <div className="bg-white border border-slate-200/60 rounded-2xl p-6 shadow-sm">
            <h2 className="text-lg font-extrabold text-slate-800 mb-4">Category Health</h2>
            <div className="space-y-4">
              {overview.category_health.map((cat) => (
                <div key={cat.category}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold text-slate-700 capitalize">
                      {cat.category}
                    </span>
                    <span className="text-xs text-slate-400 font-semibold">
                      {cat.healthy}/{cat.total_products} healthy · {cat.health_pct}%
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full overflow-hidden bg-slate-100 border border-slate-200/20">
                    <div className="h-full flex">
                      {cat.healthy > 0 && (
                        <div
                          className="h-full"
                          style={{
                            width: `${(cat.healthy / cat.total_products) * 100}%`,
                            background: "#10b981",
                          }}
                        />
                      )}
                      {cat.at_risk > 0 && (
                        <div
                          className="h-full"
                          style={{
                            width: `${(cat.at_risk / cat.total_products) * 100}%`,
                            background: "#f59e0b",
                          }}
                        />
                      )}
                      {cat.critical > 0 && (
                        <div
                          className="h-full"
                          style={{
                            width: `${(cat.critical / cat.total_products) * 100}%`,
                            background: "#ef4444",
                          }}
                        />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 mt-5 pt-1 border-t border-slate-100">
              {[
                { label: "Healthy", color: "#10b981" },
                { label: "At Risk", color: "#f59e0b" },
                { label: "Critical", color: "#ef4444" },
              ].map((l) => (
                <div key={l.label} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: l.color }} />
                  <span className="text-xs font-semibold text-slate-500">{l.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Expiry Risk Table */}
        <div className="bg-white border border-slate-200/60 rounded-2xl p-6 shadow-sm">
          <h2 className="text-lg font-extrabold text-slate-800 mb-4 flex items-center gap-2">
            <Clock size={18} className="text-red-500" />
            Expiry Risk Products
          </h2>
          {expiryRisk.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <Package size={24} className="mx-auto mb-2 opacity-45" />
              <p className="text-sm font-medium">No products at expiry risk</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {expiryRisk.map((item) => {
                const riskColor =
                  item.risk_level === "critical"
                    ? "#ef4444"
                    : item.risk_level === "warning"
                    ? "#f59e0b"
                    : "#0891b2";
                return (
                  <div
                    key={item.product_id}
                    className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-100/50"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ background: riskColor }}
                      />
                      <span className="text-sm font-semibold text-slate-800">
                        #{item.product_id}
                      </span>
                      <span className="badge capitalize text-xs"
                        style={{ background: `${riskColor}12`, color: riskColor, border: `1px solid ${riskColor}18` }}>
                        {item.risk_level}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs font-semibold text-slate-500">
                      <span>{item.days_to_expiry}d left</span>
                      <span>{item.stock_level} units</span>
                      <span className="text-emerald-600 font-bold">
                        →₹{item.suggested_price}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Stock Distribution */}
      {overview && (
        <div className="bg-white border border-slate-200/60 rounded-2xl p-6 shadow-sm">
          <h2 className="text-lg font-extrabold text-slate-800 mb-4">Stock Distribution</h2>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Low Stock (<30)", value: overview.stock_distribution.low_stock, color: "#ef4444", icon: TrendingDown },
              { label: "Optimal (30-150)", value: overview.stock_distribution.optimal, color: "#10b981", icon: Package },
              { label: "Overstock (>150)", value: overview.stock_distribution.overstock, color: "#f59e0b", icon: Warehouse },
            ].map(({ label, value, color, icon: Icon }) => (
              <div key={label} className="text-center rounded-xl p-4 bg-slate-50 border border-slate-100/50">
                <Icon size={20} className="mx-auto mb-2" style={{ color }} />
                <div className="text-2xl font-extrabold text-slate-800 mb-1">{value}</div>
                <div className="text-xs font-semibold text-slate-400">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
