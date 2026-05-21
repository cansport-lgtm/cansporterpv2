import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Plus, FileText, Eye, ArrowDownLeft, AlertTriangle, CheckCircle } from "lucide-react";
import { format, startOfMonth } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { processPurchaseReturn } from "@/lib/purchase/processPurchaseReturn";

const sb = supabase as any;

const STATUS_COLOR: Record<string, string> = {
  draft:     "bg-gray-100 text-gray-800 border-gray-200",
  posted:    "bg-green-100 text-green-800 border-green-200",
  cancelled: "bg-rose-100 text-rose-800 border-rose-200",
};

const RETURN_REASONS = ["Defective", "Quality issue", "Wrong item", "Excess receipt", "Damaged in transit", "Other"];

const CATEGORIES: { value: string; label: string }[] = [
  { value: "raw_material", label: "Raw Material" },
  { value: "office_supplies", label: "Office Supplies" },
  { value: "general_supplies", label: "General Supplies" },
  { value: "spare_maintenance", label: "Spares / Maintenance" },
];

interface LineForm {
  grn_item_id: string;
  item_id: string;
  item_label: string;
  description: string;
  original_qty: number;
  qty: number;
  unit_price: number;
  reason: string;
}

export default function PurchaseReturnsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [fromDate, setFromDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [createOpen, setCreateOpen] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);

  // Create form
  const [grnId, setGrnId] = useState("");
  const [returnDate, setReturnDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [category, setCategory] = useState<string>("raw_material");
  const [reason, setReason] = useState("Defective");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineForm[]>([]);

  const { data: returns } = useQuery({
    queryKey: ["purchase-returns-list", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await sb
        .from("purchase_returns")
        .select("*, supplier:suppliers(name, code), grn:goods_receipt_notes(grn_number)")
        .gte("return_date", fromDate)
        .lte("return_date", toDate)
        .order("return_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: grns } = useQuery({
    queryKey: ["purchase-returns-grns"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("goods_receipt_notes")
        .select(`
          id, grn_number, receipt_date, supplier_id, purchase_order_id,
          supplier:suppliers(id, name, code),
          purchase_order:purchase_orders(category)
        `)
        .order("receipt_date", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
    enabled: createOpen,
  });

  // Load GRN items when a GRN is picked
  useEffect(() => {
    if (!grnId) {
      setLines([]);
      return;
    }
    const grn = grns?.find((g: any) => g.id === grnId);
    if (grn?.purchase_order?.category) {
      setCategory(grn.purchase_order.category);
    }
    (async () => {
      const { data } = await sb
        .from("grn_items")
        .select("id, item_id, description, quantity_received, unit_price, item:items(code, name)")
        .eq("grn_id", grnId);
      const next: LineForm[] = (data || []).map((it: any) => ({
        grn_item_id: it.id,
        item_id: it.item_id || "",
        item_label: it.item ? `${it.item.code || ""} — ${it.item.name || ""}` : (it.description || "—"),
        description: it.description || "",
        original_qty: Number(it.quantity_received || 0),
        qty: 0,
        unit_price: Number(it.unit_price || 0),
        reason: "",
      }));
      setLines(next);
    })();
  }, [grnId, grns]);

  const selectedGRN = grns?.find((g: any) => g.id === grnId);
  const supplierId = selectedGRN?.supplier?.id;

  const subtotal = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const hasAnyQty = lines.some((l) => l.qty > 0);
  const overQty = lines.some((l) => l.qty > l.original_qty);

  const { data: viewReturn } = useQuery({
    queryKey: ["purchase-return-view", viewId],
    queryFn: async () => {
      const { data, error } = await sb
        .from("purchase_returns")
        .select("*, supplier:suppliers(name, code), grn:goods_receipt_notes(grn_number, receipt_date)")
        .eq("id", viewId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!viewId,
  });
  const { data: viewLines } = useQuery({
    queryKey: ["purchase-return-view-lines", viewId],
    queryFn: async () => {
      const { data, error } = await sb
        .from("purchase_return_items")
        .select("*, item:items(code, name)")
        .eq("return_id", viewId)
        .order("line_order");
      if (error) throw error;
      return data || [];
    },
    enabled: !!viewId,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!grnId) throw new Error("Pick a GRN");
      if (!supplierId) throw new Error("GRN has no linked supplier");
      if (!hasAnyQty) throw new Error("Enter at least one return quantity");
      if (overQty) throw new Error("Return quantity cannot exceed original received quantity");

      const linesToInsert = lines.filter((l) => l.qty > 0);

      const { data: header, error: hErr } = await sb
        .from("purchase_returns")
        .insert({
          return_number: "",
          return_date: returnDate,
          grn_id: grnId,
          supplier_id: supplierId,
          category,
          reason,
          subtotal,
          total_amount: subtotal,
          notes: notes || null,
          status: "draft",
          created_by: user?.id || null,
        })
        .select("id, return_number")
        .single();
      if (hErr) throw hErr;

      const items = linesToInsert.map((l, i) => ({
        return_id: header.id,
        grn_item_id: l.grn_item_id,
        item_id: l.item_id || null,
        description: l.description || null,
        quantity: l.qty,
        unit_price: l.unit_price,
        amount: l.qty * l.unit_price,
        reason: l.reason || null,
        line_order: i,
      }));
      const { error: iErr } = await sb.from("purchase_return_items").insert(items);
      if (iErr) throw iErr;

      const post = await processPurchaseReturn(header.id);
      if (!post.ok) throw new Error(`Saved as draft but auto-post failed: ${post.error}`);

      return { number: header.return_number, voucherNumber: post.voucherNumber, skipped: post.skipped };
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["purchase-returns-list"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["ap-aging"] });
      toast({
        title: `Purchase return ${r.number} created`,
        description: r.skipped ? `Accounting skipped (${r.skipped})` : `Voucher: ${r.voucherNumber || "posted"}`,
      });
      setCreateOpen(false);
      setGrnId("");
      setReason("Defective");
      setNotes("");
      setLines([]);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("purchase_returns").update({ status: "cancelled" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-returns-list"] });
      toast({ title: "Return cancelled" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const totals = {
    count: returns?.length || 0,
    total: (returns || []).reduce((s: number, r: any) => s + Number(r.total_amount || 0), 0),
    posted: (returns || []).filter((r: any) => r.status === "posted").length,
    draft: (returns || []).filter((r: any) => r.status === "draft").length,
  };

  return (
    <ERPLayout>
      <PageHeader title="Purchase Returns / Debit Notes" description="Returns to suppliers — reverses AP and the inventory/expense account that the GRN debited.">
        <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-1" />New Return</Button>
      </PageHeader>

      <div className="grid grid-cols-4 gap-3 mb-4">
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Total Returns</div><div className="text-lg font-semibold">{totals.count}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Total Value</div><div className="text-lg font-semibold">Rs. {totals.total.toLocaleString()}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Posted</div><div className="text-lg font-semibold text-green-600">{totals.posted}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Draft</div><div className="text-lg font-semibold text-gray-600">{totals.draft}</div></CardContent></Card>
      </div>

      <div className="flex gap-2 mb-4">
        <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-[160px]" />
        <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-[160px]" />
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Return #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>GRN #</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!returns?.length && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">No returns yet.</TableCell></TableRow>}
            {returns?.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.return_number}</TableCell>
                <TableCell className="text-xs">{format(new Date(r.return_date), "dd MMM yyyy")}</TableCell>
                <TableCell className="text-xs">{r.supplier?.name}</TableCell>
                <TableCell className="font-mono text-xs">{r.grn?.grn_number || "—"}</TableCell>
                <TableCell className="text-xs">{CATEGORIES.find((c) => c.value === r.category)?.label || r.category}</TableCell>
                <TableCell className="text-xs">{r.reason || "—"}</TableCell>
                <TableCell className="text-right text-xs font-medium">Rs. {Number(r.total_amount).toLocaleString()}</TableCell>
                <TableCell><Badge className={STATUS_COLOR[r.status] + " border"}>{r.status}</Badge></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setViewId(r.id)} title="View"><Eye className="h-3 w-3" /></Button>
                    {r.status !== "cancelled" && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => cancelMutation.mutate(r.id)} title="Cancel">
                        <ArrowDownLeft className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ============== Create Dialog ============== */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Purchase Return</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Original GRN *</Label>
              <Select value={grnId} onValueChange={setGrnId}>
                <SelectTrigger><SelectValue placeholder="Pick a GRN to return from" /></SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {grns?.map((g: any) => (
                    <SelectItem key={g.id} value={g.id}>
                      <span className="font-mono text-xs mr-2">{g.grn_number}</span>
                      {format(new Date(g.receipt_date), "dd MMM")} · {g.supplier?.name || "—"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedGRN && (
                <div className="text-xs text-muted-foreground mt-1">
                  Supplier: {selectedGRN.supplier?.name || "—"} · {lines.length} line item(s)
                </div>
              )}
            </div>

            <div className="grid grid-cols-4 gap-3">
              <div>
                <Label>Return Date *</Label>
                <Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
              </div>
              <div>
                <Label>Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Reason</Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{RETURN_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Notes</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" />
              </div>
            </div>

            {lines.length > 0 && (
              <div className="border rounded">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Recv Qty</TableHead>
                      <TableHead className="text-right">Return Qty</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Line Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l, i) => (
                      <TableRow key={l.grn_item_id}>
                        <TableCell className="text-xs">{l.item_label}</TableCell>
                        <TableCell className="text-right text-xs">{l.original_qty}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            max={l.original_qty}
                            step="0.01"
                            value={l.qty || ""}
                            onChange={(e) => {
                              const next = [...lines];
                              next[i] = { ...next[i], qty: parseFloat(e.target.value) || 0 };
                              setLines(next);
                            }}
                            className={`h-8 w-24 text-right ml-auto ${l.qty > l.original_qty ? "border-red-500" : ""}`}
                          />
                        </TableCell>
                        <TableCell className="text-right text-xs">Rs. {l.unit_price.toLocaleString()}</TableCell>
                        <TableCell className="text-right text-xs font-medium">Rs. {(l.qty * l.unit_price).toLocaleString()}</TableCell>
                        <TableCell>
                          <Input
                            value={l.reason}
                            onChange={(e) => {
                              const next = [...lines];
                              next[i] = { ...next[i], reason: e.target.value };
                              setLines(next);
                            }}
                            className="h-8 text-xs"
                            placeholder="optional"
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/40 font-semibold">
                      <TableCell colSpan={4} className="text-right">Total</TableCell>
                      <TableCell className="text-right">Rs. {subtotal.toLocaleString()}</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}

            {overQty && (
              <div className="text-xs text-red-600 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Return quantity exceeds original received quantity on at least one line.
              </div>
            )}
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <CheckCircle className="h-3 w-3" /> On save: Dr Accounts Payable / Cr {CATEGORIES.find((c) => c.value === category)?.label} Inventory ({subtotal.toLocaleString()}).
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button size="sm" disabled={!hasAnyQty || overQty || createMutation.isPending} onClick={() => createMutation.mutate()}>
                <FileText className="h-3 w-3 mr-1" />{createMutation.isPending ? "Saving..." : "Save & Post"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ============== View Dialog ============== */}
      <Dialog open={!!viewId} onOpenChange={(o) => !o && setViewId(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {viewReturn?.return_number} <Badge className={STATUS_COLOR[viewReturn?.status || "draft"] + " border ml-2"}>{viewReturn?.status}</Badge>
            </DialogTitle>
          </DialogHeader>
          {viewReturn && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-xs text-muted-foreground">Supplier</div><div>{viewReturn.supplier?.name || "—"}</div></div>
                <div><div className="text-xs text-muted-foreground">Return Date</div><div>{format(new Date(viewReturn.return_date), "dd MMM yyyy")}</div></div>
                <div><div className="text-xs text-muted-foreground">Original GRN</div><div>{viewReturn.grn?.grn_number || "—"}</div></div>
                <div><div className="text-xs text-muted-foreground">Category</div><div>{CATEGORIES.find((c) => c.value === viewReturn.category)?.label}</div></div>
                <div className="col-span-2"><div className="text-xs text-muted-foreground">Reason</div><div>{viewReturn.reason || "—"}</div></div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {viewLines?.map((l: any) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs">{l.item ? `${l.item.code} — ${l.item.name}` : (l.description || "—")}</TableCell>
                      <TableCell className="text-right text-xs">{Number(l.quantity).toLocaleString()}</TableCell>
                      <TableCell className="text-right text-xs">Rs. {Number(l.unit_price).toLocaleString()}</TableCell>
                      <TableCell className="text-right text-xs font-medium">Rs. {Number(l.amount).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold bg-muted/40">
                    <TableCell colSpan={3} className="text-right">Total</TableCell>
                    <TableCell className="text-right">Rs. {Number(viewReturn.total_amount).toLocaleString()}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              {viewReturn.notes && <div className="text-xs"><strong>Notes:</strong> {viewReturn.notes}</div>}
              {viewReturn.accounting_voucher_id && (
                <div className="text-xs text-muted-foreground">Accounting voucher linked. View it on the General Ledger.</div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
