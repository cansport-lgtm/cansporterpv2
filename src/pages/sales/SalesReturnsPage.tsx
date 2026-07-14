import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Plus, FileText, Eye, ArrowDownLeft, AlertTriangle, CheckCircle } from "lucide-react";
import { format, startOfMonth } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { processSalesReturn } from "@/lib/sales/processSalesReturn";

const sb = supabase as any;

const STATUS_COLOR: Record<string, string> = {
  draft:     "bg-gray-100 text-gray-800 border-gray-200",
  posted:    "bg-green-100 text-green-800 border-green-200",
  cancelled: "bg-rose-100 text-rose-800 border-rose-200",
};

const RETURN_REASONS = ["Damaged", "Quality issue", "Wrong item", "Excess delivery", "Customer cancelled", "Other"];

interface LineForm {
  dispatch_item_id: string;
  product_id: string;
  product_label: string;
  original_qty: number;
  qty: number;
  unit_price: number;
  standard_cost: number;
  reason: string;
}

export default function SalesReturnsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [fromDate, setFromDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [createOpen, setCreateOpen] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);

  // Create form
  const [dispatchId, setDispatchId] = useState("");
  const [returnDate, setReturnDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [reason, setReason] = useState("Damaged");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineForm[]>([]);

  // ---- Queries ----
  const { data: returns } = useQuery({
    queryKey: ["sales-returns-list", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await sb
        .from("sales_returns")
        .select("*, customer:customers(name, code), dispatch:sales_dispatches(dispatch_number)")
        .gte("return_date", fromDate)
        .lte("return_date", toDate)
        .order("return_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Resolve unique customers attached to a dispatch via its items chain.
  // Same reason as in DomesticInvoicesPage: domestic dispatches use the
  // sales_dispatch_orders join table, so the dispatch's direct order_id is
  // typically NULL and the customer must come from the line items.
  const customersFromItems = (items: any[]): { id: string; name: string }[] => {
    const map = new Map<string, { id: string; name: string }>();
    for (const it of items || []) {
      const c = it.order_item?.order?.customer;
      if (c?.id && !map.has(c.id)) map.set(c.id, { id: c.id, name: c.name });
    }
    return Array.from(map.values());
  };

  const { data: dispatches } = useQuery({
    queryKey: ["sales-returns-dispatches"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("sales_dispatches")
        .select(`
          id, dispatch_number, dispatch_date,
          items:sales_dispatch_items(
            order_item:sales_order_items(
              order:sales_orders(customer:customers(id, name))
            )
          )
        `)
        .eq("sales_segment", "domestic")
        .order("dispatch_date", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []).map((d: any) => ({ ...d, customers: customersFromItems(d.items || []) }));
    },
    enabled: createOpen,
  });

  // Load dispatch items when a dispatch is picked
  useEffect(() => {
    if (!dispatchId) {
      setLines([]);
      return;
    }
    (async () => {
      const { data } = await sb
        .from("sales_dispatch_items")
        .select(`
          id, quantity_dozens,
          order_item:sales_order_items(price_per_dozen, product:products(id, code, name, standard_cost))
        `)
        .eq("dispatch_id", dispatchId);

      // The return rate must follow the INVOICE for this dispatch, not the
      // original order price. Invoice line prices are editable (see
      // InvoiceEditDialog), so an invoice can bill a different rate than the
      // order — e.g. DC 00059 was ordered at 2800 but invoiced at 2500. Build
      // a dispatch_item_id → invoiced price map and prefer it below.
      const { data: invItems } = await sb
        .from("domestic_invoice_items")
        .select("price_per_dozen, dispatch_item_id, invoice:domestic_invoices!inner(dispatch_id)")
        .eq("invoice.dispatch_id", dispatchId);
      const invoicedPrice = new Map<string, number>();
      for (const ii of invItems || []) {
        if (ii.dispatch_item_id != null) invoicedPrice.set(ii.dispatch_item_id, Number(ii.price_per_dozen || 0));
      }

      const next: LineForm[] = (data || []).map((it: any) => ({
        dispatch_item_id: it.id,
        product_id: it.order_item?.product?.id || "",
        product_label: `${it.order_item?.product?.code || ""} — ${it.order_item?.product?.name || ""}`,
        original_qty: Number(it.quantity_dozens || 0),
        qty: 0,
        unit_price: invoicedPrice.has(it.id)
          ? invoicedPrice.get(it.id)!
          : Number(it.order_item?.price_per_dozen || 0),
        standard_cost: Number(it.order_item?.product?.standard_cost || 0),
        reason: "",
      }));
      setLines(next);
    })();
  }, [dispatchId]);

  const selectedDispatch = dispatches?.find((d: any) => d.id === dispatchId);
  const dispatchCustomers = selectedDispatch?.customers as { id: string; name: string }[] | undefined;
  const customerId = dispatchCustomers?.length === 1 ? dispatchCustomers[0].id : undefined;
  const customerName = dispatchCustomers?.[0]?.name;
  const multiCustomer = (dispatchCustomers?.length || 0) > 1;

  const subtotal = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const cogsTotal = lines.reduce((s, l) => s + l.qty * l.standard_cost, 0);
  const hasAnyQty = lines.some((l) => l.qty > 0);
  const overQty = lines.some((l) => l.qty > l.original_qty);

  // View dialog data
  const { data: viewReturn } = useQuery({
    queryKey: ["sales-return-view", viewId],
    queryFn: async () => {
      const { data, error } = await sb
        .from("sales_returns")
        .select("*, customer:customers(name, code), dispatch:sales_dispatches(dispatch_number, dispatch_date)")
        .eq("id", viewId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!viewId,
  });
  const { data: viewLines } = useQuery({
    queryKey: ["sales-return-view-lines", viewId],
    queryFn: async () => {
      const { data, error } = await sb
        .from("sales_return_items")
        .select("*, product:products(code, name)")
        .eq("return_id", viewId)
        .order("line_order");
      if (error) throw error;
      return data || [];
    },
    enabled: !!viewId,
  });

  // ---- Mutations ----
  const createMutation = useMutation({
    mutationFn: async () => {
      if (!dispatchId) throw new Error("Pick a dispatch");
      if (multiCustomer) throw new Error(`Dispatch spans ${dispatchCustomers!.length} customers — split into separate returns first.`);
      if (!customerId) throw new Error("Dispatch has no items linked to a customer");
      if (!hasAnyQty) throw new Error("Enter at least one return quantity");
      if (overQty) throw new Error("Return quantity cannot exceed original dispatch quantity");

      const linesToInsert = lines.filter((l) => l.qty > 0);

      const { data: header, error: hErr } = await sb
        .from("sales_returns")
        .insert({
          return_number: "",
          return_date: returnDate,
          dispatch_id: dispatchId,
          customer_id: customerId,
          reason,
          subtotal,
          total_amount: subtotal,
          cogs_amount: cogsTotal,
          notes: notes || null,
          status: "draft",
          created_by: user?.id || null,
        })
        .select("id, return_number")
        .single();
      if (hErr) throw hErr;

      const items = linesToInsert.map((l, i) => ({
        return_id: header.id,
        dispatch_item_id: l.dispatch_item_id,
        product_id: l.product_id || null,
        quantity_dozens: l.qty,
        unit_price: l.unit_price,
        amount: l.qty * l.unit_price,
        standard_cost: l.standard_cost,
        reason: l.reason || null,
        line_order: i,
      }));
      const { error: iErr } = await sb.from("sales_return_items").insert(items);
      if (iErr) throw iErr;

      const post = await processSalesReturn(header.id);
      if (!post.ok) throw new Error(`Saved as draft but auto-post failed: ${post.error}`);

      return { number: header.return_number, voucherNumber: post.voucherNumber, skipped: post.skipped };
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["sales-returns-list"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["ar-aging"] });
      toast({
        title: `Sales return ${r.number} created`,
        description: r.skipped ? `Accounting skipped (${r.skipped})` : `Voucher: ${r.voucherNumber || "posted"}`,
      });
      setCreateOpen(false);
      setDispatchId("");
      setReason("Damaged");
      setNotes("");
      setLines([]);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("sales_returns").update({ status: "cancelled" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-returns-list"] });
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
      <PageHeader title="Sales Returns / Credit Notes" description="Returns from customers — reverses AR + COGS + restores FG inventory.">
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
              <TableHead>Customer</TableHead>
              <TableHead>Dispatch #</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!returns?.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No returns yet.</TableCell></TableRow>}
            {returns?.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.return_number}</TableCell>
                <TableCell className="text-xs">{format(new Date(r.return_date), "dd MMM yyyy")}</TableCell>
                <TableCell className="text-xs">{r.customer?.name}</TableCell>
                <TableCell className="font-mono text-xs">{r.dispatch?.dispatch_number || "—"}</TableCell>
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
          <DialogHeader><DialogTitle>New Sales Return</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Original Dispatch *</Label>
              <Select value={dispatchId} onValueChange={setDispatchId}>
                <SelectTrigger><SelectValue placeholder="Pick a dispatch to return from" /></SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {dispatches?.map((d: any) => {
                    const cust = d.customers?.[0]?.name;
                    const more = (d.customers?.length || 0) > 1 ? ` +${d.customers.length - 1} more` : "";
                    return (
                      <SelectItem key={d.id} value={d.id}>
                        <span className="font-mono text-xs mr-2">{d.dispatch_number}</span>
                        {format(new Date(d.dispatch_date), "dd MMM")} · {cust || "(no customer)"}{more}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {selectedDispatch && (
                <div className="text-xs mt-1">
                  <span className="text-muted-foreground">Customer:</span> {customerName || "—"}
                  {multiCustomer && <span className="text-red-600 ml-2">⚠ Dispatch spans {dispatchCustomers!.length} customers — split into separate returns, one per customer.</span>}
                  <span className="text-muted-foreground"> · {lines.length} line item(s)</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Return Date *</Label>
                <Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
              </div>
              <div>
                <Label>Reason</Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{RETURN_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="col-span-1">
                <Label>Notes</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" />
              </div>
            </div>

            {lines.length > 0 && (
              <div className="border rounded">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Orig Qty (Dz)</TableHead>
                      <TableHead className="text-right">Return Qty</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Line Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l, i) => (
                      <TableRow key={l.dispatch_item_id}>
                        <TableCell className="text-xs">{l.product_label}</TableCell>
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
                      <TableCell colSpan={4} className="text-right">Subtotal</TableCell>
                      <TableCell className="text-right">Rs. {subtotal.toLocaleString()}</TableCell>
                      <TableCell />
                    </TableRow>
                    <TableRow className="bg-muted/40">
                      <TableCell colSpan={4} className="text-right text-xs text-muted-foreground">COGS reversal (auto-computed)</TableCell>
                      <TableCell className="text-right text-xs">Rs. {cogsTotal.toLocaleString()}</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}

            {overQty && (
              <div className="text-xs text-red-600 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Return quantity exceeds original dispatch quantity on at least one line.
              </div>
            )}
            {cogsTotal === 0 && hasAnyQty && (
              <div className="text-xs text-amber-600 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Products lack standard_cost — COGS won't be reversed. Set it on Master Data → Products.
              </div>
            )}
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <CheckCircle className="h-3 w-3" /> On save: Dr Sales Returns / Cr AR ({subtotal.toLocaleString()}); Dr FG / Cr COGS ({cogsTotal.toLocaleString()}).
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
                <div><div className="text-xs text-muted-foreground">Customer</div><div>{viewReturn.customer?.name || "—"}</div></div>
                <div><div className="text-xs text-muted-foreground">Return Date</div><div>{format(new Date(viewReturn.return_date), "dd MMM yyyy")}</div></div>
                <div><div className="text-xs text-muted-foreground">Original Dispatch</div><div>{viewReturn.dispatch?.dispatch_number || "—"}</div></div>
                <div><div className="text-xs text-muted-foreground">Reason</div><div>{viewReturn.reason || "—"}</div></div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty (Dz)</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {viewLines?.map((l: any) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs">{l.product?.code} — {l.product?.name}</TableCell>
                      <TableCell className="text-right text-xs">{Number(l.quantity_dozens).toLocaleString()}</TableCell>
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
