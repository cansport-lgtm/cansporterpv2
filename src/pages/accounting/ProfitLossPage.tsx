import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, TrendingUp, TrendingDown, DollarSign } from "lucide-react";
import { format, startOfYear, endOfMonth } from "date-fns";
import * as XLSX from "xlsx";

const sb = supabase as any;

export default function ProfitLossPage() {
  const [fromDate, setFromDate] = useState(format(startOfYear(new Date()), "yyyy-MM-dd"));
  // Default toDate = end of current month so period-end adjustments (typically dated month-end) are included
  const [toDate, setToDate] = useState(format(endOfMonth(new Date()), "yyyy-MM-dd"));

  const { data: accounts } = useQuery({
    queryKey: ["acc-pl-accounts"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_chart_of_accounts")
        .select("id, code, name, account_type, sub_category")
        .in("account_type", ["revenue", "expense"])
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
    queryKey: ["acc-pl-lines", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_voucher_lines")
        .select("account_id, debit_amount, credit_amount, voucher:accounting_vouchers!inner(voucher_date)")
        .gte("voucher.voucher_date", fromDate)
        .lte("voucher.voucher_date", toDate);
      if (error) throw error;
      return data || [];
    },
  });

  const computed = useMemo(() => {
    const totals: Record<string, { dr: number; cr: number }> = {};
    (lines || []).forEach((l: any) => {
      if (!totals[l.account_id]) totals[l.account_id] = { dr: 0, cr: 0 };
      totals[l.account_id].dr += Number(l.debit_amount || 0);
      totals[l.account_id].cr += Number(l.credit_amount || 0);
    });

    const revenueRows = (accounts || [])
      .filter((a: any) => a.account_type === "revenue")
      .map((a: any) => {
        const t = totals[a.id] || { dr: 0, cr: 0 };
        // Revenue normal: Cr - Dr (returns reduce revenue if account is 'Sales Returns' which is contra-revenue but we just net it)
        return { ...a, net: t.cr - t.dr };
      })
      .filter((r: any) => r.net !== 0);

    const expenseRows = (accounts || [])
      .filter((a: any) => a.account_type === "expense")
      .map((a: any) => {
        const t = totals[a.id] || { dr: 0, cr: 0 };
        // Expense normal: Dr - Cr
        return { ...a, net: t.dr - t.cr };
      })
      .filter((r: any) => r.net !== 0);

    const totalRevenue = revenueRows.reduce((s: number, r: any) => s + r.net, 0);
    const totalExpense = expenseRows.reduce((s: number, r: any) => s + r.net, 0);
    const netIncome = totalRevenue - totalExpense;

    // group expenses by sub-category for collapsible-style render
    const expensesByGroup: Record<string, any[]> = {};
    expenseRows.forEach((r: any) => {
      const key = r.sub_category || "Other";
      if (!expensesByGroup[key]) expensesByGroup[key] = [];
      expensesByGroup[key].push(r);
    });

    return { revenueRows, expenseRows, expensesByGroup, totalRevenue, totalExpense, netIncome };
  }, [accounts, lines]);

  const handleExport = () => {
    const data: any[] = [];
    data.push({ Section: "REVENUE", Code: "", Account: "", Amount: "" });
    computed.revenueRows.forEach((r: any) => data.push({ Section: "", Code: r.code, Account: r.name, Amount: r.net }));
    data.push({ Section: "Total Revenue", Code: "", Account: "", Amount: computed.totalRevenue });
    data.push({ Section: "", Code: "", Account: "", Amount: "" });
    data.push({ Section: "EXPENSES", Code: "", Account: "", Amount: "" });
    computed.expenseRows.forEach((r: any) => data.push({ Section: "", Code: r.code, Account: r.name, Amount: r.net }));
    data.push({ Section: "Total Expenses", Code: "", Account: "", Amount: computed.totalExpense });
    data.push({ Section: "", Code: "", Account: "", Amount: "" });
    data.push({ Section: "NET INCOME", Code: "", Account: "", Amount: computed.netIncome });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Profit & Loss");
    XLSX.writeFile(wb, `Profit_Loss_${fromDate}_to_${toDate}.xlsx`);
  };

  return (
    <ERPLayout>
      <PageHeader title="Profit & Loss" description="Revenue minus expenses for the selected period">
        <div className="flex gap-2">
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-[160px]" />
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-[160px]" />
          <Button size="sm" variant="outline" onClick={handleExport}><Download className="h-4 w-4 mr-1" />Export</Button>
        </div>
      </PageHeader>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3" />Total Revenue</div>
          <div className="text-2xl font-semibold text-green-600">Rs. {computed.totalRevenue.toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><TrendingDown className="h-3 w-3" />Total Expenses</div>
          <div className="text-2xl font-semibold text-red-600">Rs. {computed.totalExpense.toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><DollarSign className="h-3 w-3" />Net {computed.netIncome >= 0 ? "Profit" : "Loss"}</div>
          <div className={`text-2xl font-semibold ${computed.netIncome >= 0 ? "text-green-600" : "text-red-600"}`}>
            Rs. {Math.abs(computed.netIncome).toLocaleString()}
          </div>
        </CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Revenue */}
        <div className="border rounded-lg">
          <div className="px-4 py-3 border-b bg-green-50 dark:bg-green-950/20 font-semibold text-sm">REVENUE</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Code</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right w-36">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!computed.revenueRows.length && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No revenue postings in this period</TableCell></TableRow>}
              {computed.revenueRows.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.code}</TableCell>
                  <TableCell className="text-sm">{r.name}</TableCell>
                  <TableCell className="text-right text-sm">Rs. {r.net.toLocaleString()}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/40 font-semibold">
                <TableCell colSpan={2}>Total Revenue</TableCell>
                <TableCell className="text-right">Rs. {computed.totalRevenue.toLocaleString()}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {/* Expenses */}
        <div className="border rounded-lg">
          <div className="px-4 py-3 border-b bg-red-50 dark:bg-red-950/20 font-semibold text-sm">EXPENSES</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Code</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right w-36">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!computed.expenseRows.length && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No expense postings in this period</TableCell></TableRow>}
              {Object.entries(computed.expensesByGroup).map(([group, rows]) => (
                <>
                  <TableRow key={`g-${group}`} className="bg-muted/20">
                    <TableCell colSpan={3} className="text-xs font-medium text-muted-foreground">{group}</TableCell>
                  </TableRow>
                  {(rows as any[]).map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.code}</TableCell>
                      <TableCell className="text-sm">{r.name}</TableCell>
                      <TableCell className="text-right text-sm">Rs. {r.net.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </>
              ))}
              <TableRow className="bg-muted/40 font-semibold">
                <TableCell colSpan={2}>Total Expenses</TableCell>
                <TableCell className="text-right">Rs. {computed.totalExpense.toLocaleString()}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      <Card className="mt-4">
        <CardContent className="p-4 flex items-center justify-between">
          <div className="text-lg font-semibold">Net {computed.netIncome >= 0 ? "Profit" : "Loss"} for the Period</div>
          <div className={`text-2xl font-bold ${computed.netIncome >= 0 ? "text-green-600" : "text-red-600"}`}>
            Rs. {Math.abs(computed.netIncome).toLocaleString()}
          </div>
        </CardContent>
      </Card>
    </ERPLayout>
  );
}
