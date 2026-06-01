import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { Receipt, CheckCircle, AlertTriangle } from "lucide-react";
import { format, parseISO } from "date-fns";
import { postCustomerReceipt } from "@/lib/accounting/postCustomerReceipt";

const sb = supabase as any;

export default function CustomerReceiptsPage() {
  const queryClient = useQueryClient();
  const [selectedPartyId, setSelectedPartyId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [mode, setMode] = useState<"cash" | "bank">("bank");
  const [bankAccountId, setBankAccountId] = useState<string>("");
  const [receiptDate, setReceiptDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  // Find AR account
  const { data: arAccount } = useQuery({
    queryKey: ["ar-account-id"],
    queryFn: async () => {
      const { data } = await sb.from("accounting_default_accounts").select("account_id").eq("key", "accounts_receivable").maybeSingle();
      return data?.account_id || null;
    },
  });

  // Bank accounts list
  const { data: bankAccounts } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: async () => {
      const { data } = await sb.from("accounting_chart_of_accounts").select("id, code, name").eq("is_bank_account", true).eq("is_active", true).order("code");
      return data || [];
    },
  });

  // Aging — all AR posting lines grouped by party
  const { data: aging } = useQuery({
    queryKey: ["ar-aging", arAccount],
    queryFn: async () => {
      if (!arAccount) return [];
      const { data, error } = await sb
        .from("accounting_voucher_lines")
        .select("party_id, debit_amount, credit_amount, voucher:accounting_vouchers!inner(voucher_date), party:accounting_parties(name, party_type)")
        .eq("account_id", arAccount)
        .not("party_id", "is", null);
      if (error) throw error;
      const today = new Date();
      const map: Record<string, { partyId: string; name: string; total: number; b0_30: number; b31_60: number; b61_90: number; b90p: number }> = {};
      (data || []).forEach((l: any) => {
        const pid = l.party_id; if (!pid) return;
        if (!map[pid]) map[pid] = { partyId: pid, name: l.party?.name || "?", total: 0, b0_30: 0, b31_60: 0, b61_90: 0, b90p: 0 };
        const net = Number(l.debit_amount || 0) - Number(l.credit_amount || 0);
        map[pid].total += net;
        if (net !== 0) {
          const d = parseISO(l.voucher.voucher_date);
          const days = Math.floor((today.getTime() - d.getTime()) / 86400000);
          if (days <= 30) map[pid].b0_30 += net;
          else if (days <= 60) map[pid].b31_60 += net;
          else if (days <= 90) map[pid].b61_90 += net;
          else map[pid].b90p += net;
        }
      });
      // Include every customer in the list, even with no AR activity / zero
      // balance, so receipts (e.g. advances) can be recorded against any of them.
      const { data: allCustomers } = await sb
        .from("accounting_parties")
        .select("id, name")
        .eq("party_type", "customer");
      (allCustomers || []).forEach((p: any) => {
        if (!map[p.id]) map[p.id] = { partyId: p.id, name: p.name || "?", total: 0, b0_30: 0, b31_60: 0, b61_90: 0, b90p: 0 };
      });
      // Outstanding balances first (largest to smallest), then zero-balance
      // customers alphabetically.
      return Object.values(map).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    },
    enabled: !!arAccount,
  });

  const totals = useMemo(() => {
    const all = aging || [];
    return {
      total: all.reduce((s, r) => s + r.total, 0),
      b0_30: all.reduce((s, r) => s + r.b0_30, 0),
      b31_60: all.reduce((s, r) => s + r.b31_60, 0),
      b61_90: all.reduce((s, r) => s + r.b61_90, 0),
      b90p: all.reduce((s, r) => s + r.b90p, 0),
    };
  }, [aging]);

  const selectedRow = aging?.find(r => r.partyId === selectedPartyId);

  const postMutation = useMutation({
    mutationFn: async () => {
      const amt = parseFloat(amount);
      const result = await postCustomerReceipt({
        partyId: selectedPartyId,
        amount: amt,
        receiptDate,
        mode,
        bankAccountId: mode === "bank" ? bankAccountId : undefined,
        reference: reference || undefined,
        note: note || undefined,
      });
      if (!result.ok) throw new Error(result.error || "Failed");
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["ar-aging"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-vouchers"] });
      toast({ title: result.skipped === "flag_off" ? "Flag is OFF" : `Receipt posted: ${result.voucherNumber}` });
      setAmount(""); setReference(""); setNote("");
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <ERPLayout>
      <PageHeader title="Customer Receipts" description="AR aging + record customer payments against open balances" />

      <div className="grid grid-cols-5 gap-3 mb-4">
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Total Outstanding AR</div><div className="text-lg font-semibold">Rs. {totals.total.toLocaleString()}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">0-30 days</div><div className="text-lg font-semibold text-green-600">Rs. {totals.b0_30.toLocaleString()}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">31-60 days</div><div className="text-lg font-semibold text-amber-600">Rs. {totals.b31_60.toLocaleString()}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">61-90 days</div><div className="text-lg font-semibold text-orange-600">Rs. {totals.b61_90.toLocaleString()}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">90+ days</div><div className="text-lg font-semibold text-red-600">Rs. {totals.b90p.toLocaleString()}</div></CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-sm">AR Aging by Customer</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">0-30</TableHead>
                  <TableHead className="text-right">31-60</TableHead>
                  <TableHead className="text-right">61-90</TableHead>
                  <TableHead className="text-right">90+</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {!aging?.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No outstanding AR</TableCell></TableRow>}
                {aging?.map(r => (
                  <TableRow key={r.partyId} className={selectedPartyId === r.partyId ? "bg-muted/50" : ""}>
                    <TableCell className="text-sm">{r.name}</TableCell>
                    <TableCell className="text-right text-xs">{r.b0_30 > 0 ? `Rs. ${r.b0_30.toLocaleString()}` : "—"}</TableCell>
                    <TableCell className="text-right text-xs">{r.b31_60 > 0 ? `Rs. ${r.b31_60.toLocaleString()}` : "—"}</TableCell>
                    <TableCell className="text-right text-xs">{r.b61_90 > 0 ? `Rs. ${r.b61_90.toLocaleString()}` : "—"}</TableCell>
                    <TableCell className="text-right text-xs">{r.b90p > 0 ? `Rs. ${r.b90p.toLocaleString()}` : "—"}</TableCell>
                    <TableCell className="text-right font-medium text-xs">Rs. {r.total.toLocaleString()}</TableCell>
                    <TableCell>
                      <Button size="sm" variant={selectedPartyId === r.partyId ? "default" : "outline"} onClick={() => { setSelectedPartyId(r.partyId); setAmount(r.total.toString()); }}>
                        <Receipt className="h-3 w-3 mr-1" />Receive
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span>Record Receipt</span>
              {selectedRow && <Badge variant="outline">{selectedRow.name}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!selectedPartyId ? (
              <div className="text-xs text-muted-foreground p-4 border rounded-md">Click "Receive" on a customer row to start.</div>
            ) : (
              <>
                <div className="text-sm">Open balance: <strong>Rs. {selectedRow?.total.toLocaleString()}</strong></div>
                <div><Label>Date</Label><Input type="date" value={receiptDate} onChange={e => setReceiptDate(e.target.value)} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Mode</Label>
                    <Select value={mode} onValueChange={(v: any) => setMode(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash (CRV)</SelectItem>
                        <SelectItem value="bank">Bank (BRV)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Amount</Label><Input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></div>
                </div>
                {mode === "bank" && (
                  <div>
                    <Label>Bank Account</Label>
                    <Select value={bankAccountId} onValueChange={setBankAccountId}>
                      <SelectTrigger><SelectValue placeholder="Default Bank" /></SelectTrigger>
                      <SelectContent>
                        {bankAccounts?.map((a: any) => <SelectItem key={a.id} value={a.id}><span className="font-mono text-xs mr-2">{a.code}</span>{a.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div><Label>Reference</Label><Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Cheque #, txn ref" /></div>
                <div><Label>Note</Label><Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} /></div>

                <div className="border rounded-md p-2 bg-muted/30 text-xs">
                  <div className="flex justify-between">Dr {mode === "cash" ? "Cash" : "Bank"}<span className="font-medium">Rs. {(parseFloat(amount) || 0).toLocaleString()}</span></div>
                  <div className="flex justify-between">Cr Accounts Receivable<span className="font-medium">Rs. {(parseFloat(amount) || 0).toLocaleString()}</span></div>
                </div>
                <Button className="w-full" disabled={!amount || parseFloat(amount) <= 0 || postMutation.isPending} onClick={() => postMutation.mutate()}>
                  {postMutation.isPending ? "Posting..." : "Post Receipt"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
