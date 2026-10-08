import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import * as XLSX from "xlsx";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, Link2, Scale } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { fmtRs } from "@/lib/tripFuel";
import {
  PRESETS, STATUS_LABEL, applyPreset, differenceText, groupReconciliation, reconSummary, useReconciliation, type ReconStatus,
} from "@/lib/expenseLinks";

const STATUS_VARIANT: Record<ReconStatus, "success" | "warning" | "secondary"> = { matched: "success", warning: "warning", no_link: "secondary" };

const monthLabel = (m: string) => format(new Date(`${m.slice(0, 7)}-01T00:00:00`), "MMM yyyy");
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtRs(Math.abs(n))}`;

/**
 * Accounting: for every linked expense account and month, what the operational
 * records (petty cash entries, paid trip fuel vouchers) say was spent against the
 * net debit in the ledger. A difference beyond the link's tolerance is a warning.
 */
export default function ExpenseReconciliationPage() {
  const [preset, setPreset] = useState("this_year");
  const [range, setRange] = useState(() => applyPreset("this_year"));
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const { data: rows = [], isLoading, error } = useReconciliation(range.from, range.to);
  const groups = useMemo(() => groupReconciliation(rows), [rows]);
  const summary = useMemo(() => reconSummary(rows), [rows]);

  const linked = groups.filter((g) => g.kind === "linked");
  const unlinked = groups.filter((g) => g.kind === "unlinked");
  const shown = onlyIssues ? linked.filter((g) => g.status === "warning") : linked;

  const choose = (key: string) => {
    setPreset(key);
    if (key !== "custom") setRange(applyPreset(key));
  };
  const toggle = (key: string) => setOpen((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const exportXlsx = () => {
    const data = rows.map((r) => ({
      Status: STATUS_LABEL[r.status],
      "Expense account": r.expense_account_code ? `${r.expense_account_code} ${r.expense_account_name}` : "Not linked",
      "Funding account": r.funding_account_code ?? "",
      Sources: r.source_labels.join(", "),
      Month: monthLabel(r.month),
      "Source amount": r.source_amount,
      "Source entries": r.source_count,
      "Ledger amount": r.gl_amount ?? "",
      "Ledger lines": r.gl_amount == null ? "" : r.gl_count,
      Difference: r.difference ?? "",
      Tolerance: r.tolerance ?? "",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Reconciliation");
    XLSX.writeFile(wb, `expense-reconciliation-${range.from}-to-${range.to}.xlsx`);
  };

  return (
    <ERPLayout>
      <div className="w-full max-w-full space-y-4">
        <PageHeader
          title="Expense Reconciliation"
          description="Petty cash and staff trip fuel set against the ledger accounts they are linked to."
          icon={Scale}
          iconColor="bg-indigo-600 text-white"
        >
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild><Link to="/accounting/expense-links"><Link2 className="h-4 w-4 mr-1" /> Account links</Link></Button>
            <Button variant="outline" size="sm" disabled={!rows.length} onClick={exportXlsx}><Download className="h-4 w-4 mr-1" /> Excel</Button>
          </div>
        </PageHeader>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Period</div>
            <Select value={preset} onValueChange={choose}>
              <SelectTrigger className="w-[160px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{PRESETS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">From</div>
            <Input type="date" className="h-9 w-40" value={range.from} onChange={(e) => { setPreset("custom"); setRange((r) => ({ ...r, from: e.target.value })); }} />
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">To</div>
            <Input type="date" className="h-9 w-40" value={range.to} onChange={(e) => { setPreset("custom"); setRange((r) => ({ ...r, to: e.target.value })); }} />
          </div>
          <label className="flex items-center gap-2 text-sm h-9 cursor-pointer">
            <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Show differences only
          </label>
        </div>

        {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">Could not load the reconciliation: {(error as { message?: string }).message}</div>}

        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <MetricCard title="Linked accounts" value={String(linked.length)} icon={Link2} description="compared in this period" />
          <MetricCard title="Months with a difference" value={String(summary.warnings)} icon={AlertTriangle} description="beyond tolerance" />
          <MetricCard title="Months matched" value={String(summary.matched)} icon={CheckCircle2} description="within tolerance" />
          <MetricCard title="Sources not linked" value={String(summary.unlinked)} icon={Link2} description="have amounts but no account" />
        </div>

        {summary.warnings > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <b>{summary.warnings} month{summary.warnings > 1 ? "s" : ""} where the ledger and the records do not agree.</b>{" "}
              Open an account below to see which months. A payment may not be posted yet, may be posted to another account, or may be posted twice.
              If the difference is only because the ledger holds older postings, set a compare-from date on the account link.
            </div>
          </div>
        )}

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Linked accounts</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Expense account</TableHead>
                    <TableHead>Sources</TableHead>
                    <TableHead className="text-right">Records</TableHead>
                    <TableHead className="text-right">Ledger</TableHead>
                    <TableHead className="text-right">Difference</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : shown.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      {linked.length === 0 ? <>No account is linked yet. <Link className="underline" to="/accounting/expense-links">Set up the links</Link>.</> : "No differences in this period."}
                    </TableCell></TableRow>
                  ) : shown.map((g) => {
                    const isOpen = open.has(g.key);
                    return (
                      <Fragment key={g.key}>
                        <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => toggle(g.key)}>
                          <TableCell className="font-medium">
                            <span className="flex items-center gap-1">
                              {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                              {g.accountCode} · {g.accountName}
                            </span>
                            {g.fundingCode && <div className="text-[11px] text-muted-foreground ml-5">against {g.fundingCode}</div>}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-[320px]">{g.labels.join(", ")}</TableCell>
                          <TableCell className="text-right">{fmtRs(g.sourceAmount)}</TableCell>
                          <TableCell className="text-right">{fmtRs(g.glAmount)}</TableCell>
                          <TableCell className={cn("text-right font-medium", g.status === "warning" && "text-amber-700")}>{signed(g.difference)}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant={STATUS_VARIANT[g.status]}>{g.status === "warning" ? `${g.warningMonths} month${g.warningMonths > 1 ? "s" : ""} off` : STATUS_LABEL[g.status]}</Badge>
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={6} className="p-0">
                              <div className="px-6 py-3">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="h-8 text-xs">Month</TableHead>
                                      <TableHead className="h-8 text-xs text-right">Records</TableHead>
                                      <TableHead className="h-8 text-xs text-right">Ledger</TableHead>
                                      <TableHead className="h-8 text-xs text-right">Difference</TableHead>
                                      <TableHead className="h-8 text-xs">What it means</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {g.months.map((m) => (
                                      <TableRow key={m.month} className="text-xs">
                                        <TableCell className="py-1.5">{monthLabel(m.month)}</TableCell>
                                        <TableCell className="py-1.5 text-right">{fmtRs(m.source_amount)} <span className="text-muted-foreground">({m.source_count})</span></TableCell>
                                        <TableCell className="py-1.5 text-right">{fmtRs(m.gl_amount)} <span className="text-muted-foreground">({m.gl_count})</span></TableCell>
                                        <TableCell className={cn("py-1.5 text-right", m.status === "warning" && "text-amber-700 font-medium")}>{signed(m.difference ?? 0)}</TableCell>
                                        <TableCell className="py-1.5 text-muted-foreground">{m.status === "matched" ? "Matched" : differenceText(m.difference, m.tolerance)}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {unlinked.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Not linked to any account</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Entries</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unlinked.map((g) => (
                    <TableRow key={g.key}>
                      <TableCell className="font-medium">{g.labels.join(", ")}</TableCell>
                      <TableCell className="text-right">{g.months.reduce((s, m) => s + m.source_count, 0)}</TableCell>
                      <TableCell className="text-right">{fmtRs(g.sourceAmount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="p-3 text-xs text-muted-foreground border-t">
                These have amounts in the period but no ledger account to compare against. <Link className="underline" to="/accounting/expense-links">Link them</Link> to include them in the check.
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-muted-foreground">
          Records: petty cash expenses that are not rejected (by entry date) and approved trip fuel vouchers (by approval date). Ledger: net debit on the expense account in
          vouchers that also touch the funding account. Differences within the tolerance of the link are treated as matched.
        </p>
      </div>
    </ERPLayout>
  );
}
