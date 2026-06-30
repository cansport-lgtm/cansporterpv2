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

// Acceptance criteria text for a stored reading row.
function specText(r: any): string {
  const u = r.unit ? ` ${r.unit}` : "";
  if (r.parameter_type === "numeric") {
    if (r.min_value != null && r.max_value != null) return `${r.min_value} – ${r.max_value}${u}`;
    if (r.min_value != null) return `≥ ${r.min_value}${u}`;
    if (r.max_value != null) return `≤ ${r.max_value}${u}`;
    return "any";
  }
  if (r.parameter_type === "boolean") return `expected: ${r.expected_value !== "false" ? "Yes" : "No"}`;
  if (r.parameter_type === "text") return r.expected_value ? `expected: ${r.expected_value}` : "free text";
  return "";
}

function valueText(r: any): string {
  if (r.parameter_type === "numeric") return r.value_number != null ? `${r.value_number}${r.unit ? ` ${r.unit}` : ""}` : "—";
  if (r.parameter_type === "boolean") return r.value_boolean ? "Yes" : "No";
  return r.value_text || "—";
}

function resultCell(r: any): string {
  if (r.is_within_spec == null) return `<span class="muted">—</span>`;
  return r.is_within_spec
    ? `<span style="color:#0a7d33;font-weight:700">PASS</span>`
    : `<span style="color:#c0152f;font-weight:700">FAIL</span>`;
}

/**
 * Fetch a single purchase QC inspection (header + items + checkpoint readings)
 * and print it as a Quality Inspection Report. Self-contained so it can be
 * triggered from a list row or the detail dialog. Renders nothing.
 */
export async function printQCInspection(inspectionId: string): Promise<void> {
  const { data: insp, error: inspErr } = await sb
    .from("purchase_qc_inspections")
    .select(`*, purchase_orders(po_number, category), suppliers(name, code, phone)`)
    .eq("id", inspectionId)
    .maybeSingle();
  if (inspErr || !insp) throw inspErr || new Error("Inspection not found");

  const { data: items } = await sb
    .from("purchase_qc_inspection_items")
    .select(`*, items(code, name)`)
    .eq("inspection_id", inspectionId);

  const itemIds = (items || []).map((i: any) => i.id);
  let readingsByItem: Record<string, any[]> = {};
  if (itemIds.length > 0) {
    const { data: readings } = await sb
      .from("purchase_qc_inspection_readings")
      .select("*")
      .in("inspection_item_id", itemIds);
    (readings || []).forEach((r: any) => {
      (readingsByItem[r.inspection_item_id] = readingsByItem[r.inspection_item_id] || []).push(r);
    });
  }

  // Resolve inspector / approver names.
  const userIds = [insp.inspected_by, insp.approved_by].filter(Boolean);
  const nameById: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: users } = await sb.from("app_users").select("id, full_name").in("id", userIds);
    (users || []).forEach((u: any) => { nameById[u.id] = u.full_name; });
  }

  const itemsHtml = (items || []).map((it: any) => {
    const readings = readingsByItem[it.id] || [];
    const rowsHtml = readings.length
      ? readings.map((r: any) => {
          const ur = r.parameter_name_ur
            ? `<div class="xs muted" dir="rtl">${esc(r.parameter_name_ur)}</div>` : "";
          return `<tr>
            <td>${esc(r.parameter_name)}${r.is_required ? " *" : ""}${ur}</td>
            <td class="muted">${esc(specText(r))}</td>
            <td>${esc(valueText(r))}</td>
            <td>${resultCell(r)}</td>
          </tr>`;
        }).join("")
      : `<tr><td colspan="4" class="muted">No checkpoints recorded.</td></tr>`;

    return `<div class="order-card">
      <div class="bar">
        <span>${esc(it.description || it.items?.name || "Item")}${it.items?.code ? ` (${esc(it.items.code)})` : ""}</span>
        <span>Inspected ${esc(it.quantity_inspected)} · Accepted ${esc(it.quantity_accepted)} · Rejected ${esc(it.quantity_rejected)}</span>
      </div>
      <table>
        <thead><tr><th>Checkpoint</th><th>Specification</th><th>Reading</th><th>Result</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
  }).join("");

  const notesHtml = insp.notes
    ? `<div class="section-title">Notes</div><div>${esc(insp.notes)}</div>` : "";

  const resultBadge = insp.result ? ` · ${esc(String(insp.result).toUpperCase())}` : "";

  const body = `
    <div class="wrap">
      <div class="head">
        <div class="brand">
          <img src="${esc(logoUrl)}" alt="Cansport" />
          <div><h1>QUALITY INSPECTION REPORT</h1><div class="xs muted">Raw Material Incoming Inspection</div></div>
        </div>
        <div class="right">
          <div class="bold">${esc(insp.qc_number || "—")}</div>
          <div>Date: ${esc(fmtDate(insp.inspection_date))}</div>
          <div class="status">${esc(String(insp.status || "").toUpperCase())}${resultBadge}</div>
        </div>
      </div>

      <div class="grid2">
        <div>
          <div class="label">Purchase Order</div>
          <div class="bold">${esc(insp.purchase_orders?.po_number || "—")}</div>
          <div class="xs muted">${esc(insp.purchase_orders?.category || "")}</div>
        </div>
        <div>
          <div class="label">Supplier</div>
          <div class="bold">${esc(insp.suppliers?.name || "—")}</div>
          ${insp.suppliers?.code ? `<div class="xs">${esc(insp.suppliers.code)}</div>` : ""}
          ${insp.suppliers?.phone ? `<div class="xs muted">Ph: ${esc(insp.suppliers.phone)}</div>` : ""}
        </div>
        <div>
          <div class="label">Inspected By</div>
          <div>${esc(insp.inspected_by ? (nameById[insp.inspected_by] || "—") : "—")}</div>
          ${insp.approved_by ? `<div class="label" style="margin-top:8px">Approved By</div><div>${esc(nameById[insp.approved_by] || "—")}</div><div class="xs muted">${esc(fmtDate(insp.approved_at))}</div>` : ""}
        </div>
      </div>

      ${itemsHtml || `<div class="muted">No inspected items.</div>`}
      ${notesHtml}

      <div class="sign">
        <div>Inspected by (sign &amp; date)</div>
        <div>Approved by (sign &amp; date)</div>
      </div>
    </div>`;

  printDocument(`QC Inspection ${insp.qc_number || ""}`.trim(), body);
}
