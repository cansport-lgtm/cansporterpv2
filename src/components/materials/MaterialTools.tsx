import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { cn } from "@/lib/utils";
import {
  db,
  type MaterialItem,
  type MaterialSlot,
  type ProductMaterial,
  type SlotKey,
} from "@/lib/productMaterials";
import {
  type CategoryRef,
  itemsForSlot,
  MATERIAL_QUERY_KEYS,
  type ProductRef,
  slotEditableFor,
  type SubcategoryRef,
} from "@/components/materials/useMaterialData";

function useInvalidateMaterials() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: MATERIAL_QUERY_KEYS.materials });
    qc.invalidateQueries({ queryKey: MATERIAL_QUERY_KEYS.slots });
    qc.invalidateQueries({ queryKey: ["product-material-stock"] });
  };
}

// ------------------------------------------------------------ Column setup

export function ColumnSetupDialog({
  open,
  onOpenChange,
  slots,
  categories,
  subcategories,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  slots: MaterialSlot[];
  categories: CategoryRef[];
  subcategories: SubcategoryRef[];
}) {
  const invalidate = useInvalidateMaterials();
  const [rows, setRows] = useState<Record<string, { category_id: string; subcategory_id: string }>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const r: Record<string, { category_id: string; subcategory_id: string }> = {};
    for (const s of slots) r[s.key] = { category_id: s.category_id ?? "", subcategory_id: s.subcategory_id ?? "" };
    setRows(r);
  }, [open, slots]);

  const save = async () => {
    setSaving(true);
    try {
      for (const s of slots) {
        const r = rows[s.key];
        if (!r) continue;
        if ((r.category_id || null) === s.category_id && (r.subcategory_id || null) === s.subcategory_id) continue;
        const { error } = await db
          .from("product_material_slots")
          .update({ category_id: r.category_id || null, subcategory_id: r.subcategory_id || null, updated_at: new Date().toISOString() })
          .eq("key", s.key);
        if (error) throw error;
      }
      toast.success("Column setup saved");
      invalidate();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Material column setup</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Which raw-material category (and sub-category) each column's dropdown lists. Linked by ID, so renaming a
          category or sub-category never breaks it.
        </p>
        <div className="space-y-3">
          {slots.map((s) => {
            const r = rows[s.key] ?? { category_id: "", subcategory_id: "" };
            const subs = subcategories.filter((x) => x.category_id === r.category_id);
            return (
              <div key={s.key} className="grid grid-cols-[120px_1fr_1fr] items-center gap-3">
                <Label>{s.label}</Label>
                <Select
                  value={r.category_id || "none"}
                  onValueChange={(v) => setRows({ ...rows, [s.key]: { category_id: v === "none" ? "" : v, subcategory_id: "" } })}
                >
                  <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Not set —</SelectItem>
                    {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select
                  value={r.subcategory_id || "any"}
                  disabled={!r.category_id || subs.length === 0}
                  onValueChange={(v) => setRows({ ...rows, [s.key]: { ...r, subcategory_id: v === "any" ? "" : v } })}
                >
                  <SelectTrigger><SelectValue placeholder="Any sub-category" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any sub-category</SelectItem>
                    {subs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------ Bulk Assign

export function BulkAssignDialog({
  open,
  onOpenChange,
  slots,
  items,
  products,
  byProduct,
  grades,
  userId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  slots: MaterialSlot[];
  items: MaterialItem[];
  products: (ProductRef & { grade_id: string | null })[];
  byProduct: Map<string, Map<SlotKey, ProductMaterial>>;
  grades: { id: string; name: string }[];
  userId: string | null;
}) {
  const invalidate = useInvalidateMaterials();
  const [slotKey, setSlotKey] = useState<SlotKey | "">("");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("");
  const [wastage, setWastage] = useState("0");
  const [gradeId, setGradeId] = useState("all");
  const [owner, setOwner] = useState("all");
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [replace, setReplace] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSlotKey(""); setItemId(""); setQty(""); setWastage("0"); setGradeId("all"); setOwner("all");
      setOnlyEmpty(false); setReplace(false); setPicked(new Set());
    }
  }, [open]);

  const slot = slots.find((s) => s.key === slotKey);
  const slotItems = itemsForSlot(slot, items);
  const item = items.find((i) => i.id === itemId);

  const candidates = useMemo(() => {
    if (!slot) return [];
    return products.filter((p) => {
      if (p.is_active === false) return false;
      if (!slotEditableFor(p, slot)) return false;
      if (gradeId !== "all" && p.grade_id !== gradeId) return false;
      if (owner !== "all" && (owner === "customer") !== (p.owner_type === "customer")) return false;
      if (onlyEmpty && byProduct.get(p.id)?.has(slot.key)) return false;
      return true;
    });
  }, [products, slot, gradeId, owner, onlyEmpty, byProduct]);

  useEffect(() => {
    // Default: tick everything that is empty or already has this item.
    setPicked(new Set(candidates.filter((p) => {
      const cur = slot ? byProduct.get(p.id)?.get(slot.key) : undefined;
      return !cur || cur.item_id === itemId;
    }).map((p) => p.id)));
  }, [candidates, itemId, slot, byProduct]);

  const conflicts = candidates.filter((p) => {
    const cur = slot ? byProduct.get(p.id)?.get(slot.key) : undefined;
    return picked.has(p.id) && cur && cur.item_id !== itemId;
  });
  const willFill = [...picked].filter((id) => {
    const cur = slot ? byProduct.get(id)?.get(slot.key) : undefined;
    return !cur || cur.item_id === itemId || replace;
  });

  const valid = slot && item && Number(qty) > 0 && Number(wastage || 0) >= 0 && Number(wastage || 0) < 100;

  const save = async () => {
    if (!slot || !valid) return;
    setSaving(true);
    try {
      const payload = willFill.map((pid) => ({
        product_id: pid,
        slot: slot.key,
        item_id: itemId,
        qty_per_dozen: Number(qty),
        wastage_pct: Number(wastage || 0),
        updated_by: userId,
      }));
      for (let i = 0; i < payload.length; i += 200) {
        const { error } = await db
          .from("product_materials")
          .upsert(payload.slice(i, i + 200), { onConflict: "product_id,slot" });
        if (error) throw error;
      }
      toast.success(`${slot.label} set on ${payload.length} product${payload.length === 1 ? "" : "s"}`);
      invalidate();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Assign — one material to many products</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Dropdowns only. Products that already have a different item keep it unless you tick “Replace”.</p>
        <div className="flex flex-wrap gap-6">
          <div className="w-full max-w-xs space-y-4">
            <div className="space-y-1.5">
              <Label>1 · Column</Label>
              <Select value={slotKey} onValueChange={(v) => { setSlotKey(v as SlotKey); setItemId(""); }}>
                <SelectTrigger><SelectValue placeholder="Pick a column" /></SelectTrigger>
                <SelectContent>
                  {slots.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>2 · Item</Label>
              <SearchableSelect
                value={itemId}
                onValueChange={setItemId}
                disabled={!slot}
                placeholder={slot && !slot.category_id ? "Set the column's category first" : "Pick an item"}
                options={slotItems.map((i) => ({ value: i.id, label: i.name, secondary: [i.subcategory_name, i.unit].filter(Boolean).join(" · "), search: i.code ?? "" }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>3 · Quantity per dozen + wastage</Label>
              <div className="flex items-center gap-2">
                <Input type="number" min="0" step="0.0001" value={qty} onChange={(e) => setQty(e.target.value)} className="w-24" />
                <span className="text-sm text-muted-foreground">{item?.unit || "unit"}</span>
                <Input type="number" min="0" step="0.1" value={wastage} onChange={(e) => setWastage(e.target.value)} className="w-20" />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
              <p className="text-xs text-muted-foreground">Unit comes from Item Master</p>
            </div>
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            <Label>4 · Tick the products</Label>
            <div className="flex flex-wrap gap-2">
              <Select value={gradeId} onValueChange={setGradeId}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All grades</SelectItem>
                  {grades.map((g) => <SelectItem key={g.id} value={g.id}>Grade: {g.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={owner} onValueChange={setOwner}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All owners</SelectItem>
                  <SelectItem value="own">Own SKUs</SelectItem>
                  <SelectItem value="customer">Customer SKUs</SelectItem>
                </SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={onlyEmpty} onCheckedChange={(v) => setOnlyEmpty(!!v)} /> Only where {slot?.label ?? "column"} is empty
              </label>
            </div>
            <div className="max-h-80 overflow-y-auto rounded-lg border">
              <label className="flex items-center gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground">
                <Checkbox
                  checked={candidates.length > 0 && picked.size === candidates.length}
                  onCheckedChange={(v) => setPicked(v ? new Set(candidates.map((p) => p.id)) : new Set())}
                />
                Select all ({candidates.length} shown)
                <span className="ml-auto">Current {slot?.label ?? ""}</span>
              </label>
              {!slot && <div className="p-4 text-sm text-muted-foreground">Pick a column first.</div>}
              {candidates.map((p) => {
                const cur = byProduct.get(p.id)?.get(slot!.key);
                const curName = cur ? items.find((i) => i.id === cur.item_id)?.name ?? "Other item" : "Empty";
                const conflict = cur && cur.item_id !== itemId;
                return (
                  <label key={p.id} className={cn("flex items-center gap-3 border-b px-3 py-2 text-sm", conflict && "bg-amber-50 dark:bg-amber-950/30")}>
                    <Checkbox
                      checked={picked.has(p.id)}
                      onCheckedChange={(v) => {
                        const n = new Set(picked);
                        if (v) n.add(p.id); else n.delete(p.id);
                        setPicked(n);
                      }}
                    />
                    <span className="font-medium">{p.code}</span> {p.name}
                    <span className={cn("ml-auto text-xs", conflict ? "font-semibold text-amber-800" : "text-muted-foreground")}>{curName}</span>
                  </label>
                );
              })}
            </div>
            <div className="space-y-1 rounded-lg bg-primary/5 p-3 text-sm">
              <div className="font-semibold">5 · Preview</div>
              <div>✔ <strong>{willFill.length}</strong> product{willFill.length === 1 ? "" : "s"} will get {item ? <strong>{item.name} · {qty || "?"} {item.unit}/dz · {wastage || 0}%</strong> : "the item"}</div>
              {conflicts.length > 0 && (
                <>
                  <div className="text-amber-800">⚠ <strong>{conflicts.length}</strong> already have a different item — {replace ? "will be replaced" : "kept as is"}</div>
                  <label className="flex items-center gap-2 text-xs"><Checkbox checked={replace} onCheckedChange={(v) => setReplace(!!v)} /> Replace those {conflicts.length} as well</label>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={!valid || willFill.length === 0 || saving}>
            {saving ? "Saving…" : `Save to ${willFill.length} product${willFill.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------ Quick Edit

type RowState = "saved" | "editing" | "error" | "saving";

export function QuickEditGrid({
  products,
  slots,
  items,
  byProduct,
  userId,
}: {
  products: (ProductRef & { grade_name?: string | null })[];
  slots: MaterialSlot[];
  items: MaterialItem[];
  byProduct: Map<string, Map<SlotKey, ProductMaterial>>;
  userId: string | null;
}) {
  const invalidate = useInvalidateMaterials();
  const [state, setState] = useState<Record<string, { s: RowState; msg?: string }>>({});
  // New item picked in an empty cell: waits for its quantity before saving.
  const [pending, setPending] = useState<Record<string, string>>({});

  const optionsBySlot = useMemo(() => {
    const m = new Map<SlotKey, { value: string; label: string; secondary?: string; search?: string }[]>();
    for (const s of slots) {
      m.set(s.key, [
        { value: "__none", label: "— Not used —" },
        ...itemsForSlot(s, items).map((i) => ({ value: i.id, label: i.name, secondary: i.unit, search: i.code ?? "" })),
      ]);
    }
    return m;
  }, [slots, items]);

  const saveCell = async (p: ProductRef, slot: MaterialSlot, patch: { item_id?: string; qty?: string; wastage?: string }) => {
    const cur = byProduct.get(p.id)?.get(slot.key);
    const cellKey = `${p.id}:${slot.key}`;
    const itemId = patch.item_id ?? pending[cellKey] ?? cur?.item_id ?? "";
    if (!cur && itemId && itemId !== "__none" && patch.qty === undefined) {
      setPending((m) => ({ ...m, [cellKey]: itemId }));
      setState((s) => ({ ...s, [p.id]: { s: "editing", msg: `${slot.label}: enter quantity per dozen` } }));
      return;
    }
    setState((s) => ({ ...s, [p.id]: { s: "saving" } }));
    try {
      if (!itemId || itemId === "__none") {
        if (cur) {
          await db.from("product_materials").update({ updated_by: userId }).eq("id", cur.id);
          const { error } = await db.from("product_materials").delete().eq("id", cur.id);
          if (error) throw error;
        }
      } else {
        const qty = Number(patch.qty ?? cur?.qty_per_dozen ?? 0);
        const wastage = Number(patch.wastage ?? cur?.wastage_pct ?? 0);
        if (!(qty > 0)) {
          setState((s) => ({ ...s, [p.id]: { s: "error", msg: `${slot.label}: quantity must be more than 0` } }));
          return;
        }
        if (wastage < 0 || wastage >= 100) {
          setState((s) => ({ ...s, [p.id]: { s: "error", msg: `${slot.label}: wastage % must be 0–99` } }));
          return;
        }
        const { error } = await db.from("product_materials").upsert(
          { product_id: p.id, slot: slot.key, item_id: itemId, qty_per_dozen: qty, wastage_pct: wastage, updated_by: userId },
          { onConflict: "product_id,slot" },
        );
        if (error) throw error;
      }
      setPending((m) => { const n = { ...m }; delete n[cellKey]; return n; });
      setState((s) => ({ ...s, [p.id]: { s: "saved" } }));
      invalidate();
    } catch (e) {
      setState((s) => ({ ...s, [p.id]: { s: "error", msg: (e as Error).message } }));
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Material cells are dropdowns · each change saves on its own · existing columns are unchanged and read-only here.
      </p>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[1500px] text-xs">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-2 py-2 w-10">Saved</th>
              <th className="px-2 py-2">Code</th>
              <th className="px-2 py-2">Name</th>
              <th className="px-2 py-2">Grade</th>
              {slots.map((s) => <th key={s.key} className="px-2 py-2 bg-primary/5 text-primary">{s.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const rs = state[p.id];
              return (
                <tr key={p.id} className="border-t align-top">
                  <td className="px-2 py-2" title={rs?.msg}>
                    {rs?.s === "saving" ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> :
                      rs?.s === "error" ? <span className="font-bold text-red-600">!</span> :
                      rs?.s === "saved" ? <Check className="h-4 w-4 text-emerald-600" /> :
                      rs?.s === "editing" ? <span className="font-bold text-primary">●</span> : null}
                  </td>
                  <td className="px-2 py-2">{p.code}</td>
                  <td className="px-2 py-2 font-medium whitespace-nowrap">
                    {p.name}
                    {(rs?.s === "error" || rs?.s === "editing") && (
                      <div className={cn("font-normal", rs.s === "error" ? "text-red-600" : "text-primary")}>{rs.msg}</div>
                    )}
                  </td>
                  <td className="px-2 py-2">{p.grade_name ?? "-"}</td>
                  {slots.map((s) => {
                    const cur = byProduct.get(p.id)?.get(s.key);
                    const pendingItem = pending[`${p.id}:${s.key}`];
                    const editable = slotEditableFor(p, s);
                    if (!editable) {
                      return <td key={s.key} className="px-2 py-2 text-muted-foreground italic">from base product</td>;
                    }
                    return (
                      <td key={s.key} className="px-1.5 py-1.5 min-w-[170px]">
                        <SearchableSelect
                          value={pendingItem ?? cur?.item_id ?? ""}
                          placeholder={s.category_id ? "—" : "Set category"}
                          disabled={!s.category_id}
                          onValueChange={(v) => saveCell(p, s, { item_id: v })}
                          options={optionsBySlot.get(s.key) ?? []}
                          sortAlpha={false}
                        />
                        {cur && (
                          <div className="mt-1 flex items-center gap-1">
                            <Input
                              key={`q-${cur.id}-${cur.qty_per_dozen}`}
                              aria-label={`${s.label} quantity per dozen`}
                              className="h-7 w-16 px-1.5 text-xs"
                              type="number"
                              defaultValue={Number(cur.qty_per_dozen)}
                              onBlur={(e) => Number(e.target.value) !== Number(cur.qty_per_dozen) && saveCell(p, s, { qty: e.target.value })}
                            />
                            <span className="text-muted-foreground">/dz</span>
                            <Input
                              key={`w-${cur.id}-${cur.wastage_pct}`}
                              aria-label={`${s.label} wastage percent`}
                              className="h-7 w-12 px-1.5 text-xs"
                              type="number"
                              defaultValue={Number(cur.wastage_pct)}
                              onBlur={(e) => Number(e.target.value) !== Number(cur.wastage_pct) && saveCell(p, s, { wastage: e.target.value })}
                            />
                            <span className="text-muted-foreground">%</span>
                          </div>
                        )}
                        {!cur && pendingItem && (
                          <div className="mt-1 flex items-center gap-1">
                            <Input
                              autoFocus
                              aria-label={`${s.label} quantity per dozen`}
                              className="h-7 w-16 border-primary px-1.5 text-xs"
                              type="number"
                              placeholder="qty"
                              onBlur={(e) => e.target.value && saveCell(p, s, { item_id: pendingItem, qty: e.target.value, wastage: "0" })}
                            />
                            <span className="text-muted-foreground">/dz</span>
                          </div>
                        )}
                        {!cur && !pendingItem && <div className="mt-1 text-[11px] text-muted-foreground">not used</div>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
