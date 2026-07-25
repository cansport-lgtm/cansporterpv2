import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ArrowRight, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BudgetHeader,
  actualKey,
  budgetMonths,
  fetchMonthlyLedgerTotals,
  monthLabelLong,
  periodEndDate,
  periodKey,
  periodStartDate,
  signedActual,
} from "@/lib/accounting/budgetActuals";

const sb = supabase as any;

/**
 * "Budget Watch" card for the Accounting Dashboard: current-month expense
 * utilization against the active budget, plus the heads closest to (or over)
 * their monthly budget. Renders nothing when no active budget covers today.
 */
export function BudgetWatchCard() {
  const now = new Date();
  const currentPeriod = { year: now.getFullYear(), month: now.getMonth() + 1 };
  const currentKey = periodKey(currentPeriod);

  const { data: activeBudget } = useQuery({
    queryKey: ["acc-budget-watch-header"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_budgets")
        .select("*")
        .eq("status", "active")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const list = (data || []) as BudgetHeader[];
      return list.find((b) => budgetMonths(b).some((p) => periodKey(p) === currentKey)) || null;
    },
  });

  const { data: lines = [] } = useQuery({
    queryKey: ["acc-budget-watch-lines", activeBudget?.id, currentKey],
    enabled: !!activeBudget,
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_budget_lines")
        .select("account_id, amount, account:accounting_chart_of_accounts(id, code, name, account_type)")
        .eq("budget_id", activeBudget!.id)
        .eq("period_year", currentPeriod.year)
        .eq("period_month", currentPeriod.month)
        .gt("amount", 0);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: ledger } = useQuery({
    queryKey: ["acc-budget-watch-actuals", currentKey],
    enabled: !!activeBudget,
    queryFn: () => fetchMonthlyLedgerTotals(periodStartDate(currentPeriod), periodEndDate(currentPeriod)),
  });

  const { expenseTotals, attention } = useMemo(() => {
    const expenseLines = lines.filter((l: any) => l.account?.account_type === "expense");
    const withActual = expenseLines.map((l: any) => {
      const t = ledger?.get(actualKey(l.account_id, currentPeriod));
      const actual = t ? signedActual("expense", t.dr, t.cr) : 0;
      const budget = Number(l.amount);
      return { ...l, actual, budget, pct: (actual / budget) * 100 };
    });
    const totalBudget = withActual.reduce((s: number, l: any) => s + l.budget, 0);
    const totalActual = withActual.reduce((s: number, l: any) => s + l.actual, 0);
    return {
      expenseTotals: { budget: totalBudget, actual: totalActual, pct: totalBudget > 0 ? (totalActual / totalBudget) * 100 : 0 },
      attention: withActual.filter((l: any) => l.pct >= 85).sort((a: any, b: any) => b.pct - a.pct).slice(0, 4),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, ledger]);

  if (!activeBudget || !lines.length) return null;

  const overCount = attention.filter((l: any) => l.pct > 100).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            Budget Watch — {monthLabelLong(currentPeriod)}
          </span>
          {overCount > 0 && <Badge variant="destructive">{overCount} over budget</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-xs text-muted-foreground mb-1">Overall expense utilization ({activeBudget.name})</div>
        <div className="flex items-center gap-2 mb-4">
          <Progress
            value={Math.min(expenseTotals.pct, 100)}
            className={cn(
              "h-2.5 flex-1",
              expenseTotals.pct > 100 ? "[&>div]:bg-destructive" : expenseTotals.pct >= 85 ? "[&>div]:bg-warning" : "[&>div]:bg-success",
            )}
          />
          <span className="text-xs font-semibold w-24 text-right">
            {Math.round(expenseTotals.pct)}% of Rs. {Math.round(expenseTotals.budget).toLocaleString()}
          </span>
        </div>
        {attention.length > 0 ? (
          <div className="space-y-2 mb-3">
            {attention.map((l: any) => (
              <div key={l.account_id} className="flex items-center gap-2 text-xs">
                <Badge variant={l.pct > 100 ? "destructive" : "secondary"} className="w-14 justify-center shrink-0">
                  {Math.round(l.pct)}%
                </Badge>
                <span className="flex-1 truncate">
                  <span className="font-mono text-muted-foreground mr-1">{l.account?.code}</span>
                  {l.account?.name}
                </span>
                <span className={cn("shrink-0", l.pct > 100 ? "text-destructive" : "text-muted-foreground")}>
                  {l.pct > 100
                    ? `Rs. ${Math.round(l.actual - l.budget).toLocaleString()} over`
                    : `Rs. ${Math.round(l.budget - l.actual).toLocaleString()} left`}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground mb-3">All budgeted expense heads are under 85% for this month.</p>
        )}
        <Button size="sm" variant="outline" asChild>
          <Link to="/accounting/budget-vs-actual">
            Open Budget vs Actual <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
