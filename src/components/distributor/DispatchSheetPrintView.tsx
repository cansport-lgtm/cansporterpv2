import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import cansportLogo from "@/assets/cansport-logo.png";
import { printDocument, esc, HIDE_PRINT_URL_CSS } from "@/lib/printDocument";
import { buildDispatchSheetPdf } from "@/lib/dispatchSheetPdf";
import { shareOrDownloadPdf } from "@/lib/sharePdf";

export type DispatchActionMode = "print" | "share";

interface DispatchSheetPrintViewProps {
  /** When non-null, the order is fetched and printed/shared. */
  orderId: string | null;
  /** "print" opens the print dialog; "share" builds a PDF and opens the share sheet (WhatsApp). */
  mode?: DispatchActionMode;
  /** Called after the action has been triggered so the caller can clear its state. */
  onAfterPrint: () => void;
}

interface PrintOrder {
  order_number: string | null;
  order_date: string;
  required_date: string | null;
  status: string;
  dispatched_at: string | null;
  notes: string | null;
  dispatch_notes: string | null;
  distributors: {
    name: string;
    code: string | null;
    address: string | null;
    city: string | null;
    area: string | null;
    phone: string | null;
    contact_person: string | null;
  } | null;
  distributor_customers: {
    name: string;
    code: string | null;
    address: string | null;
    city: string | null;
    area: string | null;
    phone: string | null;
    contact_person: string | null;
  } | null;
}

interface PrintItem {
  id: string;
  product_name: string;
  unit: string | null;
  quantity: number;
  quantity_dispatched: number;
  remarks: string | null;
  company_product: { code: string | null; name: string } | null;
}

function addressLine(p: { address: string | null; area: string | null; city: string | null } | null) {
  if (!p) return "";
  return [p.address, p.area, p.city].filter(Boolean).join(", ");
}

const logoUrl =
  typeof window !== "undefined" ? new URL(cansportLogo, window.location.origin).href : cansportLogo;

/**
 * Fetches a single distributor order + its lines and prints a Dispatch Sheet
 * (delivery / picking slip) into an isolated iframe (see printDocument). Renders nothing.
 */
