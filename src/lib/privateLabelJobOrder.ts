// Private Label Job Orders (Production Planning).
//
// Separate from normal job orders: own tables, own number series
// (PLJO-YY-NNNN, set by the database), own page. One order = one customer +
// one grade; each line is a size + qty (dozens) + packing + master packing.
// Status rules and the change log live in the database
// (supabase/migrations/20261024120000_private_label_job_orders.sql).
import { supabase } from "@/integrations/supabase/client";
import { fetchMaterialItems, fetchSlots, type MaterialItem } from "@/lib/productMaterials";

// The new tables are not in the generated types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const PLJO_BUCKET = "private-label-logos";
export const PLJO_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const PLJO_LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp", "application/pdf"];

// Products / SKUs material columns whose items count as master packing.
export const MASTER_PACKING_SLOTS = ["cartons", "master_packing_2"] as const;

export type PljoStatus = "Draft" | "Issued" | "Closed" | "Cancelled";
export type PljoPriority = "low" | "medium" | "high" | "critical";
export type PljoAttachmentKind = "logo" | "artwork";

export interface PljoSize {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface PljoLine {
  id?: string;
  size_id: string;
  quantity: number | string;
  packing_type_id: string;
  master_packing_item_id: string;
  packs_per_master: number | string;
  remarks: string;
  sort_order: number;
}

export interface PljoForm {
  id?: string;
  order_date: string;
  required_by_date: string;
  customer_id: string;
  grade_id: string;
  brand_name: string;
  customer_po_ref: string;
  priority: PljoPriority;
  remarks: string;
  lines: PljoLine[];
}

export interface PljoAttachment {
  id: string;
  job_order_id: string;
  kind: PljoAttachmentKind;
  file_path: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  created_at: string;
}

export interface PljoOrder {
  id: string;
  pl_job_order_number: string;
  order_date: string;
  required_by_date: string | null;
  customer_id: string;
  grade_id: string;
  brand_name: string | null;
  customer_po_ref: string | null;
  priority: PljoPriority;
  status: PljoStatus;
  remarks: string | null;
  issued_at: string | null;
  closed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  customers: { name: string } | null;
  grades: { name: string } | null;
  private_label_job_order_items: { quantity: number }[];
  private_label_job_order_attachments: Pick<PljoAttachment, "kind" | "file_path" | "mime_type">[];
}

/** A saved line, with names for display and printing. */
export interface PljoSavedLine extends PljoLine {
  id: string;
  size_name: string;
  packing_label: string;
  packing_dozens: number;
  master_packing_name: string;
}

export interface PljoDetail {
  order: PljoOrder;
  lines: PljoSavedLine[];
  attachments: PljoAttachment[];
}

export interface PljoLogEntry {
  id: string;
  action: string;
  details: Record<string, unknown> | null;
  changed_at: string;
  app_users: { full_name: string | null } | null;
}

export const blankLine = (sort_order = 0): PljoLine => ({
  size_id: "",
  quantity: "",
  packing_type_id: "",
  master_packing_item_id: "",
  packs_per_master: "",
  remarks: "",
  sort_order,
});

export const blankForm = (): PljoForm => ({
  order_date: new Date().toISOString().split("T")[0],
  required_by_date: "",
  customer_id: "",
  grade_id: "",
  brand_name: "",
  customer_po_ref: "",
  priority: "medium",
  remarks: "",
  lines: [blankLine(0)],
});

/** Badge variant per status. */
export const statusVariant = (s: string) => {
  if (s === "Draft") return "secondary" as const;
  if (s === "Issued") return "default" as const;
  if (s === "Cancelled") return "destructive" as const;
  return "outline" as const;
};

export function publicUrl(path: string): string {
  return supabase.storage.from(PLJO_BUCKET).getPublicUrl(path).data.publicUrl;
}

export const isImage = (mime: string | null | undefined) => !!mime && mime.startsWith("image/");

/** Inner packs and master packs for a line: rounded up, 0 when not computable. */
export function lineTotals(quantity: number, dozensPerPack: number, packsPerMaster: number) {
  const packs = dozensPerPack > 0 ? Math.ceil(quantity / dozensPerPack) : 0;
  const masters = packs > 0 && packsPerMaster > 0 ? Math.ceil(packs / packsPerMaster) : 0;
  return { packs, masters };
}

/** First problem with the form, or null when it can be saved. */
export function validateForm(form: PljoForm): string | null {
  if (!form.customer_id) return "Select the customer";
  if (!form.grade_id) return "Select the grade";
  if (!form.order_date) return "Enter the order date";
  if (form.lines.length === 0) return "Add at least one line";
  for (const [i, l] of form.lines.entries()) {
    const n = i + 1;
    if (!l.size_id) return `Line ${n}: select the size`;
    if (!(Number(l.quantity) > 0)) return `Line ${n}: enter a quantity`;
    if (!l.packing_type_id) return `Line ${n}: select the packing`;
    if (!l.master_packing_item_id) return `Line ${n}: select the master packing`;
    if (!(Number(l.packs_per_master) > 0)) return `Line ${n}: enter packs per master packing`;
  }
  return null;
}

// ------------------------------------------------------------ reads

export async function fetchOrders(filters: {
  status: string;
  from: string;
  to: string;
}): Promise<PljoOrder[]> {
  let q = db
    .from("private_label_job_orders")
    .select(
      "*, customers(name), grades(name), private_label_job_order_items(quantity), private_label_job_order_attachments(kind, file_path, mime_type)",
    )
    .order("order_date", { ascending: false })
    .order("pl_job_order_number", { ascending: false });
  if (filters.status !== "all") q = q.eq("status", filters.status);
  if (filters.from) q = q.gte("order_date", filters.from);
  if (filters.to) q = q.lte("order_date", filters.to);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as PljoOrder[];
}

export async function fetchOrderDetail(id: string): Promise<PljoDetail> {
  const [o, l, a] = await Promise.all([
    db
      .from("private_label_job_orders")
      .select(
        "*, customers(name), grades(name), private_label_job_order_items(quantity), private_label_job_order_attachments(kind, file_path, mime_type)",
      )
      .eq("id", id)
      .single(),
    db
      .from("private_label_job_order_items")
      .select("*, private_label_sizes(name), packing_types(label, dozens), items(name)")
      .eq("job_order_id", id)
      .order("sort_order"),
    db.from("private_label_job_order_attachments").select("*").eq("job_order_id", id).order("created_at"),
  ]);
  if (o.error) throw o.error;
  if (l.error) throw l.error;
  if (a.error) throw a.error;
  return {
    order: o.data as PljoOrder,
    lines: ((l.data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      size_id: r.size_id as string,
      quantity: Number(r.quantity),
      packing_type_id: r.packing_type_id as string,
      master_packing_item_id: r.master_packing_item_id as string,
      packs_per_master: Number(r.packs_per_master),
      remarks: (r.remarks as string) ?? "",
      sort_order: Number(r.sort_order) || 0,
      size_name: (r.private_label_sizes as { name?: string } | null)?.name ?? "",
      packing_label: (r.packing_types as { label?: string } | null)?.label ?? "",
      packing_dozens: Number((r.packing_types as { dozens?: number } | null)?.dozens) || 0,
      master_packing_name: (r.items as { name?: string } | null)?.name ?? "",
    })),
    attachments: (a.data ?? []) as PljoAttachment[],
  };
}

