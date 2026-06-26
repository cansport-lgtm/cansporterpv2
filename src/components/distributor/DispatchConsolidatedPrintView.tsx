import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import cansportLogo from "@/assets/cansport-logo.png";

interface DispatchConsolidatedPrintViewProps {
  /** Distributor id, the ALL sentinel, or null. When non-null, fetch + print fires. */
  scopeId: string | null;
  /** ALL sentinel value (company-wide). */
  allValue: string;
  /** Human label for the header (distributor name, or "All Distributors"). */
  scopeLabel: string;
  /** Called after the print dialog has been triggered so the caller can clear its state. */
  onAfterPrint: () => void;
}

interface Line {
  order_id: string;
  product_name: string;
  unit: string | null;
  quantity: number;
  company_product_id: string | null;
  company_product: { code: string | null; name: string } | null;
  distributor_orders: {
    id: string;
    order_number: string | null;
    order_date: string;
    required_date: string | null;
    distributor_id: string;
    distributors: { name: string; code: string | null } | null;
    distributor_customers: { name: string; code: string | null } | null;
  } | null;
}

/**
 * Hidden, print-only CONSOLIDATED dispatch sheet. Lists every approved (not-yet-dispatched)
 * order for the selected distributor (or all distributors) on a single document: an
 * aggregated pick list (what to pull from stock) followed by a per-order breakdown (how to
 * split it per customer). Fires `window.print()` once data loads; use the browser's
 * "Save as PDF" destination to export a PDF.
 */