export function DispatchSheetPrintView({ orderId, mode = "print", onAfterPrint }: DispatchSheetPrintViewProps) {
  const printedFor = useRef<string | null>(null);

  const { data: order } = useQuery({
    queryKey: ["dispatch-sheet-print-view", orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributor_orders")
        .select(
          "order_number, order_date, required_date, status, dispatched_at, notes, dispatch_notes, distributors(name, code, address, city, area, phone, contact_person), distributor_customers(name, code, address, city, area, phone, contact_person)"
        )
        .eq("id", orderId as string)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as PrintOrder;
    },
  });

  const { data: items } = useQuery({
    queryKey: ["dispatch-sheet-print-view-items", orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributor_order_items")
        .select("id, product_name, unit, quantity, quantity_dispatched, remarks, company_product:products(code, name)")
        .eq("order_id", orderId as string)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as PrintItem[];
    },
  });

  useEffect(() => {
    if (!orderId || !order || !items) return;
    const key = `${orderId}:${mode}`;
    if (printedFor.current === key) return;
    printedFor.current = key;

    const totalOrdered = items.reduce((s, it) => s + Number(it.quantity ?? 0), 0);
    const totalDispatched = items.reduce((s, it) => s + Number(it.quantity_dispatched ?? 0), 0);

    const fmt = (d: string | null) => (d ? format(parseISO(d), "dd MMM yyyy") : undefined);
    const addr = (p: typeof order.distributors) =>
      p ? [p.address, p.area, p.city].filter(Boolean).join(", ") : undefined;

    // --- WhatsApp / file share: build a PDF blob and open the share sheet ---
    if (mode === "share") {
      const pdf = buildDispatchSheetPdf({
        orderNumber: order.order_number ?? "",
        orderDate: format(parseISO(order.order_date), "dd MMM yyyy"),
        requiredDate: fmt(order.required_date),
        dispatchedDate: fmt(order.dispatched_at),
        status: order.status,
        distributorName: order.distributors?.name ?? "",
        distributorCode: order.distributors?.code ?? undefined,
        distributorAddress: addr(order.distributors),
        distributorPhone: order.distributors?.phone ?? undefined,
        customerName: order.distributor_customers?.name ?? "",
        customerCode: order.distributor_customers?.code ?? undefined,
        customerAddress: addr(order.distributor_customers),
        customerContact: order.distributor_customers?.contact_person ?? undefined,
        customerPhone: order.distributor_customers?.phone ?? undefined,
        items: items.map((it) => ({
          product: it.product_name,
          sku: it.company_product?.code ?? undefined,
          unit: it.unit ?? "",
          ordered: Number(it.quantity ?? 0).toLocaleString(),
          dispatched: Number(it.quantity_dispatched ?? 0).toLocaleString(),
          remarks: it.remarks ?? undefined,
        })),
        totalOrdered: totalOrdered.toLocaleString(),
        totalDispatched: totalDispatched.toLocaleString(),
        notes: [order.notes, order.dispatch_notes].filter(Boolean).join(" — ") || undefined,
        generatedOn: format(new Date(), "dd MMM yyyy HH:mm"),
      });
      const fileName = `Dispatch_${(order.order_number ?? "sheet").replace(/[^\w-]+/g, "_")}.pdf`;
      const summary = `Dispatch Sheet ${order.order_number ?? ""} — ${order.distributor_customers?.name ?? ""} (${totalOrdered.toLocaleString()} units)`;
      shareOrDownloadPdf({ blob: pdf, fileName, title: "Dispatch Sheet", text: summary })
        .then((r) => {
          if (r === "shared") toast.success("Shared");
          else if (r === "downloaded") toast.success("PDF downloaded — attach it in WhatsApp");
        })
        .catch(() => toast.error("Could not share the dispatch sheet"));
      onAfterPrint();
      return;
    }

    const rows = items
      .map((it, i) => {
        const sku = it.company_product?.code ? `<div class="xs muted">SKU: ${esc(it.company_product.code)}</div>` : "";
        return `<tr>
          <td>${i + 1}</td>
          <td>${esc(it.product_name)}${sku}</td>
          <td>${esc(it.unit ?? "—")}</td>
          <td class="num">${Number(it.quantity ?? 0).toLocaleString()}</td>
          <td class="num bold">${Number(it.quantity_dispatched ?? 0).toLocaleString()}</td>
          <td>${esc(it.remarks ?? "")}</td>
        </tr>`;
      })
      .join("");

    const notes =
      order.notes || order.dispatch_notes
        ? `<div class="section-title">Notes</div><div>${esc(order.notes ?? "")}</div>${
            order.dispatch_notes ? `<div class="muted">${esc(order.dispatch_notes)}</div>` : ""
          }`
        : "";

    const body = `
      <div class="wrap">
        <div class="head">
          <div class="brand">
            <img src="${esc(logoUrl)}" alt="Cansport" />
            <div><h1>DISPATCH SHEET</h1><div class="xs muted">Delivery / Picking Slip</div></div>
          </div>
          <div class="right">
            <div class="bold">${esc(order.order_number ?? "—")}</div>
            <div>Order date: ${esc(format(parseISO(order.order_date), "dd MMM yyyy"))}</div>
            ${order.required_date ? `<div>Required: ${esc(format(parseISO(order.required_date), "dd MMM yyyy"))}</div>` : ""}
            ${order.dispatched_at ? `<div>Dispatched: ${esc(format(parseISO(order.dispatched_at), "dd MMM yyyy"))}</div>` : ""}
            <div class="status">${esc(order.status)}</div>
          </div>
        </div>

        <div class="grid2">
          <div>
            <div class="label">Distributor</div>
            <div class="bold">${esc(order.distributors?.name ?? "")}</div>
            ${order.distributors?.code ? `<div class="xs">${esc(order.distributors.code)}</div>` : ""}
            ${addressLine(order.distributors) ? `<div class="xs muted">${esc(addressLine(order.distributors))}</div>` : ""}
            ${order.distributors?.phone ? `<div class="xs muted">Ph: ${esc(order.distributors.phone)}</div>` : ""}
          </div>
          <div>
            <div class="label">Deliver To</div>
            <div class="bold">${esc(order.distributor_customers?.name ?? "")}</div>
            ${order.distributor_customers?.code ? `<div class="xs">${esc(order.distributor_customers.code)}</div>` : ""}
            ${addressLine(order.distributor_customers) ? `<div class="xs muted">${esc(addressLine(order.distributor_customers))}</div>` : ""}
            ${order.distributor_customers?.contact_person ? `<div class="xs muted">Attn: ${esc(order.distributor_customers.contact_person)}</div>` : ""}
            ${order.distributor_customers?.phone ? `<div class="xs muted">Ph: ${esc(order.distributor_customers.phone)}</div>` : ""}
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>#</th><th>Product</th><th>Unit</th>
              <th class="num">Ordered</th><th class="num">Dispatched</th><th>Remarks</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="6" class="muted">No line items.</td></tr>`}</tbody>
          <tfoot>
            <tr>
              <td colspan="3" class="num">TOTAL</td>
              <td class="num">${totalOrdered.toLocaleString()}</td>
              <td class="num">${totalDispatched.toLocaleString()}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>

        ${notes}

        <div class="sign">
          <div>Prepared By</div><div>Dispatched By</div><div>Received By</div>
        </div>
      </div>`;

    printDocument(`Dispatch Sheet ${order.order_number ?? ""}`.trim(), body, HIDE_PRINT_URL_CSS);
    onAfterPrint();
    // onAfterPrint intentionally omitted from deps; fire once per order load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, order, items, mode]);

  // Reset the guard when the caller clears the id, so the same order can be reprinted.
  useEffect(() => {
    if (!orderId) printedFor.current = null;
  }, [orderId]);

  return null;
}
