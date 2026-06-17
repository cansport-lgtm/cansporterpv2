import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer, MessageCircle } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buildInvoicePdf } from "@/lib/invoicePdf";
import { shareOrDownloadPdf } from "@/lib/sharePdf";

const sb = supabase as any;

const STATUS_COLOR: Record<string, string> = {
  draft:    "bg-gray-100 text-gray-800 border-gray-200",
  sent:     "bg-blue-100 text-blue-800 border-blue-200",
  issued:   "bg-blue-100 text-blue-800 border-blue-200",
  paid:     "bg-green-100 text-green-800 border-green-200",
  overdue:  "bg-red-100 text-red-800 border-red-200",
  cancelled:"bg-rose-100 text-rose-800 border-rose-200",
};

interface InvoiceViewDialogProps {
  invoiceId: string | null;
  onOpenChange: (open: boolean) => void;
  /** If provided, a Print button is shown. Caller is responsible for actually printing. */
  onPrint?: (invoiceId: string) => void;
}

export function InvoiceViewDialog({ invoiceId, onOpenChange, onPrint }: InvoiceViewDialogProps) {
  const { data: invoice } = useQuery({
    queryKey: ["invoice-view-dialog", invoiceId],
    queryFn: async () => {
      if (!invoiceId) return null;
      const { data, error } = await sb
        .from("domestic_invoices")
        .select("*, customer:customers(name, code), dispatch:sales_dispatches(dispatch_number, dispatch_date)")
        .eq("id", invoiceId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!invoiceId,
  });

  const { data: items } = useQuery({
    queryKey: ["invoice-view-dialog-items", invoiceId],
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

  const [sharing, setSharing] = useState(false);

  // Share the invoice as a PDF to WhatsApp (native share sheet on mobile,
  // download fallback elsewhere).
  const handleShareWhatsApp = async () => {
    if (!invoice) return;
    try {
      setSharing(true);
      type InvItem = {
        description?: string; details?: string; grade_name?: string; packing_type?: string;
        quantity_dozens?: number; price_per_dozen?: number; amount?: number;
      };
      const invItems: InvItem[] = items || [];
      const totalQty = invItems.reduce((s, it) => s + Number(it.quantity_dozens || 0), 0);
      const blob = buildInvoicePdf({
        invoiceNumber: invoice.invoice_number || "Invoice",
        invoiceDate: format(new Date(invoice.invoice_date), "dd MMM yyyy"),
        dueDate: invoice.due_date ? format(new Date(invoice.due_date), "dd MMM yyyy") : undefined,
        paymentTerms: invoice.payment_terms || undefined,
        status: invoice.status || undefined,
        customerName: invoice.customer?.name || "-",
        customerCode: invoice.customer?.code || undefined,
        dispatchNumber: invoice.dispatch?.dispatch_number || undefined,
        items: invItems.map((it) => ({
          description: it.description || "-",
          details: it.details || undefined,
          grade: `${it.grade_name || ""}${it.packing_type ? ` / ${it.packing_type}` : ""}`.trim(),
          qty: Number(it.quantity_dozens).toLocaleString(),
          rate: Number(it.price_per_dozen).toLocaleString(),
          amount: Number(it.amount).toLocaleString(),
        })),
        totalQty: `${totalQty.toLocaleString()} Dz`,
        totalAmount: `Rs. ${Number(invoice.total_amount).toLocaleString()}`,
        notes: invoice.notes || undefined,
        generatedOn: format(new Date(), "dd MMM yyyy, hh:mm a"),
      });
      const fileName = `Invoice-${invoice.invoice_number || invoice.id}-${invoice.customer?.name || ""}`
        .replace(/[^\w-]+/g, "_") + ".pdf";
      const summary =
        `Invoice ${invoice.invoice_number || ""}\n` +
        `${invoice.customer?.name || ""}\n` +
        `Date: ${format(new Date(invoice.invoice_date), "dd MMM yyyy")}\n` +
        `Total: Rs. ${Number(invoice.total_amount).toLocaleString()}`;
      const result = await shareOrDownloadPdf({
        blob,
        fileName,
        title: `Invoice ${invoice.invoice_number || ""}`.trim(),
        text: summary,
      });
      if (result === "downloaded") {
        toast.message("Invoice PDF downloaded", {
          description: "Attach the downloaded PDF to your WhatsApp chat.",
        });
      }
    } catch (e) {
      toast.error((e as { message?: string })?.message || "Failed to share invoice");
    } finally {
      setSharing(false);
    }
  };

  return (
    <Dialog open={!!invoiceId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{invoice?.invoice_number || "Invoice"}</DialogTitle></DialogHeader>
        {invoice && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><span className="text-muted-foreground">Customer:</span> <strong>{invoice.customer?.name}</strong></div>
              <div><span className="text-muted-foreground">Dispatch:</span> <strong className="font-mono">{invoice.dispatch?.dispatch_number}</strong></div>
              <div><span className="text-muted-foreground">Date:</span> <strong>{format(new Date(invoice.invoice_date), "dd MMM yyyy")}</strong></div>
              {invoice.due_date && (
                <div><span className="text-muted-foreground">Due:</span> <strong>{format(new Date(invoice.due_date), "dd MMM yyyy")}</strong></div>
              )}
              <div>
                <span className="text-muted-foreground">Status:</span>{" "}
                <Badge variant="outline" className={STATUS_COLOR[invoice.status] || ""}>{invoice.status}</Badge>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead className="text-right">Qty (Dz)</TableHead>
                  <TableHead className="text-right">Rate/Dz</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items?.map((it: any) => (
                  <TableRow key={it.id}>
                    <TableCell className="text-xs">
                      {it.description || "—"}
                      {it.details ? <div className="text-muted-foreground">{it.details}</div> : null}
                    </TableCell>
                    <TableCell className="text-xs">{it.grade_name || "—"}</TableCell>
                    <TableCell className="text-right text-xs">{Number(it.quantity_dozens).toLocaleString()}</TableCell>
                    <TableCell className="text-right text-xs">Rs. {Number(it.price_per_dozen).toLocaleString()}</TableCell>
                    <TableCell className="text-right text-xs font-medium">Rs. {Number(it.amount).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex justify-between items-center text-sm border-t pt-3">
              <span className="text-muted-foreground">Total Qty</span>
              <span>{(items || []).reduce((s: number, it: any) => s + Number(it.quantity_dozens || 0), 0).toLocaleString()} Dz</span>
            </div>
            <div className="flex justify-between items-center font-bold">
              <span>Total</span>
              <span>Rs. {Number(invoice.total_amount).toLocaleString()}</span>
            </div>
            {invoice.notes && <div><span className="text-muted-foreground">Notes:</span> {invoice.notes}</div>}
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button
                size="sm"
                variant="outline"
                onClick={handleShareWhatsApp}
                disabled={sharing}
                className="text-green-600 hover:text-green-700 hover:bg-green-50 border-green-200"
                title="Share invoice PDF on WhatsApp"
              >
                <MessageCircle className="h-3 w-3 mr-1" />{sharing ? "Preparing…" : "WhatsApp"}
              </Button>
              {onPrint && (
                <Button size="sm" variant="outline" onClick={() => onPrint(invoice.id)}>
                  <Printer className="h-3 w-3 mr-1" />Print
                </Button>
              )}
              <Button size="sm" onClick={() => onOpenChange(false)}>Close</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
