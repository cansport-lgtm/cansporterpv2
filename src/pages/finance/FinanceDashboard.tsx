import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, TrendingUp, Wallet } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend, PieChart, Pie, Cell } from "recharts";

const COLORS = ["hsl(var(--primary))", "hsl(var(--destructive))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];

export default function FinanceDashboard() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear.toString());

  // Fetch all periods for the selected year
  const { data: periods } = useQuery({
    queryKey: ["finance-periods", selectedYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("finance_periods")
        .select("*")
        .eq("year", parseInt(selectedYear))
        .order("month");
      if (error) throw error;
      return data;
    },
  });

  // Fetch all trial balance entries for the year's periods
  const { data: trialEntries } = useQuery({
    queryKey: ["finance-tb-entries-year", selectedYear, periods],
    queryFn: async () => {
      if (!periods?.length) return [];
      const periodIds = periods.map((p) => p.id);
      const { data, error } = await supabase
        .from("finance_trial_balance_entries")
        .select("*, account:finance_chart_of_accounts(*), period:finance_periods(*)")
        .in("period_id", periodIds);
      if (error) throw error;
      return data;
    },
    enabled: !!periods?.length,
  });

  // Calculate P&L metrics per month for trend
  const monthlyPnL = (periods || []).map((period) => {
    const periodEntries = (trialEntries || []).filter((e) => e.period_id === period.id);
    const revenue = periodEntries
      .filter((e: any) => e.account?.account_type === "revenue")
      .reduce((sum: number, e: any) => sum + Number(e.credit_amount || 0) - Number(e.debit_amount || 0), 0);
    const expenses = periodEntries
      .filter((e: any) => e.account?.account_type === "expense")
      .reduce((sum: number, e: any) => sum + Number(e.debit_amount || 0) - Number(e.credit_amount || 0), 0);
    const cogsEntries = periodEntries.filter(
      (e: any) => e.account?.account_type === "expense" && e.account?.sub_category?.toLowerCase()?.includes("cost of")
    );
    const cogs = cogsEntries.reduce((sum: number, e: any) => sum + Number(e.debit_amount || 0) - Number(e.credit_amount || 0), 0);
    const gp = revenue - cogs;
    const np = revenue - expenses;

    return {
      month: period.period_name?.substring(0, 3) || `M${period.month}`,
      revenue,
      expenses,
      grossProfit: gp,
      netProfit: np,
    };
  });

  const totalRevenue = monthlyPnL.reduce((s, m) => s + m.revenue, 0);
  const _totalExpenses = monthlyPnL.reduce((s, m) => s + m.expenses, 0);
  const totalNetProfit = monthlyPnL.reduce((s, m) => s + m.netProfit, 0);
  const totalGrossProfit = monthlyPnL.reduce((s, m) => s + m.grossProfit, 0);

  // Latest period balance sheet summary
  const latestPeriod = periods?.[periods.length - 1];
  const latestEntries = (trialEntries || []).filter((e) => e.period_id === latestPeriod?.id);
  const totalAssets = latestEntries
    .filter((e: any) => e.account?.account_type === "asset")
    .reduce((s: number, e: any) => s + Number(e.debit_amount || 0) - Number(e.credit_amount || 0), 0);
  const totalLiabilities = latestEntries
    .filter((e: any) => e.account?.account_type === "liability")
    .reduce((s: number, e: any) => s + Number(e.credit_amount || 0) - Number(e.debit_amount || 0), 0);
  const totalEquity = latestEntries
    .filter((e: any) => e.account?.account_type === "equity")
    .reduce((s: number, e: any) => s + Number(e.credit_amount || 0) - Number(e.debit_amount || 0), 0);

  // Expense breakdown by sub_category for pie chart
  const expenseByCategory: Record<string, number> = {};
  (trialEntries || [])
    .filter((e: any) => e.account?.account_type === "expense")
    .forEach((e: any) => {
      const cat = e.account?.sub_category || "Other";
      expenseByCategory[cat] = (expenseByCategory[cat] || 0) + Number(e.debit_amount || 0) - Number(e.credit_amount || 0);
    });
  const expensePieData = Object.entries(expenseByCategory).map(([name, value]) => ({ name, value }));

  const formatCurrency = (val: number) => `Rs. ${val.toLocaleString("en-PK", { minimumFractionDigits: 0 })}`;

  return (
    <ERPLayout>
      <PageHeader title="Finance Reports" description="Financial overview and reporting dashboard">
        <Select value={selectedYear} onValueChange={setSelectedYear}>
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[currentYear, currentYear - 1, currentYear - 2].map((y) => (
              <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PageHeader>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard title="Total Revenue" value={formatCurrency(totalRevenue)} icon={DollarSign} />
        <MetricCard title="Gross Profit" value={formatCurrency(totalGrossProfit)} icon={TrendingUp} />
        <MetricCard title="Net Profit" value={formatCurrency(totalNetProfit)} icon={TrendingUp} />
        <MetricCard title="Total Assets" value={formatCurrency(totalAssets)} icon={Wallet} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Profit Trend */}
        <Card>
          <CardHeader><CardTitle className="text-base">Profit Trend</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyPnL}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                <Legend />
                <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" name="Revenue" strokeWidth={2} />
                <Line type="monotone" dataKey="grossProfit" stroke="hsl(var(--chart-3))" name="Gross Profit" strokeWidth={2} />
                <Line type="monotone" dataKey="netProfit" stroke="hsl(var(--chart-5))" name="Net Profit" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Revenue vs Expenses */}
        <Card>
          <CardHeader><CardTitle className="text-base">Revenue vs Expenses</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyPnL}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                <Legend />
                <Bar dataKey="revenue" fill="hsl(var(--primary))" name="Revenue" />
                <Bar dataKey="expenses" fill="hsl(var(--destructive))" name="Expenses" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Balance Sheet Summary */}
        <Card>
          <CardHeader><CardTitle className="text-base">Balance Sheet Summary</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
                <span className="text-sm font-medium">Total Assets</span>
                <span className="font-bold text-primary">{formatCurrency(totalAssets)}</span>
              </div>
              <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
                <span className="text-sm font-medium">Total Liabilities</span>
                <span className="font-bold text-destructive">{formatCurrency(totalLiabilities)}</span>
              </div>
              <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
                <span className="text-sm font-medium">Total Equity</span>
                <span className="font-bold">{formatCurrency(totalEquity)}</span>
              </div>
              <div className="border-t pt-3 flex justify-between items-center">
                <span className="text-sm font-medium">L + E</span>
                <span className="font-bold">{formatCurrency(totalLiabilities + totalEquity)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Expense Breakdown */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Expense Breakdown</CardTitle></CardHeader>
          <CardContent className="h-64">
            {expensePieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={expensePieData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {expensePieData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">No expense data available</div>
            )}
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
