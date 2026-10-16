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

// Purchase Request roles: an Officer (sees the category's requests on
// Purchase → Purchase Requests) and an Approver (also gives the Purchase
// approval) for each category. Mirrors purchase_request_category_role() in
// supabase/migrations/20261016130200_purchase_request_role_rights.sql.
const PR_ROLE_KEY: Record<PurchaseCategory, string> = {
  office_supplies: "office",
  raw_material: "raw_material",
  general_supplies: "production",
  spare_maintenance: "spares",
};

export type PurchaseRequestTier = "officer" | "approver";

export const purchaseRequestRole = (category: PurchaseCategory, tier: PurchaseRequestTier) =>
  `pr_${PR_ROLE_KEY[category]}_${tier}`;

export const PURCHASE_REQUEST_ROLES: { role: string; category: PurchaseCategory; tier: PurchaseRequestTier }[] =
  PURCHASE_CATEGORY_OPTIONS.flatMap(({ value }) =>
    (["officer", "approver"] as PurchaseRequestTier[]).map((tier) => ({ role: purchaseRequestRole(value, tier), category: value, tier })));

/** Categories whose requests these roles cover, at the given tier (an approver also covers "officer"). */
export const purchaseRequestRoleCategories = (roleNames: string[], tier: PurchaseRequestTier): PurchaseCategory[] =>
  PURCHASE_REQUEST_ROLES
    .filter((r) => roleNames.includes(r.role) && (tier === "officer" || r.tier === "approver"))
    .map((r) => r.category)
    .filter((c, i, a) => a.indexOf(c) === i);
