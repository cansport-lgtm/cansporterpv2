import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/accounting/fetchAllRows";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { HiddenFigures } from "@/components/shared/HiddenFigures";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Download, CheckCircle, AlertTriangle, Briefcase, TrendingUp, ArrowLeftRight } from "lucide-react";
import { format } from "date-fns";
import * as XLSX from "xlsx";

const sb = supabase as any;

// Default to the July–June fiscal year containing today (same cycle the Budgets module uses).
function currentFiscalYear() {
  const today = new Date();
  const startYear = today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
  return { from: `${startYear}-07-01`, to: `${startYear + 1}-06-30` };
}

type AccountTotals = Record<string, { dr: number; cr: number }>;

function sumByAccount(lines: any[]): AccountTotals {
  const totals: AccountTotals = {};
  (lines || []).forEach((l: any) => {
    if (!totals[l.account_id]) totals[l.account_id] = { dr: 0, cr: 0 };
    totals[l.account_id].dr += Number(l.debit_amount || 0);
    totals[l.account_id].cr += Number(l.credit_amount || 0);
  });
  return totals;
}

// Negative amounts render accounting-style: (1,234)
function fmt(n: number) {
  const r = Math.round(n * 100) / 100;
  if (r < 0) return `(${Math.abs(r).toLocaleString()})`;
  return r.toLocaleString();
}

