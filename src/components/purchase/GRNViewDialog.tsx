import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const sb = supabase as any;

interface GRNViewDialogProps {
  grnId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function GRNViewDialog({ grnId, onOpenChange }: GRNViewDialogProps) {
  const { data: grn } = useQuery({
    queryKey: ["grn-view-dialog", grnId],
    queryFn: async () => {
      if (!grnId) return null;
      const { data, error } = await sb
        .from("goods_receipt_notes")
        .select(`*, suppliers(name, code), purchase_orders(po_number, category)`)
        .eq("id", grnId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!grnId,
  });

  const { data: items } = useQuery({
    queryKey: ["grn-view-dialog-items", grnId],
    queryFn: async () => {
      if (!grnId) return [];
      const { data, error } = await sb
        .from("grn_items")
        .select(`*, items(code, name)`)
        .eq("grn_id", grnId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!grnId,
  });

  return (
    <Dialog open={!!grnId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Goods Receipt: {grn?.grn_number || "—"}</DialogTitle>
        </DialogHeader>
        {grn && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><strong>PO #:</strong> {grn.purchase_orders?.po_number || "—"}</div>
              <div><strong>Supplier:</strong> {grn.suppliers?.name || "—"}</div>
              <div><strong>Receipt Date:</strong> {grn.receipt_date ? format(new Date(grn.receipt_date), "dd/MM/yyyy") : "—"}</div>
              <div><strong>Invoice #:</strong> {grn.invoice_number || "—"}</div>
              <div><strong>Invoice Amount:</strong> {grn.invoice_amount ? `Rs. ${Number(grn.invoice_amount).toLocaleString()}` : "—"}</div>
              <div><strong>Total Received:</strong> Rs. {Number(grn.total_amount || 0).toLocaleString()}</div>
            </div>

            {items && items.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Ordered</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item: any) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.items?.code || "—"}</TableCell>
                      <TableCell>{item.description || item.items?.name}</TableCell>
                      <TableCell className="text-right">{item.quantity_ordered}</TableCell>
                      <TableCell className="text-right">{item.quantity_received}</TableCell>
                      <TableCell className="text-right">Rs. {Number(item.unit_price || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right">Rs. {Number(item.amount || 0).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {grn.notes && (
              <div>
                <strong>Notes:</strong>
                <p className="text-muted-foreground">{grn.notes}</p>
              </div>
            )}

            <div className="flex justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
