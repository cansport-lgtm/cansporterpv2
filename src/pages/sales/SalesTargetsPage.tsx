import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Target, Plus, Pencil, Trash2, Copy, ListChecks } from "lucide-react";
import { addMonths, format, startOfMonth } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";

const sb = supabase as any;

interface TargetRow {
  id: string;
  product_id: string;
  period_month: string;
  target_qty_dozens: number;
  target_amount: number;
  notes: string | null;
  product?: { code: string; name: string } | null;
}

const monthKey = (d: Date) => format(startOfMonth(d), "yyyy-MM-dd");
const fmtNum = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const pct = (a: number, t: number) => (t > 0 ? (a / t) * 100 : null);

function achievementBadge(p: number | null) {
  if (p === null) return <Badge variant="outline">No target</Badge>;
  const cls =
    p >= 100 ? "bg-green-100 text-green-800 border-green-200"
    : p >= 70 ? "bg-amber-100 text-amber-800 border-amber-200"
    : "bg-rose-100 text-rose-800 border-rose-200";
  return <Badge variant="outline" className={cls}>{p.toFixed(0)}%</Badge>;
}

// Only these roles can change which products are tracked.
const SELECTION_ROLES = ["super_admin", "admin", "manager"];

export default function SalesTargetsPage() {
  const { user, roles } = useAuth();
  const canManageSelection = roles.some((r) => SELECTION_ROLES.includes(r.role as string));
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(monthKey(new Date()));
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TargetRow | null>(null);
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [selOpen, setSelOpen] = useState(false);
  const [selDraft, setSelDraft] = useState<Set<string>>(new Set());
  const [selSearch, setSelSearch] = useState("");
  const [selOnly, setSelOnly] = useState(false);

  const monthStart = new Date(`${month}T00:00:00`);
  const monthEnd = format(addMonths(monthStart, 1), "yyyy-MM-dd"); // exclusive

  const { data: products } = useQuery({
    queryKey: ["sales-targets-products"],
    queryFn: async () => {
      const { data, error } = await sb.from("products").select("id, code, name").eq("is_active", true).order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: selectedIds, isLoading: selLoading } = useQuery({
    queryKey: ["sales-target-products"],
    queryFn: async () => {
      const { data, error } = await sb.from("sales_target_products").select("product_id");
      if (error) throw error;
      return new Set<string>((data || []).map((r: any) => r.product_id));
    },
  });

  const { data: targets, isLoading } = useQuery({
    queryKey: ["sales-product-targets", month],
    queryFn: async () => {
      const { data, error } = await sb
        .from("sales_product_targets")
        .select("*, product:products(code, name)")
        .eq("period_month", month);
      if (error) throw error;
      return (data || []) as TargetRow[];
    },
  });

  // Actuals come straight from non-cancelled domestic invoices in the month.
  const { data: actuals } = useQuery({
    queryKey: ["sales-targets-actuals", month],
    queryFn: async () => {
      const { data, error } = await sb
        .from("domestic_invoice_items")
        .select("product_id, quantity_dozens, amount, product:products(code, name), invoice:domestic_invoices!inner(invoice_date, status)")
        .gte("invoice.invoice_date", month)
        .lt("invoice.invoice_date", monthEnd)
        .neq("invoice.status", "cancelled");
      if (error) throw error;
      const map = new Map<string, { qty: number; amount: number; code: string; name: string }>();
      for (const r of data || []) {
        if (!r.product_id) continue;
        const cur = map.get(r.product_id) || { qty: 0, amount: 0, code: r.product?.code || "", name: r.product?.name || "" };
        cur.qty += Number(r.quantity_dozens || 0);
        cur.amount += Number(r.amount || 0);
        map.set(r.product_id, cur);
      }
      return map;
    },
  });

  // One row per product that has a target OR sales this month.
  const rows = useMemo(() => {
    return Array.from(selectedIds || [])
      .map((id) => {
        const t = targets?.find((x) => x.product_id === id);
        const a = actuals?.get(id);
        const prod = products?.find((p: any) => p.id === id);
        const tQty = Number(t?.target_qty_dozens || 0);
        const tAmt = Number(t?.target_amount || 0);
        const aQty = a?.qty || 0;
        const aAmt = a?.amount || 0;
        return {
          id,
          target: t || null,
          label: `${prod?.code || t?.product?.code || a?.code || ""} — ${prod?.name || t?.product?.name || a?.name || ""}`,
          tQty, tAmt, aQty, aAmt,
          qtyPct: pct(aQty, tQty),
          amtPct: pct(aAmt, tAmt),
        };
      })
      .sort((x, y) => (y.tQty + y.tAmt) - (x.tQty + x.tAmt) || y.aAmt - x.aAmt);
  }, [selectedIds, products, targets, actuals]);

  const totals = useMemo(() => rows.reduce(
    (s, r) => ({ tQty: s.tQty + r.tQty, tAmt: s.tAmt + r.tAmt, aQty: s.aQty + r.aQty, aAmt: s.aAmt + r.aAmt }),
    { tQty: 0, tAmt: 0, aQty: 0, aAmt: 0 },
  ), [rows]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["sales-product-targets"] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        product_id: productId,
        period_month: month,
        target_qty_dozens: Number(qty) || 0,
        target_amount: Number(amount) || 0,
        notes: notes.trim() || null,
      };
      if (editing) {
        const { error } = await sb.from("sales_product_targets").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from("sales_product_targets").insert({ ...payload, created_by: user?.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      invalidate();
      setOpen(false);
      toast({ title: editing ? "Target updated" : "Target added" });
    },
    onError: (e: any) =>
      toast({
        title: "Could not save target",
        description: e?.code === "23505" ? "This product already has a target for this month — edit it instead." : e?.message,
        variant: "destructive",
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("sales_product_targets").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast({ title: "Target removed" }); },
    onError: (e: any) => toast({ title: "Could not delete", description: e?.message, variant: "destructive" }),
  });

  // Copy last month's targets into this month (skips products already set).
  const copyMutation = useMutation({
    mutationFn: async () => {
      const prev = monthKey(addMonths(monthStart, -1));
      const { data: prevRows, error } = await sb.from("sales_product_targets").select("*").eq("period_month", prev);
      if (error) throw error;
      const have = new Set((targets || []).map((t) => t.product_id));
      const toInsert = (prevRows || [])
        .filter((r: any) => !have.has(r.product_id) && selectedIds?.has(r.product_id))
        .map((r: any) => ({
          product_id: r.product_id,
          period_month: month,
          target_qty_dozens: r.target_qty_dozens,
          target_amount: r.target_amount,
          notes: r.notes,
          created_by: user?.id,
        }));
      if (toInsert.length) {
        const { error: e2 } = await sb.from("sales_product_targets").insert(toInsert);
        if (e2) throw e2;
      }
      return toInsert.length;
    },
    onSuccess: (n: number) => {
      invalidate();
      toast({ title: n ? `Copied ${n} target(s) from last month` : "Nothing to copy from last month" });
    },
    onError: (e: any) => toast({ title: "Copy failed", description: e?.message, variant: "destructive" }),
  });

  const saveSelection = useMutation({
    mutationFn: async () => {
      const current = selectedIds || new Set<string>();
      const toAdd = Array.from(selDraft).filter((id) => !current.has(id));
      const toRemove = Array.from(current).filter((id) => !selDraft.has(id));
      if (toAdd.length) {
        const { error } = await sb.from("sales_target_products").insert(toAdd.map((product_id) => ({ product_id, added_by: user?.id })));
        if (error) throw error;
      }
      if (toRemove.length) {
        const { error } = await sb.from("sales_target_products").delete().in("product_id", toRemove);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-target-products"] });
      setSelOpen(false);
      toast({ title: "Tracked products updated" });
    },
    onError: (e: any) => toast({ title: "Could not save selection", description: e?.message, variant: "destructive" }),
  });

  const openSelection = () => {
    setSelDraft(new Set(selectedIds || []));
    setSelSearch(""); setSelOnly(false); setSelOpen(true);
  };
  const toggleDraft = (id: string) =>
    setSelDraft((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const visibleProducts = useMemo(() => {
    const q = selSearch.trim().toLowerCase();
    return (products || []).filter((p: any) =>
      (!selOnly || selDraft.has(p.id)) && (!q || `${p.code} ${p.name}`.toLowerCase().includes(q)));
  }, [products, selSearch, selOnly, selDraft]);

  const trackedProducts = (products || []).filter((p: any) => selectedIds?.has(p.id));

  const openNew = () => {
    setEditing(null); setProductId(""); setQty(""); setAmount(""); setNotes(""); setOpen(true);
  };
  const openEdit = (t: TargetRow) => {
    setEditing(t); setProductId(t.product_id);
    setQty(String(t.target_qty_dozens || "")); setAmount(String(t.target_amount || "")); setNotes(t.notes || "");
    setOpen(true);
  };

  const canSave = !!productId && ((Number(qty) || 0) > 0 || (Number(amount) || 0) > 0) && !saveMutation.isPending;

  return (
    <ERPLayout>
      <PageHeader
        title="Sales Targets"
        description="Monthly sales target per product vs actual invoiced sales (domestic)"
        icon={Target}
        action={{ label: "Add Target", onClick: openNew, icon: Plus }}
      />

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <Label>Month</Label>
          <Input type="month" value={month.slice(0, 7)} onChange={(e) => e.target.value && setMonth(`${e.target.value}-01`)} className="w-44" />
        </div>
        {canManageSelection && (
          <Button variant="outline" onClick={openSelection}>
            <ListChecks className="h-4 w-4 mr-2" /> Select products ({selectedIds?.size || 0})
          </Button>
        )}
        <Button variant="outline" onClick={() => copyMutation.mutate()} disabled={copyMutation.isPending}>
          <Copy className="h-4 w-4 mr-2" /> Copy last month's targets
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {[
          { l: "Target qty (doz)", v: fmtNum(totals.tQty) },
          { l: "Sold qty (doz)", v: fmtNum(totals.aQty), p: pct(totals.aQty, totals.tQty) },
          { l: "Target value", v: fmtNum(totals.tAmt) },
          { l: "Sold value", v: fmtNum(totals.aAmt), p: pct(totals.aAmt, totals.tAmt) },
        ].map((c) => (
          <Card key={c.l}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{c.l}</div>
              <div className="text-xl font-semibold flex items-center gap-2">
                {c.v} {c.p !== undefined && c.p !== null && achievementBadge(c.p)}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Target (doz)</TableHead>
                <TableHead className="text-right">Sold (doz)</TableHead>
                <TableHead className="text-right">Balance (doz)</TableHead>
                <TableHead>Qty %</TableHead>
                <TableHead className="text-right">Target value</TableHead>
                <TableHead className="text-right">Sold value</TableHead>
                <TableHead>Value %</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(isLoading || selLoading) && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
              )}
              {!isLoading && !selLoading && rows.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  {canManageSelection
                    ? "No products are being tracked yet. Click “Select products” to choose the products you want targets for."
                    : "No products are being tracked yet. Ask a manager to select the products."}
                </TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.label}</TableCell>
                  <TableCell className="text-right">{r.target ? fmtNum(r.tQty) : "—"}</TableCell>
                  <TableCell className="text-right">{fmtNum(r.aQty)}</TableCell>
                  <TableCell className="text-right">{r.tQty > 0 ? fmtNum(Math.max(r.tQty - r.aQty, 0)) : "—"}</TableCell>
                  <TableCell>{r.tQty > 0 ? achievementBadge(r.qtyPct) : "—"}</TableCell>
                  <TableCell className="text-right">{r.target ? fmtNum(r.tAmt) : "—"}</TableCell>
                  <TableCell className="text-right">{fmtNum(r.aAmt)}</TableCell>
                  <TableCell>{r.tAmt > 0 ? achievementBadge(r.amtPct) : "—"}</TableCell>
                  <TableCell>
                    {r.target ? (
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(r.target!)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => { if (confirm("Remove this target?")) deleteMutation.mutate(r.target!.id); }}>
                          <Trash2 className="h-4 w-4 text-rose-600" />
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setProductId(r.id); setQty(""); setAmount(""); setNotes(""); setOpen(true); }}>
                        Set target
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit target" : "Add target"} — {format(monthStart, "MMMM yyyy")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Product</Label>
              <Select value={productId} onValueChange={setProductId} disabled={!!editing}>
                <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                <SelectContent>
                  {trackedProducts.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Target quantity (dozens)</Label>
                <Input type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div>
                <Label>Target value</Label>
                <Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={!canSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={selOpen} onOpenChange={setSelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Select products to track</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Search by code or name" value={selSearch} onChange={(e) => setSelSearch(e.target.value)} />
            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={selOnly} onCheckedChange={(v) => setSelOnly(v === true)} /> Show selected only
              </label>
              <span className="text-muted-foreground">{selDraft.size} selected</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setSelDraft((prev) => { const n = new Set(prev); visibleProducts.forEach((p: any) => n.add(p.id)); return n; })}>
                Select shown
              </Button>
              <Button size="sm" variant="outline" onClick={() => setSelDraft((prev) => { const n = new Set(prev); visibleProducts.forEach((p: any) => n.delete(p.id)); return n; })}>
                Clear shown
              </Button>
            </div>
            <ScrollArea className="h-72 border rounded-md">
              <div className="p-2 space-y-1">
                {visibleProducts.length === 0 && <div className="text-sm text-muted-foreground p-2">No products found.</div>}
                {visibleProducts.map((p: any) => (
                  <label key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm">
                    <Checkbox checked={selDraft.has(p.id)} onCheckedChange={() => toggleDraft(p.id)} />
                    <span>{p.code} — {p.name}</span>
                  </label>
                ))}
              </div>
            </ScrollArea>
            <p className="text-xs text-muted-foreground">
              Removing a product only hides it from this page. Its saved targets are kept and come back if you select it again.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelOpen(false)}>Cancel</Button>
            <Button onClick={() => saveSelection.mutate()} disabled={saveSelection.isPending}>Save selection</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
