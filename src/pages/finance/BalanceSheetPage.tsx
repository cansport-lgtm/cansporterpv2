import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useFinancePeriodData } from "@/hooks/useFinancePeriodData";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, AlertTriangle } from "lucide-react";

export default function BalanceSheetPage() {
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

  const bs = useMemo(() => {
    if (!entries) return null;

    const assets = entries.filter((e: any) => e.account?.account_type === "asset");
    const liabilities = entries.filter((e: any) => e.account?.account_type === "liability");
    const equity = entries.filter((e: any) => e.account?.account_type === "equity");

    // Calculate net profit to add to equity
    const revenue = entries.filter((e: any) => e.account?.account_type === "revenue")
      .reduce((s: number, e: any) => s + Number(e.credit_amount || 0) - Number(e.debit_amount || 0), 0);
    const expenses = entries.filter((e: any) => e.account?.account_type === "expense")
      .reduce((s: number, e: any) => s + Number(e.debit_amount || 0) - Number(e.credit_amount || 0), 0);
    const netProfit = revenue - expenses;

    const totalAssets = assets.reduce((s: number, e: any) => s + Number(e.debit_amount || 0) - Number(e.credit_amount || 0), 0);
    const totalLiabilities = liabilities.reduce((s: number, e: any) => s + Number(e.credit_amount || 0) - Number(e.debit_amount || 0), 0);
    const totalEquity = equity.reduce((s: number, e: any) => s + Number(e.credit_amount || 0) - Number(e.debit_amount || 0), 0);
    const totalEquityWithProfit = totalEquity + netProfit;
    const totalLE = totalLiabilities + totalEquityWithProfit;
    const isBalanced = Math.abs(totalAssets - totalLE) < 0.01;

    return { assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity, netProfit, totalEquityWithProfit, totalLE, isBalanced };
  }, [entries]);

  const fmt = (v: number) => `Rs. ${Math.abs(v).toLocaleString("en-PK", { minimumFractionDigits: 0 })}`;
  const _selectedPeriod = periods?.find((p) => p.id === selectedPeriodId);

  // Group by sub_category
  const groupBySubCat = (items: any[], isDebit: boolean) => {
    const groups: Record<string, { items: any[]; total: number }> = {};
    items.forEach((e: any) => {
      const cat = e.account?.sub_category || "Other";
      if (!groups[cat]) groups[cat] = { items: [], total: 0 };
      groups[cat].items.push(e);
      const val = isDebit ? Number(e.debit_amount || 0) - Number(e.credit_amount || 0) : Number(e.credit_amount || 0) - Number(e.debit_amount || 0);
      groups[cat].total += val;
    });
    return groups;
  };

  return (
    <ERPLayout>
      <PageHeader title="Balance Sheet" description="Assets = Liabilities + Equity">
        <Select value={selectedPeriodId} onValueChange={setSelectedPeriodId}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Select Period" /></SelectTrigger>
          <SelectContent>{periods?.map((p) => <SelectItem key={p.id} value={p.id}>{p.period_name}</SelectItem>)}</SelectContent>
        </Select>
      </PageHeader>

      {!selectedPeriodId ? (
        <div className="text-center py-16 text-muted-foreground">Select a period to view Balance Sheet</div>
      ) : !bs ? (
        <div className="text-center py-16 text-muted-foreground">No data for this period</div>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-4">
            {bs.isBalanced ? (
              <Badge className="bg-green-100 text-green-800"><CheckCircle className="h-3 w-3 mr-1" />Balanced</Badge>
            ) : (
              <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Not Balanced - Diff: {fmt(Math.abs(bs.totalAssets - bs.totalLE))}</Badge>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Assets */}
            <Card>
              <CardHeader><CardTitle className="text-base">Assets</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableBody>
                    {Object.entries(groupBySubCat(bs.assets, true)).map(([cat, group]) => (
                      <>
                        <TableRow key={`cat-${cat}`} className="bg-muted/30"><TableCell colSpan={2} className="font-semibold text-sm">{cat}</TableCell></TableRow>
                        {group.items.map((e: any) => (
                          <TableRow key={e.id}>
                            <TableCell className="pl-6 text-sm">{e.account?.name}</TableCell>
                            <TableCell className="text-right font-mono">{fmt(Number(e.debit_amount || 0) - Number(e.credit_amount || 0))}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow key={`subtotal-${cat}`} className="border-t">
                          <TableCell className="pl-6 font-medium text-sm">Sub-total</TableCell>
                          <TableCell className="text-right font-mono font-medium">{fmt(group.total)}</TableCell>
                        </TableRow>
                      </>
                    ))}
                    <TableRow className="font-bold bg-blue-50 dark:bg-blue-950/20 text-lg">
                      <TableCell>Total Assets</TableCell>
                      <TableCell className="text-right font-mono">{fmt(bs.totalAssets)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Liabilities + Equity */}
            <Card>
              <CardHeader><CardTitle className="text-base">Liabilities & Equity</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableBody>
                    <TableRow className="bg-muted/50"><TableCell colSpan={2} className="font-bold text-sm">Liabilities</TableCell></TableRow>
                    {Object.entries(groupBySubCat(bs.liabilities, false)).map(([cat, group]) => (
                      <>
                        <TableRow key={`cat-${cat}`} className="bg-muted/20"><TableCell colSpan={2} className="font-semibold text-sm pl-4">{cat}</TableCell></TableRow>
                        {group.items.map((e: any) => (
                          <TableRow key={e.id}>
                            <TableCell className="pl-8 text-sm">{e.account?.name}</TableCell>
                            <TableCell className="text-right font-mono">{fmt(Number(e.credit_amount || 0) - Number(e.debit_amount || 0))}</TableCell>
                          </TableRow>
                        ))}
                      </>
                    ))}
                    <TableRow className="border-t font-bold">
                      <TableCell className="pl-4">Total Liabilities</TableCell>
                      <TableCell className="text-right font-mono">{fmt(bs.totalLiabilities)}</TableCell>
                    </TableRow>

                    <TableRow className="bg-muted/50"><TableCell colSpan={2} className="font-bold text-sm">Equity</TableCell></TableRow>
                    {bs.equity.map((e: any) => (
                      <TableRow key={e.id}>
                        <TableCell className="pl-8 text-sm">{e.account?.name}</TableCell>
                        <TableCell className="text-right font-mono">{fmt(Number(e.credit_amount || 0) - Number(e.debit_amount || 0))}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell className="pl-8 text-sm italic">Retained Earnings (Net Profit)</TableCell>
                      <TableCell className="text-right font-mono italic">{fmt(bs.netProfit)}</TableCell>
                    </TableRow>
                    <TableRow className="border-t font-bold">
                      <TableCell className="pl-4">Total Equity</TableCell>
                      <TableCell className="text-right font-mono">{fmt(bs.totalEquityWithProfit)}</TableCell>
                    </TableRow>

                    <TableRow className="font-bold bg-blue-50 dark:bg-blue-950/20 text-lg">
                      <TableCell>Total L + E</TableCell>
                      <TableCell className="text-right font-mono">{fmt(bs.totalLE)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </ERPLayout>
  );
}
