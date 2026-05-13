import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format, subDays } from "date-fns";

const sb = supabase as any;

export default function BankBookPage() {
  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [accountId, setAccountId] = useState<string>("");

  const { data: bankAccounts } = useQuery({
    queryKey: ["acc-bankbook-accounts"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_chart_of_accounts")
        .select("id, code, name")
        .eq("is_bank_account", true)
        .eq("is_active", true)
        .order("code");
      if (error) throw error;
      return data || [];
    },
  });

  useEffect(() => {
    if (!accountId && bankAccounts?.length) setAccountId(bankAccounts[0].id);
  }, [bankAccounts, accountId]);

  const { data: opening } = useQuery({
    queryKey: ["acc-bankbook-opening", accountId, fromDate],
    queryFn: async () => {
      if (!accountId) return 0;
      const { data, error } = await sb
        .from("accounting_voucher_lines")
        .select("debit_amount, credit_amount, voucher:accounting_vouchers!inner(voucher_date)")
        .eq("account_id", accountId)
        .lt("voucher.voucher_date", fromDate);
      if (error) throw error;
      return (data || []).reduce((s: number, l: any) => s + Number(l.debit_amount || 0) - Number(l.credit_amount || 0), 0);
    },
    enabled: !!accountId,
  });

  const { data: lines } = useQuery({
    queryKey: ["acc-bankbook-lines", accountId, fromDate, toDate],
    queryFn: async () => {
      if (!accountId) return [];
      const { data, error } = await sb
        .from("accounting_voucher_lines")
        .select("*, voucher:accounting_vouchers!inner(voucher_number, voucher_type, voucher_date, narration, party_id), account:accounting_chart_of_accounts(code, name), party:accounting_parties(name)")
        .eq("account_id", accountId)
        .gte("voucher.voucher_date", fromDate)
        .lte("voucher.voucher_date", toDate);
      if (error) throw error;
      return (data || []).sort((a: any, b: any) => {
        const ad = a.voucher?.voucher_date || "";
        const bd = b.voucher?.voucher_date || "";
        if (ad !== bd) return ad < bd ? -1 : 1;
        return (a.voucher?.voucher_number || "").localeCompare(b.voucher?.voucher_number || "");
      });
    },
    enabled: !!accountId,
  });

  const voucherIds = useMemo(() => Array.from(new Set((lines || []).map((l: any) => l.voucher_id))), [lines]);
  const { data: contraData } = useQuery({
    queryKey: ["acc-bankbook-contra", voucherIds.join(",")],
    queryFn: async () => {
      if (!voucherIds.length) return {};
      const { data, error } = await sb
        .from("accounting_voucher_lines")
        .select("voucher_id, account_id, account:accounting_chart_of_accounts(name)")
        .in("voucher_id", voucherIds);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data || []).forEach((l: any) => {
        if (l.account_id === accountId) return;
        if (!map[l.voucher_id]) map[l.voucher_id] = l.account?.name || "";
        else if (!map[l.voucher_id].includes(l.account?.name)) map[l.voucher_id] += ", " + l.account?.name;
      });
      return map;
    },
    enabled: voucherIds.length > 0,
  });

  const rows = useMemo(() => {
    if (!lines) return [];
    let bal = Number(opening || 0);
    return lines.map((l: any) => {
      bal += Number(l.debit_amount || 0) - Number(l.credit_amount || 0);
      return { ...l, runningBalance: bal };
    });
  }, [lines, opening]);

  const totalDr = (lines || []).reduce((s: number, l: any) => s + Number(l.debit_amount || 0), 0);
  const totalCr = (lines || []).reduce((s: number, l: any) => s + Number(l.credit_amount || 0), 0);
  const closing = Number(opening || 0) + totalDr - totalCr;
  const selectedAccount = bankAccounts?.find((a: any) => a.id === accountId);

  return (
    <ERPLayout>
      <PageHeader title="Bank Book" description="Running ledger for any bank account">
        <div className="flex gap-2">
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger className="w-[280px]"><SelectValue placeholder="Bank account" /></SelectTrigger>
            <SelectContent>
              {bankAccounts?.map((a: any) => <SelectItem key={a.id} value={a.id}><span className="font-mono text-xs mr-2">{a.code}</span>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-[160px]" />
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-[160px]" />
        </div>
      </PageHeader>

      <div className="grid grid-cols-4 gap-4 mb-4">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Opening Balance</div><div className="text-xl font-semibold">Rs. {Number(opening || 0).toLocaleString()}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Receipts (Dr)</div><div className="text-xl font-semibold text-green-600">Rs. {totalDr.toLocaleString()}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Payments (Cr)</div><div className="text-xl font-semibold text-red-600">Rs. {totalCr.toLocaleString()}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Closing Balance</div><div className="text-xl font-semibold">Rs. {closing.toLocaleString()}</div></CardContent></Card>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Voucher</TableHead>
              <TableHead>Particulars</TableHead>
              <TableHead>Party</TableHead>
              <TableHead className="text-right">Receipt (Dr)</TableHead>
              <TableHead className="text-right">Payment (Cr)</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="bg-muted/40">
              <TableCell colSpan={6} className="text-xs italic">Opening Balance — {selectedAccount?.name}</TableCell>
              <TableCell className="text-right font-semibold">Rs. {Number(opening || 0).toLocaleString()}</TableCell>
            </TableRow>
            {!rows.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No transactions in this range</TableCell></TableRow>}
            {rows.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs">{r.voucher?.voucher_date && format(new Date(r.voucher.voucher_date), "dd MMM")}</TableCell>
                <TableCell className="text-xs">
                  <Badge variant="outline" className="font-mono text-[10px] mr-1">{r.voucher?.voucher_type}</Badge>
                  {r.voucher?.voucher_number}
                </TableCell>
                <TableCell className="text-xs">{contraData?.[r.voucher_id] || r.voucher?.narration || "—"}</TableCell>
                <TableCell className="text-xs">{r.party?.name || "—"}</TableCell>
                <TableCell className="text-right text-xs">{Number(r.debit_amount) > 0 ? `Rs. ${Number(r.debit_amount).toLocaleString()}` : "—"}</TableCell>
                <TableCell className="text-right text-xs">{Number(r.credit_amount) > 0 ? `Rs. ${Number(r.credit_amount).toLocaleString()}` : "—"}</TableCell>
                <TableCell className="text-right text-xs font-medium">Rs. {r.runningBalance.toLocaleString()}</TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/40 font-semibold">
              <TableCell colSpan={4}>Closing Balance</TableCell>
              <TableCell className="text-right">Rs. {totalDr.toLocaleString()}</TableCell>
              <TableCell className="text-right">Rs. {totalCr.toLocaleString()}</TableCell>
              <TableCell className="text-right">Rs. {closing.toLocaleString()}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </ERPLayout>
  );
}
