import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, RefreshCw, History, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface SampleItem {
  id: string;
  product_id: string;
  variant_id: string | null;
  sku: string | null;
  unit: string;
  reorder_level: number;
  is_active: boolean;
}
interface Product { id: string; name: string; brand: string | null; }
interface Variant { id: string; variant_name: string; }
interface Movement {
  id: string;
  sample_item_id: string;
  movement_date: string;
  movement_type: "opening" | "receipt" | "issue" | "return" | "adjustment";
  quantity: number;
  reference_type: string | null;
  reference_id: string | null;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

const typeColor = (t: Movement["movement_type"]) => {
  switch (t) {
    case "opening": return "bg-slate-100 text-slate-800 border-slate-300";
    case "receipt": return "bg-green-100 text-green-800 border-green-300";
    case "issue": return "bg-red-100 text-red-800 border-red-300";
    case "return": return "bg-blue-100 text-blue-800 border-blue-300";
    case "adjustment": return "bg-amber-100 text-amber-800 border-amber-300";
  }
};

export default function CRMSampleInventoryPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<SampleItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveType, setMoveType] = useState<"opening" | "receipt" | "adjustment">("receipt");
  const [moveItem, setMoveItem] = useState<string>("");
  const [moveQty, setMoveQty] = useState<number>(0);
  const [moveDate, setMoveDate] = useState(todayStr());
  const [moveRemarks, setMoveRemarks] = useState("");
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [ledgerItem, setLedgerItem] = useState<SampleItem | null>(null);

  const prodMap = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products]);
  const varMap = useMemo(() => Object.fromEntries(variants.map(v => [v.id, v])), [variants]);

  const load = async () => {
    setLoading(true);
    const [it, pr, vr, mv] = await Promise.all([
      supabase.from("crm_sample_items").select("*").eq("is_active", true).order("created_at"),
      supabase.from("crm_products").select("id,name,brand"),
      supabase.from("crm_product_variants").select("id,variant_name"),
      supabase.from("crm_sample_stock_movements").select("*").order("movement_date", { ascending: false }).order("created_at", { ascending: false }).limit(5000),
    ]);
    if (it.error) toast.error(it.error.message);
    setItems((it.data as any) || []);
    setProducts((pr.data as any) || []);
    setVariants((vr.data as any) || []);
    setMovements((mv.data as any) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const stockByItem = useMemo(() => {
    const m: Record<string, number> = {};
    movements.forEach(mv => { m[mv.sample_item_id] = (m[mv.sample_item_id] || 0) + Number(mv.quantity); });
    return m;
  }, [movements]);

  const lastMoveByItem = useMemo(() => {
    const m: Record<string, Movement> = {};
    movements.forEach(mv => { if (!m[mv.sample_item_id]) m[mv.sample_item_id] = mv; });
    return m;
  }, [movements]);

  const openMove = (type: typeof moveType, itemId?: string) => {
    setMoveType(type);
    setMoveItem(itemId || "");
    setMoveQty(0);
    setMoveDate(todayStr());
    setMoveRemarks("");
    setMoveOpen(true);
  };

  const saveMove = async () => {
    if (!moveItem) { toast.error("Select an item"); return; }
    if (!moveQty || isNaN(moveQty)) { toast.error("Enter quantity"); return; }
    if (moveType === "adjustment" && !moveRemarks.trim()) { toast.error("Remarks required for adjustments"); return; }
    let qty = Number(moveQty);
    if (moveType === "opening" || moveType === "receipt") qty = Math.abs(qty);
    const { error } = await supabase.from("crm_sample_stock_movements").insert({
      sample_item_id: moveItem,
      movement_date: moveDate,
      movement_type: moveType,
      quantity: qty,
      reference_type: "manual",
      remarks: moveRemarks || null,
      created_by: user?.full_name || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Recorded");
    setMoveOpen(false);
    load();
  };

  const openLedger = (it: SampleItem) => { setLedgerItem(it); setLedgerOpen(true); };

  const itemLabel = (it: SampleItem) => {
    const p = prodMap[it.product_id]?.name || "—";
    const v = it.variant_id ? ` / ${varMap[it.variant_id]?.variant_name || ""}` : "";
    return `${p}${v}`;
  };

  const totals = useMemo(() => {
    const totalItems = items.length;
    const lowStock = items.filter(i => (stockByItem[i.id] || 0) <= Number(i.reorder_level || 0)).length;
    const totalUnits = items.reduce((s, i) => s + (stockByItem[i.id] || 0), 0);
    return { totalItems, lowStock, totalUnits };
  }, [items, stockByItem]);

  const ledgerRows = useMemo(() => {
    if (!ledgerItem) return [];
    const rows = movements.filter(m => m.sample_item_id === ledgerItem.id);
    const sorted = [...rows].sort((a, b) => (a.movement_date + a.created_at).localeCompare(b.movement_date + b.created_at));
    let bal = 0;
    return sorted.map(r => { bal += Number(r.quantity); return { ...r, balance: bal }; }).reverse();
  }, [movements, ledgerItem]);

  return (
    <ERPLayout>
      <PageHeader title="Sample Inventory" description="Dedicated stock of CRM samples" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Sample Items</div><div className="text-2xl font-bold">{totals.totalItems}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Units in Stock</div><div className="text-2xl font-bold">{totals.totalUnits}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Low Stock Items</div><div className="text-2xl font-bold text-red-600">{totals.lowStock}</div></CardContent></Card>
      </div>

      <div className="flex items-center justify-end gap-2 mb-3">
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
        <Button size="sm" variant="outline" onClick={() => openMove("opening")}><Plus className="h-4 w-4 mr-1" />Opening Stock</Button>
        <Button size="sm" variant="outline" onClick={() => openMove("adjustment")}>Adjustment</Button>
        <Button size="sm" onClick={() => openMove("receipt")}><Plus className="h-4 w-4 mr-1" />Add Receipt</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Current Stock</TableHead>
                <TableHead className="text-right">Reorder</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Movement</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={8} className="text-center p-6">Loading...</TableCell></TableRow>
              ) : items.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center p-6 text-muted-foreground">No sample items. Add some in <strong>Sample Items</strong> first.</TableCell></TableRow>
              ) : items.map(it => {
                const stock = stockByItem[it.id] || 0;
                const low = stock <= Number(it.reorder_level || 0);
                const lm = lastMoveByItem[it.id];
                return (
                  <TableRow key={it.id}>
                    <TableCell className="font-medium">{itemLabel(it)}</TableCell>
                    <TableCell>{it.sku || "—"}</TableCell>
                    <TableCell>{it.unit}</TableCell>
                    <TableCell className={`text-right font-bold ${low ? "text-red-600" : ""}`}>{stock}</TableCell>
                    <TableCell className="text-right">{it.reorder_level}</TableCell>
                    <TableCell>
                      {low ? <Badge className="bg-red-100 text-red-800 border-red-300"><AlertTriangle className="h-3 w-3 mr-1" />Low</Badge>
                           : <Badge className="bg-green-100 text-green-800 border-green-300">OK</Badge>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{lm ? `${lm.movement_date} · ${lm.movement_type}` : "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => openMove("receipt", it.id)}>+ Stock</Button>
                      <Button size="icon" variant="ghost" onClick={() => openLedger(it)}><History className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="max-w-md w-[95vw]">
          <DialogHeader><DialogTitle>{moveType === "opening" ? "Opening Stock" : moveType === "receipt" ? "Add Receipt" : "Stock Adjustment"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Sample Item *</Label>
              <Select value={moveItem} onValueChange={setMoveItem}>
                <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                <SelectContent>
                  {items.map(it => <SelectItem key={it.id} value={it.id}>{itemLabel(it)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date</Label>
                <Input type="date" value={moveDate} onChange={(e) => setMoveDate(e.target.value)} />
              </div>
              <div>
                <Label>Quantity {moveType === "adjustment" ? "(+/-)" : ""}</Label>
                <Input type="number" value={moveQty} onChange={(e) => setMoveQty(Number(e.target.value))} />
              </div>
            </div>
            <div>
              <Label>Remarks {moveType === "adjustment" ? "*" : ""}</Label>
              <Textarea value={moveRemarks} onChange={(e) => setMoveRemarks(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(false)}>Cancel</Button>
            <Button onClick={saveMove}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={ledgerOpen} onOpenChange={setLedgerOpen}>
        <DialogContent className="max-w-3xl w-[95vw] max-h-[90vh] overflow-auto">
          <DialogHeader><DialogTitle>Ledger — {ledgerItem ? itemLabel(ledgerItem) : ""}</DialogTitle></DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Remarks</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledgerRows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center p-6 text-muted-foreground">No movements yet</TableCell></TableRow>
              ) : ledgerRows.map(r => (
                <TableRow key={r.id}>
                  <TableCell>{r.movement_date}</TableCell>
                  <TableCell><Badge className={typeColor(r.movement_type)}>{r.movement_type}</Badge></TableCell>
                  <TableCell className={`text-right ${Number(r.quantity) < 0 ? "text-red-600" : "text-green-700"}`}>{Number(r.quantity) > 0 ? "+" : ""}{r.quantity}</TableCell>
                  <TableCell className="text-right font-medium">{r.balance}</TableCell>
                  <TableCell className="text-xs">{r.reference_type || "—"}</TableCell>
                  <TableCell className="text-xs">{r.remarks || "—"}</TableCell>
                  <TableCell className="text-xs">{r.created_by || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
