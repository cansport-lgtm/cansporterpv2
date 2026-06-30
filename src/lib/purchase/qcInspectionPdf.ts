import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { jpegToPdf, dataUrlToBytes } from "@/lib/imagePdf";
import { shareOrDownloadPdf, type SharePdfResult } from "@/lib/sharePdf";

const sb = supabase as any;

const fmtDate = (d?: string | null) => {
  if (!d) return "—";
  try { return format(new Date(d), "dd MMM yyyy"); } catch { return String(d); }
};

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

interface ReportData {
  insp: any;
  items: any[];
  readingsByItem: Record<string, any[]>;
  nameById: Record<string, string>;
}

async function fetchReport(inspectionId: string): Promise<ReportData> {
  const { data: insp, error } = await sb
    .from("purchase_qc_inspections")
    .select(`*, purchase_orders(po_number, category), suppliers(name, code, phone)`)
    .eq("id", inspectionId)
    .maybeSingle();
  if (error || !insp) throw error || new Error("Inspection not found");

  const { data: items } = await sb
    .from("purchase_qc_inspection_items")
    .select(`*, items(code, name)`)
    .eq("inspection_id", inspectionId);

  const itemIds = (items || []).map((i: any) => i.id);
  const readingsByItem: Record<string, any[]> = {};
  if (itemIds.length > 0) {
    const { data: readings } = await sb
      .from("purchase_qc_inspection_readings")
      .select("*")
      .in("inspection_item_id", itemIds);
    (readings || []).forEach((r: any) => {
      (readingsByItem[r.inspection_item_id] = readingsByItem[r.inspection_item_id] || []).push(r);
    });
  }

  const userIds = [insp.inspected_by, insp.approved_by].filter(Boolean);
  const nameById: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: users } = await sb.from("app_users").select("id, full_name").in("id", userIds);
    (users || []).forEach((u: any) => { nameById[u.id] = u.full_name; });
  }

  return { insp, items: items || [], readingsByItem, nameById };
}

// ── Canvas layout ──────────────────────────────────────────────────────────
const W = 900;          // logical width
const M = 40;           // margin
const S = 2;            // supersampling for crisp text
const COL = { cp: M, spec: 430, read: 620, res: 800 }; // checkpoint table columns

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = String(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width <= maxW || !line) line = test;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

