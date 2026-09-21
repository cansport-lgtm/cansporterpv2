import type { Database } from "@/integrations/supabase/types";

export type MaterialValueCategory =
  Database["public"]["Enums"]["raw_material_value_category"];

// HP / MP / CM value-tier classification for raw materials, set on the
// Items master (items.raw_material_value_category) and mirrored into
// consumption_raw_materials.value_category. Distinct from the free-form
// Category Master (consumption_categories) — this is a fixed 3-value tier
// used to filter consumption reports.
export const MATERIAL_VALUE_CATEGORIES: {
  value: MaterialValueCategory;
  code: string;
  label: string;
}[] = [
  { value: "high_value", code: "HP", label: "High Value (HP)" },
  { value: "medium_value", code: "MP", label: "Medium Value (MP)" },
  { value: "customer_provided", code: "CM", label: "Customer Provided (CM)" },
];

export function materialValueCategoryCode(
  value: MaterialValueCategory | null | undefined
): string {
  return MATERIAL_VALUE_CATEGORIES.find((c) => c.value === value)?.code || "-";
}

export function materialValueCategoryLabel(
  value: MaterialValueCategory | null | undefined
): string {
  return MATERIAL_VALUE_CATEGORIES.find((c) => c.value === value)?.label || "Unclassified";
}
