import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { printDocument, esc } from "@/lib/printDocument";
import cansportLogo from "@/assets/cansport-logo.png";

const sb = supabase as any;

const logoUrl =
  typeof window !== "undefined" ? new URL(cansportLogo, window.location.origin).href : cansportLogo;

const fmtDate = (d?: string | null) => {
  if (!d) return "—";
  try { return format(new Date(d), "dd MMM yyyy"); } catch { return String(d); }
};

/**
 * Fetch a goods receipt note (header + items) and print it as a store copy.
 * Deliberately excludes all commercial figures — unit prices, line amounts,
 * invoice/transportation amounts and totals — so the printout can go to the
 * store/gate without exposing purchase rates. Self-contained; renders nothing.
 */
export async function printGRN(grnId: string): Promise<void> {
  const { data: grn, error: grnErr } = await sb
    .from("goods_receipt_notes")
    .select(`*, purchase_orders(po_number, category), suppliers(name, code, phone)`)
    .eq("id", grnId)
    .maybeSingle();
  if (grnErr || !grn) throw grnErr || new Error("GRN not found");

  const { data: items } = await sb
    .from("grn_items")
    .select(`*, items(code, name)`)
    .eq("grn_id", grnId);

  const userIds = [grn.received_by, grn.approved_by].filter(Boolean);
  const nameById: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: users } = await sb.from("app_users").select("id, full_name").in("id", userIds);
    (users || []).forEach((u: any) => { nameById[u.id] = u.full_name; });
  }

  const categoryLabel: Record<string, string> = {
    raw_material: "Raw Material",
    office_supplies: "Office Supplies",
    general_supplies: "General Supplies",
    spare_maintenance: "Spare & Maintenance",
  };

  const rowsHtml = (items || []).length
    ? (items || []).map((it: any, i: number) => `<tr>
        <td>${i + 1}</td>
        <td>${esc(it.items?.code || "—")}</td>
        <td>${esc(it.description || it.items?.name || "—")}</td>
        <td class="num">${esc(it.quantity_ordered ?? "—")}</td>
        <td class="num bold">${esc(it.quantity_received)}</td>
        <td>${esc(it.remarks || "")}</td>
      </tr>`).join("")
    : `<tr><td colspan="6" class="muted">No items recorded.</td></tr>`;

  const notesHtml = grn.notes
    ? `<div class="section-title">Notes</div><div>${esc(grn.notes)}</div>` : "";

  const body = `
    <div class="wrap">
      <div class="head">
        <div class="brand">
          <img src="${esc(logoUrl)}" alt="Cansport" />
          <div><h1>GOODS RECEIPT NOTE</h1><div class="xs muted">Store Copy — quantities only</div></div>
        </div>
        <div class="right">
          <div class="bold">${esc(grn.grn_number || "—")}</div>
          <div>Date: ${esc(fmtDate(grn.receipt_date))}</div>
          <div class="status">${esc(String(grn.status || "").toUpperCase())}</div>
        </div>
      </div>

      <div class="grid2">
        <div>
          <div class="label">Purchase Order</div>
          <div class="bold">${esc(grn.purchase_orders?.po_number || "—")}</div>
          <div class="xs muted">${esc(categoryLabel[grn.purchase_orders?.category] || grn.purchase_orders?.category || "")}</div>
        </div>
        <div>
          <div class="label">Supplier</div>
          <div class="bold">${esc(grn.suppliers?.name || "—")}</div>
          ${grn.suppliers?.code ? `<div class="xs">${esc(grn.suppliers.code)}</div>` : ""}
          ${grn.suppliers?.phone ? `<div class="xs muted">Ph: ${esc(grn.suppliers.phone)}</div>` : ""}
        </div>
        <div>
          <div class="label">Supplier Invoice / Challan</div>
          <div>${esc(grn.invoice_number || "—")}</div>
          ${grn.invoice_date ? `<div class="xs muted">${esc(fmtDate(grn.invoice_date))}</div>` : ""}
          <div class="label" style="margin-top:8px">Received By</div>
          <div>${esc(grn.received_by ? (nameById[grn.received_by] || "—") : "—")}</div>
        </div>
      </div>

      <table>
        <thead><tr>
          <th style="width:28px">#</th>
          <th>Item Code</th>
          <th>Description</th>
          <th class="num">Ordered</th>
          <th class="num">Received</th>
          <th>Remarks</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>

      ${notesHtml}

      <div class="sign">
        <div>Received by (sign &amp; date)</div>
        <div>Store incharge (sign &amp; date)</div>
        <div>Approved by (sign &amp; date)</div>
      </div>
    </div>`;

  printDocument(`GRN ${grn.grn_number || ""}`.trim(), body);
}
