/**
 * Planning item classification helpers.
 *
 * planning_items.item_type says what a planning item is:
 *   - wip       → work-in-process output of a department
 *   - finished  → a finished, sellable product
 *   - NULL      → not yet classified (rows created before the column existed)
 *
 * Finished products carry extra details (SKU owner, felt, logo picture, grade,
 * packing, master packing); see docs/PLANNING_ITEM_TYPES.md.
 */
import { supabase } from "@/integrations/supabase/client";

/** Mirrors the item_type CHECK constraint on planning_items. */
export type PlanningItemType = "wip" | "finished";

export const PLANNING_ITEM_TYPES: {
  value: PlanningItemType;
  label: string;
  shortLabel: string;
  badgeClass: string;
}[] = [
  { value: "wip", label: "WIP (work in process)", shortLabel: "WIP", badgeClass: "text-orange-600 border-orange-300" },
  { value: "finished", label: "Finished Product", shortLabel: "Finished", badgeClass: "text-emerald-600 border-emerald-300" },
];

export function planningItemTypeMeta(value: string | null | undefined) {
  return PLANNING_ITEM_TYPES.find((t) => t.value === value) ?? null;
}

/** Value of an item type filter: one type, "unclassified" (NULL) or "all". */
export type PlanningItemTypeFilterValue = PlanningItemType | "unclassified" | "all";

/** True when an item's item_type passes the filter. */
export function matchesPlanningItemType(value: string | null | undefined, filter: PlanningItemTypeFilterValue) {
  if (filter === "all") return true;
  if (filter === "unclassified") return !value;
  return value === filter;
}

/** Mirrors the sku_owner_type CHECK constraint on planning_items. */
export type SkuOwnerType = "company" | "customer";

export const SKU_OWNER_TYPES: { value: SkuOwnerType; label: string; shortLabel: string; badgeClass: string }[] = [
  { value: "company", label: "Company product / SKU", shortLabel: "Company SKU", badgeClass: "text-blue-600 border-blue-300" },
  { value: "customer", label: "Customer SKU", shortLabel: "Customer SKU", badgeClass: "text-violet-600 border-violet-300" },
];

export function skuOwnerTypeMeta(value: string | null | undefined) {
  return SKU_OWNER_TYPES.find((t) => t.value === value) ?? null;
}

/** Finished-product detail columns on planning_items. */
export interface FinishedProductDetails {
  sku_owner_type: SkuOwnerType | null;
  customer_id: string | null;
  sku_code: string | null;
  felt: string | null;
  logo_image_path: string | null;
  grade_id: string | null;
  packing: string | null;
  master_packing: string | null;
}

/** Every finished-product detail cleared; what a WIP item is saved with. */
export const EMPTY_FINISHED_PRODUCT_DETAILS: FinishedProductDetails = {
  sku_owner_type: null,
  customer_id: null,
  sku_code: null,
  felt: null,
  logo_image_path: null,
  grade_id: null,
  packing: null,
  master_packing: null,
};

export const LOGO_BUCKET = "planning-item-logos";

/** Upload a finished product's logo picture and return its storage path. */
export async function uploadPlanningItemLogo(file: File): Promise<string> {
  const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw error;
  return path;
}

/** Best-effort removal of a logo picture; a missing object is not an error. */
export async function removePlanningItemLogo(path: string | null | undefined): Promise<void> {
  if (!path) return;
  await supabase.storage.from(LOGO_BUCKET).remove([path]).catch(() => {});
}

export const planningItemLogoUrl = (path: string | null | undefined) =>
  path ? supabase.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl : null;
