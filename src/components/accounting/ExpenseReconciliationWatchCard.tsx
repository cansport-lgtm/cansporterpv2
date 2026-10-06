import { useMemo } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { AlertTriangle, ArrowRight, CheckCircle2, Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { applyPreset, groupReconciliation, reconSummary, useExpenseLinks, useReconciliation } from "@/lib/expenseLinks";

/**
 * Accounting Dashboard card: linked expense accounts whose ledger and records
 * differ this year. Renders nothing until at least one link exists.
 */
export function ExpenseReconciliationWatchCard() {
  const { data: links = [] } = useExpenseLinks();
  const { from, to } = useMemo(() => applyPreset("ytd"), []);
  const { data: rows = [] } = useReconciliation(from, to, links.length > 0);

  const summary = useMemo(() => reconSummary(rows), [rows]);
  const offAccounts = useMemo(() => groupReconciliation(rows).filter((g) => g.kind === "linked" && g.status === "warning"), [rows]);

  if (links.length === 0) return null;

  return (
    <Card className={cn(offAccounts.length > 0 && "border-amber-300")}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Scale className="h-4 w-4" /> Expense reconciliation</span>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/accounting/expense-reconciliation">Open <ArrowRight className="h-3.5 w-3.5 ml-1" /></Link>
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {offAccounts.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> Ledger and records agree on every linked account, {format(new Date(`${from}T00:00:00`), "d MMM")} to today.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4" /> {offAccounts.length} account{offAccounts.length > 1 ? "s" : ""} with a difference this year.
            </div>
            <div className="divide-y">
              {offAccounts.slice(0, 5).map((g) => (
                <div key={g.key} className="flex items-center justify-between py-1.5 text-sm gap-2">
                  <span className="truncate">{g.accountCode} · {g.accountName}</span>
                  <Badge variant="warning">{g.warningMonths} month{g.warningMonths > 1 ? "s" : ""} off</Badge>
                </div>
              ))}
            </div>
          </>
        )}
        {summary.unlinked > 0 && (
          <div className="text-xs text-muted-foreground">
            {summary.unlinked} source{summary.unlinked > 1 ? "s have" : " has"} amounts but no linked account. <Link className="underline" to="/accounting/expense-links">Link</Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
