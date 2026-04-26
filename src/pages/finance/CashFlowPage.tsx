import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useFinancePeriodData } from "@/hooks/useFinancePeriodData";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function CashFlowPage() {
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");
  const [comparePeriodId, setComparePeriodId] = useState<string>("");

  const { data: periods } = useQuery({
    queryKey: ["finance-periods-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("finance_periods").select("*").order("year", { ascending: false }).order("month", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const currentEntries = useFinancePeriodData(selectedPeriodId);
  const previousEntries = useFinancePeriodData(comparePeriodId);

  const cashFlow = useMemo(() => {
    if (!currentEntries) return null;

    const getBalance = (entries: any[], type: string, isDebit: boolean, subCatFilter?: string) => {
      return entries
        .filter((e: any) => {
          if (e.account?.account_type !== type) return false;
          if (subCatFilter && !e.account?.sub_category?.toLowerCase()?.includes(subCatFilter)) return false;
          return true;
        })
        .reduce((s: number, e: any) => {
          return s + (isDebit ? Number(e.debit_amount || 0) - Number(e.credit_amount || 0) : Number(e.credit_amount || 0) - Number(e.debit_amount || 0));
        }, 0);
    };

    const getAccountBalance = (entries: any[], accountName: string, isDebit: boolean) => {
      return entries
        .filter((e: any) => e.account?.name?.toLowerCase()?.includes(accountName.toLowerCase()))
        .reduce((s: number, e: any) => {
          return s + (isDebit ? Number(e.debit_amount || 0) - Number(e.credit_amount || 0) : Number(e.credit_amount || 0) - Number(e.debit_amount || 0));
        }, 0);
    };

    // Net Profit
    const revenue = getBalance(currentEntries, "revenue", false);
    const expenses = getBalance(currentEntries, "expense", true);
    const netProfit = revenue - expenses;

    // Non-cash adjustments (depreciation, amortization)
    const depreciation = currentEntries
      .filter((e: any) => e.account?.account_type === "expense" && (
        e.account?.name?.toLowerCase()?.includes("depreciation") ||
        e.account?.name?.toLowerCase()?.includes("amortization")
      ))
      .reduce((s: number, e: any) => s + Number(e.debit_amount || 0) - Number(e.credit_amount || 0), 0);

    // Working capital changes (current period vs previous period)
    const prev = previousEntries || [];

    const currentReceivables = getAccountBalance(currentEntries, "receivable", true);
    const prevReceivables = getAccountBalance(prev, "receivable", true);
    const receivableChange = -(currentReceivables - prevReceivables); // decrease = positive

    const currentPayables = getAccountBalance(currentEntries, "payable", false);
    const prevPayables = getAccountBalance(prev, "payable", false);
    const payableChange = currentPayables - prevPayables; // increase = positive

    const currentInventory = getAccountBalance(currentEntries, "inventory", true) + getAccountBalance(currentEntries, "stock", true);
    const prevInventory = getAccountBalance(prev, "inventory", true) + getAccountBalance(prev, "stock", true);
    const inventoryChange = -(currentInventory - prevInventory);

    const operatingCashFlow = netProfit + depreciation + receivableChange + payableChange + inventoryChange;

    // Investing (changes in fixed assets)
    const currentFixedAssets = getBalance(currentEntries, "asset", true, "fixed");
    const prevFixedAssets = getBalance(prev, "asset", true, "fixed");
    const investingCashFlow = -(currentFixedAssets - prevFixedAssets + depreciation); // capex net of depreciation

    // Financing (changes in long-term liabilities + equity)
    const currentLTL = getBalance(currentEntries, "liability", false, "long");
    const prevLTL = getBalance(prev, "liability", false, "long");
    const currentEquity = getBalance(currentEntries, "equity", false);
    const prevEquity = getBalance(prev, "equity", false);
    const financingCashFlow = (currentLTL - prevLTL) + (currentEquity - prevEquity);

    const netCashFlow = operatingCashFlow + investingCashFlow + financingCashFlow;

    // Cash position
    const cashAccounts = currentEntries.filter((e: any) => e.account?.is_cash_account);
    const cashPosition = cashAccounts.reduce((s: number, e: any) => s + Number(e.debit_amount || 0) - Number(e.credit_amount || 0), 0);

    return {
      netProfit, depreciation, receivableChange, payableChange, inventoryChange, operatingCashFlow,
      investingCashFlow, financingCashFlow, netCashFlow, cashPosition, cashAccounts,
    };
  }, [currentEntries, previousEntries]);

  const fmt = (v: number) => {
    const sign = v >= 0 ? "" : "(";
    const end = v >= 0 ? "" : ")";
    return `${sign}Rs. ${Math.abs(v).toLocaleString("en-PK", { minimumFractionDigits: 0 })}${end}`;
  };

  const selectedPeriod = periods?.find((p) => p.id === selectedPeriodId);

  // Auto-select previous period
  useMemo(() => {
    if (selectedPeriodId && periods) {
      const idx = periods.findIndex((p) => p.id === selectedPeriodId);
      if (idx >= 0 && idx < periods.length - 1) {
        setComparePeriodId(periods[idx + 1].id);
      }
    }
  }, [selectedPeriodId, periods]);

  return (
    <ERPLayout>
      <PageHeader title="Cash Flow Statement" description="Indirect method - Operating, Investing, Financing">
        <div className="flex gap-2">
          <Select value={selectedPeriodId} onValueChange={setSelectedPeriodId}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Current Period" /></SelectTrigger>
            <SelectContent>{periods?.map((p) => <SelectItem key={p.id} value={p.id}>{p.period_name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={comparePeriodId} onValueChange={setComparePeriodId}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Previous Period" /></SelectTrigger>
            <SelectContent>{periods?.map((p) => <SelectItem key={p.id} value={p.id}>{p.period_name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </PageHeader>

      {!selectedPeriodId ? (
        <div className="text-center py-16 text-muted-foreground">Select current and previous periods to generate cash flow</div>
      ) : !cashFlow ? (
        <div className="text-center py-16 text-muted-foreground">No data available</div>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-base">Cash Flow Statement - {selectedPeriod?.period_name}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Particulars</TableHead>
                  <TableHead className="text-right w-48">Amount (Rs.)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Operating Activities */}
                <TableRow className="bg-muted/50 font-bold"><TableCell colSpan={2}>A. Cash Flow from Operating Activities</TableCell></TableRow>
                <TableRow><TableCell className="pl-8">Net Profit</TableCell><TableCell className="text-right font-mono">{fmt(cashFlow.netProfit)}</TableCell></TableRow>
                <TableRow className="bg-muted/20"><TableCell className="pl-6 font-medium" colSpan={2}>Adjustments for non-cash items:</TableCell></TableRow>
                <TableRow><TableCell className="pl-10">Depreciation & Amortization</TableCell><TableCell className="text-right font-mono">{fmt(cashFlow.depreciation)}</TableCell></TableRow>
                <TableRow className="bg-muted/20"><TableCell className="pl-6 font-medium" colSpan={2}>Changes in working capital:</TableCell></TableRow>
                <TableRow><TableCell className="pl-10">(Increase)/Decrease in Receivables</TableCell><TableCell className="text-right font-mono">{fmt(cashFlow.receivableChange)}</TableCell></TableRow>
                <TableRow><TableCell className="pl-10">Increase/(Decrease) in Payables</TableCell><TableCell className="text-right font-mono">{fmt(cashFlow.payableChange)}</TableCell></TableRow>
                <TableRow><TableCell className="pl-10">(Increase)/Decrease in Inventory</TableCell><TableCell className="text-right font-mono">{fmt(cashFlow.inventoryChange)}</TableCell></TableRow>
                <TableRow className="font-bold bg-green-50 dark:bg-green-950/20">
                  <TableCell>Net Cash from Operating Activities</TableCell>
                  <TableCell className="text-right font-mono">{fmt(cashFlow.operatingCashFlow)}</TableCell>
                </TableRow>

                {/* Investing Activities */}
                <TableRow className="bg-muted/50 font-bold"><TableCell colSpan={2}>B. Cash Flow from Investing Activities</TableCell></TableRow>
                <TableRow><TableCell className="pl-8">Capital Expenditure (Net)</TableCell><TableCell className="text-right font-mono">{fmt(cashFlow.investingCashFlow)}</TableCell></TableRow>
                <TableRow className="font-bold bg-blue-50 dark:bg-blue-950/20">
                  <TableCell>Net Cash from Investing Activities</TableCell>
                  <TableCell className="text-right font-mono">{fmt(cashFlow.investingCashFlow)}</TableCell>
                </TableRow>

                {/* Financing Activities */}
                <TableRow className="bg-muted/50 font-bold"><TableCell colSpan={2}>C. Cash Flow from Financing Activities</TableCell></TableRow>
                <TableRow><TableCell className="pl-8">Changes in Long-term Liabilities & Equity</TableCell><TableCell className="text-right font-mono">{fmt(cashFlow.financingCashFlow)}</TableCell></TableRow>
                <TableRow className="font-bold bg-purple-50 dark:bg-purple-950/20">
                  <TableCell>Net Cash from Financing Activities</TableCell>
                  <TableCell className="text-right font-mono">{fmt(cashFlow.financingCashFlow)}</TableCell>
                </TableRow>

                {/* Net Change */}
                <TableRow className={`font-bold text-lg ${cashFlow.netCashFlow >= 0 ? "bg-green-100 dark:bg-green-950/30" : "bg-red-100 dark:bg-red-950/30"}`}>
                  <TableCell>Net Change in Cash (A+B+C)</TableCell>
                  <TableCell className="text-right font-mono">{fmt(cashFlow.netCashFlow)}</TableCell>
                </TableRow>

                <TableRow className="font-bold">
                  <TableCell>Cash Position (from cash accounts)</TableCell>
                  <TableCell className="text-right font-mono">{fmt(cashFlow.cashPosition)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </ERPLayout>
  );
}
