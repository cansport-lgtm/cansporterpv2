import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  db,
  fetchItemStock,
  fetchMaterialItems,
  fetchProductMaterials,
  fetchSlots,
  type ItemStock,
  type MaterialItem,
  type MaterialSlot,
  type ProductMaterial,
  type SlotKey,
} from "@/lib/productMaterials";

export interface ProductRef {
  id: string;
  code: string;
  name: string;
  owner_type: string | null;
  base_product_id: string | null;
  is_active?: boolean | null;
}

export interface EffectiveMaterial extends ProductMaterial {
  inherited: boolean;
}

export type StockLevel = "ok" | "low" | "out" | "unknown";

export function stockLevel(s: ItemStock | undefined): StockLevel {
  if (!s || !s.stock_known || s.stock_now == null) return "unknown";
  if (s.stock_now <= 0) return "out";
  if (s.min_stock > 0 && s.stock_now < s.min_stock) return "low";
  return "ok";
}

export const STOCK_DOT: Record<StockLevel, string> = {
  ok: "bg-emerald-600",
  low: "bg-amber-500",
  out: "bg-red-600",
  unknown: "bg-red-600",
};

export const STOCK_TEXT: Record<StockLevel, string> = {
  ok: "In stock",
  low: "Below min stock",
  out: "Out of stock",
  unknown: "Stock unknown (never counted)",
};

export interface CategoryRef {
  id: string;
  name: string;
}
export interface SubcategoryRef {
  id: string;
  name: string;
  category_id: string;
}

// Stable empty values so memoised lookups don't rebuild on every render.
const NO_MATERIALS: ProductMaterial[] = [];
const NO_ITEMS: MaterialItem[] = [];
const NO_SLOTS: MaterialSlot[] = [];
const NO_STOCK = new Map<string, ItemStock>();
const NO_CATEGORIES: CategoryRef[] = [];
const NO_SUBCATEGORIES: SubcategoryRef[] = [];

export const MATERIAL_QUERY_KEYS = {
  slots: ["product-material-slots"],
  materials: ["product-materials"],
  items: ["product-material-items"],
} as const;

// Everything the Products page needs for the material columns.
export function useMaterialData(enabled = true) {
  const slotsQ = useQuery({ queryKey: MATERIAL_QUERY_KEYS.slots, queryFn: fetchSlots, enabled });
  const materialsQ = useQuery({ queryKey: MATERIAL_QUERY_KEYS.materials, queryFn: fetchProductMaterials, enabled });
  // Refetch on focus so items added in another tab show up in the pickers.
  const itemsQ = useQuery({
    queryKey: MATERIAL_QUERY_KEYS.items,
    queryFn: fetchMaterialItems,
    enabled,
    refetchOnWindowFocus: true,
  });

  const categoriesQ = useQuery({
    queryKey: ["consumption-categories-for-materials"],
    queryFn: async () => {
      const { data, error } = await db.from("consumption_categories").select("id, name").eq("is_active", true).order("name");
      if (error) throw error;
      return data as CategoryRef[];
    },
    enabled,
  });
  const subcategoriesQ = useQuery({
    queryKey: ["consumption-subcategories-for-materials"],
    queryFn: async () => {
      const { data, error } = await db
        .from("consumption_subcategories")
        .select("id, name, category_id")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as SubcategoryRef[];
    },
    enabled,
  });

  const materials = materialsQ.data ?? NO_MATERIALS;
  const usedItemIds = useMemo(
    () => Array.from(new Set(materials.map((m) => m.item_id))).sort(),
    [materials],
  );
  const stockQ = useQuery({
    queryKey: ["product-material-stock", usedItemIds],
    queryFn: () => fetchItemStock(usedItemIds),
    enabled: enabled && usedItemIds.length > 0,
  });

  const slots: MaterialSlot[] = slotsQ.data ?? NO_SLOTS;
  const items: MaterialItem[] = itemsQ.data ?? NO_ITEMS;
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const byProduct = useMemo(() => {
    const m = new Map<string, Map<SlotKey, ProductMaterial>>();
    for (const row of materials) {
      if (!m.has(row.product_id)) m.set(row.product_id, new Map());
      m.get(row.product_id)!.set(row.slot, row);
    }
    return m;
  }, [materials]);

  return {
    slots,
    items,
    itemById,
    materials,
    byProduct,
    stock: stockQ.data ?? NO_STOCK,
    categories: categoriesQ.data ?? NO_CATEGORIES,
    subcategories: subcategoriesQ.data ?? NO_SUBCATEGORIES,
    isLoading: slotsQ.isLoading || materialsQ.isLoading || itemsQ.isLoading,
  };
}

// Own rows + (customer SKU with a base product) the base product's rows for
// the columns the SKU does not set itself. Mirrors v_product_materials_effective.
export function effectiveMaterials(
  product: ProductRef,
  byProduct: Map<string, Map<SlotKey, ProductMaterial>>,
): Map<SlotKey, EffectiveMaterial> {
  const out = new Map<SlotKey, EffectiveMaterial>();
  const own = byProduct.get(product.id);
  if (product.owner_type === "customer" && product.base_product_id) {
    const base = byProduct.get(product.base_product_id);
    base?.forEach((row, slot) => out.set(slot, { ...row, inherited: true }));
  }
  own?.forEach((row, slot) => out.set(slot, { ...row, inherited: false }));
  return out;
}

// Items a column's dropdown may list: the column's mapped category and,
// when set, its sub-category.
export function itemsForSlot(slot: MaterialSlot | undefined, items: MaterialItem[]): MaterialItem[] {
  if (!slot?.category_id) return [];
  return items.filter(
    (i) =>
      i.raw_material_category_id === slot.category_id &&
      (!slot.subcategory_id || i.raw_material_subcategory_id === slot.subcategory_id),
  );
}

// Customer SKUs that copy a base product may only set these columns.
export function slotEditableFor(product: Pick<ProductRef, "owner_type" | "base_product_id">, slot: MaterialSlot): boolean {
  if (product.owner_type === "customer" && product.base_product_id) return slot.customer_override;
  return true;
}
