import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Package, Printer, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { printVoucher, shareVoucherWhatsApp } from "@/lib/accounting/voucherShare";

const sb = supabase as any;

const VOUCHER_TYPE_COLORS: Record<string, string> = {
  CRV: "bg-green-100 text-green-800",
  CPV: "bg-red-100 text-red-800",
  BRV: "bg-emerald-100 text-emerald-800",
  BPV: "bg-rose-100 text-rose-800",
  JV: "bg-purple-100 text-purple-800",
  CV: "bg-blue-100 text-blue-800",
  OB: "bg-amber-100 text-amber-800",
};

const typeBadge = (t?: string) =>
  t ? <Badge variant="outline" className={VOUCHER_TYPE_COLORS[t] || ""}>{t}</Badge> : null;

interface VoucherViewDialogProps {
  /** When non-null the dialog opens and loads this voucher. */
  voucherId: string | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Read-only voucher viewer used to open a voucher directly from any of the
 * Books / Ledger pages (Day Book, Cash Book, Bank Book, General Ledger,
 * Party Ledger). Self-fetches the voucher header and its Dr/Cr lines so the
 * caller only needs to track a selected voucher id.
 */
export function VoucherViewDialog({ voucherId, onOpenChange }: VoucherViewDialogProps) {
  const [sharing, setSharing] = useState(false);

  const handlePrint = async () => {
    if (!voucherId) return;
    try {
      await printVoucher(voucherId);
    } catch (e: any) {
      toast.error("Print failed", { description: e.message });
    }
  };

  const handleShareWhatsApp = async () => {
    if (!voucherId) return;
    try {
      setSharing(true);
      const result = await shareVoucherWhatsApp(voucherId);
      if (result === "downloaded") {
        toast.message("Voucher PDF downloaded", {
          description: "Attach the downloaded PDF to your WhatsApp chat.",
        });
      }
    } catch (e: any) {
      toast.error("Share failed", { description: e.message });
    } finally {
      setSharing(false);
    }
  };

  const { data: voucher } = useQuery({
    queryKey: ["voucher-view-dialog", voucherId],
    queryFn: async () => {
      if (!voucherId) return null;
      const { data, error } = await sb
        .from("accounting_vouchers")
        .select("*, party:accounting_parties(name), reverses_voucher:reverses_voucher_id(voucher_number)")
        .eq("id", voucherId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!voucherId,
  });

  const { data: lines } = useQuery({
    queryKey: ["voucher-view-dialog-lines", voucherId],
    queryFn: async () => {
      if (!voucherId) return [];
      const { data, error } = await sb
        .from("accounting_voucher_lines")
        .select("*, account:accounting_chart_of_accounts(code, name), party:accounting_parties(name)")
        .eq("voucher_id", voucherId)
        .order("line_order");
      if (error) throw error;
      return data || [];
    },
    enabled: !!voucherId,
  });

  // Item-level detail for vouchers that originate from a source document.
  //   - domestic_sales: source_reference_id is a dispatch id; resolve it to the
  //     invoice, then read its line items.
  //   - purchase:       source_reference_id IS the GRN id; read its received items.
  // Returns null for manual / non-itemised vouchers (JV adjustments, CRV, etc.).
  const srcModule = voucher?.source_module as string | undefined;
  const srcRefId = voucher?.source_reference_id as string | undefined;
  const itemsEnabled = !!voucherId && !!srcRefId && (srcModule === "domestic_sales" || srcModule === "purchase");

  const { data: itemDetail } = useQuery({
    queryKey: ["voucher-view-dialog-items", voucherId, srcModule, srcRefId],
    queryFn: async () => {
      if (!srcRefId) return null;
      if (srcModule === "domestic_sales") {
        const { data: inv, error: invErr } = await sb
          .from("domestic_invoices")
          .select("id, invoice_number")
          .eq("dispatch_id", srcRefId)
          .maybeSingle();
        if (invErr) throw invErr;
        if (!inv?.id) return null;
        const { data: items, error: itErr } = await sb
          .from("domestic_invoice_items")
          .select("*")
          .eq("invoice_id", inv.id)
          .order("line_order");
        if (itErr) throw itErr;
        return { kind: "invoice" as const, docNumber: inv.invoice_number as string | null, items: items || [] };
      }
      if (srcModule === "purchase") {
        const { data: items, error: itErr } = await sb
          .from("grn_items")
          .select("*, items(code, name)")
          .eq("grn_id", srcRefId);
        if (itErr) throw itErr;
        return { kind: "grn" as const, docNumber: null, items: items || [] };
      }
      return null;
    },
    enabled: itemsEnabled,
  });

  return (
    <Dialog open={!!voucherId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
            {voucher?.voucher_number || "Voucher"} {typeBadge(voucher?.voucher_type)}
            <span className="ml-auto flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                onClick={handlePrint}
                disabled={!voucher}
                title="Print voucher"
              >
                <Printer className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">Print</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-green-600 hover:text-green-700 hover:bg-green-50 border-green-200"
                onClick={handleShareWhatsApp}
                disabled={!voucher || sharing}
                title="Share voucher on WhatsApp"
              >
                <MessageCircle className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">{sharing ? "Preparing…" : "WhatsApp"}</span>
              </Button>
            </span>
          </DialogTitle>
        </DialogHeader>
        {voucher && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><span className="text-muted-foreground">Date:</span> <strong>{format(parseISO(voucher.voucher_date), "dd MMM yyyy")}</strong></div>
              <div><span className="text-muted-foreground">Party:</span> <strong>{voucher.party?.name || "—"}</strong></div>
              <div><span className="text-muted-foreground">Amount:</span> <strong>Rs. {Number(voucher.total_amount).toLocaleString()}</strong></div>
            </div>
            {voucher.narration && (
              <div className="text-sm"><span className="text-muted-foreground">Narration:</span> {voucher.narration}</div>
            )}
            {voucher.status === "reversed" && (
              <Badge variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200">Reversed</Badge>
            )}
            {voucher.reverses_voucher_id && (
              <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                Reversal of {voucher.reverses_voucher?.voucher_number || "..."}
              </Badge>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines?.map((l: any) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs"><span className="font-mono">{l.account?.code}</span> {l.account?.name}</TableCell>
                    <TableCell className="text-xs">{l.party?.name || "—"}</TableCell>
                    <TableCell className="text-right text-xs">{Number(l.debit_amount) > 0 ? `Rs. ${Number(l.debit_amount).toLocaleString()}` : "—"}</TableCell>
                    <TableCell className="text-right text-xs">{Number(l.credit_amount) > 0 ? `Rs. ${Number(l.credit_amount).toLocaleString()}` : "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.line_narration || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Source-document item details (sales invoice / purchase GRN) */}
            {itemDetail && itemDetail.items.length > 0 && (
              <div className="space-y-2 border-t pt-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  Item Details
                  <span className="text-xs font-normal text-muted-foreground">
                    {itemDetail.kind === "invoice"
                      ? `Invoice ${itemDetail.docNumber || ""}`.trim()
                      : "Goods Receipt"}
                  </span>
                </div>
                {itemDetail.kind === "invoice" ? (
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
                      {itemDetail.items.map((it: any) => (
                        <TableRow key={it.id}>
                          <TableCell className="text-xs">{it.description || "—"}</TableCell>
                          <TableCell className="text-xs">{it.grade_name || "—"}</TableCell>
                          <TableCell className="text-right text-xs">{Number(it.quantity_dozens).toLocaleString()}</TableCell>
                          <TableCell className="text-right text-xs">Rs. {Number(it.price_per_dozen).toLocaleString()}</TableCell>
                          <TableCell className="text-right text-xs font-medium">Rs. {Number(it.amount).toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Received</TableHead>
                        <TableHead className="text-right">Unit Price</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {itemDetail.items.map((it: any) => (
                        <TableRow key={it.id}>
                          <TableCell className="text-xs font-mono">{it.items?.code || "—"}</TableCell>
                          <TableCell className="text-xs">{it.description || it.items?.name || "—"}</TableCell>
                          <TableCell className="text-right text-xs">{Number(it.quantity_received || 0).toLocaleString()}</TableCell>
                          <TableCell className="text-right text-xs">Rs. {Number(it.unit_price || 0).toLocaleString()}</TableCell>
                          <TableCell className="text-right text-xs font-medium">Rs. {Number(it.amount || 0).toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
