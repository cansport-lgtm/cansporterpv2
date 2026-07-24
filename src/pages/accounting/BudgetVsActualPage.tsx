import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Download, Settings2, AlertTriangle, Target, TrendingUp, TrendingDown } from "lucide-react";
import * as XLSX from "xlsx";
import { cn } from "@/lib/utils";
import {
  BudgetHeader,
  BudgetPeriod,
  actualKey,
  budgetMonths,
  fetchMonthlyLedgerTotals,
  monthLabel,
  monthLabelLong,
  periodEndDate,
  periodKey,
  periodStartDate,
  signedActual,
} from "@/lib/accounting/budgetActuals";

const sb = supabase as any;

interface ReportRow {
  id: string;
  code: string;
  name: string;
  account_type: "revenue" | "expense";
  sub_category: string | null;
  budget: number;
  actual: number;
  variance: number; // positive = favorable
  pct: number | null; // actual/budget %, null when no budget
}

const fmt = (n: number) => `Rs. ${Math.round(n).toLocaleString()}`;

const utilizationBar = (pct: number | null) => {
  if (pct === null) return <span className="text-xs text-muted-foreground">no budget</span>;
  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      <Progress
        value={Math.min(Math.max(pct, 0), 100)}
        className={cn(
          "h-2 flex-1",
          pct > 100 ? "[&>div]:bg-destructive" : pct >= 85 ? "[&>div]:bg-warning" : "[&>div]:bg-success",
        )}
      />
      <span className="text-xs w-12 text-right">{Math.round(pct)}%</span>
    </div>
  );
};

const statusBadge = (row: ReportRow) => {
  if (row.pct === null) return <Badge variant="outline">Unbudgeted</Badge>;
  if (row.account_type === "revenue") {
    return row.pct >= 100
      ? <Badge className="bg-green-500/10 text-green-600 border-green-500/20">Ahead</Badge>
      : <Badge variant="secondary">Behind</Badge>;
  }
  if (row.pct > 100) return <Badge variant="destructive">Over Budget</Badge>;
  if (row.pct >= 85) return <Badge variant="secondary">Watch</Badge>;
  return <Badge className="bg-green-500/10 text-green-600 border-green-500/20">On Track</Badge>;
};

