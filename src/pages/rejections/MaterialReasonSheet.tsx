import { useMemo, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type MaterialKind = "rejection" | "wastage" | "leakage";

export interface SelectedMaterial {
  kind: MaterialKind;
  id: string; // material_id ("none" when missing)
  name: string;
}

const CONFIG: Record<MaterialKind, { label: string; qtyField: string; qtyLabel: string; bar: string }> = {
  rejection: { label: "Rejection", qtyField: "rejected_qty", qtyLabel: "Rejected qty", bar: "bg-red-500" },
  wastage: { label: "Wastage", qtyField: "wasted_qty", qtyLabel: "Wasted qty", bar: "bg-amber-500" },
  leakage: { label: "Leakage", qtyField: "leaked_qty", qtyLabel: "Leaked qty", bar: "bg-indigo-500" },
};

interface Props {
  selected: SelectedMaterial | null;
  onClose: () => void;
  /** All records (already filtered by date/department) for the selected kind. */
  records: any[];
  reasonMap: Record<string, string>;
  deptMap: Record<string, string>;
  dateLabel: string;
}

export function MaterialReasonSheet({ selected, onClose, records, reasonMap, deptMap, dateLabel }: Props) {
  const [tab, setTab] = useState<"reason" | "dept">("reason");
  const cfg = selected ? CONFIG[selected.kind] : CONFIG.rejection;

  const { rows, totalQty, totalCost, share } = useMemo(() => {
    if (!selected) return { rows: [], totalQty: 0, totalCost: 0, share: 0 };
    const all = records;
    const mine = all.filter((r) => (r.material_id || "none") === selected.id);
    const grandCost = all.reduce((s, r) => s + Number(r.total_cost || 0), 0);
    const key = tab === "reason" ? "reason_id" : "department_id";
    const names = tab === "reason" ? reasonMap : deptMap;
    const fallback = tab === "reason" ? "No reason recorded" : "No department";
    const map: Record<string, { name: string; qty: number; cost: number; count: number }> = {};
    mine.forEach((r) => {
      const k = r[key] || "none";
      map[k] = map[k] || { name: names[k] || fallback, qty: 0, cost: 0, count: 0 };
      map[k].qty += Number(r[cfg.qtyField] || 0);
      map[k].cost += Number(r.total_cost || 0);
      map[k].count += 1;
    });
    const tq = mine.reduce((s, r) => s + Number(r[cfg.qtyField] || 0), 0);
    const tc = mine.reduce((s, r) => s + Number(r.total_cost || 0), 0);
    return {
      rows: Object.values(map).sort((a, b) => b.cost - a.cost || b.qty - a.qty),
      totalQty: tq,
      totalCost: tc,
      share: grandCost > 0 ? (tc / grandCost) * 100 : 0,
    };
  }, [selected, records, tab, reasonMap, deptMap, cfg.qtyField]);

  const top = rows[0];
  const pct = (v: number) => (totalCost > 0 ? (v / totalCost) * 100 : 0);

  return (
    <Sheet open={!!selected} onOpenChange={(o) => { if (!o) { onClose(); setTab("reason"); } }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="text-left">
          <span className="text-xs font-semibold text-muted-foreground">{cfg.label}</span>
          <SheetTitle>{selected?.name}</SheetTitle>
          <SheetDescription>{dateLabel}</SheetDescription>
        </SheetHeader>

        <div className="grid grid-cols-3 gap-2 mt-4">
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">{cfg.qtyLabel}</div>
            <div className="text-lg font-semibold">{totalQty.toLocaleString()}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Cost</div>
            <div className="text-lg font-semibold">Rs. {Math.round(totalCost).toLocaleString()}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Share of total</div>
            <div className="text-lg font-semibold">{share.toFixed(0)}%</div>
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "reason" | "dept")} className="mt-4">
          <TabsList>
            <TabsTrigger value="reason">By reason</TabsTrigger>
            <TabsTrigger value="dept">By department</TabsTrigger>
          </TabsList>
        </Tabs>

        <Table className="mt-2">
          <TableHeader>
            <TableRow>
              <TableHead>{tab === "reason" ? "Reason" : "Department"}</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Cost (Rs.)</TableHead>
              <TableHead className="text-right">%</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No data.</TableCell></TableRow>
            )}
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell>
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{r.count} {r.count === 1 ? "entry" : "entries"}</div>
                  <div className="mt-1.5 h-1.5 w-full rounded bg-muted">
                    <div className={`h-1.5 rounded ${cfg.bar}`} style={{ width: `${pct(r.cost)}%` }} />
                  </div>
                </TableCell>
                <TableCell className="text-right align-top">{r.qty.toLocaleString()}</TableCell>
                <TableCell className="text-right align-top">{Math.round(r.cost).toLocaleString()}</TableCell>
                <TableCell className="text-right align-top font-semibold">{pct(r.cost).toFixed(0)}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {top && totalCost > 0 && (
          <div className="mt-4 rounded-md bg-muted p-3 text-sm">
            <strong>{top.name}</strong> is the biggest driver: {pct(top.cost).toFixed(0)}% of this material's cost
            (Rs. {Math.round(top.cost).toLocaleString()}).
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
