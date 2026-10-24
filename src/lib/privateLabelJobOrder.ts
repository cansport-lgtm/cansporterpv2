// Private Label Job Orders and Company Product Job Orders (Production Planning).
//
// Separate from normal job orders: own tables, own number series (set by the
// database), own pages. Both kinds share the same tables, told apart by
// order_type:
// - private_label (PLJO-YY-NNNN): one customer + one grade; each line is a
//   size + color + qty (dozens) + packing.
// - company (CJO-YY-NNNN, supabase/migrations/20261030120000_company_job_orders.sql):
//   no customer; each line is one of our own sellable products + qty + packing.
// Status rules and the change log live in the database
// (supabase/migrations/20261024120000_private_label_job_orders.sql).
import { supabase } from "@/integrations/supabase/client";
import { isSellableStockCategory } from "@/lib/stockCategories";

// The new tables are not in the generated types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const PLJO_BUCKET = "private-label-logos";
export const PLJO_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const PLJO_LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp", "application/pdf"];

export type PljoStatus = "Draft" | "Issued" | "Dispatched" | "Closed" | "Cancelled";
export type PljoOrderType = "private_label" | "company";
export type PljoPriority = "low" | "medium" | "high" | "critical";
export type PljoAttachmentKind = "logo" | "artwork";

export interface PljoSize {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface PljoColor extends PljoSize {
  /** Hex shown as a dot next to the name. */
  swatch: string | null;
}

export interface PljoLine {
  id?: string;
  /** Private label lines. */
  size_id: string;
  color_id: string;
  /** Company lines. */
  product_id: string;
  quantity: number | string;
  packing_type_id: string;
  remarks: string;
  sort_order: number;
}

export interface PljoForm {
  id?: string;
  order_date: string;
  required_by_date: string;
  customer_id: string;
  /** Who is invoiced; empty = same as the customer. */
  billing_customer_id: string;
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
  order_type: PljoOrderType;
  order_date: string;
  required_by_date: string | null;
  /** Null on company orders (as are the billing customer and grade). */
  customer_id: string | null;
  grade_id: string | null;
  brand_name: string | null;
  customer_po_ref: string | null;
  priority: PljoPriority;
  status: PljoStatus;
  remarks: string | null;
  issued_at: string | null;
  closed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  dispatched_at?: string | null;
  dispatch_note?: string | null;
  created_at: string;
  billing_customer_id: string | null;
  customers: { name: string } | null;
  billing_customer: { name: string } | null;
  grades: { name: string } | null;
  private_label_job_order_items: {
    quantity: number;
    products?: { code: string; name: string; grades: { name: string } | null } | null;
  }[];
  private_label_job_order_attachments: Pick<PljoAttachment, "kind" | "file_path" | "mime_type">[];
  /** Floor production entries (list query only). */
  private_label_job_order_progress?: { dozens: number }[];
  production_done_at?: string | null;
  production_done_by_name?: string | null;
  /** Position on the floor queue while Issued (list and detail queries). */
  private_label_floor_sequence?: { seq: number } | null;
}

/** A saved line, with names for display and printing. */
export interface PljoSavedLine extends PljoLine {
  id: string;
  size_name: string;
  color_name: string;
  color_swatch: string | null;
  product_code: string;
  product_name: string;
  product_grade: string;
  packing_label: string;
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
  color_id: "",
  product_id: "",
  quantity: "",
  packing_type_id: "",
  remarks: "",
  sort_order,
});

