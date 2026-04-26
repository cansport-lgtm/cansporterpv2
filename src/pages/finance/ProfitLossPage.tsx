import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useFinancePeriodData } from "@/hooks/useFinancePeriodData";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function ProfitLossPage() {
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");

  const { data: periods } = useQuery({
    queryKey: ["finance-periods-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("finance_periods").select("*").order("year", { ascending: false }).order("month", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const entries = useFinancePeriodData(selectedPeriodId);

  const pnl = useMemo(() => {
    if (!entries) return null;

    const revenueAccounts = entries.filter((e: any) => e.account?.account_type === "revenue");
    const expenseAccounts = entries.filter((e: any) => e.account?.account_type === "expense");

    const cogsAccounts = expenseAccounts.filter((e: any) =>
      e.account?.sub_category?.toLowerCase()?.includes("cost of") || e.account?.sub_category?.toLowerCase()?.includes("cogs")
    );
    const operatingExpenses = expenseAccounts.filter((e: any) =>
      !cogsAccounts.some((c: any) => c.id === e.id) &&
      (e.account?.sub_category?.toLowerCase()?.includes("operating") || e.account?.sub_category?.toLowerCase()?.includes("admin") || e.account?.sub_category?.toLowerCase()?.includes("selling") || !e.account?.sub_category?.toLowerCase()?.includes("other"))
    );
    const otherExpenses = expenseAccounts.filter((e: any) =>
      !cogsAccounts.some((c: any) => c.id === e.id) && !operatingExpenses.some((o: any) => o.id === e.id)
    );

    const calcNet = (items: any[]) => items.reduce((s, e) => s + Number(e.credit_amount || 0) - Number(e.debit_amount || 0), 0);
    const calcExpense = (items: any[]) => items.reduce((s, e) => s + Number(e.debit_amount || 0) - Number(e.credit_amount || 0), 0);

    const totalRevenue = calcNet(revenueAccounts);
    const totalCOGS = calcExpense(cogsAccounts);
    const grossProfit = totalRevenue - totalCOGS;
    const totalOpex = calcExpense(operatingExpenses);
    const operatingProfit = grossProfit - totalOpex;
    const totalOther = calcExpense(otherExpenses);
    const netProfit = operatingProfit - totalOther;

    return {
      revenueAccounts, cogsAccounts, operatingExpenses, otherExpenses,
      totalRevenue, totalCOGS, grossProfit, totalOpex, operatingProfit, totalOther, netProfit,
      gpMargin: totalRevenue ? ((grossProfit / totalRevenue) * 100).toFixed(1) : "0",
      opMargin: totalRevenue ? ((operatingProfit / totalRevenue) * 100).toFixed(1) : "0",
      npMargin: totalRevenue ? ((netProfit / totalRevenue) * 100).toFixed(1) : "0",
    };
  }, [entries]);

  const fmt = (v: number) => `Rs. ${Math.abs(v).toLocaleString("en-PK", { minimumFractionDigits: 0 })}`;
  const selectedPeriod = periods?.find((p) => p.id === selectedPeriodId);

  const renderSection = (title: string, items: any[], isExpense = false) => (
    <>
      <TableRow className="bg-muted/30">
        <TableCell colSpan={2} className="font-semibold text-sm">{title}</TableCell>
      </TableRow>
      {items.map((e: any) => (
        <TableRow key={e.id}>
          <TableCell className="pl-8 text-sm">{e.account?.code} - {e.account?.name}</TableCell>
          <TableCell className="text-right font-mono">
            {isExpense
              ? fmt(Number(e.debit_amount || 0) - Number(e.credit_amount || 0))
              : fmt(Number(e.credit_amount || 0) - Number(e.debit_amount || 0))}
          </TableCell>
        </TableRow>
      ))}
    </>
  );

  return (
    <ERPLayout>
      <PageHeader title="Profit & Loss Statement" description="Income statement with GP, OP, and NP">
        <Select value={selectedPeriodId} onValueChange={setSelectedPeriodId}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Select Period" /></SelectTrigger>
          <SelectContent>{periods?.map((p) => <SelectItem key={p.id} value={p.id}>{p.period_name}</SelectItem>)}</SelectContent>
        </Select>
      </PageHeader>

      {!selectedPeriodId ? (
        <div className="text-center py-16 text-muted-foreground">Select a period to view Profit & Loss</div>
      ) : !pnl ? (
        <div className="text-center py-16 text-muted-foreground">No data for this period</div>
      ) : (
        <>
          {/* Margin Badges */}
          <div className="flex gap-3 mb-4">
            <Badge variant="outline" className="text-sm px-3 py-1">GP Margin: {pnl.gpMargin}%</Badge>
            <Badge variant="outline" className="text-sm px-3 py-1">OP Margin: {pnl.opMargin}%</Badge>
            <Badge variant={Number(pnl.npMargin) >= 0 ? "default" : "destructive"} className="text-sm px-3 py-1">NP Margin: {pnl.npMargin}%</Badge>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Profit & Loss - {selectedPeriod?.period_name}</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Particulars</TableHead>
                    <TableHead className="text-right w-48">Amount (Rs.)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {renderSection("Revenue", pnl.revenueAccounts)}
                  <TableRow className="font-bold border-t">
                    <TableCell>Total Revenue</TableCell>
                    <TableCell className="text-right font-mono">{fmt(pnl.totalRevenue)}</TableCell>
                  </TableRow>

                  {renderSection("Cost of Goods Sold", pnl.cogsAccounts, true)}
                  <TableRow className="font-bold border-t">
                    <TableCell>Total COGS</TableCell>
                    <TableCell className="text-right font-mono">({fmt(pnl.totalCOGS)})</TableCell>
                  </TableRow>

                  <TableRow className="font-bold bg-green-50 dark:bg-green-950/20">
                    <TableCell>Gross Profit</TableCell>
                    <TableCell className="text-right font-mono text-green-700 dark:text-green-400">{fmt(pnl.grossProfit)}</TableCell>
                  </TableRow>

                  {renderSection("Operating Expenses", pnl.operatingExpenses, true)}
                  <TableRow className="font-bold border-t">
                    <TableCell>Total Operating Expenses</TableCell>
                    <TableCell className="text-right font-mono">({fmt(pnl.totalOpex)})</TableCell>
                  </TableRow>

                  <TableRow className="font-bold bg-blue-50 dark:bg-blue-950/20">
                    <TableCell>Operating Profit</TableCell>
                    <TableCell className="text-right font-mono text-blue-700 dark:text-blue-400">{fmt(pnl.operatingProfit)}</TableCell>
                  </TableRow>

                  {pnl.otherExpenses.length > 0 && renderSection("Other Expenses", pnl.otherExpenses, true)}

                  <TableRow className={`font-bold text-lg ${pnl.netProfit >= 0 ? "bg-green-100 dark:bg-green-950/30" : "bg-red-100 dark:bg-red-950/30"}`}>
                    <TableCell>Net Profit</TableCell>
                    <TableCell className={`text-right font-mono ${pnl.netProfit >= 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
                      {pnl.netProfit >= 0 ? fmt(pnl.netProfit) : `(${fmt(pnl.netProfit)})`}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </ERPLayout>
  );
}
