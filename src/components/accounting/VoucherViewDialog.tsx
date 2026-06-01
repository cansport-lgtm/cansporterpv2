import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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

  return (
    <Dialog open={!!voucherId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {voucher?.voucher_number || "Voucher"} {typeBadge(voucher?.voucher_type)}
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
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