export const blankForm = (): PljoForm => ({
  order_date: new Date().toISOString().split("T")[0],
  required_by_date: "",
  customer_id: "",
  billing_customer_id: "",
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
  if (s === "Dispatched") return "secondary" as const;
  if (s === "Cancelled") return "destructive" as const;
  return "outline" as const;
};

export function publicUrl(path: string): string {
  return supabase.storage.from(PLJO_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Produced share of the ordered dozens, 0–100. */
export const producedPct = (done: number, total: number) =>
  total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

export const isImage = (mime: string | null | undefined) => !!mime && mime.startsWith("image/");

/** First problem with the form, or null when it can be saved. */
export function validateForm(form: PljoForm): string | null {
  if (!form.customer_id) return "Select the customer";
  if (!form.grade_id) return "Select the grade";
  if (!form.order_date) return "Enter the order date";
  if (form.lines.length === 0) return "Add at least one line";
  for (const [i, l] of form.lines.entries()) {
    const n = i + 1;
    if (!l.size_id) return `Line ${n}: select the size`;
    if (!l.color_id) return `Line ${n}: select the color`;
    if (!(Number(l.quantity) > 0)) return `Line ${n}: enter a quantity`;
    if (!l.packing_type_id) return `Line ${n}: select the packing`;
  }
  return null;
}

/** Company Product Job Order form: no customer, brand or header grade. */
export interface CjoForm {
  id?: string;
  order_date: string;
  required_by_date: string;
  priority: PljoPriority;
  remarks: string;
  lines: PljoLine[];
}

export const blankCompanyForm = (): CjoForm => ({
  order_date: new Date().toISOString().split("T")[0],
  required_by_date: "",
  priority: "medium",
  remarks: "",
  lines: [blankLine(0)],
});

/** First problem with a company form, or null when it can be saved. */
export function validateCompanyForm(form: CjoForm): string | null {
  if (!form.order_date) return "Enter the order date";
  if (form.lines.length === 0) return "Add at least one line";
  for (const [i, l] of form.lines.entries()) {
    const n = i + 1;
    if (!l.product_id) return `Line ${n}: select the product`;
    if (!(Number(l.quantity) > 0)) return `Line ${n}: enter a quantity`;
    if (!l.packing_type_id) return `Line ${n}: select the packing`;
  }
  return null;
}

/** An own (company) product that can go on a company job order. */
export interface CompanyProduct {
  id: string;
  code: string;
  name: string;
  grade_name: string | null;
  stock_category: string;
}

// ------------------------------------------------------------ reads

// The orders table links to customers twice (customer, billing customer),
// so each embed names its foreign key.
const CUSTOMER_EMBEDS =
  "customers:customers!private_label_job_orders_customer_id_fkey(name), " +
  "billing_customer:customers!private_label_job_orders_billing_customer_id_fkey(name)";

export async function fetchOrders(filters: {
  type: PljoOrderType;
  status: string;
  from: string;
  to: string;
}): Promise<PljoOrder[]> {
  let q = db
    .from("private_label_job_orders")
    .select(
      `*, ${CUSTOMER_EMBEDS}, grades(name), private_label_job_order_items(quantity, products(code, name, grades(name))), private_label_job_order_attachments(kind, file_path, mime_type), private_label_job_order_progress(dozens), private_label_floor_sequence(seq)`,
    )
    .eq("order_type", filters.type)
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
        `*, ${CUSTOMER_EMBEDS}, grades(name), private_label_job_order_items(quantity), private_label_job_order_attachments(kind, file_path, mime_type), private_label_job_order_progress(dozens), private_label_floor_sequence(seq)`,
      )
      .eq("id", id)
      .single(),
    db
      .from("private_label_job_order_items")
      .select(
        "*, private_label_sizes(name), private_label_colors(name, swatch), products(code, name, grades(name)), packing_types(label)",
      )
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
      size_id: (r.size_id as string) ?? "",
      // Lines saved before colors existed have none.
      color_id: (r.color_id as string) ?? "",
      product_id: (r.product_id as string) ?? "",
      quantity: Number(r.quantity),
      packing_type_id: r.packing_type_id as string,
      remarks: (r.remarks as string) ?? "",
      sort_order: Number(r.sort_order) || 0,
      size_name: (r.private_label_sizes as { name?: string } | null)?.name ?? "",
      color_name: (r.private_label_colors as { name?: string } | null)?.name ?? "",
      color_swatch: (r.private_label_colors as { swatch?: string | null } | null)?.swatch ?? null,
      product_code: (r.products as { code?: string } | null)?.code ?? "",
      product_name: (r.products as { name?: string } | null)?.name ?? "",
      product_grade: (r.products as { grades?: { name?: string } | null } | null)?.grades?.name ?? "",
      packing_label: (r.packing_types as { label?: string } | null)?.label ?? "",
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

/**
 * Active own (company) products in a sellable stock category (Standard /
 * Final Ball). A product without a planning item counts as Standard. The
 * database checks the same rule on every saved line.
 */
export async function fetchCompanyProducts(): Promise<CompanyProduct[]> {
  const { data, error } = await db
    .from("products")
    .select("id, code, name, is_active, grades(name), planning_items(stock_category)")
    .eq("owner_type", "own")
    .order("name");
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[])
    .filter((p) => p.is_active !== false)
    .map((p) => ({
      id: p.id as string,
      code: p.code as string,
      name: p.name as string,
      grade_name: (p.grades as { name?: string } | null)?.name ?? null,
      stock_category: (p.planning_items as { stock_category?: string } | null)?.stock_category || "standard",
    }))
    .filter((p) => isSellableStockCategory(p.stock_category));
}

export async function fetchSizes(includeInactive = false): Promise<PljoSize[]> {
  let q = db.from("private_label_sizes").select("id, name, sort_order, is_active");
  if (!includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q.order("sort_order").order("name");
  if (error) throw error;
  return (data ?? []) as PljoSize[];
}

export async function fetchColors(includeInactive = false): Promise<PljoColor[]> {
  let q = db.from("private_label_colors").select("id, name, swatch, sort_order, is_active");
  if (!includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q.order("sort_order").order("name");
  if (error) throw error;
  return (data ?? []) as PljoColor[];
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

export async function saveColor(color: {
  id?: string;
  name: string;
  swatch: string | null;
  sort_order: number;
  is_active: boolean;
}) {
  const payload = {
    name: color.name.trim(),
    swatch: color.swatch,
    sort_order: color.sort_order,
    is_active: color.is_active,
  };
  const { error } = color.id
    ? await db.from("private_label_colors").update(payload).eq("id", color.id)
    : await db.from("private_label_colors").insert(payload);
  if (error) {
    if (error.code === "23505") throw new Error(`Color "${payload.name}" already exists`);
    throw error;
  }
}

const linePayload = (l: PljoLine, i: number) => ({
  size_id: l.size_id || null,
  color_id: l.color_id || null,
  product_id: l.product_id || null,
  quantity: Number(l.quantity),
  packing_type_id: l.packing_type_id,
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
    billing_customer_id: form.billing_customer_id || form.customer_id,
    grade_id: form.grade_id,
    brand_name: form.brand_name.trim() || null,
    customer_po_ref: form.customer_po_ref.trim() || null,
    priority: form.priority,
    remarks: form.remarks.trim() || null,
  };

  return saveHeaderAndLines(form.id, header, form.lines, existingLines, onHeaderSaved);
}

/** Save a Company Product Job Order (header + lines). Returns the order id. */
export async function saveCompanyOrder(
  form: CjoForm,
  existingLines: PljoSavedLine[],
  onHeaderSaved?: (id: string) => void,
): Promise<string> {
  const header = {
    order_date: form.order_date,
    required_by_date: form.required_by_date || null,
    priority: form.priority,
    remarks: form.remarks.trim() || null,
  };
  // order_type is set once, on insert; the database ignores later changes.
  return saveHeaderAndLines(
    form.id,
    form.id ? header : { ...header, order_type: "company" },
    form.lines,
    existingLines,
    onHeaderSaved,
  );
}

async function saveHeaderAndLines(
  existingId: string | undefined,
  header: Record<string, unknown>,
  lines: PljoLine[],
  existingLines: PljoSavedLine[],
  onHeaderSaved?: (id: string) => void,
): Promise<string> {
  let id = existingId;
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

  const keep = new Set(lines.filter((l) => l.id).map((l) => l.id));
  const removed = existingLines.filter((l) => !keep.has(l.id)).map((l) => l.id);
  if (removed.length) {
    const { error } = await db.from("private_label_job_order_items").delete().in("id", removed);
    if (error) throw error;
  }

  for (const [i, l] of lines.entries()) {
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

export type FloorPinStatus = "ok" | "invalid" | "locked" | "not_set" | "not_found" | "short";

export interface FloorOrder {
  id: string;
  pl_job_order_number: string;
  order_type: PljoOrderType;
  order_date: string;
  required_by_date: string | null;
  brand_name: string | null;
  customer_po_ref: string | null;
  priority: PljoPriority;
  remarks: string | null;
  issued_at: string | null;
  /** Position on the floor queue (1 = next). Null only before the backfill ran. */
  floor_sequence: number | null;
  /** Null on company orders. */
  customer_name: string | null;
  billing_customer_name: string | null;
  /** Company orders: the grades of their products, comma separated. */
  grade_name: string | null;
  /** Company orders: product names / codes in line order. */
  product_names: string | null;
  product_codes: string | null;
  total_dozens: number;
  line_count: number;
  logo_path: string | null;
  logo_mime: string | null;
  last_printed_at: string | null;
  done_dozens: number;
  production_done_at: string | null;
  production_done_by_name: string | null;
  last_progress_at: string | null;
  last_progress_by: string | null;
  /** Latest "no progress" check-in. */
  last_checkin_at: string | null;
  last_checkin_reason: string | null;
  last_checkin_by: string | null;
  /** Start of the 2-hour update clock: issue, progress, check-in or reopen. */
  last_activity_at: string | null;
}

export interface FloorProgressLine {
  item_id: string;
  size_name: string;
  color_name: string;
  /** Company lines. */
  product_code: string;
  product_name: string;
  packing_label: string;
  ordered: number;
  done: number;
}

export interface FloorProgressEntry {
  id: string;
  dozens: number;
  entered_by_name: string | null;
  created_at: string;
  /** The line's label: its size, or its product on company orders. */
  size_name: string;
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
      size_id: l.size_id ?? "",
      color_id: l.color_id ?? "",
      product_id: l.product_id ?? "",
      quantity: Number(l.quantity),
    })),
    attachments: data.attachments,
  };
}

export async function logFloorPrinted(pin: string, id: string) {
  await floorRpc("pljo_floor_log_printed", { p_pin: pin, p_job_order_id: id });
}

export async function fetchFloorProgress(
  pin: string,
  id: string,
): Promise<{ lines: FloorProgressLine[]; entries: FloorProgressEntry[] }> {
  const data = await floorRpc<{ lines: FloorProgressLine[]; entries: FloorProgressEntry[] }>("pljo_floor_progress", {
    p_pin: pin,
    p_job_order_id: id,
  });
  return {
    lines: data.lines.map((l) => ({ ...l, ordered: Number(l.ordered), done: Number(l.done) })),
    entries: data.entries.map((e) => ({ ...e, dozens: Number(e.dozens) })),
  };
}

export async function addFloorProgress(
  pin: string,
  id: string,
  entries: { item_id: string; dozens: number }[],
  enteredBy: string,
): Promise<{ completed: boolean }> {
  // completed: this entry brought every size to 100%, so the order is now Done.
  const data = await floorRpc<{ completed?: boolean }>("pljo_floor_add_progress", {
    p_pin: pin,
    p_job_order_id: id,
    p_entries: entries,
    p_entered_by: enteredBy,
  });
  return { completed: !!data.completed };
}

export async function setFloorDone(pin: string, id: string, done: boolean, by: string) {
  await floorRpc("pljo_floor_set_done", { p_pin: pin, p_job_order_id: id, p_done: done, p_by: by });
}

/** "No progress" check-in: restarts the 2-hour update clock. */
export async function floorCheckin(pin: string, id: string, reason: string, by: string) {
  await floorRpc("pljo_floor_checkin", { p_pin: pin, p_job_order_id: id, p_reason: reason, p_by: by });
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

// ---------------------------------------------------------------------------
// Floor sequence (supabase/migrations/20261114120000_private_label_floor_sequence.sql)
// ---------------------------------------------------------------------------

/** One Issued order as listed in the Floor Sequence dialog. */
export interface FloorSequenceOrder {
  id: string;
  pl_job_order_number: string;
  order_type: PljoOrderType;
  required_by_date: string | null;
  priority: PljoPriority;
  issued_at: string | null;
  updated_at: string;
  brand_name: string | null;
  production_done_at: string | null;
  customers: { name: string } | null;
  grades: { name: string } | null;
  private_label_job_order_items: { quantity: number; products?: { name: string; grades: { name: string } | null } | null }[];
  private_label_job_order_progress: { dozens: number; created_at: string }[];
  private_label_job_order_floor_checkins: { created_at: string }[];
  private_label_floor_sequence: { seq: number } | null;
}

/** Every Issued order (both types), in floor sequence. */
export async function fetchFloorSequence(): Promise<FloorSequenceOrder[]> {
  const { data, error } = await db
    .from("private_label_job_orders")
    .select(
      "id, pl_job_order_number, order_type, required_by_date, priority, issued_at, updated_at, brand_name, production_done_at, customers!private_label_job_orders_customer_id_fkey(name), grades(name), private_label_job_order_items(quantity, products(name, grades(name))), private_label_job_order_progress(dozens, created_at), private_label_job_order_floor_checkins(created_at), private_label_floor_sequence(seq)",
    )
    .eq("status", "Issued");
  if (error) throw error;
  const rows = (data ?? []) as FloorSequenceOrder[];
  const rank = (p: PljoPriority) => ({ critical: 0, high: 1, medium: 2, low: 3 })[p] ?? 3;
  // Same order as the floor page: sequence, then the old priority fallback.
  return rows.sort((a, b) => {
    const sa = a.private_label_floor_sequence?.seq ?? Number.MAX_SAFE_INTEGER;
    const sb = b.private_label_floor_sequence?.seq ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    if (rank(a.priority) !== rank(b.priority)) return rank(a.priority) - rank(b.priority);
    const da = a.required_by_date ?? "9999";
    const db_ = b.required_by_date ?? "9999";
    if (da !== db_) return da < db_ ? -1 : 1;
    return a.pl_job_order_number.localeCompare(b.pl_job_order_number);
  });
}

/**
 * Dispatch an Issued order (final). Below 100% produced the database insists
 * on a note. The order leaves the floor display and the floor queue.
 */
export async function dispatchOrder(id: string, note: string): Promise<{ produced: number; ordered: number }> {
  const { data, error } = await db.rpc("pljo_dispatch", { p_job_order_id: id, p_note: note.trim() || null });
  if (error) throw error;
  return { produced: Number(data?.produced ?? 0), ordered: Number(data?.ordered ?? 0) };
}

/**
 * Save the whole queue: ids of every Issued order in the wanted order. The
 * database refuses if the set of Issued orders changed since the list was
 * loaded (someone issued or closed one), so the caller should reload then.
 */
export async function setFloorSequence(orderIds: string[]): Promise<{ changed: number }> {
  const { data, error } = await db.rpc("pljo_set_floor_sequence", { p_order_ids: orderIds });
  if (error) throw error;
  return { changed: Number(data?.changed ?? 0) };
}