export function DispatchConsolidatedPrintView({
  scopeId,
  allValue,
  scopeLabel,
  onAfterPrint,
}: DispatchConsolidatedPrintViewProps) {
  const isAll = scopeId === allValue;

  const { data: lines } = useQuery({
    queryKey: ["dispatch-consolidated-print", scopeId],
    enabled: !!scopeId,
    queryFn: async () => {
      let q = supabase
        .from("distributor_order_items")
        .select(
          "order_id, product_name, unit, quantity, company_product_id, company_product:products(code, name), distributor_orders!inner(id, order_number, order_date, required_date, distributor_id, status, distributors(name, code), distributor_customers(name, code))"
        )
        .eq("distributor_orders.status", "approved");
      if (!isAll) q = q.eq("distributor_orders.distributor_id", scopeId as string);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Line[];
    },
  });

  // Aggregated pick list: total qty per product (mapped SKUs aggregate by code).
  const pickList = useMemo(() => {
    const map = new Map<string, { product: string; unit: string; quantity: number }>();
    for (const it of lines ?? []) {
      const unit = it.unit ?? "";
      const mapped = !!it.company_product_id;
      const key = mapped ? `c:${it.company_product_id}|${unit}` : `n:${it.product_name}|${unit}`;
      let label = it.product_name;
      if (mapped && it.company_product) {
        label = it.company_product.code
          ? `${it.company_product.code} — ${it.company_product.name}`
          : it.company_product.name;
      }
      const row = map.get(key) ?? { product: label, unit, quantity: 0 };
      row.quantity += Number(it.quantity ?? 0);
      map.set(key, row);
    }
    return Array.from(map.values()).sort((a, b) => a.product.localeCompare(b.product));
  }, [lines]);

  // Per-order grouping for the breakdown section.
  const orders = useMemo(() => {
    const map = new Map<
      string,
      {
        order_number: string | null;
        order_date: string;
        required_date: string | null;
        distributor: string;
        customer: string;
        items: { product: string; unit: string; quantity: number }[];
      }
    >();
    for (const it of lines ?? []) {
      const o = it.distributor_orders;
      if (!o) continue;
      const g =
        map.get(o.id) ?? {
          order_number: o.order_number,
          order_date: o.order_date,
          required_date: o.required_date,
          distributor: o.distributors?.name ?? "—",
          customer: o.distributor_customers
            ? `${o.distributor_customers.name}${o.distributor_customers.code ? ` (${o.distributor_customers.code})` : ""}`
            : "—",
          items: [],
        };
      const mapped = !!it.company_product_id;
      let label = it.product_name;
      if (mapped && it.company_product) {
        label = it.company_product.code
          ? `${it.company_product.code} — ${it.company_product.name}`
          : it.company_product.name;
      }
      g.items.push({ product: label, unit: it.unit ?? "—", quantity: Number(it.quantity ?? 0) });
      map.set(o.id, g);
    }
    return Array.from(map.values()).sort((a, b) =>
      (a.order_number ?? "").localeCompare(b.order_number ?? "")
    );
  }, [lines]);

  useEffect(() => {
    if (!scopeId || !lines) return;
    const t = setTimeout(() => {
      window.print();
      onAfterPrint();
    }, 300);
    return () => clearTimeout(t);
    // onAfterPrint intentionally omitted; fire once per load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeId, lines]);

  if (!lines) return null;

  const totalUnits = pickList.reduce((s, r) => s + r.quantity, 0);

  return (
    <div className="hidden print:block print:fixed print:inset-0 print:bg-white print:p-8 print:z-50 print:text-foreground">
      <div className="max-w-3xl mx-auto">
        <div className="flex justify-between items-start mb-6 pb-4 border-b-2 border-gray-800">
          <div className="flex items-center gap-3">
            <img src={cansportLogo} alt="Cansport" className="h-12 w-auto" />
            <div>
              <h1 className="text-2xl font-bold leading-tight">DISPATCH SHEET</h1>
              <div className="text-xs text-gray-500">Consolidated — approved orders awaiting dispatch</div>
            </div>
          </div>
          <div className="text-right text-sm">
            <div className="font-bold">{scopeLabel}</div>
            <div>Printed: {format(new Date(), "dd MMM yyyy")}</div>
            <div>{orders.length} order{orders.length === 1 ? "" : "s"}</div>
          </div>
        </div>

        {orders.length === 0 ? (
          <div className="text-sm text-gray-600">No approved orders awaiting dispatch.</div>
        ) : (
          <>
            {/* Aggregated pick list */}
            <div className="mb-2 font-bold text-xs text-gray-500 uppercase">Pick List (total to pull from stock)</div>
            <table className="w-full text-sm mb-6 border-collapse">
              <thead>
                <tr className="border-b-2 border-gray-800">
                  <th className="text-left py-2">Product</th>
                  <th className="text-left py-2">Unit</th>
                  <th className="text-right py-2">Total Qty</th>
                </tr>
              </thead>
              <tbody>
                {pickList.map((r, i) => (
                  <tr key={i} className="border-b border-gray-200">
                    <td className="py-1.5">{r.product}</td>
                    <td className="py-1.5">{r.unit || "—"}</td>
                    <td className="text-right py-1.5">{r.quantity.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-800 font-bold">
                  <td colSpan={2} className="text-right py-2">TOTAL</td>
                  <td className="text-right py-2">{totalUnits.toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>

            {/* Per-order breakdown */}
            <div className="mb-2 font-bold text-xs text-gray-500 uppercase">Per-order breakdown</div>
            <div className="space-y-4">
              {orders.map((o, idx) => (
                <div key={idx} className="border border-gray-300 rounded break-inside-avoid">
                  <div className="flex justify-between items-center bg-gray-100 px-3 py-1.5 text-sm font-semibold">
                    <span>
                      {o.order_number ?? "—"} · {o.customer}
                      {isAll ? <span className="text-gray-500 font-normal"> · {o.distributor}</span> : null}
                    </span>
                    <span className="text-xs font-normal text-gray-600">
                      {o.required_date ? `Required: ${o.required_date}` : `Order: ${o.order_date}`}
                    </span>
                  </div>
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="text-xs uppercase text-gray-500">
                        <th className="text-left px-3 py-1">Product</th>
                        <th className="text-left px-3 py-1">Unit</th>
                        <th className="text-right px-3 py-1">Qty</th>
                        <th className="text-left px-3 py-1 w-32">Picked / Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.items.map((it, j) => (
                        <tr key={j} className="border-t border-gray-200">
                          <td className="px-3 py-1.5">{it.product}</td>
                          <td className="px-3 py-1.5">{it.unit}</td>
                          <td className="text-right px-3 py-1.5">{it.quantity.toLocaleString()}</td>
                          <td className="px-3 py-1.5"></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>

            <div className="text-xs text-gray-500 border-t pt-4 mt-8">
              <div className="mt-8 grid grid-cols-3 gap-8">
                <div className="border-t border-gray-400 pt-1">Prepared By</div>
                <div className="border-t border-gray-400 pt-1">Dispatched By</div>
                <div className="border-t border-gray-400 pt-1">Received By</div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
