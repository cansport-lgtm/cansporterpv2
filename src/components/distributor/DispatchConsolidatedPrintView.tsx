import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import cansportLogo from "@/assets/cansport-logo.png";
import { printDocument, esc, HIDE_PRINT_URL_CSS } from "@/lib/printDocument";
import { buildBulkDispatchSheetPdf } from "@/lib/dispatchSheetPdf";
import { shareOrDownloadPdf } from "@/lib/sharePdf";

/**
 * What to print. Either an entire scope (all approved orders for a distributor / company-wide)
 * or an explicit list of hand-picked order ids (bulk dispatch from the Orders list selection).
 */
export interface ConsolidatedRequest {
  /** Header label (distributor name, "All Distributors", or e.g. "3 selected orders"). */
  label: string;
  /** Distributor id or the ALL sentinel — prints every approved order in scope. */
  scopeId?: string;
  /** Explicit order ids — prints exactly these (bulk dispatch). Takes precedence over scopeId. */
  orderIds?: string[];
  /** "print" opens the print dialog; "share" builds a PDF and opens the share sheet (WhatsApp). */
  mode?: "print" | "share";
}

interface DispatchConsolidatedPrintViewProps {
  /** When non-null, fetch + print fires. */
  request: ConsolidatedRequest | null;
  /** ALL sentinel value (company-wide). */
  allValue: string;
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

const logoUrl =
  typeof window !== "undefined" ? new URL(cansportLogo, window.location.origin).href : cansportLogo;

function label(it: Line): string {
  if (it.company_product_id && it.company_product) {
    return it.company_product.code
      ? `${it.company_product.code} — ${it.company_product.name}`
      : it.company_product.name;
  }
  return it.product_name;
}

/**
 * Fetches every approved (not-yet-dispatched) order for the scope and prints a single
 * consolidated Dispatch Sheet — aggregated pick list + per-order breakdown — into an
 * isolated iframe (see printDocument). Renders nothing.
 */
export function DispatchConsolidatedPrintView({
  request,
  allValue,
  onAfterPrint,
}: DispatchConsolidatedPrintViewProps) {
  const orderIds = request?.orderIds ?? null;
  const scopeId = request?.scopeId ?? null;
  const scopeLabel = request?.label ?? "";
  const mode = request?.mode ?? "print";
  const isAll = scopeId === allValue;
  // Stable key for the active request (selected ids take precedence over scope).
  const baseKey = orderIds && orderIds.length ? `ids:${[...orderIds].sort().join(",")}` : scopeId ? `scope:${scopeId}` : null;
  const reqKey = baseKey ? `${baseKey}:${mode}` : null;
  const printedFor = useRef<string | null>(null);

  const { data: lines } = useQuery({
    queryKey: ["dispatch-consolidated-print", baseKey],
    enabled: !!baseKey,
    queryFn: async () => {
      let q = supabase
        .from("distributor_order_items")
        .select(
          "order_id, product_name, unit, quantity, company_product_id, company_product:products(code, name), distributor_orders!inner(id, order_number, order_date, required_date, distributor_id, status, distributors(name, code), distributor_customers(name, code))"
        );
      if (orderIds && orderIds.length) {
        // Bulk dispatch from hand-picked orders — print exactly these, any status.
        q = q.in("distributor_orders.id", orderIds);
      } else {
        q = q.eq("distributor_orders.status", "approved");
        if (!isAll) q = q.eq("distributor_orders.distributor_id", scopeId as string);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Line[];
    },
  });

  useEffect(() => {
    if (!reqKey || !lines) return;
    if (printedFor.current === reqKey) return;
    printedFor.current = reqKey;

    // Aggregated pick list: total qty per product (mapped SKUs aggregate by code).
    const pick = new Map<string, { product: string; unit: string; quantity: number }>();
    // Per-order grouping.
    const orderMap = new Map<
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

    for (const it of lines) {
      const unit = it.unit ?? "";
      const mapped = !!it.company_product_id;
      const key = mapped ? `c:${it.company_product_id}|${unit}` : `n:${it.product_name}|${unit}`;
      const lbl = label(it);
      const pk = pick.get(key) ?? { product: lbl, unit, quantity: 0 };
      pk.quantity += Number(it.quantity ?? 0);
      pick.set(key, pk);

      const o = it.distributor_orders;
      if (o) {
        const g =
          orderMap.get(o.id) ?? {
            order_number: o.order_number,
            order_date: o.order_date,
            required_date: o.required_date,
            distributor: o.distributors?.name ?? "—",
            customer: o.distributor_customers
              ? `${o.distributor_customers.name}${o.distributor_customers.code ? ` (${o.distributor_customers.code})` : ""}`
              : "—",
            items: [],
          };
        g.items.push({ product: lbl, unit: it.unit ?? "—", quantity: Number(it.quantity ?? 0) });
        orderMap.set(o.id, g);
      }
    }

    const pickList = Array.from(pick.values()).sort((a, b) => a.product.localeCompare(b.product));
    const orders = Array.from(orderMap.values()).sort((a, b) =>
      (a.order_number ?? "").localeCompare(b.order_number ?? "")
    );
    const totalUnits = pickList.reduce((s, r) => s + r.quantity, 0);

    // --- WhatsApp / file share: build a PDF blob and open the share sheet ---
    if (mode === "share") {
      const pdf = buildBulkDispatchSheetPdf({
        scopeLabel,
        printedOn: format(new Date(), "dd MMM yyyy HH:mm"),
        totalUnits: totalUnits.toLocaleString(),
        pickList: pickList.map((r) => ({
          product: r.product,
          unit: r.unit || "—",
          quantity: r.quantity.toLocaleString(),
        })),
        orders: orders.map((o) => ({
          orderNumber: o.order_number ?? "—",
          customer: o.customer,
          distributor: isAll ? o.distributor : undefined,
          when: o.required_date ? `Required: ${o.required_date}` : `Order: ${o.order_date}`,
          items: o.items.map((it) => ({
            product: it.product,
            unit: it.unit,
            quantity: it.quantity.toLocaleString(),
          })),
        })),
      });
      const fileName = `Dispatch_Sheet_${scopeLabel.replace(/[^\w-]+/g, "_")}.pdf`;
      const summary = `Dispatch Sheet — ${scopeLabel}: ${orders.length} order${orders.length === 1 ? "" : "s"}, ${totalUnits.toLocaleString()} units`;
      shareOrDownloadPdf({ blob: pdf, fileName, title: "Dispatch Sheet", text: summary })
        .then((r) => {
          if (r === "shared") toast.success("Shared");
          else if (r === "downloaded") toast.success("PDF downloaded — attach it in WhatsApp");
        })
        .catch(() => toast.error("Could not share the dispatch sheet"));
      onAfterPrint();
      return;
    }

    const pickRows = pickList
      .map(
        (r) =>
          `<tr><td>${esc(r.product)}</td><td>${esc(r.unit || "—")}</td><td class="num">${r.quantity.toLocaleString()}</td></tr>`
      )
      .join("");

    const orderCards = orders
      .map((o) => {
        const itemRows = o.items
          .map(
            (it) =>
              `<tr><td>${esc(it.product)}</td><td>${esc(it.unit)}</td><td class="num">${it.quantity.toLocaleString()}</td><td></td></tr>`
          )
          .join("");
        const when = o.required_date ? `Required: ${esc(o.required_date)}` : `Order: ${esc(o.order_date)}`;
        const dist = isAll ? ` <span class="muted">· ${esc(o.distributor)}</span>` : "";
        return `<div class="order-card">
          <div class="bar"><span>${esc(o.order_number ?? "—")} · ${esc(o.customer)}${dist}</span><span class="xs muted">${when}</span></div>
          <table>
            <thead><tr><th>Product</th><th>Unit</th><th class="num">Qty</th><th>Picked / Remarks</th></tr></thead>
            <tbody>${itemRows}</tbody>
          </table>
        </div>`;
      })
      .join("");

    const body = `
      <div class="wrap">
        <div class="head">
          <div class="brand">
            <img src="${esc(logoUrl)}" alt="Cansport" />
            <div><h1>DISPATCH SHEET</h1><div class="xs muted">Consolidated — approved orders awaiting dispatch</div></div>
          </div>
          <div class="right">
            <div class="bold">${esc(scopeLabel)}</div>
            <div>Printed: ${esc(format(new Date(), "dd MMM yyyy"))}</div>
            <div>${orders.length} order${orders.length === 1 ? "" : "s"}</div>
          </div>
        </div>

        ${
          orders.length === 0
            ? `<div class="muted">No approved orders awaiting dispatch.</div>`
            : `
          <div class="section-title">Pick List (total to pull from stock)</div>
          <table>
            <thead><tr><th>Product</th><th>Unit</th><th class="num">Total Qty</th></tr></thead>
            <tbody>${pickRows}</tbody>
            <tfoot><tr><td colspan="2" class="num">TOTAL</td><td class="num">${totalUnits.toLocaleString()}</td></tr></tfoot>
          </table>

          <div class="section-title">Per-order breakdown</div>
          ${orderCards}

          <div class="sign"><div>Prepared By</div><div>Dispatched By</div><div>Received By</div></div>
        `
        }
      </div>`;

    printDocument(`Dispatch Sheet — ${scopeLabel}`, body, HIDE_PRINT_URL_CSS);
    onAfterPrint();
    // onAfterPrint intentionally omitted; fire once per request load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey, lines]);

  useEffect(() => {
    if (!reqKey) printedFor.current = null;
  }, [reqKey]);

  return null;
}
