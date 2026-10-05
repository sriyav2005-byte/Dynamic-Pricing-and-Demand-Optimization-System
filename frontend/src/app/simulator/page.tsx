"use client";

/** /simulator — pick a product and explore prices & scenarios. */

import { useState } from "react";
import { Calculator } from "lucide-react";
import { getProducts, inr, Product } from "@/lib/api";
import { useApp } from "@/components/providers/AppProvider";
import { Card, EmptyState, ErrorState, Field, PageHeader, SkeletonRows, useAsync } from "@/components/ui/kit";
import SimulatorPanel from "@/components/pricing/SimulatorPanel";

export default function SimulatorPage() {
  const { storeId } = useApp();
  const products = useAsync(() => getProducts(storeId, { page_size: 200, sort: "name" }), [storeId]);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("product"));
  const all: Product[] = products.data?.data ?? [];
  const selected = all.find((p) => p.id === selectedId) ?? all[0] ?? null;

  return (
    <>
      <PageHeader title="Price simulator" icon={Calculator} subtitle="Test prices and scenarios before changing anything — nothing here changes a price" />
      <Card>
        {products.error ? <ErrorState message={products.error} onRetry={products.reload} /> : !products.data ? <SkeletonRows rows={3} cols={2} /> : products.data.data.length === 0 ? (
          <EmptyState title="No products in this store" />
        ) : (
          <div className="space-y-5">
            <Field label="Product">
              <select className="select max-w-xl" value={selected?.id ?? ""} onChange={(e) => setSelectedId(e.target.value)}>
                {products.data.data.map((p) => <option key={p.id} value={p.id}>{p.name} — {inr(p.selling_price)} (stock {p.stock}{p.days_to_expiry !== null ? `, expires in ${p.days_to_expiry} d` : ""})</option>)}
              </select>
            </Field>
            {selected && <SimulatorPanel key={selected.id} productId={selected.id} currentPrice={selected.selling_price} mrp={selected.mrp} />}
          </div>
        )}
      </Card>
    </>
  );
}
