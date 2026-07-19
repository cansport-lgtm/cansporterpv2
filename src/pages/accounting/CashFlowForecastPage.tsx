import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/accounting/fetchAllRows";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Wallet, ArrowUpRight, ArrowDownRight, TrendingUp, AlertTriangle } from "lucide-react";
import { format, parseISO, addDays, addMonths, subDays, differenceInCalendarDays } from "date-fns";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer,
} from "recharts";
import * as XLSX from "xlsx";

const sb = supabase as any;

type OpenItem = { date: string; amount: number; partyId: string };

/**
 * FIFO open-item extraction for one party — same walk as the AR/AP aging
 * report, but instead of bucketing by age it returns the surviving open
 * items (invoice date + remaining amount), capped at the net GL balance so
 * the total always reconciles to the trial balance.
 */
function openItemsForParty(lines: any[], isAR: boolean, fallbackDate: string, partyId: string): OpenItem[] {
  const sorted = [...lines].sort((a, b) => {
    const ad = a.voucher?.voucher_date || "";
    const bd = b.voucher?.voucher_date || "";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return (a.voucher?.voucher_number || "").localeCompare(b.voucher?.voucher_number || "");
  });

  const opens: { date: string; remaining: number }[] = [];
  let net = 0;

  for (const l of sorted) {
    const open = isAR ? Number(l.debit_amount || 0) : Number(l.credit_amount || 0);
    let settle = isAR ? Number(l.credit_amount || 0) : Number(l.debit_amount || 0);
    net += open - settle;

    if (open > 0) opens.push({ date: l.voucher?.voucher_date || fallbackDate, remaining: open });
    while (settle > 0 && opens.length) {
      const head = opens[0];
      if (head.remaining <= settle) {
        settle -= head.remaining;
        opens.shift();
      } else {
        head.remaining -= settle;
        settle = 0;
      }
    }
  }

  if (net <= 0.005) return [];

  const out: OpenItem[] = [];
  let remaining = net;
  for (const o of opens) {
    if (remaining <= 0) break;
    const amt = Math.min(o.remaining, remaining);
    out.push({ date: o.date, amount: amt, partyId });
    remaining -= amt;
  }
  if (remaining > 0.005) out.push({ date: fallbackDate, amount: remaining, partyId });
  return out;
}

const fmt = (n: number) => `Rs. ${Math.round(n).toLocaleString()}`;

type PeriodRow = {
  label: string;
  start: string;
  end: string;
  arIn: number;
  otherIn: number;
  apOut: number;
  otherOut: number;
  opening: number;
  net: number;
  closing: number;
};

