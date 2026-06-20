import { useEffect, useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import { format, addDays } from "date-fns";
import { syncInvoiceToLedger } from "@/lib/accounting/syncInvoiceToLedger";

const sb = supabase as any;
const PAYMENT_TERMS_OPTIONS = ["Net 7", "Net 15", "Net 30", "Net 45", "Net 60", "Advance", "Cash on Delivery"];

interface InvoiceEditDialogProps {
  invoiceId: string | null;
  onOpenChange: (open: boolean) => void;
}

interface LineForm {
  id?: string;
  product_id: string | null;
  description: string;
  details: string;
  grade_name: string;
  packing_type: string;
  quantity_dozens: number;
  price_per_dozen: number;
}

export function InvoiceEditDialog({ invoiceId, onOpenChange }: InvoiceEditDialogProps) {
  const queryClient = useQueryClient();
  const [invoiceDate, setInvoiceDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("Net 30");
  const [status, setStatus] = useState("draft");
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState<number>(0);
  const [lines, setLines] = useState<LineForm[]>([]);
  const [originalTotal, setOriginalTotal] = useState<number>(0);

  const { data: invoice } = useQuery({
    queryKey: ["invoice-edit", invoiceId],
    queryFn: async () => {
      if (!invoiceId) return null;
      const { data, error } = await sb
        .from("domestic_invoices")
        .select("*, customer:customers(name, code), dispatch:sales_dispatches(dispatch_number)")
        .eq("id", invoiceId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!invoiceId,
  });

  const { data: existingItems } = useQuery({
    queryKey: ["invoice-edit-items", invoiceId],
    queryFn: async () => {
      if (!invoiceId) return [];
      const { data, error } = await sb
        .from("domestic_invoice_items")
        .select("*")
        .eq("invoice_id", invoiceId)
        .order("line_order");
      if (error) throw error;
      return data || [];
    },
    enabled: !!invoiceId,
  });

  const { data: products } = useQuery({
    queryKey: ["invoice-edit-products"],
    queryFn: async () => {
      const { data, error } = await sb.from("products").select("id, code, name").eq("is_active", true).order("name");
      if (error) throw error;
      return data || [];
    },
  });

  // Initialize state when the invoice loads
  useEffect(() => {
    if (!invoice) return;
    setInvoiceDate(invoice.invoice_date || "");
    setDueDate(invoice.due_date || "");
    setPaymentTerms(invoice.payment_terms || "Net 30");
    setStatus(invoice.status || "draft");
    setNotes(invoice.notes || "");
    setDiscount(Number(invoice.discount || 0));
    setOriginalTotal(Number(invoice.total_amount || 0));
  }, [invoice]);

  useEffect(() => {
    if (!existingItems) return;
    setLines(
      existingItems.map((it: any) => ({
        id: it.id,
        product_id: it.product_id,
        description: it.description || "",
        details: it.details || "",
        grade_name: it.grade_name || "",
        packing_type: it.packing_type || "",
        quantity_dozens: Number(it.quantity_dozens || 0),
        price_per_dozen: Number(it.price_per_dozen || 0),
      }))
    );
  }, [existingItems]);

  const subtotal = useMemo(() => lines.reduce((s, l) => s + l.quantity_dozens * l.price_per_dozen, 0), [lines]);
  const total = Math.max(0, subtotal - (discount || 0));
  const drift = total - originalTotal;

  // Auto-recompute due date when payment terms change (only when user opens — not on every render)
  const recomputeDueDate = (terms: string) => {
    const m = terms.match(/Net (\d+)/);
    if (!m || !invoiceDate) return;
    setDueDate(format(addDays(new Date(invoiceDate), parseInt(m[1])), "yyyy-MM-dd"));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!invoiceId) throw new Error("No invoice");
      if (!invoiceDate) throw new Error("Invoice date is required");
      if (lines.length === 0) throw new Error("Invoice must have at least one line");
      if (lines.some((l) => !(l.quantity_dozens > 0) || !(l.price_per_dozen > 0))) {
        throw new Error("Each line needs a positive quantity and a price greater than zero (Rs. 0 not allowed).");
      }

      // Update header
      const { error: hErr } = await sb
        .from("domestic_invoices")
        .update({
          invoice_date: invoiceDate,
          due_date: dueDate || null,
          payment_terms: paymentTerms,
          status,
          notes: notes || null,
          discount,
          subtotal,
          total_amount: total,
        })
        .eq("id", invoiceId);
      if (hErr) throw hErr;

      // Replace line items wholesale (simpler than diffing inserts/updates/deletes)
      const { error: dErr } = await sb.from("domestic_invoice_items").delete().eq("invoice_id", invoiceId);
      if (dErr) throw dErr;
      const itemsPayload = lines.map((l, i) => ({
        invoice_id: invoiceId,
        product_id: l.product_id || null,
        description: l.description || null,
        details: l.details || null,
        grade_name: l.grade_name || null,
        packing_type: l.packing_type || null,
        quantity_dozens: l.quantity_dozens,
        price_per_dozen: l.price_per_dozen,
        amount: l.quantity_dozens * l.price_per_dozen,
        line_order: i,
      }));
      if (itemsPayload.length > 0) {
        const { error: iErr } = await sb.from("domestic_invoice_items").insert(itemsPayload);
        if (iErr) throw iErr;
      }

      // Invoice is the source of truth for the receivable — keep the dispatch's
      // AR / Sales ledger voucher in step with the (possibly edited) invoice total.
      const sync = await syncInvoiceToLedger(invoiceId);
      return sync;
    },
    onSuccess: (sync: any) => {
      queryClient.invalidateQueries({ queryKey: ["domestic-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice-view-dialog"] });
      queryClient.invalidateQueries({ queryKey: ["invoice-view-dialog-items"] });
      queryClient.invalidateQueries({ queryKey: ["invoice-items-for-print"] });
      if (sync?.updated) {
        toast({ title: "Invoice updated", description: `Ledger synced: ${sync.updated.voucherNumber} → Rs. ${Number(sync.updated.to).toLocaleString()}` });
      } else if (sync?.created) {
        toast({ title: "Invoice updated", description: `Sale posted to ledger: Rs. ${Number(sync.created.amount).toLocaleString()}` });
      } else if (sync && !sync.ok) {
        toast({ title: "Invoice saved, but ledger sync failed", description: sync.error, variant: "destructive" });
      } else {
        toast({ title: "Invoice updated" });
      }
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={!!invoiceId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Edit Invoice {invoice?.invoice_number} <span className="text-xs text-muted-foreground ml-2">{invoice?.customer?.name}</span>
          </DialogTitle>
        </DialogHeader>

        {invoice && (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-3">
              <div>
                <Label>Invoice Date *</Label>
                <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
              </div>
              <div>
                <Label>Due Date</Label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <div>
                <Label>Payment Terms</Label>
                <Select value={paymentTerms} onValueChange={(v) => { setPaymentTerms(v); recomputeDueDate(v); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PAYMENT_TERMS_OPTIONS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-semibold">Line Items</Label>
                <Button size="sm" variant="outline" onClick={() => setLines([...lines, { product_id: null, description: "", details: "", grade_name: "", packing_type: "", quantity_dozens: 0, price_per_dozen: 0 }])}>
                  <Plus className="h-3 w-3 mr-1" />Add Line
                </Button>
              </div>
              <div className="border rounded overflow-x-auto">
                <Table className="min-w-[1200px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[210px]">Product</TableHead>
                      <TableHead className="min-w-[230px]">Description</TableHead>
                      <TableHead className="min-w-[210px]">Details</TableHead>
                      <TableHead className="min-w-[130px]">Grade</TableHead>
                      <TableHead className="min-w-[150px]">Packing</TableHead>
                      <TableHead className="text-right w-28">Qty</TableHead>
                      <TableHead className="text-right w-32">Rate/Dz</TableHead>
                      <TableHead className="text-right w-32">Amount</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l, i) => (
                      <TableRow key={l.id || `new-${i}`}>
                        <TableCell>
                          <Select value={l.product_id || ""} onValueChange={(v) => {
                            const next = [...lines];
                            const p = products?.find((p: any) => p.id === v);
                            next[i] = {
                              ...next[i],
                              product_id: v,
                              description: next[i].description || (p ? `${p.code} — ${p.name}` : ""),
                            };
                            setLines(next);
                          }}>
                            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="(none)" /></SelectTrigger>
                            <SelectContent className="max-h-[260px]">
                              {products?.map((p: any) => (
                                <SelectItem key={p.id} value={p.id}><span className="font-mono text-xs mr-2">{p.code}</span>{p.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input className="h-9 text-sm" value={l.description} onChange={(e) => {
                            const next = [...lines]; next[i] = { ...next[i], description: e.target.value }; setLines(next);
                          }} />
                        </TableCell>
                        <TableCell>
                          <Input className="h-9 text-sm" value={l.details} placeholder="Prints on invoice" onChange={(e) => {
                            const next = [...lines]; next[i] = { ...next[i], details: e.target.value }; setLines(next);
                          }} />
                        </TableCell>
                        <TableCell>
                          <Input className="h-9 text-sm" value={l.grade_name} onChange={(e) => {
                            const next = [...lines]; next[i] = { ...next[i], grade_name: e.target.value }; setLines(next);
                          }} />
                        </TableCell>
                        <TableCell>
                          <Input className="h-9 text-sm" value={l.packing_type} onChange={(e) => {
                            const next = [...lines]; next[i] = { ...next[i], packing_type: e.target.value }; setLines(next);
                          }} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number" min={0} step="0.01"
                            className="h-9 text-right text-sm"
                            value={l.quantity_dozens || ""}
                            onChange={(e) => {
                              const next = [...lines]; next[i] = { ...next[i], quantity_dozens: parseFloat(e.target.value) || 0 }; setLines(next);
                            }}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number" min={0} step="0.01"
                            className="h-9 text-right text-sm"
                            value={l.price_per_dozen || ""}
                            onChange={(e) => {
                              const next = [...lines]; next[i] = { ...next[i], price_per_dozen: parseFloat(e.target.value) || 0 }; setLines(next);
                            }}
                          />
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium whitespace-nowrap">
                          Rs. {(l.quantity_dozens * l.price_per_dozen).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setLines(lines.filter((_, idx) => idx !== i))}>
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {lines.length === 0 && (
                      <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground text-sm">No line items. Click Add Line.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Notes</Label>
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="font-medium">Rs. {subtotal.toLocaleString()}</span></div>
                <div className="flex justify-between items-center gap-2">
                  <span className="text-muted-foreground">Discount</span>
                  <Input type="number" min={0} step="0.01" className="h-8 w-32 text-right text-xs" value={discount || ""} onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)} />
                </div>
                <div className="flex justify-between font-bold border-t pt-2"><span>Total</span><span>Rs. {total.toLocaleString()}</span></div>
              </div>
            </div>

            {Math.abs(drift) > 0.01 && (
              <div className="rounded border border-blue-200 bg-blue-50 dark:bg-blue-950/20 p-2 text-xs flex items-start gap-2">
                <AlertTriangle className="h-3 w-3 mt-0.5 text-blue-600 shrink-0" />
                <div>
                  This invoice total (<span className="font-mono">Rs. {total.toLocaleString()}</span>) differs from the amount posted at dispatch (<span className="font-mono">Rs. {originalTotal.toLocaleString()}</span>). <strong>Saving will update the customer's Accounts Receivable / Sales ledger to match this invoice.</strong>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button size="sm" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                {saveMutation.isPending ? "Saving..." : "Save Invoice"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
