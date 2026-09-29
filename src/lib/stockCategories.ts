/** Mirrors the stock_category CHECK constraint on planning_items. */
export type StockCategory = "standard" | "cpa" | "leak" | "rejection" | "lot";

export const STOCK_CATEGORIES: {
  value: StockCategory;
  label: string;
  /** Short label for KPI cards and badges. */
  shortLabel: string;
  badgeClass: string;
  iconColor: string;
}[] = [
  { value: "standard", label: "Standard (sellable)", shortLabel: "Standard", badgeClass: "text-green-600 border-green-300", iconColor: "text-primary" },
  { value: "cpa", label: "CPA / Quality Hold", shortLabel: "CPA Hold", badgeClass: "text-purple-600 border-purple-300", iconColor: "text-purple-500" },
  { value: "leak", label: "Leak", shortLabel: "Leak", badgeClass: "text-sky-600 border-sky-300", iconColor: "text-sky-500" },
  { value: "rejection", label: "Rejection", shortLabel: "Rejection", badgeClass: "text-red-600 border-red-300", iconColor: "text-red-500" },
  { value: "lot", label: "Lot Item", shortLabel: "Lot", badgeClass: "text-amber-600 border-amber-300", iconColor: "text-amber-500" },
];

/** The non-standard categories, in the order they are shown on the inventory report. */
export const HELD_STOCK_CATEGORIES = STOCK_CATEGORIES.filter((c) => c.value !== "standard");

export function stockCategoryMeta(value: string | null | undefined) {
  return STOCK_CATEGORIES.find((c) => c.value === value) ?? STOCK_CATEGORIES[0];
}

/** Value of a stock category filter: one category, or "all". */
export type StockCategoryFilterValue = StockCategory | "all";

/** True when an item's stock_category passes the filter (null counts as standard). */
export function matchesStockCategory(value: string | null | undefined, filter: StockCategoryFilterValue) {
  return filter === "all" || (value || "standard") === filter;
}
