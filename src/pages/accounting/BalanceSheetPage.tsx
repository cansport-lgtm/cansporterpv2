import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/accounting/fetchAllRows";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Download, CheckCircle, AlertTriangle, Wallet, Building2, Briefcase } from "lucide-react";
import { format, endOfMonth } from "date-fns";
import * as XLSX from "xlsx";

const sb = supabase as any;

export default function BalanceSheetPage() {
  // Default = end of current month so period-end adjustments are reflected
  const [asOfDate, setAsOfDate] = useState(format(endOfMonth(new Date()), "yyyy-MM-dd"));

  const { data: accounts } = useQuery({
    queryKey: ["acc-bs-accounts"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_chart_of_accounts")
        .select("id, code, name, account_type, sub_category")
        .eq("is_active", true)
        .not("sub_category", "is", null)
        .order("account_type")
        .order("sort_order")
        .order("code");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: lines } = useQuery({
    queryKey: ["acc-bs-lines", asOfDate],
    queryFn: async () => {
      const data = await fetchAllRows((from, to) =>
        sb
          .from("accounting_voucher_lines")
          .select("account_id, debit_amount, credit_amount, voucher:accounting_vouchers!inner(voucher_date)")
          .lte("voucher.voucher_date", asOfDate)
          .order("id", { ascending: true })
          .range(from, to));
      return data;
    },
  });

  const computed = useMemo(() => {
    const totals: Record<string, { dr: number; cr: number }> = {};
    (lines || []).forEach((l: any) => {
      if (!totals[l.account_id]) totals[l.account_id] = { dr: 0, cr: 0 };
      totals[l.account_id].dr += Number(l.debit_amount || 0);
      totals[l.account_id].cr += Number(l.credit_amount || 0);
    });

    const buildRows = (type: string, normal: "dr" | "cr") => {
      return (accounts || [])
        .filter((a: any) => a.account_type === type)
        .map((a: any) => {
          const t = totals[a.id] || { dr: 0, cr: 0 };
          const net = normal === "dr" ? t.dr - t.cr : t.cr - t.dr;
          return { ...a, net };
        })
        .filter((r: any) => r.net !== 0);
    };

    const assetRows = buildRows("asset", "dr");
    const liabilityRows = buildRows("liability", "cr");
    const equityRows = buildRows("equity", "cr");

    // Current-year earnings = Revenue (Cr - Dr) - Expense (Dr - Cr)
    let revenue = 0;
    let expense = 0;
    (accounts || []).forEach((a: any) => {
      const t = totals[a.id];
      if (!t) return;
      if (a.account_type === "revenue") revenue += t.cr - t.dr;
      if (a.account_type === "expense") expense += t.dr - t.cr;
    });
    const currentYearEarnings = revenue - expense;

    const totalAssets = assetRows.reduce((s: number, r: any) => s + r.net, 0);
    const totalLiabilities = liabilityRows.reduce((s: number, r: any) => s + r.net, 0);
    const totalEquityBeforeCYE = equityRows.reduce((s: number, r: any) => s + r.net, 0);
    const totalEquity = totalEquityBeforeCYE + currentYearEarnings;
    const totalLiabAndEquity = totalLiabilities + totalEquity;
    const balanced = Math.abs(totalAssets - totalLiabAndEquity) < 0.01;
    const diff = totalAssets - totalLiabAndEquity;

    return { assetRows, liabilityRows, equityRows, currentYearEarnings, totalAssets, totalLiabilities, totalEquity, totalLiabAndEquity, balanced, diff };
  }, [accounts, lines]);

  const handleExport = () => {
    const data: any[] = [];
    data.push({ Section: "ASSETS", Code: "", Account: "", Amount: "" });
    computed.assetRows.forEach((r: any) => data.push({ Section: "", Code: r.code, Account: r.name, Amount: r.net }));
    data.push({ Section: "Total Assets", Code: "", Account: "", Amount: computed.totalAssets });
    data.push({ Section: "", Code: "", Account: "", Amount: "" });
    data.push({ Section: "LIABILITIES", Code: "", Account: "", Amount: "" });
    computed.liabilityRows.forEach((r: any) => data.push({ Section: "", Code: r.code, Account: r.name, Amount: r.net }));
    data.push({ Section: "Total Liabilities", Code: "", Account: "", Amount: computed.totalLiabilities });
    data.push({ Section: "", Code: "", Account: "", Amount: "" });
    data.push({ Section: "EQUITY", Code: "", Account: "", Amount: "" });
    computed.equityRows.forEach((r: any) => data.push({ Section: "", Code: r.code, Account: r.name, Amount: r.net }));
    data.push({ Section: "", Code: "", Account: "Current Year Earnings", Amount: computed.currentYearEarnings });
    data.push({ Section: "Total Equity", Code: "", Account: "", Amount: computed.totalEquity });
    data.push({ Section: "", Code: "", Account: "", Amount: "" });
    data.push({ Section: "Total Liabilities + Equity", Code: "", Account: "", Amount: computed.totalLiabAndEquity });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Balance Sheet");
    XLSX.writeFile(wb, `Balance_Sheet_${asOfDate}.xlsx`);
  };

  return (
    <ERPLayout>
      <PageHeader title="Balance Sheet" description="Assets = Liabilities + Equity, as of the selected date">
        <div className="flex gap-2">
          <Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="w-[180px]" />
          <Button size="sm" variant="outline" onClick={handleExport}><Download className="h-4 w-4 mr-1" />Export</Button>
        </div>
      </PageHeader>

      <div className="grid grid-cols-4 gap-4 mb-4">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Wallet className="h-3 w-3" />Total Assets</div>
          <div className="text-2xl font-semibold text-blue-600">Rs. {computed.totalAssets.toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Building2 className="h-3 w-3" />Total Liabilities</div>
          <div className="text-2xl font-semibold text-red-600">Rs. {computed.totalLiabilities.toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Briefcase className="h-3 w-3" />Total Equity</div>
          <div className="text-2xl font-semibold text-purple-600">Rs. {computed.totalEquity.toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Status</div>
          <div className="text-xl font-semibold mt-1">
            {computed.balanced
              ? <Badge variant="default" className="bg-green-600"><CheckCircle className="h-3 w-3 mr-1" />Balanced</Badge>
              : <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Diff Rs. {Math.abs(computed.diff).toLocaleString()}</Badge>}
          </div>
        </CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ASSETS */}
        <div className="border rounded-lg">
          <div className="px-4 py-3 border-b bg-blue-50 dark:bg-blue-950/20 font-semibold text-sm">ASSETS</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Code</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right w-36">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!computed.assetRows.length && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No asset postings yet</TableCell></TableRow>}
              {computed.assetRows.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.code}</TableCell>
                  <TableCell className="text-sm">
                    <Link to={`/accounting/general-ledger?account=${r.id}`} className="text-primary hover:underline" title="Open ledger">
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right text-sm">Rs. {r.net.toLocaleString()}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/40 font-semibold">
                <TableCell colSpan={2}>Total Assets</TableCell>
                <TableCell className="text-right">Rs. {computed.totalAssets.toLocaleString()}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {/* LIABILITIES + EQUITY */}
        <div className="space-y-4">
          <div className="border rounded-lg">
            <div className="px-4 py-3 border-b bg-red-50 dark:bg-red-950/20 font-semibold text-sm">LIABILITIES</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Code</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right w-36">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!computed.liabilityRows.length && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No liability postings yet</TableCell></TableRow>}
                {computed.liabilityRows.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.code}</TableCell>
                    <TableCell className="text-sm">
                    <Link to={`/accounting/general-ledger?account=${r.id}`} className="text-primary hover:underline" title="Open ledger">
                      {r.name}
                    </Link>
                  </TableCell>
                    <TableCell className="text-right text-sm">Rs. {r.net.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell colSpan={2}>Total Liabilities</TableCell>
                  <TableCell className="text-right">Rs. {computed.totalLiabilities.toLocaleString()}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <div className="border rounded-lg">
            <div className="px-4 py-3 border-b bg-purple-50 dark:bg-purple-950/20 font-semibold text-sm">EQUITY</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Code</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right w-36">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {computed.equityRows.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.code}</TableCell>
                    <TableCell className="text-sm">
                    <Link to={`/accounting/general-ledger?account=${r.id}`} className="text-primary hover:underline" title="Open ledger">
                      {r.name}
                    </Link>
                  </TableCell>
                    <TableCell className="text-right text-sm">Rs. {r.net.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-mono text-xs">—</TableCell>
                  <TableCell className="text-sm italic">Current Year Earnings (P&amp;L)</TableCell>
                  <TableCell className={`text-right text-sm ${computed.currentYearEarnings >= 0 ? "text-green-600" : "text-red-600"}`}>
                    Rs. {computed.currentYearEarnings.toLocaleString()}
                  </TableCell>
                </TableRow>
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell colSpan={2}>Total Equity</TableCell>
                  <TableCell className="text-right">Rs. {computed.totalEquity.toLocaleString()}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <Card>
            <CardContent className="p-4 flex items-center justify-between">
              <div className="text-sm font-semibold">Total Liabilities + Equity</div>
              <div className="text-xl font-bold">Rs. {computed.totalLiabAndEquity.toLocaleString()}</div>
            </CardContent>
          </Card>
        </div>
      </div>
    </ERPLayout>
  );
}
