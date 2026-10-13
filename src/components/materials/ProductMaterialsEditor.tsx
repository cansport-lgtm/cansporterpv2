import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { cn } from "@/lib/utils";
import {
  db,
  fmtQty,
  type ItemStock,
  type MaterialItem,
  type MaterialSlot,
  type ProductMaterial,
  type SlotKey,
} from "@/lib/productMaterials";
import {
  itemsForSlot,
  type ProductRef,
  slotEditableFor,
  STOCK_DOT,
  STOCK_TEXT,
  stockLevel,
} from "@/components/materials/useMaterialData";

export interface DraftRow {
  item_id: string;
  qty: string;
  wastage: string;
}
export type MaterialDraft = Partial<Record<SlotKey, DraftRow>>;

export function draftFromRows(rows: Map<SlotKey, ProductMaterial> | undefined): MaterialDraft {
  const d: MaterialDraft = {};
  rows?.forEach((r, slot) => {
    d[slot] = { item_id: r.item_id, qty: String(Number(r.qty_per_dozen)), wastage: String(Number(r.wastage_pct)) };
  });
  return d;
}

// Validate before saving. Blank item = column not used.
export function validateDraft(draft: MaterialDraft, slots: MaterialSlot[]): string | null {
  for (const s of slots) {
    const r = draft[s.key];
    if (!r || !r.item_id) continue;
    const q = Number(r.qty);
    if (!r.qty || Number.isNaN(q) || q <= 0) return `${s.label}: quantity per dozen must be more than 0 (or clear the item if not used)`;
    const w = Number(r.wastage || 0);
    if (Number.isNaN(w) || w < 0 || w >= 100) return `${s.label}: wastage % must be between 0 and 99`;
  }
  return null;
}

// Apply a draft for one product: insert / update / delete per column.
export async function saveProductMaterials(
  productId: string,
  draft: MaterialDraft,
  existing: Map<SlotKey, ProductMaterial> | undefined,
  editableSlots: SlotKey[],
  userId: string | null,
) {
  for (const slot of editableSlots) {
    const row = draft[slot];
    const old = existing?.get(slot);
    if (!row || !row.item_id) {
      if (old) {
        // Record who removed it, then delete.
        await db.from("product_materials").update({ updated_by: userId }).eq("id", old.id);
        const { error } = await db.from("product_materials").delete().eq("id", old.id);
        if (error) throw error;
      }
      continue;
    }
    const payload = {
      item_id: row.item_id,
      qty_per_dozen: Number(row.qty),
      wastage_pct: Number(row.wastage || 0),
      updated_by: userId,
    };
    if (old) {
      if (
        old.item_id === payload.item_id &&
        Number(old.qty_per_dozen) === payload.qty_per_dozen &&
        Number(old.wastage_pct) === payload.wastage_pct
      ) continue;
      const { error } = await db.from("product_materials").update(payload).eq("id", old.id);
      if (error) throw error;
    } else {
      const { error } = await db.from("product_materials").insert({ product_id: productId, slot, ...payload });
      if (error) throw error;
    }
  }
}

interface Props {
  product: Pick<ProductRef, "owner_type" | "base_product_id"> & { id?: string };
  slots: MaterialSlot[];
  items: MaterialItem[];
  itemById: Map<string, MaterialItem>;
  stock: Map<string, ItemStock>;
  draft: MaterialDraft;
  onChange: (d: MaterialDraft) => void;
  // Rows the customer SKU inherits from its base product (read-only).
  inherited?: Map<SlotKey, ProductMaterial>;
  copyOptions: { value: string; label: string; secondary?: string; search?: string }[];
  onCopyFrom: (productId: string) => void;
  readOnly?: boolean;
}

