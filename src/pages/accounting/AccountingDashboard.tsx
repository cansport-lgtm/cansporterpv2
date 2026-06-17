import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/accounting/fetchAllRows";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wallet, Landmark, FileText, Plus, BookOpen, Package, AlertTriangle, CheckCircle, ArrowRight } from "lucide-react";
import { format, parseISO } from "date-fns";

const sb = supabase as any;

export default function AccountingDashboard() {
  const { data: cashAccounts } = useQuery({
    queryKey: ["acc-dash-cash-accounts"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_chart_of_accounts")
        .select("id, code, name, is_cash_account, is_bank_account")
        .or("is_cash_account.eq.true,is_bank_account.eq.true")
        .eq("is_active", true);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: inventoryAccounts } = useQuery({
    queryKey: ["acc-dash-inventory-accounts"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_chart_of_accounts")
        .select("id, code, name")
        .in("code", ["1130", "1131", "1132"])
        .eq("is_active", true)
        .order("code");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: allLines } = useQuery({
    queryKey: ["acc-dash-lines"],
    queryFn: async () => {
      const data = await fetchAllRows((from, to) =>
        sb
          .from("accounting_voucher_lines")
          .select("account_id, debit_amount, credit_amount")
          .order("id", { ascending: true })
          .range(from, to));
      return data;
    },
  });

  const { data: recentVouchers } = useQuery({
    queryKey: ["acc-dash-recent"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_vouchers")
        .select("*, party:accounting_parties(name)")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
  });

  const balanceFor = (accountId: string) => {
    if (!allLines) return 0;
    return allLines
      .filter((l: any) => l.account_id === accountId)
      .reduce((s: number, l: any) => s + Number(l.debit_amount || 0) - Number(l.credit_amount || 0), 0);
  };

  const cashOnly = (cashAccounts || []).filter((a: any) => a.is_cash_account);
  const bankOnly = (cashAccounts || []).filter((a: any) => a.is_bank_account);

  const totalCash = cashOnly.reduce((s: number, a: any) => s + balanceFor(a.id), 0);
  const totalBank = bankOnly.reduce((s: number, a: any) => s + balanceFor(a.id), 0);
  const voucherCount = recentVouchers?.length || 0;

  const inventoryRows = (inventoryAccounts || []).map((a: any) => ({ ...a, balance: balanceFor(a.id) }));
  const totalInventory = inventoryRows.reduce((s: number, a: any) => s + a.balance, 0);
  const negativeInventory = inventoryRows.filter((a: any) => a.balance < 0).length;

  return (
    <ERPLayout>
      <PageHeader title="Accounting Dashboard" description="Standalone double-entry accounting module">
        <div className="flex gap-2">
          <Link to="/accounting/vouchers/new"><Button size="sm"><Plus className="h-4 w-4 mr-1" />New Voucher</Button></Link>
          <Link to="/accounting/day-book"><Button size="sm" variant="outline"><BookOpen className="h-4 w-4 mr-1" />Day Book</Button></Link>
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <MetricCard title="Total Cash on Hand" value={`Rs. ${totalCash.toLocaleString()}`} icon={Wallet} />
        <MetricCard title="Total Bank Balance" value={`Rs. ${totalBank.toLocaleString()}`} icon={Landmark} />
        <MetricCard title="Total Inventory (RM+WIP+FG)" value={`Rs. ${totalInventory.toLocaleString()}`} icon={Package} />
        <MetricCard title="Recent Vouchers" value={voucherCount.toString()} icon={FileText} />
      </div>

      <Card className={`mb-6 ${negativeInventory > 0 ? "border-red-300" : ""}`}>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Package className="h-4 w-4" />Inventory Account Health
            </span>
            {negativeInventory > 0
              ? <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />{negativeInventory} account(s) negative</Badge>
              : <Badge variant="default" className="bg-green-600"><CheckCircle className="h-3 w-3 mr-1" />All non-negative</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">GL Balance</TableHead>
                <TableHead>Health</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {!inventoryRows.length && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Inventory accounts (1130/1131/1132) not found</TableCell></TableRow>}
              {inventoryRows.map((a: any) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs">{a.code}</TableCell>
                  <TableCell className="text-sm">{a.name}</TableCell>
                  <TableCell className={`text-right text-sm font-medium ${a.balance < 0 ? "text-red-600" : ""}`}>
                    Rs. {a.balance.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {a.balance < 0
                      ? <Badge variant="destructive" className="text-xs"><AlertTriangle className="h-3 w-3 mr-1" />Negative</Badge>
                      : a.balance === 0
                        ? <Badge variant="secondary" className="text-xs">Zero</Badge>
                        : <Badge variant="default" className="bg-green-600 text-xs"><CheckCircle className="h-3 w-3 mr-1" />Positive</Badge>}
                  </TableCell>
                  <TableCell>
                    <Link to={`/accounting/general-ledger`}>
                      <Button size="sm" variant="ghost" className="h-7 text-xs">View ledger <ArrowRight className="h-3 w-3 ml-1" /></Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {negativeInventory > 0 && (
            <div className="px-4 py-3 border-t bg-red-50 dark:bg-red-950/20 text-xs text-red-700 dark:text-red-400">
              <AlertTriangle className="h-3 w-3 inline mr-1" />
              Negative inventory in the GL typically means: missing opening balance entry, over-consumption recorded,
              or an unposted purchase. Investigate via the General Ledger drill-down or post the periodic COGS adjustment
              at <Link to="/accounting/periodic-cogs" className="underline font-medium">/accounting/periodic-cogs</Link>.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Cash & Bank Accounts</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(cashAccounts || []).map((a: any) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-xs">{a.code}</TableCell>
                    <TableCell>{a.name}</TableCell>
                    <TableCell className="text-right font-medium">Rs. {balanceFor(a.id).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
                {!cashAccounts?.length && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No accounts yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Recent Vouchers</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Narration</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(recentVouchers || []).map((v: any) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-mono text-xs">{v.voucher_number}</TableCell>
                    <TableCell className="text-xs">{format(parseISO(v.voucher_date), "dd MMM yyyy")}</TableCell>
                    <TableCell><Badge variant="outline">{v.voucher_type}</Badge></TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate">{v.narration || v.party?.name || "—"}</TableCell>
                    <TableCell className="text-right text-xs">Rs. {Number(v.total_amount).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
                {!recentVouchers?.length && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No vouchers yet — start with a Cash Receipt Voucher</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
