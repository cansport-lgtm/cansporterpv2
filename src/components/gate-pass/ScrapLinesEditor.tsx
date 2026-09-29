import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { fmtQty } from "@/lib/gatePass";
import { newScrapLine, useScrapYard, type ScrapLine } from "@/lib/gatePassForms";

// Lines of a scrap pass: one per scrap category, with the weight and the rate for this sale.

export function ScrapLinesEditor({
  lines, setLines, weightLabel,
}: {
  lines: ScrapLine[];
  setLines: (fn: (ls: ScrapLine[]) => ScrapLine[]) => void;
  weightLabel: string;
}) {
  const { data: yard = [] } = useScrapYard();
  const active = yard.filter((c) => c.is_active);
  const update = (key: string, patch: Partial<ScrapLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.rate || 0), 0);

  if (yard.length === 0) {
    return <p className="text-sm text-muted-foreground">No scrap categories yet. A super admin sets them up on the Scrap Yard page.</p>;
  }

  return (
    <div className="space-y-2">
      {lines.map((l, idx) => {
        const cat = yard.find((c) => c.category_id === l.scrap_category_id);
        const over = cat && Number(l.quantity || 0) > Number(cat.balance);
        const n = idx + 1;
        return (
          <div key={l.key} className="grid grid-cols-1 md:grid-cols-[1fr_140px_140px_130px_40px] gap-2 items-end">
            <div>
              {idx === 0 && <Label className="text-xs">Scrap category</Label>}
              <Select value={l.scrap_category_id || undefined} onValueChange={(v) => update(l.key, { scrap_category_id: v })}>
                <SelectTrigger aria-label={`Line ${n} scrap category`}><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {active.map((c) => (
                    <SelectItem key={c.category_id} value={c.category_id}
                      disabled={lines.some((x) => x.key !== l.key && x.scrap_category_id === c.category_id)}>
                      {c.name} — {fmtQty(c.balance)} {c.uom} in yard
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              {idx === 0 && <Label className="text-xs">{weightLabel} ({cat?.uom ?? "kg"})</Label>}
              <Input aria-label={`Line ${n} weight`} type="number" min="0" step="any" value={l.quantity}
                className={cn(over && "border-red-500")} onChange={(e) => update(l.key, { quantity: e.target.value })} />
            </div>
            <div>
              {idx === 0 && <Label className="text-xs">Rate per {cat?.uom ?? "kg"} (Rs)</Label>}
              <Input aria-label={`Line ${n} rate`} type="number" min="0" step="any" value={l.rate}
                onChange={(e) => update(l.key, { rate: e.target.value })} />
            </div>
            <div className="text-sm tabular-nums pb-2">
              {idx === 0 && <div className="text-xs text-muted-foreground">Value (Rs)</div>}
              {fmtQty(Number(l.quantity || 0) * Number(l.rate || 0))}
            </div>
            <Button variant="ghost" size="icon" aria-label={`Remove line ${n}`} disabled={lines.length === 1}
              onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
              <Trash2 className="h-4 w-4" />
            </Button>
            {over && <p className="md:col-span-5 text-xs text-red-700 -mt-1">The Scrap Yard has only {fmtQty(cat!.balance)} {cat!.uom} of {cat!.name}.</p>}
          </div>
        );
      })}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, newScrapLine()])}>
          <Plus className="h-4 w-4 mr-1" /> Add category
        </Button>
        <span className="text-sm font-semibold">Total value: Rs {fmtQty(total)}</span>
      </div>
    </div>
  );
}

