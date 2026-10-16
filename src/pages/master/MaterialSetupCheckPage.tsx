import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ClipboardCheck } from "lucide-react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { db, fetchItemStock } from "@/lib/productMaterials";
import { effectiveMaterials, useMaterialData } from "@/components/materials/useMaterialData";

interface Issue {
  name: string;
  issue: string;
  link: string;
}
interface Group {
  key: string;
  title: string;
  hint: string;
  rows: Issue[];
}

const KNOWN_UNITS = new Set(["dozen", "dozens", "dz", "pieces", "piece", "pcs", "pc", "pcs."]);

export default function MaterialSetupCheckPage() {
  const material = useMaterialData();

  const { data: products = [] } = useQuery({
    queryKey: ["setup-check-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, code, name, owner_type, base_product_id, is_active")
        .eq("is_active", true)
        .order("code");
      if (error) throw error;
      return data as { id: string; code: string; name: string; owner_type: string | null; base_product_id: string | null; is_active: boolean }[];
    },
  });

  // Raw-material items in a category that requires a sub-category but have none.
  const { data: noSubcategory = [] } = useQuery({
    queryKey: ["setup-check-no-subcategory"],
    queryFn: async () => {
      const { data: cats, error } = await db.from("consumption_categories").select("id, name").eq("requires_subcategory", true);
      if (error) throw error;
      const ids = (cats ?? []).map((c: { id: string }) => c.id);
      if (ids.length === 0) return [];
      const { data, error: e2 } = await db
        .from("items")
        .select("id, name, raw_material_category_id")
        .eq("category", "raw_material")
        .eq("is_active", true)
        .in("raw_material_category_id", ids)
        .is("raw_material_subcategory_id", null)
        .order("name");
      if (e2) throw e2;
      const catName = new Map((cats ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));
      return (data ?? []).map((i: { name: string; raw_material_category_id: string }) => ({
        name: i.name,
        category: catName.get(i.raw_material_category_id) as string,
      }));
    },
  });

  const { data: distributorUnits = [] } = useQuery({
    queryKey: ["setup-check-distributor-units"],
    queryFn: async () => {
      const { data, error } = await db
        .from("distributor_products")
        .select("id, name, unit, company_product_id")
        .not("company_product_id", "is", null);
      if (error) return [];
      return (data ?? []).filter(
        (p: { unit: string | null }) => !KNOWN_UNITS.has((p.unit ?? "").trim().toLowerCase()),
      ) as { name: string; unit: string | null }[];
    },
  });

  const usedItemIds = useMemo(
    () => Array.from(new Set(material.materials.map((m) => m.item_id))).sort(),
    [material.materials],
  );
  const { data: stock } = useQuery({
    queryKey: ["setup-check-stock", usedItemIds],
    queryFn: () => fetchItemStock(usedItemIds),
    enabled: usedItemIds.length > 0,
  });

  const groups: Group[] = useMemo(() => {
    const productsMissing = products
      .filter((p) => effectiveMaterials(p, material.byProduct).size === 0)
      .map((p) => ({ name: `${p.code} · ${p.name}`, issue: "No materials set — orders say “Set the materials”", link: "/master/products" }));

    const slotsUnset = material.slots
      .filter((s) => !s.category_id)
      .map((s) => ({ name: s.label, issue: "Column has no category — its dropdown is empty", link: "/master/products" }));

    const usedItems = usedItemIds.map((id) => material.itemById.get(id)).filter(Boolean);
    const noMin = usedItems
      .filter((i) => !i!.min_stock || Number(i!.min_stock) <= 0)
      .map((i) => ({ name: i!.name, issue: "Min Stock is 0 — “Below min stock” can never show", link: "/master/items" }));

    const neverCounted: Issue[] = [];
    const oldCount: Issue[] = [];
    stock?.forEach((s) => {
      if (!s.stock_known) neverCounted.push({ name: s.item_name, issue: "Never counted — shows “Stock unknown” on every order", link: "/consumption/stock-closing" });
      else if (s.count_is_old) oldCount.push({ name: s.item_name, issue: `Last count ${s.last_count_date} (${s.closing_frequency})`, link: "/consumption/stock-closing" });
    });

    return [
      { key: "slots", title: "Material columns without a category", hint: "Products / SKUs → Column setup", rows: slotsUnset },
      { key: "products", title: "Products missing materials", hint: "Bulk Assign, Quick Edit or the Edit form", rows: productsMissing },
      {
        key: "subcat",
        title: "Packing items with no sub-category",
        hint: "Item Master → Sub-Category",
        rows: noSubcategory.map((i: { name: string; category: string }) => ({ name: i.name, issue: `${i.category}, Sub-Category empty`, link: "/master/items" })),
      },
      { key: "min", title: "Items with no Min Stock", hint: "Item Master → Min Stock", rows: noMin },
      { key: "never", title: "Items never counted in Stock Closing", hint: "Material Consumption → Stock Closing", rows: neverCounted },
      { key: "old", title: "Items with an old stock count", hint: "Daily items after 2 days, weekly after 8 days", rows: oldCount },
      {
        key: "units",
        title: "Distributor products with an unclear unit",
        hint: "Distributor → Products → Unit (Dozen / Pieces)",
        rows: distributorUnits.map((p) => ({ name: p.name, issue: `Unit “${p.unit ?? ""}” — counted as dozens`, link: "/distributor/products" })),
      },
    ];
  }, [products, material.byProduct, material.slots, material.itemById, usedItemIds, noSubcategory, stock, distributorUnits]);

  const productsReady = products.length
    ? Math.round(((products.length - (groups.find((g) => g.key === "products")?.rows.length ?? 0)) / products.length) * 100)
    : 0;
  const issueTotal = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Setup Check"
          description="Everything the raw-material stock check needs. Fix each list until it is empty."
          icon={ClipboardCheck}
          iconColor="bg-primary/10 text-primary"
        />

        <div className="flex flex-wrap items-end gap-6 rounded-xl border bg-card p-4">
          <div className="min-w-[260px] flex-1">
            <div className="flex justify-between text-sm font-semibold">
              <span>Products with materials set</span>
              <span>{productsReady}%</span>
            </div>
            <Progress value={productsReady} className="mt-2" />
          </div>
          <div className="text-sm">
            <span className={issueTotal ? "font-semibold text-red-600" : "font-semibold text-emerald-600"}>
              {issueTotal ? `${issueTotal} things to fix` : "All clear — ready"}
            </span>
          </div>
        </div>

        {groups.map((g) => (
          <section key={g.key} className="overflow-hidden rounded-xl border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-3">
              <h2 className="text-sm font-semibold">
                {g.title}{" "}
                <span className={g.rows.length ? "ml-1 text-red-600" : "ml-1 text-emerald-600"}>
                  {g.rows.length || "✓"}
                </span>
              </h2>
              <span className="text-xs text-muted-foreground">{g.hint}</span>
            </div>
            {g.rows.slice(0, 50).map((r, i) => (
              <div key={g.key + i} className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-sm first:border-t-0">
                <span>
                  <strong>{r.name}</strong>
                  <span className="ml-2 text-muted-foreground">{r.issue}</span>
                </span>
                <Link to={r.link} className="rounded-md border px-3 py-1 text-xs font-semibold text-primary hover:bg-muted">
                  Fix
                </Link>
              </div>
            ))}
            {g.rows.length > 50 && (
              <div className="border-t px-4 py-2 text-xs text-muted-foreground">+ {g.rows.length - 50} more</div>
            )}
          </section>
        ))}
      </div>
    </ERPLayout>
  );
}
