import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { reverseVoucher } from "@/lib/accounting/reverseVoucher";
import { Undo2 } from "lucide-react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Eye, Download, Search } from "lucide-react";
import { format, startOfMonth, parseISO } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import * as XLSX from "xlsx";

const sb = supabase as any;

const VOUCHER_TYPES = [
  { value: "CRV", label: "Cash Receipt", color: "bg-green-100 text-green-800" },
  { value: "CPV", label: "Cash Payment", color: "bg-red-100 text-red-800" },
  { value: "BRV", label: "Bank Receipt", color: "bg-emerald-100 text-emerald-800" },
  { value: "BPV", label: "Bank Payment", color: "bg-rose-100 text-rose-800" },
  { value: "JV", label: "Journal", color: "bg-purple-100 text-purple-800" },
  { value: "CV", label: "Contra", color: "bg-blue-100 text-blue-800" },
  { value: "OB", label: "Opening Balance", color: "bg-amber-100 text-amber-800" },
];

const typeBadge = (t: string) => {
  const m = VOUCHER_TYPES.find((v) => v.value === t);
  return <Badge variant="outline" className={m?.color}>{t}</Badge>;
};

export default function AccountingVouchersPage() {
  const queryClient = useQueryClient();
  const [fromDate, setFromDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [filterType, setFilterType] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [viewVoucherId, setViewVoucherId] = useState<string | null>(null);
  const [reverseDialogId, setReverseDialogId] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState("");

  const { data: vouchers, isLoading } = useQuery({
    queryKey: ["accounting-vouchers", fromDate, toDate, filterType],
    queryFn: async () => {
      let q = sb
        .from("accounting_vouchers")
        .select("*, party:accounting_parties(name), reverses_voucher:reverses_voucher_id(voucher_number)")
        .gte("voucher_date", fromDate)
        .lte("voucher_date", toDate)
        .order("voucher_date", { ascending: false })
        .order("voucher_number", { ascending: false });
      if (filterType !== "all") q = q.eq("voucher_type", filterType);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const { data: voucherLines } = useQuery({
    queryKey: ["accounting-voucher-detail", viewVoucherId],
    queryFn: async () => {
      if (!viewVoucherId) return null;
      const { data, error } = await sb
        .from("accounting_voucher_lines")
        .select("*, account:accounting_chart_of_accounts(code, name), party:accounting_parties(name)")
        .eq("voucher_id", viewVoucherId)
        .order("line_order");
      if (error) throw error;
      return data || [];
    },
    enabled: !!viewVoucherId,
  });

  const selectedVoucher = vouchers?.find((v: any) => v.id === viewVoucherId);
  const reverseTargetVoucher = vouchers?.find((v: any) => v.id === reverseDialogId);

  const reverseMutation = useMutation({
    mutationFn: async () => {
      if (!reverseDialogId) throw new Error("No voucher selected");
      const result = await reverseVoucher(reverseDialogId, reverseReason);
      if (!result.ok) throw new Error(result.error || "Failed");
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["accounting-vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-voucher-detail"] });
      toast({ title: "Voucher reversed", description: `Reversal posted as ${result.reversalVoucherNumber}` });
      setReverseDialogId(null);
      setReverseReason("");
    },
    onError: (e: any) => toast({ title: "Reversal failed", description: e.message, variant: "destructive" }),
  });

  const searchLower = search.toLowerCase();
  const filteredVouchers = (vouchers || []).filter((v: any) => {
    if (!searchLower) return true;
    return (
      v.voucher_number?.toLowerCase().includes(searchLower) ||
      v.narration?.toLowerCase().includes(searchLower) ||
      v.party?.name?.toLowerCase().includes(searchLower)
    );
  });

  const handleExport = () => {
    const data = filteredVouchers.map((v: any) => ({
      "Voucher #": v.voucher_number,
      "Date": v.voucher_date,
      "Type": v.voucher_type,
      "Party": v.party?.name || "",
      "Narration": v.narration || "",
      "Amount": Number(v.total_amount),
      "Status": v.status,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Voucher Register");
    XLSX.writeFile(wb, `Voucher_Register_${fromDate}_to_${toDate}.xlsx`);
  };

  return (
    <ERPLayout>
      <PageHeader title="Voucher Register" description="All posted vouchers across types — searchable, exportable">
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handleExport}><Download className="h-4 w-4 mr-1" />Export</Button>
          <Link to="/accounting/vouchers/new"><Button size="sm"><Plus className="h-4 w-4 mr-1" />New Voucher</Button></Link>
        </div>
      </PageHeader>

      <div className="flex gap-2 mb-4">
        <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-[160px]" />
        <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-[160px]" />
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {VOUCHER_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.value} — {t.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search voucher #, narration, party..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Voucher #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Party</TableHead>
              <TableHead>Narration</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>}
            {!isLoading && !filteredVouchers?.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No vouchers match your filters</TableCell></TableRow>}
            {filteredVouchers?.map((v: any) => (
              <TableRow key={v.id}>
                <TableCell className="font-mono text-xs">{v.voucher_number}</TableCell>
                <TableCell className="text-xs">{format(parseISO(v.voucher_date), "dd MMM yyyy")}</TableCell>
                <TableCell>{typeBadge(v.voucher_type)}</TableCell>
                <TableCell className="text-xs">{v.party?.name || "—"}</TableCell>
                <TableCell className="text-xs max-w-[280px] truncate">{v.narration || "—"}</TableCell>
                <TableCell className="text-right font-medium">Rs. {Number(v.total_amount).toLocaleString()}</TableCell>
                <TableCell>
                  {v.status === "reversed"
                    ? <Badge variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200">Reversed</Badge>
                    : v.reverses_voucher_id
                      ? <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">Reversal of {v.reverses_voucher?.voucher_number || "..."}</Badge>
                      : <Badge variant="default" className="text-xs">Posted</Badge>}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setViewVoucherId(v.id)} title="View"><Eye className="h-3 w-3" /></Button>
                    {v.status === "posted" && !v.reverses_voucher_id && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setReverseDialogId(v.id)} title="Reverse voucher">
                        <Undo2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!viewVoucherId} onOpenChange={(o) => !o && setViewVoucherId(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{selectedVoucher?.voucher_number} — {selectedVoucher && typeBadge(selectedVoucher.voucher_type)}</DialogTitle></DialogHeader>
          {selectedVoucher && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div><span className="text-muted-foreground">Date:</span> <strong>{format(parseISO(selectedVoucher.voucher_date), "dd MMM yyyy")}</strong></div>
                <div><span className="text-muted-foreground">Party:</span> <strong>{selectedVoucher.party?.name || "—"}</strong></div>
                <div><span className="text-muted-foreground">Amount:</span> <strong>Rs. {Number(selectedVoucher.total_amount).toLocaleString()}</strong></div>
              </div>
              {selectedVoucher.narration && <div className="text-sm"><span className="text-muted-foreground">Narration:</span> {selectedVoucher.narration}</div>}
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
                  {voucherLines?.map((l: any) => (
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

      <Dialog open={!!reverseDialogId} onOpenChange={(o) => { if (!o) { setReverseDialogId(null); setReverseReason(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Reverse Voucher</DialogTitle></DialogHeader>
          {reverseTargetVoucher && (
            <div className="space-y-3 text-sm">
              <div className="border rounded-md p-3 bg-muted/30 space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Voucher #</span><strong className="font-mono">{reverseTargetVoucher.voucher_number}</strong></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Date</span><strong>{format(parseISO(reverseTargetVoucher.voucher_date), "dd MMM yyyy")}</strong></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Type</span>{typeBadge(reverseTargetVoucher.voucher_type)}</div>
                <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><strong>Rs. {Number(reverseTargetVoucher.total_amount).toLocaleString()}</strong></div>
                {reverseTargetVoucher.narration && <div className="text-xs text-muted-foreground pt-1 border-t mt-1">{reverseTargetVoucher.narration}</div>}
              </div>
              <div>
                <Label>Reason *</Label>
                <Textarea rows={3} value={reverseReason} onChange={(e) => setReverseReason(e.target.value)}
                  placeholder="e.g. Duplicate entry / Data correction / Customer order cancelled" />
                <p className="text-xs text-muted-foreground mt-1">
                  This will create a new JV with Dr/Cr swapped. Both vouchers stay in the GL — they cancel out mathematically.
                  The original will be marked <code>status='reversed'</code>.
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" size="sm" onClick={() => { setReverseDialogId(null); setReverseReason(""); }}>Cancel</Button>
                <Button size="sm" disabled={!reverseReason.trim() || reverseMutation.isPending} onClick={() => reverseMutation.mutate()}>
                  <Undo2 className="h-3 w-3 mr-1" />
                  {reverseMutation.isPending ? "Reversing..." : "Confirm Reversal"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
