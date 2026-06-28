import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Boxes, PackagePlus, PackageMinus, AlertTriangle, Wallet, Layers } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { formatPKR } from "@/lib/currency";

const IN_TYPES = [
  { v: "purchase", l: "Purchase / Restock" },
  { v: "opening", l: "Opening Stock" },
  { v: "return_in", l: "Return to Stock" },
  { v: "adjustment_in", l: "Adjustment (+)" },
];
const OUT_TYPES = [
  { v: "sale", l: "Sale / Dispatch" },
  { v: "damage", l: "Damage / Loss" },
  { v: "adjustment_out", l: "Adjustment (−)" },
];
const typeLabel = (t: string) => [...IN_TYPES, ...OUT_TYPES].find(x => x.v === t)?.l || t;

export default function OnlineInventoryPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [moves, setMoves] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("stock");
  const [open, setOpen] = useState(false);
  const [dir, setDir] = useState<"in" | "out">("in");
  const [form, setForm] = useState({ item_id: "", type: "purchase", quantity: "", unit_cost: "", movement_date: format(new Date(), "yyyy-MM-dd"), reference: "", note: "", updateCost: true });

  const fetchData = async () => {
    setLoading(true);
    const [iRes, mRes] = await Promise.all([
      supabase.from("online_items").select("*").order("name"),
      supabase.from("online_stock_movements").select("*").order("movement_date", { ascending: false }).order("created_at", { ascending: false }),
    ]);
    setItems(iRes.data || []);
    setMoves(mRes.data || []);
    setLoading(false);
  };
  useEffect(() => { fetchData(); }, []);

  const stock = useMemo(() => {
    const byItem = new Map<string, number>();
    moves.forEach(m => {
      const q = Number(m.quantity || 0) * (m.direction === "out" ? -1 : 1);
      byItem.set(m.item_id, (byItem.get(m.item_id) || 0) + q);
    });
    return items.map(it => {
      const qty = byItem.get(it.id) || 0;
      const cost = Number(it.cost_price || 0);
      const reorder = Number(it.reorder_level || 0);
      const status = qty <= 0 ? "out" : (reorder > 0 && qty <= reorder) ? "low" : "ok";
      return { ...it, qty, value: qty * cost, reorder, status };
    });
  }, [items, moves]);

  const totals = useMemo(() => ({
    skus: stock.length,
    value: stock.reduce((s, x) => s + (x.qty > 0 ? x.value : 0), 0),
    low: stock.filter(x => x.status === "low").length,
    out: stock.filter(x => x.status === "out").length,
  }), [stock]);

  const openMove = (d: "in" | "out") => {
    setDir(d);
    setForm({ item_id: items[0]?.id || "", type: d === "in" ? "purchase" : "sale", quantity: "", unit_cost: "", movement_date: format(new Date(), "yyyy-MM-dd"), reference: "", note: "", updateCost: true });
    setOpen(true);
  };

  const save = async () => {
    if (!form.item_id) { toast.error("Select an item"); return; }
    const qty = Number(form.quantity);
    if (!qty || qty <= 0) { toast.error("Enter a quantity greater than 0"); return; }
    const unitCost = form.unit_cost.trim() === "" ? null : Number(form.unit_cost);
    const { error } = await supabase.from("online_stock_movements").insert({
      item_id: form.item_id, movement_date: form.movement_date, type: form.type, direction: dir,
      quantity: qty, unit_cost: unitCost, reference: form.reference.trim() || null, note: form.note.trim() || null,
      created_by: user?.id || null,
    });
    if (error) { toast.error(error.message); return; }
    // Refresh the item's cost price to the latest purchase cost (last-cost method)
    // so COGS in the P&L uses an up-to-date figure.
    if (dir === "in" && (form.type === "purchase" || form.type === "opening") && unitCost && unitCost > 0 && form.updateCost) {
      await supabase.from("online_items").update({ cost_price: unitCost, updated_at: new Date().toISOString() }).eq("id", form.item_id);
    }
    toast.success("Stock movement saved");
    setOpen(false); fetchData();
  };

  const itemName = (id: string) => items.find(i => i.id === id)?.name || "-";
  const statusBadge = (s: string) =>
    s === "out" ? <Badge variant="destructive">Out</Badge>
      : s === "low" ? <Badge className="bg-amber-100 text-amber-800 border-amber-400">Low</Badge>
        : <Badge className="bg-emerald-100 text-emerald-800 border-emerald-400">OK</Badge>;

  return (
    <ERPLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <PageHeader title="Inventory" description="Online stock levels, movements, valuation & low-stock alerts" icon={Boxes} iconColor="bg-emerald-600 text-white" />
          <div className="flex gap-2">
            <Button onClick={() => openMove("in")} className="gap-1"><PackagePlus className="h-4 w-4" /> Stock In</Button>
            <Button onClick={() => openMove("out")} variant="outline" className="gap-1"><PackageMinus className="h-4 w-4" /> Stock Out</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard title="SKUs" value={totals.skus} icon={Layers} iconColor="text-slate-600" />
          <MetricCard title="Stock Value" value={formatPKR(totals.value)} icon={Wallet} iconColor="text-blue-600" description="on-hand qty × cost" />
          <MetricCard title="Low Stock" value={totals.low} icon={AlertTriangle} iconColor="text-amber-600" />
          <MetricCard title="Out of Stock" value={totals.out} icon={AlertTriangle} iconColor="text-red-600" />
        </div>

        {(totals.low > 0 || totals.out > 0) && (
          <Card className="border-amber-300 bg-amber-50">
            <CardContent className="py-3 px-4 text-sm text-amber-800 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{totals.out} item(s) out of stock and {totals.low} at/below reorder level. Set reorder levels in Item Master and record a Purchase to restock.</span>
            </CardContent>
          </Card>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="stock">Stock on Hand</TabsTrigger>
            <TabsTrigger value="moves">Movements ({moves.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="stock">
            <Card><CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Item</TableHead><TableHead>Code</TableHead>
                  <TableHead className="text-right">On Hand</TableHead><TableHead className="text-right">Reorder</TableHead>
                  <TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Stock Value</TableHead><TableHead>Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : stock.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No items — add items in Item Master first</TableCell></TableRow>
                  ) : stock.map(x => (
                    <TableRow key={x.id} className={x.status === "out" ? "bg-red-50/40" : x.status === "low" ? "bg-amber-50/40" : ""}>
                      <TableCell className="font-medium">{x.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{x.code || "-"}</TableCell>
                      <TableCell className="text-right font-semibold">{x.qty}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{x.reorder || "-"}</TableCell>
                      <TableCell className="text-right">{formatPKR(Number(x.cost_price || 0))}</TableCell>
                      <TableCell className="text-right">{formatPKR(x.qty > 0 ? x.value : 0)}</TableCell>
                      <TableCell>{statusBadge(x.status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="moves">
            <Card><CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Date</TableHead><TableHead>Item</TableHead><TableHead>Type</TableHead>
                  <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Unit Cost</TableHead>
                  <TableHead>Reference</TableHead><TableHead>Note</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : moves.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No movements yet</TableCell></TableRow>
                  ) : moves.map(m => (
                    <TableRow key={m.id}>
                      <TableCell className="text-sm">{m.movement_date ? format(new Date(m.movement_date), "dd MMM yyyy") : "-"}</TableCell>
                      <TableCell className="font-medium">{itemName(m.item_id)}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{typeLabel(m.type)}</Badge></TableCell>
                      <TableCell className={`text-right font-medium ${m.direction === "out" ? "text-red-600" : "text-emerald-700"}`}>{m.direction === "out" ? "−" : "+"}{Number(m.quantity)}</TableCell>
                      <TableCell className="text-right">{m.unit_cost != null ? formatPKR(Number(m.unit_cost)) : "-"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{m.reference || "-"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{m.note || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dir === "in" ? "Stock In" : "Stock Out"}</DialogTitle>
            <DialogDescription>{dir === "in" ? "Add stock from a purchase, opening balance or return." : "Remove stock for a sale, damage or adjustment."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div><Label>Item</Label>
              <Select value={form.item_id} onValueChange={v => setForm(p => ({ ...p, item_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                <SelectContent>{items.map(i => <SelectItem key={i.id} value={i.id}>{i.name}{i.code ? ` (${i.code})` : ""}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Type</Label>
                <Select value={form.type} onValueChange={v => setForm(p => ({ ...p, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(dir === "in" ? IN_TYPES : OUT_TYPES).map(t => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Quantity</Label><Input type="number" min="0" step="1" value={form.quantity} onChange={e => setForm(p => ({ ...p, quantity: e.target.value }))} placeholder="0" /></div>
            </div>
            {dir === "in" && (form.type === "purchase" || form.type === "opening") && (
              <>
                <div><Label>Unit Cost (Rs.)</Label><Input type="number" min="0" step="0.01" value={form.unit_cost} onChange={e => setForm(p => ({ ...p, unit_cost: e.target.value }))} placeholder="cost per unit" /></div>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" checked={form.updateCost} onChange={e => setForm(p => ({ ...p, updateCost: e.target.checked }))} />
                  Update item cost price to this unit cost (improves P&L COGS accuracy)
                </label>
              </>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Date</Label><Input type="date" value={form.movement_date} onChange={e => setForm(p => ({ ...p, movement_date: e.target.value }))} /></div>
              <div><Label>Reference</Label><Input value={form.reference} onChange={e => setForm(p => ({ ...p, reference: e.target.value }))} placeholder="PO / invoice #" /></div>
            </div>
            <div><Label>Note</Label><Input value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))} placeholder="optional" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
