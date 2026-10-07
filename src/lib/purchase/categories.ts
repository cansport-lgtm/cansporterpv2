import type { Database } from "@/integrations/supabase/types";

export type PurchaseCategory = Database["public"]["Enums"]["purchase_category"];

// Display names of the purchase categories. The database values stay as they
// are; `general_supplies` is shown as Production Supplies (gloves, clippers, …)
// and `spare_maintenance` as Spares & Parts.
export const PURCHASE_CATEGORY_LABELS: Record<PurchaseCategory, string> = {
  office_supplies: "Office Supplies",
  raw_material: "Raw Material",
  general_supplies: "Production Supplies",
  spare_maintenance: "Spares & Parts",
};

export const PURCHASE_CATEGORY_OPTIONS: { value: PurchaseCategory; label: string }[] = (
  ["office_supplies", "raw_material", "general_supplies", "spare_maintenance"] as PurchaseCategory[]
).map((value) => ({ value, label: PURCHASE_CATEGORY_LABELS[value] }));

export const purchaseCategoryLabel = (c: string | null | undefined) =>
  (c && PURCHASE_CATEGORY_LABELS[c as PurchaseCategory]) || c || "—";