export default function EquityChangesPage() {
  const fy = currentFiscalYear();
  const [fromDate, setFromDate] = useState(fy.from);
  const [toDate, setToDate] = useState(fy.to);

  const { data: accounts } = useQuery({
    queryKey: ["acc-eq-accounts"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_chart_of_accounts")
        .select("id, code, name, account_type, sub_category")
        .eq("is_active", true)
        .not("sub_category", "is", null)
        .order("account_type")
        .order("sort_order")
        .order("code");
      if (error) throw error;
      return data || [];
    },
  });

  // Everything posted before the period → opening balances (incl. accumulated prior-year P&L).
  const { data: openLines } = useQuery({
    queryKey: ["acc-eq-open-lines", fromDate],
    queryFn: async () => {
      const data = await fetchAllRows((from, to) =>
        sb
          .from("accounting_voucher_lines")
          .select("account_id, debit_amount, credit_amount, voucher:accounting_vouchers!inner(voucher_date)")
          .lt("voucher.voucher_date", fromDate)
          .order("id", { ascending: true })
          .range(from, to));
      return data;
    },
  });

  // Postings within the period → the movements.
  const { data: periodLines } = useQuery({
    queryKey: ["acc-eq-period-lines", fromDate, toDate],
    queryFn: async () => {
      const data = await fetchAllRows((from, to) =>
        sb
          .from("accounting_voucher_lines")
          .select("account_id, debit_amount, credit_amount, voucher:accounting_vouchers!inner(voucher_date)")
          .gte("voucher.voucher_date", fromDate)
          .lte("voucher.voucher_date", toDate)
          .order("id", { ascending: true })
          .range(from, to));
      return data;
    },
  });

  const computed = useMemo(() => {
    const open = sumByAccount(openLines || []);
    const period = sumByAccount(periodLines || []);

    const profitOf = (totals: AccountTotals) => {
      let revenue = 0;
      let expense = 0;
      (accounts || []).forEach((a: any) => {
        const t = totals[a.id];
        if (!t) return;
        if (a.account_type === "revenue") revenue += t.cr - t.dr;
        if (a.account_type === "expense") expense += t.dr - t.cr;
      });
      return revenue - expense;
    };
    const openingPL = profitOf(open);   // prior earnings still sitting in P&L accounts (not yet closed to 3010)
    const periodProfit = profitOf(period);

    const netCr = (totals: AccountTotals, id: string) => {
      const t = totals[id];
      return t ? t.cr - t.dr : 0;
    };

    const equityAccounts = (accounts || []).filter((a: any) => a.account_type === "equity");
    const reAccounts = equityAccounts.filter((a: any) => a.sub_category === "Retained Earnings");
    const otherAccounts = equityAccounts.filter((a: any) => a.sub_category !== "Retained Earnings");

    // One column per non-RE equity account (Capital, Drawings, ...); hide fully-empty ones.
    const accountColumns = otherAccounts
      .map((a: any) => {
        const opening = netCr(open, a.id);
        const credits = period[a.id]?.cr || 0;
        const debits = period[a.id]?.dr || 0;
        return { ...a, opening, credits, debits, closing: opening + credits - debits };
      })
      .filter((c: any) => c.opening !== 0 || c.credits !== 0 || c.debits !== 0);

    // All Retained Earnings accounts merge into one column; it also carries the P&L.
    const reOpening = reAccounts.reduce((s: number, a: any) => s + netCr(open, a.id), 0) + openingPL;
    const reAdjustments = reAccounts.reduce((s: number, a: any) => s + netCr(period, a.id), 0);
    const reClosing = reOpening + reAdjustments + periodProfit;

    const openingTotal = accountColumns.reduce((s: number, c: any) => s + c.opening, 0) + reOpening;
    const creditsTotal = accountColumns.reduce((s: number, c: any) => s + c.credits, 0);
    const debitsTotal = accountColumns.reduce((s: number, c: any) => s + c.debits, 0);
    const closingTotal = accountColumns.reduce((s: number, c: any) => s + c.closing, 0) + reClosing;

    // Independent cross-check computed the way the Balance Sheet does it:
    // equity account balances as of To + all revenue − expense posted up to To.
    const bsEquity =
      equityAccounts.reduce((s: number, a: any) => s + netCr(open, a.id) + netCr(period, a.id), 0) +
      openingPL + periodProfit;
    const diff = closingTotal - bsEquity;
    const matched = Math.abs(diff) < 0.01;

    return {
      accountColumns, reAccounts, reOpening, reAdjustments, reClosing, periodProfit,
      openingTotal, creditsTotal, debitsTotal, closingTotal, bsEquity, diff, matched,
    };
  }, [accounts, openLines, periodLines]);

  const handleExport = () => {
    const cols = computed.accountColumns;
    const row = (label: string, per: (c: any) => number | string, re: number | string, total: number | string) => {
      const r: Record<string, any> = { Movement: label };
      cols.forEach((c: any) => { r[`${c.name} (${c.code})`] = per(c); });
      r["Retained Earnings"] = re;
      r["Total Equity"] = total;
      return r;
    };
    const data = [
      row("Opening balance", (c) => c.opening, computed.reOpening, computed.openingTotal),
      row("Capital introduced", (c) => c.credits || "", "", computed.creditsTotal),
      row("Owner drawings", (c) => (c.debits ? -c.debits : ""), "", -computed.debitsTotal),
      row("Net profit / (loss) for the period", () => "", computed.periodProfit, computed.periodProfit),
      row("Other adjustments", () => "", computed.reAdjustments || "", computed.reAdjustments || ""),
      row("Closing balance", (c) => c.closing, computed.reClosing, computed.closingTotal),
    ];
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Changes in Equity");
    XLSX.writeFile(wb, `Changes_in_Equity_${fromDate}_to_${toDate}.xlsx`);
  };

  const netContributions = computed.creditsTotal - computed.debitsTotal;
  const colCount = computed.accountColumns.length + 3; // label + account cols + RE + Total

  return (
    <ERPLayout>
      <PageHeader title="Statement of Changes in Equity" description="Opening equity, movements during the period, and closing equity by component">
        <div className="flex gap-2 items-center">
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-[160px]" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-[160px]" />
          <Button size="sm" variant="outline" onClick={handleExport}><Download className="h-4 w-4 mr-1" />Export</Button>
        </div>
      </PageHeader>

      <HiddenFigures>
      <div className="grid grid-cols-4 gap-4 mb-4">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Briefcase className="h-3 w-3" />Opening Equity</div>
          <div className="text-2xl font-semibold">Rs. {fmt(computed.openingTotal)}</div>
          <div className="text-xs text-muted-foreground mt-1">As at day before {fromDate}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3" />Net Profit (Period)</div>
          <div className={`text-2xl font-semibold ${computed.periodProfit >= 0 ? "text-green-600" : "text-red-600"}`}>Rs. {fmt(computed.periodProfit)}</div>
          <div className="text-xs text-muted-foreground mt-1">Revenue − expenses, per P&amp;L</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><ArrowLeftRight className="h-3 w-3" />Net Contributions / (Drawings)</div>
          <div className={`text-2xl font-semibold ${netContributions >= 0 ? "text-blue-600" : "text-red-600"}`}>Rs. {fmt(netContributions)}</div>
          <div className="text-xs text-muted-foreground mt-1">Capital in Rs. {fmt(computed.creditsTotal)} · drawings Rs. {fmt(-computed.debitsTotal)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Briefcase className="h-3 w-3" />Closing Equity</div>
          <div className="text-2xl font-semibold text-purple-600">Rs. {fmt(computed.closingTotal)}</div>
          <div className="text-xs text-muted-foreground mt-1">As at {toDate}</div>
        </CardContent></Card>
      </div>
      </HiddenFigures>

      <div className="border rounded-lg mb-4">
        <div className="px-4 py-3 border-b bg-purple-50 dark:bg-purple-950/20 font-semibold text-sm flex items-center justify-between">
          <span>MOVEMENTS IN EQUITY</span>
          <span className="font-normal text-xs text-muted-foreground">{fromDate} to {toDate} · amounts in Rs.</span>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[220px]">Movement</TableHead>
                {computed.accountColumns.map((c: any) => (
                  <TableHead key={c.id} className="text-right min-w-[140px]">
                    <Link to={`/accounting/general-ledger?account=${c.id}`} className="text-primary hover:underline" title="Open ledger">{c.name}</Link>
                    <div className="font-mono text-[10px] text-muted-foreground font-normal">{c.code}</div>
                  </TableHead>
                ))}
                <TableHead className="text-right min-w-[150px]">
                  Retained Earnings
                  <div className="font-mono text-[10px] text-muted-foreground font-normal">
                    {computed.reAccounts.map((a: any, i: number) => (
                      <span key={a.id}>
                        {i > 0 && " + "}
                        <Link to={`/accounting/general-ledger?account=${a.id}`} className="hover:underline" title="Open ledger">{a.code}</Link>
                      </span>
                    ))}
                  </div>
                </TableHead>
                <TableHead className="text-right min-w-[150px] bg-purple-50 dark:bg-purple-950/20">Total Equity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="bg-muted/40 font-semibold">
                <TableCell>Opening balance</TableCell>
                {computed.accountColumns.map((c: any) => <TableCell key={c.id} className="text-right">{fmt(c.opening)}</TableCell>)}
                <TableCell className="text-right">{fmt(computed.reOpening)}</TableCell>
                <TableCell className="text-right bg-purple-50 dark:bg-purple-950/20">{fmt(computed.openingTotal)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <div className="font-medium">Capital introduced</div>
                  <div className="text-xs text-muted-foreground">Credits posted to capital accounts during the period</div>
                </TableCell>
                {computed.accountColumns.map((c: any) => (
                  <TableCell key={c.id} className={`text-right ${c.credits ? "text-green-600" : "text-muted-foreground"}`}>{c.credits ? fmt(c.credits) : "—"}</TableCell>
                ))}
                <TableCell className="text-right text-muted-foreground">—</TableCell>
                <TableCell className={`text-right bg-purple-50 dark:bg-purple-950/20 ${computed.creditsTotal ? "text-green-600" : "text-muted-foreground"}`}>{computed.creditsTotal ? fmt(computed.creditsTotal) : "—"}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <div className="font-medium">Owner drawings</div>
                  <div className="text-xs text-muted-foreground">Debits posted to capital / drawings accounts during the period</div>
                </TableCell>
                {computed.accountColumns.map((c: any) => (
                  <TableCell key={c.id} className={`text-right ${c.debits ? "text-red-600" : "text-muted-foreground"}`}>{c.debits ? fmt(-c.debits) : "—"}</TableCell>
                ))}
                <TableCell className="text-right text-muted-foreground">—</TableCell>
                <TableCell className={`text-right bg-purple-50 dark:bg-purple-950/20 ${computed.debitsTotal ? "text-red-600" : "text-muted-foreground"}`}>{computed.debitsTotal ? fmt(-computed.debitsTotal) : "—"}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <div className="font-medium">Net profit / (loss) for the period</div>
                  <div className="text-xs text-muted-foreground">Same calculation as "Current Year Earnings" on the Balance Sheet</div>
                </TableCell>
                {computed.accountColumns.map((c: any) => <TableCell key={c.id} className="text-right text-muted-foreground">—</TableCell>)}
                <TableCell className={`text-right ${computed.periodProfit >= 0 ? "text-green-600" : "text-red-600"}`}>{fmt(computed.periodProfit)}</TableCell>
                <TableCell className={`text-right bg-purple-50 dark:bg-purple-950/20 ${computed.periodProfit >= 0 ? "text-green-600" : "text-red-600"}`}>{fmt(computed.periodProfit)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <div className="font-medium">Other adjustments</div>
                  <div className="text-xs text-muted-foreground">Journal postings to retained earnings (e.g. year-end close, transfers, corrections)</div>
                </TableCell>
                {computed.accountColumns.map((c: any) => <TableCell key={c.id} className="text-right text-muted-foreground">—</TableCell>)}
                <TableCell className={`text-right ${computed.reAdjustments ? "" : "text-muted-foreground"}`}>{computed.reAdjustments ? fmt(computed.reAdjustments) : "—"}</TableCell>
                <TableCell className={`text-right bg-purple-50 dark:bg-purple-950/20 ${computed.reAdjustments ? "" : "text-muted-foreground"}`}>{computed.reAdjustments ? fmt(computed.reAdjustments) : "—"}</TableCell>
              </TableRow>
              <TableRow className="bg-muted/40 font-semibold border-t-2">
                <TableCell>Closing balance — {toDate}</TableCell>
                {computed.accountColumns.map((c: any) => <TableCell key={c.id} className="text-right">{fmt(c.closing)}</TableCell>)}
                <TableCell className="text-right">{fmt(computed.reClosing)}</TableCell>
                <TableCell className="text-right bg-purple-50 dark:bg-purple-950/20">{fmt(computed.closingTotal)}</TableCell>
              </TableRow>
              {!computed.accountColumns.length && computed.reOpening === 0 && computed.periodProfit === 0 && computed.reAdjustments === 0 && (
                <TableRow><TableCell colSpan={colCount} className="text-center text-muted-foreground">No equity postings yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
          <div className="text-sm">
            <div className="font-semibold">Reconciliation with Balance Sheet</div>
            <div className="text-muted-foreground text-xs mt-0.5">
              Total Equity on the Balance Sheet as at {toDate}: <b>Rs. {fmt(computed.bsEquity)}</b> · Closing equity per this statement: <b>Rs. {fmt(computed.closingTotal)}</b>
            </div>
          </div>
          {computed.matched
            ? <Badge variant="default" className="bg-green-600"><CheckCircle className="h-3 w-3 mr-1" />Matched</Badge>
            : <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Diff Rs. {fmt(Math.abs(computed.diff))}</Badge>}
        </CardContent>
      </Card>
    </ERPLayout>
  );
}