export default function BudgetVsActualPage() {
  const [budgetId, setBudgetId] = useState("");
  const [viewMode, setViewMode] = useState<"month" | "ytd" | "year">("month");
  const [monthIdx, setMonthIdx] = useState(0);

  const { data: budgets = [] } = useQuery({
    queryKey: ["acc-budgets"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_budgets")
        .select("*")
        .order("start_year", { ascending: false })
        .order("start_month", { ascending: false });
      if (error) throw error;
      return (data || []) as BudgetHeader[];
    },
  });

  const budget = budgets.find((b) => b.id === budgetId) || null;
  const months = useMemo<BudgetPeriod[]>(() => (budget ? budgetMonths(budget) : []), [budget]);

  useEffect(() => {
    if (!budgetId && budgets.length) {
      setBudgetId((budgets.find((b) => b.status === "active") || budgets[0]).id);
    }
  }, [budgets, budgetId]);

  // Default the month selector to the current month when it falls inside the
  // budget, otherwise to the last budget month.
  useEffect(() => {
    if (!months.length) return;
    const nowKey = periodKey({ year: new Date().getFullYear(), month: new Date().getMonth() + 1 });
    const idx = months.findIndex((p) => periodKey(p) === nowKey);
    setMonthIdx(idx >= 0 ? idx : months.length - 1);
  }, [budgetId, months.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedMonths = useMemo<BudgetPeriod[]>(() => {
    if (!months.length) return [];
    if (viewMode === "year") return months;
    if (viewMode === "ytd") return months.slice(0, monthIdx + 1);
    return [months[monthIdx]];
  }, [months, viewMode, monthIdx]);

  const { data: accounts = [] } = useQuery({
    queryKey: ["acc-budget-accounts"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_chart_of_accounts")
        .select("id, code, name, account_type, sub_category")
        .eq("is_active", true)
        .not("sub_category", "is", null)
        .in("account_type", ["revenue", "expense"])
        .order("code");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: lines = [] } = useQuery({
    queryKey: ["acc-budget-lines", budgetId],
    enabled: !!budgetId,
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_budget_lines")
        .select("account_id, period_year, period_month, amount")
        .eq("budget_id", budgetId);
      if (error) throw error;
      return data || [];
    },
  });

  const rangeFrom = selectedMonths.length ? periodStartDate(selectedMonths[0]) : "";
  const rangeTo = selectedMonths.length ? periodEndDate(selectedMonths[selectedMonths.length - 1]) : "";

  const { data: ledger } = useQuery({
    queryKey: ["acc-budget-actuals", rangeFrom, rangeTo],
    enabled: !!rangeFrom,
    queryFn: () => fetchMonthlyLedgerTotals(rangeFrom, rangeTo),
  });

  const rows = useMemo<ReportRow[]>(() => {
    if (!accounts.length || !selectedMonths.length) return [];
    const selectedKeys = new Set(selectedMonths.map(periodKey));
    const budgetByAccount = new Map<string, number>();
    lines.forEach((l: any) => {
      if (!selectedKeys.has(periodKey({ year: l.period_year, month: l.period_month }))) return;
      budgetByAccount.set(l.account_id, (budgetByAccount.get(l.account_id) || 0) + Number(l.amount || 0));
    });
    return accounts
      .map((a: any): ReportRow => {
        const budgetAmt = budgetByAccount.get(a.id) || 0;
        let actual = 0;
        selectedMonths.forEach((p) => {
          const t = ledger?.get(actualKey(a.id, p));
          if (t) actual += signedActual(a.account_type, t.dr, t.cr);
        });
        // Favorable: revenue above budget, expense below budget.
        const variance = a.account_type === "revenue" ? actual - budgetAmt : budgetAmt - actual;
        return {
          id: a.id,
          code: a.code,
          name: a.name,
          account_type: a.account_type,
          sub_category: a.sub_category,
          budget: budgetAmt,
          actual,
          variance,
          pct: budgetAmt > 0 ? (actual / budgetAmt) * 100 : null,
        };
      })
      .filter((r) => r.budget !== 0 || Math.abs(r.actual) >= 0.01);
  }, [accounts, lines, ledger, selectedMonths]);

  const revenueRows = rows.filter((r) => r.account_type === "revenue");
  const expenseRows = rows.filter((r) => r.account_type === "expense");

  const expenseGroups = useMemo(() => {
    const groups = new Map<string, ReportRow[]>();
    expenseRows.forEach((r) => {
      const key = r.sub_category || "Other";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    });
    return Array.from(groups.entries());
  }, [expenseRows]);

  const sum = (list: ReportRow[], f: (r: ReportRow) => number) => list.reduce((s, r) => s + f(r), 0);
  const totalRevBudget = sum(revenueRows, (r) => r.budget);
  const totalRevActual = sum(revenueRows, (r) => r.actual);
  const totalExpBudget = sum(expenseRows, (r) => r.budget);
  const totalExpActual = sum(expenseRows, (r) => r.actual);
  const overBudget = expenseRows.filter((r) => r.pct !== null && r.pct > 100);

  const periodLabel = !selectedMonths.length
    ? ""
    : viewMode === "month"
      ? monthLabelLong(selectedMonths[0])
      : `${monthLabel(selectedMonths[0])} – ${monthLabel(selectedMonths[selectedMonths.length - 1])}`;

  const handleExport = () => {
    if (!budget) return;
    const data = rows.map((r) => ({
      Code: r.code,
      Account: r.name,
      Type: r.account_type,
      "Sub-category": r.sub_category || "",
      Budget: r.budget,
      Actual: r.actual,
      Variance: r.variance,
      "Utilization %": r.pct === null ? "" : Math.round(r.pct),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Budget vs Actual");
    XLSX.writeFile(wb, `Budget_vs_Actual_${budget.fiscal_year_label}_${viewMode}.xlsx`);
  };

  const detailRow = (r: ReportRow) => (
    <TableRow key={r.id}>
      <TableCell>
        <span className="font-mono text-xs text-muted-foreground mr-2">{r.code}</span>
        <Link to={`/accounting/general-ledger?account=${r.id}`} className="text-sm hover:text-primary hover:underline">
          {r.name}
        </Link>
      </TableCell>
      <TableCell className="text-right text-xs">{r.budget ? fmt(r.budget) : "—"}</TableCell>
      <TableCell className="text-right text-xs">{fmt(r.actual)}</TableCell>
      <TableCell className={cn("text-right text-xs font-medium", r.variance > 0 ? "text-green-600" : r.variance < 0 ? "text-destructive" : "")}>
        {r.variance < 0 ? `(${Math.round(Math.abs(r.variance)).toLocaleString()})` : Math.round(r.variance).toLocaleString()}
      </TableCell>
      <TableCell>{utilizationBar(r.pct)}</TableCell>
      <TableCell>{statusBadge(r)}</TableCell>
    </TableRow>
  );

  const groupHeader = (title: string) => (
    <TableRow className="bg-muted/60">
      <TableCell colSpan={6} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground py-2">{title}</TableCell>
    </TableRow>
  );

  const subtotalRow = (title: string, list: ReportRow[]) => {
    const b = sum(list, (r) => r.budget);
    const a = sum(list, (r) => r.actual);
    const v = sum(list, (r) => r.variance);
    const pct = b > 0 ? (a / b) * 100 : null;
    return (
      <TableRow className="bg-muted/30 font-semibold">
        <TableCell className="text-xs">{title}</TableCell>
        <TableCell className="text-right text-xs">{fmt(b)}</TableCell>
        <TableCell className="text-right text-xs">{fmt(a)}</TableCell>
        <TableCell className={cn("text-right text-xs", v > 0 ? "text-green-600" : v < 0 ? "text-destructive" : "")}>
          {v < 0 ? `(${Math.round(Math.abs(v)).toLocaleString()})` : Math.round(v).toLocaleString()}
        </TableCell>
        <TableCell>{utilizationBar(pct)}</TableCell>
        <TableCell />
      </TableRow>
    );
  };

  const netBudget = totalRevBudget - totalExpBudget;
  const netActual = totalRevActual - totalExpActual;

  return (
    <ERPLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <PageHeader title="Budget vs Actual" description="Ledger actuals from posted vouchers vs the selected budget" />
          <div className="flex flex-wrap items-center gap-2">
            <Select value={budgetId} onValueChange={setBudgetId}>
              <SelectTrigger className="w-[230px]"><SelectValue placeholder="Select budget" /></SelectTrigger>
              <SelectContent>
                {budgets.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name} ({b.status})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={viewMode} onValueChange={(v) => setViewMode(v as any)}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="month">Single Month</SelectItem>
                <SelectItem value="ytd">Year to Date</SelectItem>
                <SelectItem value="year">Full Year</SelectItem>
              </SelectContent>
            </Select>
            {viewMode !== "year" && (
              <Select value={String(monthIdx)} onValueChange={(v) => setMonthIdx(parseInt(v))}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {months.map((p, i) => (
                    <SelectItem key={periodKey(p)} value={String(i)}>{monthLabelLong(p)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button size="sm" variant="outline" onClick={handleExport}><Download className="h-4 w-4 mr-1" />Export</Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/accounting/budgets"><Settings2 className="h-4 w-4 mr-1" />Manage Budgets</Link>
            </Button>
          </div>
        </div>

        {!budget ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground text-sm">
              No budgets found — <Link to="/accounting/budgets" className="text-primary hover:underline">create one first</Link>.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />Revenue — {periodLabel}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{fmt(totalRevActual)}</p>
                  <p className="text-xs text-muted-foreground">
                    Budget {fmt(totalRevBudget)}{totalRevBudget > 0 && <> · {Math.round((totalRevActual / totalRevBudget) * 100)}% achieved</>}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <TrendingDown className="h-4 w-4" />Expenses — {periodLabel}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{fmt(totalExpActual)}</p>
                  <p className="text-xs text-muted-foreground">
                    Budget {fmt(totalExpBudget)}{totalExpBudget > 0 && <> · {Math.round((totalExpActual / totalExpBudget) * 100)}% utilized</>}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <Target className="h-4 w-4" />Net vs Budget
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{fmt(netActual)}</p>
                  <p className="text-xs text-muted-foreground">
                    Budgeted net {fmt(netBudget)} ·{" "}
                    <span className={netActual >= netBudget ? "text-green-600" : "text-destructive"}>
                      {netActual >= netBudget ? "ahead by" : "behind by"} {fmt(Math.abs(netActual - netBudget))}
                    </span>
                  </p>
                </CardContent>
              </Card>
              <Card className={overBudget.length ? "border-destructive" : ""}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-destructive" />Over Budget
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{overBudget.length}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {overBudget.slice(0, 3).map((r) => r.name).join(" · ") || "All expense heads within budget"}
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex flex-wrap items-center justify-between gap-2">
                  <span>{budget.name} — {periodLabel}</span>
                  <span className="flex items-center gap-3 text-xs font-normal text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-success inline-block" />On track ≤ 85%</span>
                    <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-warning inline-block" />Watch 85–100%</span>
                    <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-destructive inline-block" />Over 100%</span>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[240px]">Account</TableHead>
                        <TableHead className="text-right">Budget</TableHead>
                        <TableHead className="text-right">Actual</TableHead>
                        <TableHead className="text-right">Variance</TableHead>
                        <TableHead className="w-[200px]">Utilization</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {!rows.length && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                            No budget lines or ledger activity for this period
                          </TableCell>
                        </TableRow>
                      )}
                      {revenueRows.length > 0 && (
                        <>
                          {groupHeader("Revenue (variance favorable when actual > budget)")}
                          {revenueRows.map(detailRow)}
                          {subtotalRow("Total Revenue", revenueRows)}
                        </>
                      )}
                      {expenseGroups.map(([group, list]) => (
                        <React.Fragment key={group}>
                          {groupHeader(group)}
                          {list.map(detailRow)}
                        </React.Fragment>
                      ))}
                      {expenseRows.length > 0 && subtotalRow("Total Expenses", expenseRows)}
                      {rows.length > 0 && (
                        <TableRow className="bg-primary/5 font-bold border-t-2">
                          <TableCell>Net (Revenue − Expenses)</TableCell>
                          <TableCell className="text-right">{fmt(netBudget)}</TableCell>
                          <TableCell className="text-right">{fmt(netActual)}</TableCell>
                          <TableCell className={cn("text-right", netActual - netBudget >= 0 ? "text-green-600" : "text-destructive")}>
                            {netActual - netBudget < 0
                              ? `(${Math.round(Math.abs(netActual - netBudget)).toLocaleString()})`
                              : Math.round(netActual - netBudget).toLocaleString()}
                          </TableCell>
                          <TableCell colSpan={2} className="text-xs font-medium text-muted-foreground">
                            {netBudget > 0 ? `${Math.round((netActual / netBudget) * 100)}% of budgeted net achieved` : ""}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  Account names link to the General Ledger for that account. Actuals aggregate all voucher lines in the
                  period, matching the Trial Balance. Revenue utilization reads as “% achieved”.
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </ERPLayout>
  );
}
