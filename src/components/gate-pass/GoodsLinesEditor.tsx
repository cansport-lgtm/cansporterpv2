import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { gpDb } from "@/lib/gatePass";
import { newGoodsLine, type GoodsKind, type GoodsLine } from "@/lib/gatePassForms";

// Lines of a returnable or job-work pass.

const KIND_LABEL: Record<GoodsKind, string> = {
  machine: "Machine",
  fixed_asset: "Fixed asset",
  spare_part: "Spare part",
  item: "Store item",
  product: "Product (FG)",
  other: "Other (free text)",
};

type Option = { id: string; label: string; extra?: string };

function useOptions(kind: GoodsKind | "none", enabled: boolean) {
  return useQuery<Option[]>({
    queryKey: ["gate-pass-options", kind],
    enabled: enabled && kind !== "other" && kind !== "none",
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const q = {
        product: () => gpDb.from("products").select("id, code, name").eq("is_active", true).order("code"),
        item: () => gpDb.from("items").select("id, code, name").eq("is_active", true).order("code"),
        machine: () => gpDb.from("machines").select("id, code, name").eq("is_active", true).order("code"),
        fixed_asset: () => gpDb.from("fixed_assets").select("id, code:asset_code, name").order("asset_code"),
        spare_part: () => gpDb.from("spare_parts").select("id, code, name, current_stock, unit_of_measure").eq("is_active", true).order("code"),
      }[kind as Exclude<GoodsKind, "other">];
      const { data, error } = await q();
      if (error) throw error;
      return (data ?? []).map((r: { id: string; code: string; name: string; current_stock?: number | null; unit_of_measure?: string | null }) => ({
        id: r.id,
        label: `${r.code} · ${r.name}`,
        extra: r.current_stock !== undefined ? `${r.current_stock ?? 0} ${r.unit_of_measure || "pcs"} in stock` : undefined,
      }));
    },
  });
}

function RefSelect({ kind, value, onChange, label }: { kind: GoodsKind; value: string; onChange: (v: string) => void; label: string }) {
  const { data = [], isLoading } = useOptions(kind, true);
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger aria-label={label}><SelectValue placeholder={isLoading ? "Loading…" : `Select ${KIND_LABEL[kind].toLowerCase()}`} /></SelectTrigger>
      <SelectContent>
        {data.map((o) => (
          <SelectItem key={o.id} value={o.id}>{o.label}{o.extra ? ` — ${o.extra}` : ""}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function GoodsLinesEditor({
  type, lines, setLines,
}: {
  type: "returnable" | "job_work";
  lines: GoodsLine[];
  setLines: (fn: (ls: GoodsLine[]) => GoodsLine[]) => void;
}) {
  const kinds: GoodsKind[] = type === "returnable"
    ? ["machine", "fixed_asset", "spare_part", "item", "product", "other"]
    : ["item", "product", "other"];
  const update = (key: string, patch: Partial<GoodsLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <div className="space-y-3">
      {lines.map((l, idx) => {
        const n = idx + 1;
        const single = l.kind === "machine" || l.kind === "fixed_asset";
        return (
          <div key={l.key} className="rounded-lg border p-3 space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-[170px_1fr_110px_100px_40px] gap-2 items-end">
              <div>
                <Label className="text-xs">Line {n}</Label>
                <Select value={l.kind} onValueChange={(v) => update(l.key, { kind: v as GoodsKind, ref_id: "", quantity: v === "machine" || v === "fixed_asset" ? "1" : l.quantity })}>
                  <SelectTrigger aria-label={`Line ${n} type`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {kinds.map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{l.kind === "other" ? "Description" : KIND_LABEL[l.kind]}</Label>
                {l.kind === "other" ? (
                  <Input aria-label={`Line ${n} description`} value={l.description} placeholder="What is going out"
                    onChange={(e) => update(l.key, { description: e.target.value })} />
                ) : (
                  <RefSelect kind={l.kind} value={l.ref_id} label={`Line ${n} ${KIND_LABEL[l.kind]}`} onChange={(v) => update(l.key, { ref_id: v })} />
                )}
              </div>
              <div>
                <Label className="text-xs">Qty</Label>
                <Input aria-label={`Line ${n} quantity`} type="number" min="0" step="any" value={l.quantity} disabled={single}
                  onChange={(e) => update(l.key, { quantity: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Unit</Label>
                <Input aria-label={`Line ${n} unit`} value={single ? "no" : l.uom} disabled={single || l.kind === "spare_part"}
                  placeholder={l.kind === "item" ? "item's unit" : "pcs"} onChange={(e) => update(l.key, { uom: e.target.value })} />
              </div>
              <Button variant="ghost" size="icon" aria-label={`Remove line ${n}`} disabled={lines.length === 1}
                onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {type === "job_work" && (
              <div className="grid grid-cols-1 md:grid-cols-[170px_1fr] gap-2 items-end">
                <div>
                  <Label className="text-xs">Comes back as</Label>
                  <Select value={l.output_kind} onValueChange={(v) => update(l.key, { output_kind: v as GoodsLine["output_kind"], output_ref_id: "" })}>
                    <SelectTrigger aria-label={`Line ${n} comes back as`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="item">Store item</SelectItem>
                      <SelectItem value="product">Product (FG)</SelectItem>
                      <SelectItem value="other">Other (free text)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Processed item</Label>
                  {l.output_kind === "other" ? (
                    <Input aria-label={`Line ${n} processed item`} value={l.output_description} placeholder="e.g. Printed ball panels"
                      onChange={(e) => update(l.key, { output_description: e.target.value })} />
                  ) : (
                    <RefSelect kind={l.output_kind} value={l.output_ref_id} label={`Line ${n} processed item`}
                      onChange={(v) => update(l.key, { output_ref_id: v })} />
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
      <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, newGoodsLine(type === "returnable" ? "machine" : "item")])}>
        <Plus className="h-4 w-4 mr-1" /> Add line
      </Button>
    </div>
  );
}

