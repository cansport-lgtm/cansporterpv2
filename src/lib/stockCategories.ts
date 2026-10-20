/** Mirrors the stock_category CHECK constraint on planning_items. */
export type StockCategory =
  | "standard" | "final_ball" | "cpa" | "leak" | "rejection" | "lot" | "cutting_kapra" | "compounds";

export const STOCK_CATEGORIES: {
  value: StockCategory;
  label: string;
  /** Short label for KPI cards and badges. */
  shortLabel: string;
  /** Sellable stock counts in the finished-goods headline. */
  sellable: boolean;
  /** Held stock (quality hold, leak, rejection, lot) is valued separately; in-process material is neither sellable nor held. */
  held: boolean;
  badgeClass: string;
  iconColor: string;
}[] = [
  { value: "standard", label: "Standard (sellable)", shortLabel: "Standard", sellable: true, held: false, badgeClass: "text-green-600 border-green-300", iconColor: "text-primary" },
  { value: "final_ball", label: "Standard (Final Ball)", shortLabel: "Final Ball", sellable: true, held: false, badgeClass: "text-teal-600 border-teal-300", iconColor: "text-teal-500" },
  { value: "cpa", label: "CPA / Quality Hold", shortLabel: "CPA Hold", sellable: false, held: true, badgeClass: "text-purple-600 border-purple-300", iconColor: "text-purple-500" },
  { value: "leak", label: "Leak", shortLabel: "Leak", sellable: false, held: true, badgeClass: "text-sky-600 border-sky-300", iconColor: "text-sky-500" },
  { value: "rejection", label: "Rejection", shortLabel: "Rejection", sellable: false, held: true, badgeClass: "text-red-600 border-red-300", iconColor: "text-red-500" },
  { value: "lot", label: "Lot Item", shortLabel: "Lot", sellable: false, held: true, badgeClass: "text-amber-600 border-amber-300", iconColor: "text-amber-500" },
  { value: "cutting_kapra", label: "Cutting Kapra", shortLabel: "Cutting Kapra", sellable: false, held: false, badgeClass: "text-indigo-600 border-indigo-300", iconColor: "text-indigo-500" },
  { value: "compounds", label: "Compounds", shortLabel: "Compounds", sellable: false, held: false, badgeClass: "text-orange-600 border-orange-300", iconColor: "text-orange-500" },
];

/** The held categories, in the order they are shown on the inventory report. */
export const HELD_STOCK_CATEGORIES = STOCK_CATEGORIES.filter((c) => c.held);

export function stockCategoryMeta(value: string | null | undefined) {
  return STOCK_CATEGORIES.find((c) => c.value === value) ?? STOCK_CATEGORIES[0];
}

/** True for sellable stock (standard / final ball); null counts as standard. */
export function isSellableStockCategory(value: string | null | undefined) {
  return stockCategoryMeta(value).sellable;
}

/** True for held stock (CPA / leak / rejection / lot); in-process material is not held. */
export function isHeldStockCategory(value: string | null | undefined) {
  return stockCategoryMeta(value).held;
}

/** Value of a stock category filter: one category, or "all". */
export type StockCategoryFilterValue = StockCategory | "all";

/** True when an item's stock_category passes the filter (null counts as standard). */
export function matchesStockCategory(value: string | null | undefined, filter: StockCategoryFilterValue) {
  return filter === "all" || (value || "standard") === filter;
}