export default function CashFlowForecastPage() {
  const today = format(new Date(), "yyyy-MM-dd");

  // ----- Assumptions (page-local; nothing is persisted) -----
  const [interval, setIntervalMode] = useState<"weekly" | "monthly">("weekly");
  const [periods, setPeriods] = useState(8);
  const [collectionDays, setCollectionDays] = useState(30);
  const [paymentDays, setPaymentDays] = useState(30);
  const [includeOther, setIncludeOther] = useState(true);

  // Cash + bank accounts from the chart of accounts
  const { data: cashBankAccounts } = useQuery({
    queryKey: ["cff-cash-bank-accounts"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_chart_of_accounts")
        .select("id, code, name, is_cash_account, is_bank_account")
        .or("is_cash_account.eq.true,is_bank_account.eq.true")
        .eq("is_active", true);
      if (error) throw error;
      return data || [];
    },
  });
  const cashBankIds = useMemo(
    () => (cashBankAccounts || []).map((a: any) => a.id as string),
    [cashBankAccounts]
  );

  // Default AR / AP control accounts
  const { data: defaults } = useQuery({
    queryKey: ["cff-default-accounts"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_default_accounts")
        .select("key, account_id")
        .in("key", ["accounts_receivable", "accounts_payable"]);
      if (error) throw error;
      const out: { ar: string | null; ap: string | null } = { ar: null, ap: null };
      (data || []).forEach((r: any) => {
        if (r.key === "accounts_receivable") out.ar = r.account_id;
        if (r.key === "accounts_payable") out.ap = r.account_id;
      });
      return out;
    },
  });

  // Current cash & bank balance (all posted lines up to today)
  const { data: cashLines } = useQuery({
    queryKey: ["cff-cash-balance", cashBankIds.join(","), today],
    queryFn: async () => {
      if (!cashBankIds.length) return [];
      return fetchAllRows((from, to) =>
        sb
          .from("accounting_voucher_lines")
          .select("account_id, debit_amount, credit_amount, voucher:accounting_vouchers!inner(voucher_date)")
          .in("account_id", cashBankIds)
          .lte("voucher.voucher_date", today)
          .order("id", { ascending: true })
          .range(from, to));
    },
    enabled: cashBankIds.length > 0,
  });

  const openingCash = useMemo(
    () => (cashLines || []).reduce(
      (s: number, l: any) => s + Number(l.debit_amount || 0) - Number(l.credit_amount || 0), 0),
    [cashLines]
  );

  // Per-party credit terms. Resilient to the credit_days column not existing
  // yet (frontend deploy and DB migration are not atomic) — falls back to the
  // page-level defaults for everyone.
  const { data: partyTerms } = useQuery({
    queryKey: ["cff-party-terms"],
    queryFn: async () => {
      const map: Record<string, number> = {};
      const { data, error } = await sb
        .from("accounting_parties")
        .select("id, credit_days")
        .not("credit_days", "is", null);
      if (error) return map;
      (data || []).forEach((r: any) => { map[r.id] = Number(r.credit_days); });
      return map;
    },
  });

  // Outstanding AR / AP lines (same shape as the Receivables & Payables report)
  const partyLinesQuery = (account: string | null | undefined) => async () => {
    if (!account) return [];
    return fetchAllRows((from, to) =>
      sb
        .from("accounting_voucher_lines")
        .select("party_id, debit_amount, credit_amount, voucher:accounting_vouchers!inner(voucher_date, voucher_number)")
        .eq("account_id", account)
        .not("party_id", "is", null)
        .lte("voucher.voucher_date", today)
        .order("id", { ascending: true })
        .range(from, to));
  };

  const { data: arLines } = useQuery({
    queryKey: ["cff-ar-lines", defaults?.ar, today],
    queryFn: partyLinesQuery(defaults?.ar),
    enabled: !!defaults?.ar,
  });
  const { data: apLines } = useQuery({
    queryKey: ["cff-ap-lines", defaults?.ap, today],
    queryFn: partyLinesQuery(defaults?.ap),
    enabled: !!defaults?.ap,
  });

  // Last 90 days of cash/bank movement, to derive a run-rate for "other"
  // operating flows (payroll, utilities, cash expenses, cash sales…) that
  // never pass through the AR/AP control accounts.
  const histFrom = format(subDays(parseISO(today), 90), "yyyy-MM-dd");
  const { data: histCashLines } = useQuery({
    queryKey: ["cff-hist-cash", cashBankIds.join(","), histFrom, today],
    queryFn: async () => {
      if (!cashBankIds.length) return [];
      return fetchAllRows((from, to) =>
        sb
          .from("accounting_voucher_lines")
          .select("voucher_id, debit_amount, credit_amount, voucher:accounting_vouchers!inner(voucher_date)")
          .in("account_id", cashBankIds)
          .gte("voucher.voucher_date", histFrom)
          .lte("voucher.voucher_date", today)
          .order("id", { ascending: true })
          .range(from, to));
    },
    enabled: cashBankIds.length > 0,
  });

  const { data: histSettlementIds } = useQuery({
    queryKey: ["cff-hist-settlements", defaults?.ar, defaults?.ap, histFrom, today],
    queryFn: async () => {
      const ids = [defaults?.ar, defaults?.ap].filter(Boolean) as string[];
      if (!ids.length) return new Set<string>();
      const rows = await fetchAllRows((from, to) =>
        sb
          .from("accounting_voucher_lines")
          .select("voucher_id, voucher:accounting_vouchers!inner(voucher_date)")
          .in("account_id", ids)
          .gte("voucher.voucher_date", histFrom)
          .lte("voucher.voucher_date", today)
          .order("id", { ascending: true })
          .range(from, to));
      return new Set<string>(rows.map((r: any) => r.voucher_id));
    },
    enabled: !!defaults && (!!defaults.ar || !!defaults.ap),
  });

  // Daily run-rate of non-AR/AP cash flows. Cash/bank lines are netted per
  // voucher first so cash↔bank contra transfers cancel out instead of
  // inflating both sides.
  const otherDaily = useMemo(() => {
    const byVoucher: Record<string, number> = {};
    (histCashLines || []).forEach((l: any) => {
      byVoucher[l.voucher_id] =
        (byVoucher[l.voucher_id] || 0) + Number(l.debit_amount || 0) - Number(l.credit_amount || 0);
    });
    let inflow = 0, outflow = 0;
    Object.entries(byVoucher).forEach(([vid, net]) => {
      if (histSettlementIds?.has(vid)) return;
      if (net > 0) inflow += net;
      else outflow += -net;
    });
    return { inflow: inflow / 90, outflow: outflow / 90 };
  }, [histCashLines, histSettlementIds]);

  // FIFO open items across all parties
  const collectOpenItems = (lines: any[], isAR: boolean): OpenItem[] => {
    const byParty: Record<string, any[]> = {};
    (lines || []).forEach((l: any) => {
      if (!l.party_id) return;
      (byParty[l.party_id] ||= []).push(l);
    });
    const items: OpenItem[] = [];
    Object.entries(byParty).forEach(([pid, ls]) => items.push(...openItemsForParty(ls, isAR, today, pid)));
    return items;
  };

  const arItems = useMemo(() => collectOpenItems(arLines || [], true), [arLines, today]);
  const apItems = useMemo(() => collectOpenItems(apLines || [], false), [apLines, today]);

  // ----- Build the forecast -----
  const forecast = useMemo(() => {
    const start = parseISO(today);
    const bounds: { start: Date; end: Date }[] = [];
    for (let i = 0; i < periods; i++) {
      const s = interval === "weekly" ? addDays(start, i * 7) : addMonths(start, i);
      const e = interval === "weekly" ? addDays(start, (i + 1) * 7 - 1) : subDays(addMonths(start, i + 1), 1);
      bounds.push({ start: s, end: e });
    }
    const horizonEnd = bounds[bounds.length - 1].end;

    const rows: PeriodRow[] = bounds.map((b) => ({
      label:
        interval === "weekly"
          ? `${format(b.start, "d MMM")} – ${format(b.end, "d MMM")}`
          : `${format(b.start, "d MMM")} – ${format(b.end, "d MMM")}`,
      start: format(b.start, "yyyy-MM-dd"),
      end: format(b.end, "yyyy-MM-dd"),
      arIn: 0, otherIn: 0, apOut: 0, otherOut: 0, opening: 0, net: 0, closing: 0,
    }));

    // Place an expected cash event (item date + credit terms) into a period.
    // A party with its own credit_days (set in Accounting → Parties) uses
    // those; others use the page-level default. Anything already due (or
    // overdue) lands in period 1; anything past the horizon is reported
    // separately instead of silently dropped.
    let arBeyond = 0, apBeyond = 0, overdueAR = 0, overdueAP = 0;
    const place = (item: OpenItem, defaultTermDays: number, isIn: boolean) => {
      const termDays = partyTerms?.[item.partyId] ?? defaultTermDays;
      const due = addDays(parseISO(item.date), termDays);
      if (due > horizonEnd) {
        if (isIn) arBeyond += item.amount; else apBeyond += item.amount;
        return;
      }
      let idx = 0;
      if (due > start) idx = bounds.findIndex((b) => due >= b.start && due <= b.end);
      if (idx < 0) idx = rows.length - 1;
      if (isIn) {
        rows[idx].arIn += item.amount;
        if (due <= start) overdueAR += item.amount;
      } else {
        rows[idx].apOut += item.amount;
        if (due <= start) overdueAP += item.amount;
      }
    };
    arItems.forEach((i) => place(i, collectionDays, true));
    apItems.forEach((i) => place(i, paymentDays, false));

    if (includeOther) {
      rows.forEach((r) => {
        const days = differenceInCalendarDays(parseISO(r.end), parseISO(r.start)) + 1;
        r.otherIn = otherDaily.inflow * days;
        r.otherOut = otherDaily.outflow * days;
      });
    }

    let running = openingCash;
    rows.forEach((r) => {
      r.opening = running;
      r.net = r.arIn + r.otherIn - r.apOut - r.otherOut;
      running += r.net;
      r.closing = running;
    });

    const totalIn = rows.reduce((s, r) => s + r.arIn + r.otherIn, 0);
    const totalOut = rows.reduce((s, r) => s + r.apOut + r.otherOut, 0);
    const minRow = rows.reduce((m, r) => (r.closing < m.closing ? r : m), rows[0]);
    const firstNegative = rows.find((r) => r.closing < 0) || null;

    return { rows, arBeyond, apBeyond, overdueAR, overdueAP, totalIn, totalOut, minRow, firstNegative };
  }, [arItems, apItems, otherDaily, openingCash, periods, interval, collectionDays, paymentDays, includeOther, partyTerms, today]);

  const closing = forecast.rows.length ? forecast.rows[forecast.rows.length - 1].closing : openingCash;

  const chartData = forecast.rows.map((r) => ({
    name: r.label,
    Inflows: Math.round(r.arIn + r.otherIn),
    Outflows: Math.round(r.apOut + r.otherOut),
    Balance: Math.round(r.closing),
  }));

  const handleExport = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        forecast.rows.map((r) => ({
          Period: r.label,
          Opening: Math.round(r.opening),
          "AR Collections": Math.round(r.arIn),
          "Other Inflows": Math.round(r.otherIn),
          "AP Payments": Math.round(r.apOut),
          "Other Outflows": Math.round(r.otherOut),
          Net: Math.round(r.net),
          Closing: Math.round(r.closing),
        }))
      ),
      "Forecast"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        { Label: "Cash & Bank Today", Amount: Math.round(openingCash) },
        { Label: "Expected Inflows (horizon)", Amount: Math.round(forecast.totalIn) },
        { Label: "Expected Outflows (horizon)", Amount: Math.round(forecast.totalOut) },
        { Label: "Projected Closing", Amount: Math.round(closing) },
        { Label: "Overdue Receivables (assumed period 1)", Amount: Math.round(forecast.overdueAR) },
        { Label: "Overdue Payables (assumed period 1)", Amount: Math.round(forecast.overdueAP) },
        { Label: "Receivables beyond horizon", Amount: Math.round(forecast.arBeyond) },
        { Label: "Payables beyond horizon", Amount: Math.round(forecast.apBeyond) },
        { Label: "Assumption: customer credit days", Amount: collectionDays },
        { Label: "Assumption: supplier credit days", Amount: paymentDays },
        { Label: "Assumption: include other operating flows", Amount: includeOther ? 1 : 0 },
      ]),
      "Summary"
    );
    XLSX.writeFile(wb, `Cash_Flow_Forecast_${today}.xlsx`);
  };

  const periodOptions = interval === "weekly" ? [4, 8, 13] : [3, 6, 12];

  return (
    <ERPLayout>
      <PageHeader
        title="Cash Flow Forecast"
        description="Projected cash & bank position from outstanding receivables, payables and operating run-rate"
      >
        <Button size="sm" variant="outline" onClick={handleExport}>
          <Download className="h-4 w-4 mr-1" />Export
        </Button>
      </PageHeader>

      {/* Assumptions */}
      <Card className="mb-4">
        <CardContent className="p-4 flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Interval</Label>
            <Select
              value={interval}
              onValueChange={(v) => {
                setIntervalMode(v as "weekly" | "monthly");
                setPeriods(v === "weekly" ? 8 : 6);
              }}
            >
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Horizon</Label>
            <Select value={String(periods)} onValueChange={(v) => setPeriods(Number(v))}>
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {periodOptions.map((p) => (
                  <SelectItem key={p} value={String(p)}>
                    {p} {interval === "weekly" ? "weeks" : "months"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Customer credit days (default)</Label>
            <Input
              type="number" min={0} max={365} className="w-[130px]"
              value={collectionDays}
              onChange={(e) => setCollectionDays(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Supplier credit days (default)</Label>
            <Input
              type="number" min={0} max={365} className="w-[130px]"
              value={paymentDays}
              onChange={(e) => setPaymentDays(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Switch id="cff-other" checked={includeOther} onCheckedChange={setIncludeOther} />
            <Label htmlFor="cff-other" className="text-xs">
              Include other operating flows (90-day run-rate: {fmt(otherDaily.inflow * 30)} in / {fmt(otherDaily.outflow * 30)} out per month)
            </Label>
          </div>
        </CardContent>
      </Card>

      {(!defaults?.ar || !defaults?.ap) && defaults && (
        <Card className="mb-4 border-amber-300">
          <CardContent className="p-3 text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Accounts Receivable / Accounts Payable default accounts are not configured (Accounting → Default Accounts), so
            {!defaults.ar && " expected collections"}{!defaults.ar && !defaults.ap && " and"}{!defaults.ap && " expected payments"} cannot be forecast.
          </CardContent>
        </Card>
      )}

      {forecast.firstNegative && (
        <Card className="mb-4 border-red-300">
          <CardContent className="p-3 text-sm text-red-600 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Projected cash goes negative in <span className="font-semibold">{forecast.firstNegative.label}</span>
            &nbsp;(closing {fmt(forecast.firstNegative.closing)}). Consider accelerating collections or deferring payments.
          </CardContent>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><Wallet className="h-3 w-3" />Cash & Bank Today</div>
            <div className="text-2xl font-semibold">{fmt(openingCash)}</div>
            <div className="text-xs text-muted-foreground">{cashBankIds.length} account{cashBankIds.length === 1 ? "" : "s"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><ArrowUpRight className="h-3 w-3" />Expected Inflows</div>
            <div className="text-2xl font-semibold text-green-600">{fmt(forecast.totalIn)}</div>
            <div className="text-xs text-muted-foreground">incl. {fmt(forecast.overdueAR)} already overdue</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><ArrowDownRight className="h-3 w-3" />Expected Outflows</div>
            <div className="text-2xl font-semibold text-red-600">{fmt(forecast.totalOut)}</div>
            <div className="text-xs text-muted-foreground">incl. {fmt(forecast.overdueAP)} already due</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3" />Projected Closing</div>
            <div className={`text-2xl font-semibold ${closing >= 0 ? "text-green-600" : "text-red-600"}`}>{fmt(closing)}</div>
            <div className="text-xs text-muted-foreground">
              lowest point {fmt(forecast.minRow?.closing ?? openingCash)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Projected cash position</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => (v / 1000).toLocaleString() + "k"} />
              <Tooltip formatter={(v: number) => `Rs. ${v.toLocaleString()}`} />
              <Legend />
              <ReferenceLine y={0} stroke="hsl(var(--destructive))" strokeDasharray="4 4" />
              <Bar dataKey="Inflows" fill="hsl(142 71% 45%)" />
              <Bar dataKey="Outflows" fill="hsl(0 72% 51%)" />
              <Line type="monotone" dataKey="Balance" stroke="hsl(var(--primary))" strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Detail table */}
      <div className="border rounded-lg">
        <div className="px-4 py-3 border-b bg-muted/40 font-semibold text-sm">
          FORECAST DETAIL ({interval === "weekly" ? "weekly" : "monthly"})
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead className="text-right">Opening</TableHead>
              <TableHead className="text-right">AR Collections</TableHead>
              <TableHead className="text-right">Other Inflows</TableHead>
              <TableHead className="text-right">AP Payments</TableHead>
              <TableHead className="text-right">Other Outflows</TableHead>
              <TableHead className="text-right">Net</TableHead>
              <TableHead className="text-right">Closing</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {forecast.rows.map((r) => (
              <TableRow key={r.start}>
                <TableCell className="text-sm whitespace-nowrap">{r.label}</TableCell>
                <TableCell className="text-right text-xs">{fmt(r.opening)}</TableCell>
                <TableCell className="text-right text-xs text-green-600">{r.arIn ? fmt(r.arIn) : "—"}</TableCell>
                <TableCell className="text-right text-xs text-green-600">{r.otherIn ? fmt(r.otherIn) : "—"}</TableCell>
                <TableCell className="text-right text-xs text-red-600">{r.apOut ? fmt(r.apOut) : "—"}</TableCell>
                <TableCell className="text-right text-xs text-red-600">{r.otherOut ? fmt(r.otherOut) : "—"}</TableCell>
                <TableCell className={`text-right text-xs font-medium ${r.net >= 0 ? "text-green-600" : "text-red-600"}`}>{fmt(r.net)}</TableCell>
                <TableCell className={`text-right text-sm font-semibold ${r.closing >= 0 ? "" : "text-red-600"}`}>{fmt(r.closing)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/40 font-semibold">
              <TableCell>Total</TableCell>
              <TableCell className="text-right">{fmt(openingCash)}</TableCell>
              <TableCell className="text-right">{fmt(forecast.rows.reduce((s, r) => s + r.arIn, 0))}</TableCell>
              <TableCell className="text-right">{fmt(forecast.rows.reduce((s, r) => s + r.otherIn, 0))}</TableCell>
              <TableCell className="text-right">{fmt(forecast.rows.reduce((s, r) => s + r.apOut, 0))}</TableCell>
              <TableCell className="text-right">{fmt(forecast.rows.reduce((s, r) => s + r.otherOut, 0))}</TableCell>
              <TableCell className="text-right">{fmt(forecast.totalIn - forecast.totalOut)}</TableCell>
              <TableCell className="text-right">{fmt(closing)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <div className="mt-3 space-y-1 text-xs text-muted-foreground">
        <p>
          Expected date = invoice date + credit days; anything already due (including overdue balances) is assumed to settle
          in the first period. Parties with their own Credit Days (set in Accounting → Parties) use those; the inputs above
          are the default for everyone else{partyTerms && Object.keys(partyTerms).length > 0 ? ` — ${Object.keys(partyTerms).length} part${Object.keys(partyTerms).length === 1 ? "y has" : "ies have"} specific terms` : ""}.
          Open items use the same FIFO settlement logic as the Receivables &amp; Payables report, so totals reconcile with
          the trial balance.
        </p>
        {(forecast.arBeyond > 0.5 || forecast.apBeyond > 0.5) && (
          <p>
            Beyond this horizon: {fmt(forecast.arBeyond)} receivables and {fmt(forecast.apBeyond)} payables are excluded
            from the projection above.
          </p>
        )}
        <p>
          "Other" flows are the daily run-rate of cash-book movements over the last 90 days that did not touch the AR/AP
          control accounts (cash sales, payroll, utilities, cash expenses); cash↔bank transfers are netted out.
        </p>
      </div>
    </ERPLayout>
  );
}