export async function fetchLog(id: string): Promise<PljoLogEntry[]> {
  const { data, error } = await db
    .from("private_label_job_order_log")
    .select("id, action, details, changed_at, app_users(full_name)")
    .eq("job_order_id", id)
    .order("changed_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PljoLogEntry[];
}

export async function fetchSizes(includeInactive = false): Promise<PljoSize[]> {
  let q = db.from("private_label_sizes").select("id, name, sort_order, is_active");
  if (!includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q.order("sort_order").order("name");
  if (error) throw error;
  return (data ?? []) as PljoSize[];
}

/** Items of the Master Packing material columns (Products / SKUs > Column setup). */
export async function fetchMasterPackingItems(): Promise<MaterialItem[]> {
  const [slots, items] = await Promise.all([fetchSlots(), fetchMaterialItems()]);
  const mapped = slots.filter(
    (s) => (MASTER_PACKING_SLOTS as readonly string[]).includes(s.key) && s.category_id,
  );
  return items.filter((i) =>
    mapped.some(
      (s) =>
        i.raw_material_category_id === s.category_id &&
        (!s.subcategory_id || i.raw_material_subcategory_id === s.subcategory_id),
    ),
  );
}

// ------------------------------------------------------------ writes

export async function saveSize(size: { id?: string; name: string; sort_order: number; is_active: boolean }) {
  const payload = { name: size.name.trim(), sort_order: size.sort_order, is_active: size.is_active };
  const { error } = size.id
    ? await db.from("private_label_sizes").update(payload).eq("id", size.id)
    : await db.from("private_label_sizes").insert(payload);
  if (error) {
    if (error.code === "23505") throw new Error(`Size "${payload.name}" already exists`);
    throw error;
  }
}

const linePayload = (l: PljoLine, i: number) => ({
  size_id: l.size_id,
  quantity: Number(l.quantity),
  packing_type_id: l.packing_type_id,
  master_packing_item_id: l.master_packing_item_id,
  packs_per_master: Number(l.packs_per_master),
  remarks: l.remarks.trim() || null,
  sort_order: i,
});

/**
 * Save header + lines. Lines are updated in place, not deleted and
 * re-inserted, so the change log shows only what really changed.
 * Returns the order id.
 */
export async function saveOrder(
  form: PljoForm,
  existingLines: PljoSavedLine[],
  /** Called once the header is written (before the lines). */
  onHeaderSaved?: (id: string) => void,
): Promise<string> {
  const header = {
    order_date: form.order_date,
    required_by_date: form.required_by_date || null,
    customer_id: form.customer_id,
    grade_id: form.grade_id,
    brand_name: form.brand_name.trim() || null,
    customer_po_ref: form.customer_po_ref.trim() || null,
    priority: form.priority,
    remarks: form.remarks.trim() || null,
  };

  let id = form.id;
  if (id) {
    const { error } = await db.from("private_label_job_orders").update(header).eq("id", id);
    if (error) throw error;
  } else {
    const { data, error } = await db.from("private_label_job_orders").insert(header).select("id").single();
    if (error) throw error;
    id = data.id as string;
  }
  // Lets the caller re-sync (and open a new order) even if a line fails below.
  onHeaderSaved?.(id!);

  const keep = new Set(form.lines.filter((l) => l.id).map((l) => l.id));
  const removed = existingLines.filter((l) => !keep.has(l.id)).map((l) => l.id);
  if (removed.length) {
    const { error } = await db.from("private_label_job_order_items").delete().in("id", removed);
    if (error) throw error;
  }

  for (const [i, l] of form.lines.entries()) {
    const payload = linePayload(l, i);
    if (l.id) {
      const before = existingLines.find((e) => e.id === l.id);
      if (before && JSON.stringify(linePayload(before, before.sort_order)) === JSON.stringify(payload)) continue;
      const { error } = await db.from("private_label_job_order_items").update(payload).eq("id", l.id);
      if (error) throw error;
    } else {
      const { error } = await db.from("private_label_job_order_items").insert({ ...payload, job_order_id: id });
      if (error) throw error;
    }
  }
  return id!;
}

export async function setStatus(id: string, status: PljoStatus, cancelReason?: string) {
  const patch: Record<string, unknown> = { status };
  if (status === "Cancelled") patch.cancel_reason = cancelReason?.trim() || null;
  const { error } = await db.from("private_label_job_orders").update(patch).eq("id", id);
  if (error) throw error;
}

/** Remarks are the only field an Issued order still takes. */
export async function saveRemarks(id: string, remarks: string) {
  const { error } = await db
    .from("private_label_job_orders")
    .update({ remarks: remarks.trim() || null })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteDraft(id: string, attachments: PljoAttachment[]) {
  const { error } = await db.from("private_label_job_orders").delete().eq("id", id);
  if (error) throw error;
  if (attachments.length) {
    await supabase.storage.from(PLJO_BUCKET).remove(attachments.map((a) => a.file_path));
  }
}

export function checkFile(file: File): string | null {
  if (!PLJO_LOGO_TYPES.includes(file.type)) return "Use a PNG, JPG, SVG, WEBP or PDF file";
  if (file.size > PLJO_MAX_FILE_BYTES) return "File is larger than 10 MB";
  return null;
}

/** Upload a logo (replaces the current one) or an artwork file. */
export async function uploadAttachment(
  orderId: string,
  file: File,
  kind: PljoAttachmentKind,
  current: PljoAttachment[],
) {
  const problem = checkFile(file);
  if (problem) throw new Error(problem);

  if (kind === "logo") {
    for (const old of current.filter((a) => a.kind === "logo")) await removeAttachment(old);
  }

  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const path = `pljo/${orderId}/${kind}-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage.from(PLJO_BUCKET).upload(path, file, {
    contentType: file.type,
  });
  if (upErr) throw upErr;

  const { error } = await db.from("private_label_job_order_attachments").insert({
    job_order_id: orderId,
    kind,
    file_path: path,
    file_name: file.name,
    file_size: file.size,
    mime_type: file.type,
  });
  if (error) {
    await supabase.storage.from(PLJO_BUCKET).remove([path]);
    throw error;
  }
}

/**
 * Copy one of the customer's saved logos into this order, so later changes
 * on Customer Logos never alter an order that was already issued.
 */
export async function copyCustomerLogo(orderId: string, logoUrl: string, current: PljoAttachment[]) {
  const res = await fetch(logoUrl);
  if (!res.ok) throw new Error("Could not load the customer logo");
  const blob = await res.blob();
  const name = decodeURIComponent(logoUrl.split("/").pop()?.split("?")[0] || "customer-logo");
  await uploadAttachment(orderId, new File([blob], name, { type: blob.type }), "logo", current);
}

export async function removeAttachment(att: PljoAttachment) {
  const { error } = await db.from("private_label_job_order_attachments").delete().eq("id", att.id);
  if (error) throw error;
  await supabase.storage.from(PLJO_BUCKET).remove([att.file_path]);
}

export async function logPrinted(id: string) {
  const { error } = await db.rpc("pljo_log_printed", { p_job_order_id: id });
  if (error) throw error;
}

// ------------------------------------------------------------ floor page (/floor/private-label)
// The floor page has no ERP login: every call carries the floor PIN, which
// the database checks before returning anything.

export type FloorPinStatus = "ok" | "invalid" | "locked" | "not_set" | "not_found";

export interface FloorOrder {
  id: string;
  pl_job_order_number: string;
  order_date: string;
  required_by_date: string | null;
  brand_name: string | null;
  customer_po_ref: string | null;
  priority: PljoPriority;
  remarks: string | null;
  issued_at: string | null;
  customer_name: string;
  grade_name: string;
  total_dozens: number;
  line_count: number;
  logo_path: string | null;
  logo_mime: string | null;
  last_printed_at: string | null;
}

export class FloorPinError extends Error {
  constructor(public status: FloorPinStatus) {
    super(status);
  }
}

async function floorRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw error;
  if (data?.status !== "ok") throw new FloorPinError(data?.status ?? "invalid");
  return data as T;
}

export async function fetchFloorOrders(pin: string): Promise<FloorOrder[]> {
  const data = await floorRpc<{ orders: FloorOrder[] }>("pljo_floor_orders", { p_pin: pin });
  return data.orders;
}

export async function fetchFloorOrderDetail(pin: string, id: string): Promise<PljoDetail> {
  const data = await floorRpc<PljoDetail>("pljo_floor_order_detail", { p_pin: pin, p_job_order_id: id });
  return {
    order: data.order,
    lines: data.lines.map((l) => ({
      ...l,
      quantity: Number(l.quantity),
      packs_per_master: Number(l.packs_per_master),
      packing_dozens: Number(l.packing_dozens) || 0,
    })),
    attachments: data.attachments,
  };
}

export async function logFloorPrinted(pin: string, id: string) {
  await floorRpc("pljo_floor_log_printed", { p_pin: pin, p_job_order_id: id });
}

export async function fetchFloorPinStatus(): Promise<{ is_set: boolean; changed_at?: string }> {
  const { data, error } = await db.rpc("pljo_floor_pin_status");
  if (error) throw error;
  return data;
}

export async function setFloorPin(pin: string) {
  const { error } = await db.rpc("pljo_floor_set_pin", { p_pin: pin });
  if (error) throw error;
}