export function ProductMaterialsEditor({
  product,
  slots,
  items,
  itemById,
  stock,
  draft,
  onChange,
  inherited,
  copyOptions,
  onCopyFrom,
  readOnly,
}: Props) {
  const [showLog, setShowLog] = useState(false);
  const isCopyingSku = product.owner_type === "customer" && !!product.base_product_id;

  const setRow = (slot: SlotKey, patch: Partial<DraftRow>) => {
    const cur = draft[slot] ?? { item_id: "", qty: "", wastage: "0" };
    onChange({ ...draft, [slot]: { ...cur, ...patch } });
  };

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Raw materials per dozen</div>
          <p className="text-xs text-muted-foreground">
            Pick from the list only. Unit comes from Item Master. Leave a row empty if the product doesn't use it.
          </p>
        </div>
        {!readOnly && (
          <div className="w-64">
            <SearchableSelect
              value=""
              onValueChange={onCopyFrom}
              placeholder="Copy materials from product…"
              options={copyOptions}
            />
          </div>
        )}
      </div>

      {isCopyingSku && (
        <p className="rounded-md bg-primary/5 px-3 py-2 text-xs">
          This customer SKU copies its materials from the base product. Only <strong>Stamp / Logo</strong> and{" "}
          <strong>Cartons</strong> can be changed here.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="py-1.5 pr-2">Column</th>
              <th className="py-1.5 pr-2">Item</th>
              <th className="py-1.5 pr-2">Qty / dz</th>
              <th className="py-1.5 pr-2">Wastage %</th>
              <th className="py-1.5 pr-2">Counted / dz</th>
              <th className="py-1.5 pr-2">Stock now</th>
              <th className="py-1.5">Min stock</th>
            </tr>
          </thead>
          <tbody>
            {slots.map((slot) => {
              const editable = !readOnly && slotEditableFor(product, slot);
              const own = draft[slot.key];
              const inh = !own?.item_id ? inherited?.get(slot.key) : undefined;
              const itemId = own?.item_id || inh?.item_id || "";
              const item = itemId ? itemById.get(itemId) : undefined;
              const qty = own?.item_id ? own.qty : inh ? String(Number(inh.qty_per_dozen)) : "";
              const waste = own?.item_id ? own.wastage : inh ? String(Number(inh.wastage_pct)) : "";
              const counted = Number(qty) > 0 ? Number(qty) * (1 + Number(waste || 0) / 100) : null;
              const st = itemId ? stock.get(itemId) : undefined;
              const level = stockLevel(st);
              const options = itemsForSlot(slot, items).map((i) => ({
                value: i.id,
                label: i.name,
                secondary: [i.subcategory_name, i.unit].filter(Boolean).join(" · "),
                search: i.code ?? "",
              }));
              return (
                <tr key={slot.key} className="border-t align-top">
                  <td className="py-2 pr-2 font-medium whitespace-nowrap">
                    {slot.label}
                    {inh && <div className="text-[11px] font-normal text-muted-foreground">from base product</div>}
                  </td>
                  <td className="py-2 pr-2 min-w-[200px]">
                    {editable ? (
                      slot.category_id ? (
                        <div className="flex gap-1">
                          <SearchableSelect
                            value={own?.item_id ?? ""}
                            onValueChange={(v) => setRow(slot.key, { item_id: v, qty: own?.qty || "", wastage: own?.wastage ?? "0" })}
                            placeholder={inh ? item?.name ?? "—" : "Not used"}
                            options={options}
                            emptyText="No active items in this column's category"
                          />
                          {own?.item_id && (
                            <Button type="button" variant="ghost" size="sm" className="px-2 text-xs" onClick={() => setRow(slot.key, { item_id: "", qty: "", wastage: "0" })}>
                              Clear
                            </Button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-amber-700">Set this column's category in Column setup</span>
                      )
                    ) : (
                      <span className={cn(!item && "text-muted-foreground")}>{item?.name ?? "—"}</span>
                    )}
                  </td>
                  <td className="py-2 pr-2">
                    <Input
                      className="h-9 w-20"
                      type="number"
                      step="0.0001"
                      min="0"
                      value={qty}
                      disabled={!editable || !own?.item_id}
                      onChange={(e) => setRow(slot.key, { qty: e.target.value })}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <Input
                      className="h-9 w-16"
                      type="number"
                      step="0.1"
                      min="0"
                      value={waste}
                      disabled={!editable || !own?.item_id}
                      onChange={(e) => setRow(slot.key, { wastage: e.target.value })}
                    />
                  </td>
                  <td className="py-2 pr-2 whitespace-nowrap">{counted != null ? fmtQty(counted, item?.unit) : "—"}</td>
                  <td className="py-2 pr-2 whitespace-nowrap">
                    {itemId ? (
                      <span className="inline-flex items-center gap-1.5" title={STOCK_TEXT[level]}>
                        <span className={cn("h-2 w-2 rounded-full", STOCK_DOT[level])} />
                        {st?.stock_known ? fmtQty(st.stock_now, st.unit) : "Unknown"}
                      </span>
                    ) : (
                      "—"
                    )}
                    {st?.count_is_old && <div className="text-[11px] text-amber-700">old count</div>}
                  </td>
                  <td className="py-2 whitespace-nowrap">{item ? fmtQty(item.min_stock, item.unit) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {product.id && (
        <div className="text-xs">
          <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => setShowLog((s) => !s)}>
            <History className="h-3.5 w-3.5" /> {showLog ? "Hide" : "Show"} change log
          </button>
          {showLog && <ChangeLog productId={product.id} slots={slots} />}
        </div>
      )}
    </div>
  );
}

function ChangeLog({ productId, slots }: { productId: string; slots: MaterialSlot[] }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["product-material-log", productId],
    queryFn: async () => {
      const { data, error } = await db
        .from("product_material_log")
        .select("id, slot, action, old_values, new_values, changed_at, app_users(full_name)")
        .eq("product_id", productId)
        .order("changed_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as {
        id: string;
        slot: SlotKey;
        action: string;
        old_values: { item_name?: string; qty_per_dozen?: number; wastage_pct?: number } | null;
        new_values: { item_name?: string; qty_per_dozen?: number; wastage_pct?: number } | null;
        changed_at: string;
        app_users: { full_name: string } | null;
      }[];
    },
  });
  const label = useMemo(() => new Map(slots.map((s) => [s.key, s.label])), [slots]);
  const fmt = (v: { item_name?: string; qty_per_dozen?: number; wastage_pct?: number } | null) =>
    v ? `${v.item_name ?? "?"} · ${Number(v.qty_per_dozen)}/dz · ${Number(v.wastage_pct)}%` : "—";
  if (isLoading) return <p className="mt-2 text-muted-foreground">Loading…</p>;
  if (data.length === 0) return <p className="mt-2 text-muted-foreground">No changes yet.</p>;
  return (
    <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
      {data.map((r) => (
        <li key={r.id} className="text-muted-foreground">
          <span className="text-foreground">{new Date(r.changed_at).toLocaleString()}</span> · {r.app_users?.full_name ?? "—"} ·{" "}
          {label.get(r.slot) ?? r.slot} {r.action}: {r.action === "added" ? fmt(r.new_values) : r.action === "removed" ? fmt(r.old_values) : `${fmt(r.old_values)} → ${fmt(r.new_values)}`}
        </li>
      ))}
    </ul>
  );
}