/** Draw the whole report. Returns the final logical height used. */
function draw(ctx: CanvasRenderingContext2D, d: ReportData): number {
  const { insp, items, readingsByItem, nameById } = d;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, 5000);

  let y = 46;

  // Title block
  ctx.fillStyle = "#111";
  ctx.textAlign = "left";
  ctx.font = "bold 24px Arial";
  ctx.fillText("QUALITY INSPECTION REPORT", M, y);
  ctx.font = "12px Arial";
  ctx.fillStyle = "#666";
  ctx.fillText("Raw Material Incoming Inspection", M, y + 18);

  // Right header
  ctx.textAlign = "right";
  ctx.fillStyle = "#111";
  ctx.font = "bold 15px Arial";
  ctx.fillText(insp.qc_number || "—", W - M, 30);
  ctx.font = "12px Arial";
  ctx.fillStyle = "#444";
  ctx.fillText("Date: " + fmtDate(insp.inspection_date), W - M, 48);
  const resultTxt = insp.result ? ` · ${String(insp.result).toUpperCase()}` : "";
  ctx.fillText(String(insp.status || "").toUpperCase() + resultTxt, W - M, 66);
  ctx.textAlign = "left";

  y += 34;
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke();
  y += 26;

  // Info columns
  const cols = [
    { x: M, label: "PURCHASE ORDER", main: insp.purchase_orders?.po_number || "—", sub: insp.purchase_orders?.category || "" },
    { x: 330, label: "SUPPLIER", main: insp.suppliers?.name || "—", sub: insp.suppliers?.code || "" },
    {
      x: 620, label: "INSPECTED BY",
      main: insp.inspected_by ? (nameById[insp.inspected_by] || "—") : "—",
      sub: insp.approved_by ? `Approved: ${nameById[insp.approved_by] || "—"} (${fmtDate(insp.approved_at)})` : "",
    },
  ];
  cols.forEach((c) => {
    ctx.font = "bold 10px Arial"; ctx.fillStyle = "#666";
    ctx.fillText(c.label.toUpperCase(), c.x, y);
    ctx.font = "bold 13px Arial"; ctx.fillStyle = "#111";
    ctx.fillText(String(c.main), c.x, y + 18);
    if (c.sub) { ctx.font = "10px Arial"; ctx.fillStyle = "#666"; ctx.fillText(String(c.sub), c.x, y + 33); }
  });
  y += 50;

  // Item cards
  for (const it of items) {
    const readings = readingsByItem[it.id] || [];
    // Card header bar
    ctx.fillStyle = "#f1f1f1";
    ctx.fillRect(M, y, W - 2 * M, 26);
    ctx.fillStyle = "#111"; ctx.font = "bold 12px Arial"; ctx.textAlign = "left";
    const itemName = (it.description || it.items?.name || "Item") + (it.items?.code ? ` (${it.items.code})` : "");
    ctx.fillText(itemName, M + 8, y + 17);
    ctx.textAlign = "right";
    ctx.fillText(
      `Insp ${it.quantity_inspected} · Acc ${it.quantity_accepted} · Rej ${it.quantity_rejected}`,
      W - M - 8, y + 17
    );
    ctx.textAlign = "left";
    y += 26;

    // Column headers
    ctx.font = "bold 10px Arial"; ctx.fillStyle = "#666";
    ctx.fillText("CHECKPOINT", COL.cp + 6, y + 15);
    ctx.fillText("SPECIFICATION", COL.spec, y + 15);
    ctx.fillText("READING", COL.read, y + 15);
    ctx.fillText("RESULT", COL.res, y + 15);
    y += 22;
    ctx.strokeStyle = "#ddd"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke();

    if (readings.length === 0) {
      ctx.font = "11px Arial"; ctx.fillStyle = "#888";
      ctx.fillText("No checkpoints recorded.", COL.cp + 6, y + 18);
      y += 26;
    }

    for (const r of readings) {
      const rowTop = y;
      const hasUr = !!r.parameter_name_ur;
      ctx.fillStyle = "#111"; ctx.font = "12px Arial"; ctx.textAlign = "left";
      ctx.fillText(`${r.parameter_name}${r.is_required ? " *" : ""}`, COL.cp + 6, y + 18);
      ctx.font = "11px Arial"; ctx.fillStyle = "#666";
      ctx.fillText(specText(r), COL.spec, y + 18);
      ctx.fillStyle = "#111"; ctx.font = "12px Arial";
      ctx.fillText(valueText(r), COL.read, y + 18);
      // Result
      ctx.font = "bold 12px Arial";
      ctx.fillStyle = r.is_within_spec == null ? "#888" : r.is_within_spec ? "#0a7d33" : "#c0152f";
      ctx.fillText(r.is_within_spec == null ? "—" : r.is_within_spec ? "PASS" : "FAIL", COL.res, y + 18);
      let rowH = 26;
      // Urdu name (RTL) under the English checkpoint name
      if (hasUr) {
        ctx.textAlign = "right";
        ctx.direction = "rtl";
        ctx.font = "12px Arial";
        ctx.fillStyle = "#666";
        ctx.fillText(String(r.parameter_name_ur), COL.spec - 20, rowTop + 36);
        ctx.direction = "ltr";
        ctx.textAlign = "left";
        rowH = 44;
      }
      y += rowH;
      ctx.strokeStyle = "#eee"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke();
    }
    y += 16;
  }

  // Notes
  if (insp.notes) {
    ctx.font = "bold 10px Arial"; ctx.fillStyle = "#666";
    ctx.fillText("NOTES", M, y);
    y += 16;
    ctx.font = "12px Arial"; ctx.fillStyle = "#111";
    for (const line of wrapText(ctx, insp.notes, W - 2 * M)) { ctx.fillText(line, M, y); y += 16; }
    y += 8;
  }

  // Signatures
  y += 40;
  ctx.strokeStyle = "#999"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(M + 300, y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W - M - 300, y); ctx.lineTo(W - M, y); ctx.stroke();
  ctx.font = "10px Arial"; ctx.fillStyle = "#555";
  ctx.fillText("Inspected by (sign & date)", M, y + 16);
  ctx.fillText("Approved by (sign & date)", W - M - 300, y + 16);
  y += 40;

  return y;
}

async function buildPdf(d: ReportData): Promise<Blob> {
  // First pass on a tall canvas to measure, then crop to the used height.
  const big = document.createElement("canvas");
  big.width = W * S;
  big.height = 5000 * S;
  const bctx = big.getContext("2d")!;
  bctx.scale(S, S);
  const usedH = Math.ceil(draw(bctx, d));

  const out = document.createElement("canvas");
  out.width = W * S;
  out.height = usedH * S;
  const octx = out.getContext("2d")!;
  octx.drawImage(big, 0, 0); // copies the top-left region (clipped to out's size)

  const dataUrl = out.toDataURL("image/jpeg", 0.92);
  return jpegToPdf(dataUrlToBytes(dataUrl), out.width, out.height);
}

/** Build the QC inspection PDF and open the share sheet (WhatsApp on mobile). */
export async function shareQCInspectionPdf(inspectionId: string): Promise<SharePdfResult> {
  const d = await fetchReport(inspectionId);
  const blob = await buildPdf(d);
  const qc = d.insp.qc_number || "inspection";
  const supplier = d.insp.suppliers?.name ? ` — ${d.insp.suppliers.name}` : "";
  const po = d.insp.purchase_orders?.po_number ? ` (PO ${d.insp.purchase_orders.po_number})` : "";
  return shareOrDownloadPdf({
    blob,
    fileName: `QC-Inspection-${qc}.pdf`,
    title: `Quality Inspection ${qc}`,
    text: `Quality Inspection Report ${qc}${supplier}${po}`,
  });
}
