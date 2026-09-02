import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { InvoiceViewDialog } from "@/components/sales/InvoiceViewDialog";
import { InvoiceEditDialog } from "@/components/sales/InvoiceEditDialog";
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
import { toast } from "@/hooks/use-toast";
import { Plus, Printer, FileText, Eye, Pencil } from "lucide-react";
import { format, addDays, startOfMonth, parseISO } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { createInvoiceForDispatch } from "@/lib/sales/createInvoiceForDispatch";

const sb = supabase as any;

const STATUS_COLOR: Record<string, string> = {
  draft:    "bg-gray-100 text-gray-800 border-gray-200",
  sent:     "bg-blue-100 text-blue-800 border-blue-200",
  paid:     "bg-green-100 text-green-800 border-green-200",
  overdue:  "bg-red-100 text-red-800 border-red-200",
  cancelled:"bg-rose-100 text-rose-800 border-rose-200",
};

const PAYMENT_TERMS_OPTIONS = ["Net 7", "Net 15", "Net 30", "Net 45", "Net 60", "Advance", "Cash on Delivery"];

export default function DomesticInvoicesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [fromDate, setFromDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(addDays(new Date(), 30), "yyyy-MM-dd"));
  const [createOpen, setCreateOpen] = useState(false);
  const [viewInvoiceId, setViewInvoiceId] = useState<string | null>(null);
  const [printInvoiceId, setPrintInvoiceId] = useState<string | null>(null);
  const [editInvoiceId, setEditInvoiceId] = useState<string | null>(null);

  // Deep-link: open ?invoice=<id> in the view dialog (used from Party Ledger etc.)
  // Deep-link: open ?createFromDispatch=<id> to pre-fill the create dialog (used from Dispatch list)
  useEffect(() => {
    const viewId = searchParams.get("invoice");
    const fromDispatchId = searchParams.get("createFromDispatch");
    if (viewId) setViewInvoiceId(viewId);
    if (fromDispatchId) {
      setSelectedDispatchId(fromDispatchId);
      setCreateOpen(true);
    }
    if (viewId || fromDispatchId) {
      const next = new URLSearchParams(searchParams);
      next.delete("invoice");
      next.delete("createFromDispatch");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Form state
  const [selectedDispatchId, setSelectedDispatchId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [paymentTerms, setPaymentTerms] = useState("Net 30");
  const [notes, setNotes] = useState("");

  // === Queries ===
  const { data: invoices } = useQuery({
    queryKey: ["domestic-invoices", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await sb
        .from("domestic_invoices")
        .select("*, customer:customers(name, code), dispatch:sales_dispatches(dispatch_number, dispatch_date)")
        .gte("invoice_date", fromDate)
        .lte("invoice_date", toDate)
        .order("invoice_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Resolve unique customers attached to a dispatch via its items chain.
  // Domestic dispatches typically have dispatch.order_id = NULL and link
  // multiple orders via the sales_dispatch_orders join table, so we cannot
  // reach the customer through the legacy dispatch.order path. The customer
  // is derivable from each line: dispatch_item → order_item → order → customer.
  const customersFromItems = (items: any[]): { id: string; name: string; code: string | null }[] => {
    const map = new Map<string, { id: string; name: string; code: string | null }>();
    for (const it of items || []) {
      const c = it.order_item?.order?.customer;
      if (c?.id && !map.has(c.id)) map.set(c.id, { id: c.id, name: c.name, code: c.code || null });
    }
    return Array.from(map.values());
  };

  // Dispatches with at least one customer not yet invoiced. A dispatch can span
  // several customers (one invoice per customer), so exclusion is per
  // (dispatch, customer) pair — a partially invoiced dispatch stays listed
  // until every customer on it has an invoice.
  const { data: invoiceableDispatches } = useQuery({
    queryKey: ["invoiceable-dispatches"],
    queryFn: async () => {
      const { data: existing } = await sb.from("domestic_invoices").select("dispatch_id, customer_id");
      const existingRows: { dispatch_id: string; customer_id: string | null }[] = existing || [];
      const usedPairs = new Set(existingRows.map((r) => `${r.dispatch_id}|${r.customer_id || ""}`));
      const usedIds = new Set(existingRows.map((r) => r.dispatch_id));

      const { data, error } = await sb
        .from("sales_dispatches")
        .select(`
          id, dispatch_number, dispatch_date,
          items:sales_dispatch_items(
            order_item:sales_order_items(
              order:sales_orders(customer:customers(id, name, code))
            )
          )
        `)
        .eq("sales_segment", "domestic")
        .order("dispatch_date", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || [])
        .map((d: any) => {
          const customers = customersFromItems(d.items || []);
          const pendingCustomers = customers.filter((c) => !usedPairs.has(`${d.id}|${c.id}`));
          return { ...d, customers, pendingCustomers };
        })
        .filter((d: any) =>
          d.customers.length > 0 ? d.pendingCustomers.length > 0 : !usedIds.has(d.id)
        );
    },
    enabled: createOpen,
  });

  // Detail: dispatch items + amount, for the selected dispatch (used on create only;
  // view/print read from the invoice's own items table once the invoice exists).
  const fetchDispatchDetail = async (dispatchId: string) => {
    const { data, error } = await sb
      .from("sales_dispatch_items")
      .select(`
        id, quantity_dozens, packing_type,
        order_item:sales_order_items(price_per_dozen, details, product:products(id, code, name), grade:grades(name), order:sales_orders(customer_id))
      `)
      .eq("dispatch_id", dispatchId);
    if (error) throw error;
    return data || [];
  };

  const { data: createDispatchItems } = useQuery({
    queryKey: ["dispatch-items-for-create", selectedDispatchId],
    queryFn: () => fetchDispatchDetail(selectedDispatchId),
    enabled: !!selectedDispatchId,
  });

  const computeTotal = (items: any[]): number => {
    return (items || []).reduce((s: number, it: any) => {
      return s + Number(it.quantity_dozens || 0) * Number(it.order_item?.price_per_dozen || 0);
    }, 0);
  };

  // Only the lines of customers that still need an invoice count towards the
  // preview — already-invoiced customers on the same dispatch are excluded.
  const selectedDispatch = invoiceableDispatches?.find((d: any) => d.id === selectedDispatchId);
  const itemsForCreate = (createDispatchItems || []).filter((it: any) => {
    if (!selectedDispatch?.pendingCustomers?.length) return true;
    const cid = it.order_item?.order?.customer_id;
    return selectedDispatch.pendingCustomers.some((c: { id: string }) => c.id === cid);
  });
  const totalForCreate = computeTotal(itemsForCreate);
  const pendingInvoiceCount = selectedDispatch?.pendingCustomers?.length || 0;

  // Default due date = invoice date + payment-terms days
  const dueDate = (() => {
    const m = paymentTerms.match(/Net (\d+)/);
    if (!m) return invoiceDate;
    return format(addDays(parseISO(invoiceDate), parseInt(m[1])), "yyyy-MM-dd");
  })();

  // === Create ===
  // Delegates to the same grouped helper the dispatch flow uses: one invoice per
  // customer on the dispatch, idempotent per (dispatch, customer). This is the
  // recovery path when the auto-create at dispatch time failed or was skipped
  // (e.g. prices were still Rs. 0), and it handles multi-customer dispatches
  // instead of refusing them.
  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedDispatchId) throw new Error("Pick a dispatch");

      const res = await createInvoiceForDispatch(selectedDispatchId, {
        createdBy: user?.id || null,
        paymentTerms,
        invoiceDate,
        notes: notes || null,
      });
      if (!res.ok) throw new Error(res.error || "Invoice creation failed");
      if (res.created.length === 0) {
        if (res.skippedZeroPrice > 0) {
          throw new Error("Cannot create a Rs. 0 invoice — set selling prices on the dispatched order lines first.");
        }
        if (res.skippedExisting > 0) {
          throw new Error("Every customer on this dispatch already has an invoice.");
        }
        throw new Error("Dispatch has no items linked to a customer. Add line items in the dispatch first.");
      }
      return res;
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["domestic-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoiceable-dispatches"] });
      toast({ title: res.created.length > 1 ? `Invoices created: ${res.created.join(", ")}` : `Invoice ${res.created[0]} created` });
      if (res.skippedZeroPrice > 0) {
        toast({ title: `${res.skippedZeroPrice} invoice(s) skipped — items have no selling price (Rs. 0). Fix prices on the sales order.`, variant: "destructive" });
      }
      setCreateOpen(false);
      setSelectedDispatchId("");
      setNotes("");
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // === Status change ===
  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await sb.from("domestic_invoices").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["domestic-invoices"] });
      toast({ title: "Status updated" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // === Print ===
  // Same fallback as view: support invoices not in the current date-filtered list (deep links).
  const printInListInvoice = invoices?.find((i: any) => i.id === printInvoiceId);
  const { data: printDeepLinkInvoice } = useQuery({
    queryKey: ["domestic-invoice-direct-print", printInvoiceId],
    queryFn: async () => {
      const { data, error } = await sb
        .from("domestic_invoices")
        .select("*, customer:customers(name, code), dispatch:sales_dispatches(dispatch_number, dispatch_date)")
        .eq("id", printInvoiceId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!printInvoiceId && !printInListInvoice,
  });
  const printInvoice = printInListInvoice || printDeepLinkInvoice;
  // Read the invoice's own line items (snapshotted at create time and editable thereafter).
  const { data: printItems } = useQuery({
    queryKey: ["invoice-items-for-print", printInvoiceId],
    queryFn: async () => {
      const { data, error } = await sb
        .from("domestic_invoice_items")
        .select("*")
        .eq("invoice_id", printInvoiceId)
        .order("line_order");
      if (error) throw error;
      return data || [];
    },
    enabled: !!printInvoiceId,
  });

  useEffect(() => {
    if (!printInvoiceId || !printItems) return;
    const t = setTimeout(() => {
      window.print();
      setPrintInvoiceId(null);
    }, 250);
    return () => clearTimeout(t);
  }, [printInvoiceId, printItems]);

  const totals = {
    count: invoices?.length || 0,
    total: (invoices || []).reduce((s: number, i: any) => s + Number(i.total_amount || 0), 0),
    draft: (invoices || []).filter((i: any) => i.status === "draft").length,
    sent: (invoices || []).filter((i: any) => i.status === "sent").length,
    paid: (invoices || []).filter((i: any) => i.status === "paid").length,
  };

  return (
    <ERPLayout>
      {/* === PRINT VIEW (only visible when printing) === */}
      {printInvoice && printItems && (
        <div className="hidden print:block print:fixed print:inset-0 print:bg-white print:p-8 print:z-50 print:text-foreground">
          <div className="max-w-3xl mx-auto">
            <div className="flex justify-between items-start mb-6 pb-4 border-b-2 border-gray-800">
              <div>
                <h1 className="text-2xl font-bold">INVOICE</h1>
              </div>
              <div className="text-right text-sm">
                <div className="font-bold">{printInvoice.invoice_number}</div>
                <div>Date: {format(parseISO(printInvoice.invoice_date), "dd MMM yyyy")}</div>
                {printInvoice.due_date && <div>Due: {format(parseISO(printInvoice.due_date), "dd MMM yyyy")}</div>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6 mb-6 text-sm">
              <div>
                <div className="font-bold text-xs text-gray-500 mb-1">BILL TO</div>
                <div className="font-bold">{printInvoice.customer?.name}</div>
                <div className="text-xs">{printInvoice.customer?.code}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Dispatch ref: {printInvoice.dispatch?.dispatch_number}</div>
              </div>
            </div>

            <table className="w-full text-sm mb-6 border-collapse">
              <thead>
                <tr className="border-b-2 border-gray-800">
                  <th className="text-left py-2">#</th>
                  <th className="text-left py-2">Product</th>
                  <th className="text-left py-2">Grade / Packing</th>
                  <th className="text-right py-2">Qty (Dz)</th>
                  <th className="text-right py-2">Rate / Dz</th>
                  <th className="text-right py-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {printItems?.map((it: any, i: number) => (
                  <tr key={it.id} className="border-b border-gray-200">
                    <td className="py-2">{i + 1}</td>
                    <td className="py-2">{it.description || "—"}</td>
                    <td className="py-2 text-xs">{it.grade_name || ""}{it.packing_type ? ` / ${it.packing_type}` : ""}</td>
                    <td className="text-right py-2">{Number(it.quantity_dozens).toLocaleString()}</td>
                    <td className="text-right py-2">Rs. {Number(it.price_per_dozen).toLocaleString()}</td>
                    <td className="text-right py-2 font-medium">Rs. {Number(it.amount).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-800 font-bold">
                  <td colSpan={5} className="text-right py-3">TOTAL</td>
                  <td className="text-right py-3">Rs. {Number(printInvoice.total_amount).toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>

            {printInvoice.notes && (
              <div className="mb-6 text-sm">
                <div className="font-bold text-xs text-gray-500 mb-1">NOTES</div>
                <div>{printInvoice.notes}</div>
              </div>
            )}

            <div className="text-xs text-gray-500 border-t pt-4 mt-8">
              <div className="mt-4 grid grid-cols-2 gap-8">
                <div className="border-t pt-1">Authorized Signature</div>
                <div className="border-t pt-1">Customer Acknowledgement</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* === MAIN UI (hidden when printing) === */}
      <div className="print:hidden">
      <PageHeader title="Invoices" description="Customer-facing tax invoices linked to dispatches. Accounting (AR/Sales) already posted from dispatch.">
        <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-1" />New Invoice</Button>
      </PageHeader>

      <div className="grid grid-cols-5 gap-3 mb-4">
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Total Invoices</div><div className="text-lg font-semibold">{totals.count}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Total Value</div><div className="text-lg font-semibold">Rs. {totals.total.toLocaleString()}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Draft</div><div className="text-lg font-semibold text-gray-600">{totals.draft}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Sent</div><div className="text-lg font-semibold text-blue-600">{totals.sent}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Paid</div><div className="text-lg font-semibold text-green-600">{totals.paid}</div></CardContent></Card>
      </div>

      <div className="flex gap-2 mb-4">
        <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-[160px]" />
        <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-[160px]" />
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Dispatch #</TableHead>
              <TableHead>Terms</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!invoices?.length && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">No invoices yet. Click "New Invoice" to create from a dispatch.</TableCell></TableRow>}
            {invoices?.map((inv: any) => (
              <TableRow key={inv.id}>
                <TableCell className="font-mono text-xs">{inv.invoice_number}</TableCell>
                <TableCell className="text-xs">{format(parseISO(inv.invoice_date), "dd MMM yyyy")}</TableCell>
                <TableCell className="text-xs">{inv.due_date ? format(parseISO(inv.due_date), "dd MMM yyyy") : "—"}</TableCell>
                <TableCell className="text-xs">{inv.customer?.name}</TableCell>
                <TableCell className="font-mono text-xs">{inv.dispatch?.dispatch_number}</TableCell>
                <TableCell className="text-xs">{inv.payment_terms || "—"}</TableCell>
                <TableCell className="text-right text-xs font-medium">Rs. {Number(inv.total_amount).toLocaleString()}</TableCell>
                <TableCell>
                  <Select value={inv.status} onValueChange={(s) => statusMutation.mutate({ id: inv.id, status: s })}>
                    <SelectTrigger className="h-7 text-xs w-[100px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="sent">Sent</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="overdue">Overdue</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setViewInvoiceId(inv.id)} title="View"><Eye className="h-3 w-3" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditInvoiceId(inv.id)} title="Edit"><Pencil className="h-3 w-3" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setPrintInvoiceId(inv.id)} title="Print"><Printer className="h-3 w-3" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Invoice</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Dispatch *</Label>
              <Select value={selectedDispatchId} onValueChange={setSelectedDispatchId}>
                <SelectTrigger><SelectValue placeholder={invoiceableDispatches?.length ? "Pick a dispatch without an invoice" : "All dispatches have invoices"} /></SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {invoiceableDispatches?.map((d: any) => {
                    const pending = d.pendingCustomers?.length ? d.pendingCustomers : d.customers;
                    const cust = pending?.[0]?.name;
                    const more = (pending?.length || 0) > 1 ? ` +${pending.length - 1} more` : "";
                    return (
                      <SelectItem key={d.id} value={d.id}>
                        <span className="font-mono text-xs mr-2">{d.dispatch_number}</span>
                        {format(parseISO(d.dispatch_date), "dd MMM")} · {cust || "(no customer)"}{more}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {selectedDispatchId && (
                <div className="text-xs text-muted-foreground mt-1">
                  Total: Rs. {totalForCreate.toLocaleString()} · {itemsForCreate?.length || 0} line item(s)
                  {pendingInvoiceCount > 1 && (
                    <span> · dispatch spans {pendingInvoiceCount} customers — {pendingInvoiceCount} invoices will be created (one per customer)</span>
                  )}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Invoice Date *</Label>
                <Input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
              </div>
              <div>
                <Label>Payment Terms</Label>
                <Select value={paymentTerms} onValueChange={setPaymentTerms}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_TERMS_OPTIONS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Due date will auto-calculate to <strong>{dueDate}</strong> based on payment terms.
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Goods received in good condition by..." />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button size="sm" disabled={!selectedDispatchId || createMutation.isPending} onClick={() => createMutation.mutate()}>
                <FileText className="h-3 w-3 mr-1" />{createMutation.isPending ? "Creating..." : "Create Invoice"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <InvoiceViewDialog
        invoiceId={viewInvoiceId}
        onOpenChange={(o) => !o && setViewInvoiceId(null)}
        onPrint={(id) => { setViewInvoiceId(null); setPrintInvoiceId(id); }}
      />

      <InvoiceEditDialog
        invoiceId={editInvoiceId}
        onOpenChange={(o) => !o && setEditInvoiceId(null)}
      />
      </div>
    </ERPLayout>
  );
}
