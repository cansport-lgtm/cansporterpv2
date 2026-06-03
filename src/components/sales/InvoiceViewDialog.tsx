import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
              {invoice.payment_terms && (
                <div><span className="text-muted-foreground">Terms:</span> <strong>{invoice.payment_terms}</strong></div>
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
            <div className="flex justify-between items-center font-bold border-t pt-3">
              <span>Total</span>
              <span>Rs. {Number(invoice.total_amount).toLocaleString()}</span>
            </div>
            {invoice.notes && <div><span className="text-muted-foreground">Notes:</span> {invoice.notes}</div>}
            <div className="flex justify-end gap-2 pt-2 border-t">
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
