import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/accounting/fetchAllRows";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Download, CheckCircle, AlertTriangle } from "lucide-react";
import { format, endOfMonth } from "date-fns";
import * as XLSX from "xlsx";

const sb = supabase as any;

const TYPE_COLOR: Record<string, string> = {
  asset: "bg-blue-100 text-blue-800",
  liability: "bg-red-100 text-red-800",
  equity: "bg-purple-100 text-purple-800",
  revenue: "bg-green-100 text-green-800",
  expense: "bg-orange-100 text-orange-800",
};

const TYPE_ORDER: Record<string, number> = { asset: 1, liability: 2, equity: 3, revenue: 4, expense: 5 };

export default function TrialBalancePage() {
  const [asOfDate, setAsOfDate] = useState(format(endOfMonth(new Date()), "yyyy-MM-dd"));

  const { data: accounts } = useQuery({
    queryKey: ["acc-tb-accounts"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_chart_of_accounts")
        .select("id, code, name, account_type, sub_category")
        .eq("is_active", true)
        .not("sub_category", "is", null)
        .order("code");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: allLines } = useQuery({
    queryKey: ["acc-tb-lines", asOfDate],
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

  const rows = useMemo(() => {
    if (!accounts || !allLines) return [];
    const acc: Record<string, { dr: number; cr: number }> = {};
    allLines.forEach((l: any) => {
      if (!acc[l.account_id]) acc[l.account_id] = { dr: 0, cr: 0 };
      acc[l.account_id].dr += Number(l.debit_amount || 0);
      acc[l.account_id].cr += Number(l.credit_amount || 0);
    });
    return accounts
      .map((a: any) => {
        const sum = acc[a.id] || { dr: 0, cr: 0 };
        const net = sum.dr - sum.cr;
        return {
          ...a,
          totalDr: sum.dr,
          totalCr: sum.cr,
          netDr: net > 0 ? net : 0,
          netCr: net < 0 ? -net : 0,
          hasActivity: sum.dr !== 0 || sum.cr !== 0,
        };
      })
      .filter((r: any) => r.hasActivity)
      .sort((a: any, b: any) => {
        const ord = TYPE_ORDER[a.account_type] - TYPE_ORDER[b.account_type];
        if (ord !== 0) return ord;
        return a.code.localeCompare(b.code);
      });
  }, [accounts, allLines]);

  const totalDr = rows.reduce((s, r: any) => s + r.netDr, 0);
  const totalCr = rows.reduce((s, r: any) => s + r.netCr, 0);
  const balanced = Math.abs(totalDr - totalCr) < 0.01;

  const handleExport = () => {
    const data = rows.map((r: any) => ({
      Code: r.code,
      Account: r.name,
      Type: r.account_type,
      "Sub-category": r.sub_category || "",
      "Debit (Net)": r.netDr,
      "Credit (Net)": r.netCr,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Trial Balance");
    XLSX.writeFile(wb, `Trial_Balance_${asOfDate}.xlsx`);
  };

  return (
    <ERPLayout>
      <PageHeader title="Trial Balance" description="Net Dr/Cr for all accounts up to selected date">
        <div className="flex gap-2">
          <Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="w-[180px]" />
          <Button size="sm" variant="outline" onClick={handleExport}><Download className="h-4 w-4 mr-1" />Export</Button>
        </div>
      </PageHeader>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Debit</div><div className="text-2xl font-semibold text-green-600">Rs. {totalDr.toLocaleString()}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Credit</div><div className="text-2xl font-semibold text-red-600">Rs. {totalCr.toLocaleString()}</div></CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Status</div>
          <div className="text-xl font-semibold mt-1">
            {balanced
              ? <Badge variant="default" className="bg-green-600"><CheckCircle className="h-3 w-3 mr-1" />Balanced</Badge>
              : <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Diff: Rs. {Math.abs(totalDr - totalCr).toLocaleString()}</Badge>}
          </div>
        </CardContent></Card>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Sub-category</TableHead>
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!rows.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No postings up to this date</TableCell></TableRow>}
            {rows.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.code}</TableCell>
                <TableCell className="text-sm">{r.name}</TableCell>
                <TableCell><Badge variant="outline" className={TYPE_COLOR[r.account_type]}>{r.account_type}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.sub_category}</TableCell>
                <TableCell className="text-right text-xs">{r.netDr > 0 ? `Rs. ${r.netDr.toLocaleString()}` : "—"}</TableCell>
                <TableCell className="text-right text-xs">{r.netCr > 0 ? `Rs. ${r.netCr.toLocaleString()}` : "—"}</TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/40 font-semibold">
              <TableCell colSpan={4}>TOTALS</TableCell>
              <TableCell className="text-right">Rs. {totalDr.toLocaleString()}</TableCell>
              <TableCell className="text-right">Rs. {totalCr.toLocaleString()}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </ERPLayout>
  );
}
