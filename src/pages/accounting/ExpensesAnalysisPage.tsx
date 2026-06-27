import { useMemo, useState, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  format, parseISO, startOfMonth, endOfMonth, startOfYear, endOfYear, subYears, subDays,
  eachMonthOfInterval,
} from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/accounting/fetchAllRows";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DollarSign, TrendingUp, CalendarRange, Layers, ChevronDown, ChevronRight } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from "recharts";

const sb = supabase as any;
const COLORS = ["hsl(var(--primary))", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#3b82f6", "#14b8a6"];
const fmtRs = (n: number) => `Rs. ${Math.round(n).toLocaleString()}`;

const PRESETS = [
  { key: "this_month", label: "This Month" },
  { key: "last_90", label: "Last 90 Days" },
  { key: "ytd", label: "Year to Date" },
  { key: "this_year", label: "This Year" },
  { key: "last_year", label: "Last Year" },
  { key: "custom", label: "Custom" },
];

function applyPreset(key: string): { from: string; to: string } {
  const now = new Date();
  const iso = (d: Date) => format(d, "yyyy-MM-dd");
  switch (key) {
    case "this_month": return { from: iso(startOfMonth(now)), to: iso(endOfMonth(now)) };
    case "last_90": return { from: iso(subDays(now, 89)), to: iso(now) };
    case "ytd": return { from: iso(startOfYear(now)), to: iso(now) };
    case "this_year": return { from: iso(startOfYear(now)), to: iso(endOfYear(now)) };
    case "last_year": { const ly = subYears(now, 1); return { from: iso(startOfYear(ly)), to: iso(endOfYear(ly)) }; }
    default: return { from: iso(startOfYear(now)), to: iso(endOfYear(now)) };
  }
}

/**
 * Expenses Analysis (Accounting).
 *
 * Month-wise analysis of expenses recorded in the General Ledger — voucher
 * lines posted to expense accounts (accounting_chart_of_accounts.account_type =
 * 'expense'). Net per account = debit - credit, matching the Profit & Loss.
 * By default it shows OPERATING expenses (excludes the COGS sub-category); a
 * view toggle includes COGS for the full expense picture.
 */
export default function ExpensesAnalysisPage() {
  const initial = applyPreset("this_year");
  const [preset, setPreset] = useState("this_year");
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);
  const [scope, setScope] = useState<"operating" | "all">("operating"); // exclude vs include COGS
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  const onPresetChange = (key: string) => {
    setPreset(key);
    if (key !== "custom") { const r = applyPreset(key); setFromDate(r.from); setToDate(r.to); }
  };

  // Expense accounts (chart of accounts).
  const { data: accounts = [] } = useQuery({
    queryKey: ["acc-exp-accounts"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_chart_of_accounts")
        .select("id, code, name, account_type, sub_category")
        .eq("account_type", "expense")
        .order("code");
      if (error) throw error;
      return data || [];
    },
  });

  // All voucher lines in the period (paged past the 1000-row cap), like P&L.
  const { data: lines = [], isLoading } = useQuery({
    queryKey: ["acc-exp-lines", fromDate, toDate],
    queryFn: async () =>
      fetchAllRows((from, to) =>
        sb
          .from("accounting_voucher_lines")
          .select("account_id, debit_amount, credit_amount, line_narration, voucher:accounting_vouchers!inner(voucher_date, voucher_number)")
          .gte("voucher.voucher_date", fromDate)
          .lte("voucher.voucher_date", toDate)
          .order("id", { ascending: true })
          .range(from, to)),
  });

  // account_id -> account meta, limited to expense accounts honouring the scope.
  const acctMap = useMemo(() => {
    const m = new Map<string, { code: string; name: string; sub: string }>();
    (accounts as any[]).forEach((a) => {
      if (scope === "operating" && a.sub_category === "COGS") return;
      m.set(a.id, { code: a.code, name: a.name, sub: a.sub_category || "Other" });
    });
    return m;
  }, [accounts, scope]);

  // Normalised expense lines: { month, date, accountId, code, name, group, net }.
  const entries = useMemo(() => {
    const rows: Array<{ month: string; date: string; accountId: string; code: string; name: string; group: string; net: number; voucherNo: string; narration: string }> = [];
    (lines as any[]).forEach((l) => {
      const meta = acctMap.get(l.account_id);
      if (!meta) return; // not an in-scope expense account
      const date = l.voucher?.voucher_date;
      if (!date) return;
      const net = Number(l.debit_amount || 0) - Number(l.credit_amount || 0);
      if (net === 0) return;
      rows.push({
        month: date.slice(0, 7),
        date,
        accountId: l.account_id,
        code: meta.code,
        name: meta.name,
        group: meta.sub,
        net,
        voucherNo: l.voucher?.voucher_number || "",
        narration: l.line_narration || "",
      });
    });
    return rows;
  }, [lines, acctMap]);

  const monthly = useMemo(() => {
    let start: Date, end: Date;
    try { start = parseISO(fromDate); end = parseISO(toDate); } catch { return []; }
    if (!(start <= end)) return [];
    const months = eachMonthOfInterval({ start: startOfMonth(start), end: endOfMonth(end) });
    const buckets = months.map((m) => ({ key: format(m, "yyyy-MM"), label: format(m, "MMM yy"), total: 0, count: 0 }));
    const index = new Map(buckets.map((b) => [b.key, b]));
    entries.forEach((e) => {
      const b = index.get(e.month);
      if (!b) return;
      b.total += e.net; b.count += 1;
    });
    return buckets;
  }, [entries, fromDate, toDate]);

  const metrics = useMemo(() => {
    const total = entries.reduce((s, e) => s + e.net, 0);
    const monthsWithSpend = monthly.filter((m) => m.total !== 0).length;
    const avgPerMonth = monthsWithSpend > 0 ? total / monthsWithSpend : 0;
    const peak = monthly.reduce((best, m) => (m.total > best.total ? { label: m.label, total: m.total } : best), { label: "—", total: 0 });
    return { total, avgPerMonth, peak };
  }, [entries, monthly]);

  // By account (category).
  const byAccount = useMemo(() => {
    const map = new Map<string, { code: string; name: string; group: string; amount: number; count: number; accountId: string }>();
    entries.forEach((e) => {
      const cur = map.get(e.accountId) || { code: e.code, name: e.name, group: e.group, amount: 0, count: 0, accountId: e.accountId };
      cur.amount += e.net; cur.count += 1;
      map.set(e.accountId, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }, [entries]);

  // By group (sub-category) for the pie.
  const byGroup = useMemo(() => {
    const map = new Map<string, number>();
    entries.forEach((e) => map.set(e.group, (map.get(e.group) || 0) + e.net));
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).filter((g) => g.value > 0).sort((a, b) => b.value - a.value);
  }, [entries]);

  return (
    <ERPLayout>
      <PageHeader title="Expenses Analysis" description="Month-wise expense analysis from the General Ledger (matches Profit & Loss)">
        <div className="flex flex-wrap gap-2 items-center">
          <Select value={scope} onValueChange={(v) => setScope(v as "operating" | "all")}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="operating">Operating (excl. COGS)</SelectItem>
              <SelectItem value="all">All expenses (incl. COGS)</SelectItem>
            </SelectContent>
          </Select>
          <Select value={preset} onValueChange={onPresetChange}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRESETS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPreset("custom"); }} className="w-[150px]" />
          <Input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPreset("custom"); }} className="w-[150px]" />
        </div>
      </PageHeader>

      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard title={scope === "operating" ? "Operating Expenses" : "Total Expenses"} value={fmtRs(metrics.total)} icon={DollarSign} description={`${fromDate} → ${toDate}`} />
          <MetricCard title="Avg / Active Month" value={fmtRs(metrics.avgPerMonth)} icon={TrendingUp} description="Average monthly spend" />
          <MetricCard title="Peak Month" value={fmtRs(metrics.peak.total)} icon={CalendarRange} description={metrics.peak.label} />
          <MetricCard title="Expense Accounts" value={byAccount.length.toString()} icon={Layers} description={`${entries.length} postings`} />
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Month-wise Expenses</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[340px]">
              {isLoading ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Loading…</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthly}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={monthly.length > 12 ? -35 : 0} textAnchor={monthly.length > 12 ? "end" : "middle"} height={monthly.length > 12 ? 50 : 30} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => (Math.abs(v) >= 1000 ? `Rs.${(v / 1000).toFixed(0)}k` : `Rs.${v}`)} />
                    <Tooltip formatter={(value: number) => fmtRs(value)} />
                    <Legend />
                    <Bar dataKey="total" fill={COLORS[0]} name={scope === "operating" ? "Operating Expenses" : "Total Expenses"} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Spend by Group</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[300px]">
                {byGroup.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No data for this period</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={byGroup} cx="50%" cy="50%" labelLine={false} outerRadius={100} dataKey="value"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                        {byGroup.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(value: number) => fmtRs(value)} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Top Expense Accounts</CardTitle></CardHeader>
            <CardContent>
              <div className="max-h-[300px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-center">Postings</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">% Share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byAccount.map((c) => (
                      <TableRow key={c.accountId}>
                        <TableCell className="font-medium">
                          <Link to={`/accounting/general-ledger?account=${c.accountId}`} className="text-primary hover:underline">
                            <span className="font-mono text-xs mr-1">{c.code}</span>{c.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-center">{c.count}</TableCell>
                        <TableCell className="text-right">{fmtRs(c.amount)}</TableCell>
                        <TableCell className="text-right">{metrics.total !== 0 ? ((c.amount / metrics.total) * 100).toFixed(1) : 0}%</TableCell>
                      </TableRow>
                    ))}
                    {byAccount.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No expense postings found</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Monthly Summary</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-center">Postings</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">% Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthly.map((m) => {
                  // Per-account aggregation for the expanded month.
                  const detail = (() => {
                    if (expandedMonth !== m.key) return [];
                    const map = new Map<string, { code: string; name: string; amount: number }>();
                    entries.filter((e) => e.month === m.key).forEach((e) => {
                      const cur = map.get(e.accountId) || { code: e.code, name: e.name, amount: 0 };
                      cur.amount += e.net; map.set(e.accountId, cur);
                    });
                    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
                  })();
                  return (
                    <Fragment key={m.key}>
                      <TableRow
                        className={m.count > 0 ? "cursor-pointer hover:bg-muted/50" : "hover:bg-muted/50"}
                        onClick={() => m.count > 0 && setExpandedMonth(expandedMonth === m.key ? null : m.key)}
                      >
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-1">
                            {m.count > 0 ? (expandedMonth === m.key ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : <span className="w-3.5" />}
                            {m.label}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">{m.count}</TableCell>
                        <TableCell className="text-right font-medium">{fmtRs(m.total)}</TableCell>
                        <TableCell className="text-right">{metrics.total !== 0 ? ((m.total / metrics.total) * 100).toFixed(1) : 0}%</TableCell>
                      </TableRow>
                      {expandedMonth === m.key && m.count > 0 && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={4} className="p-0">
                            <div className="px-6 py-3">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="h-8 text-xs">Account</TableHead>
                                    <TableHead className="h-8 text-xs text-right">Amount</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {detail.map((d, di) => (
                                    <TableRow key={di} className="text-xs">
                                      <TableCell className="py-1.5"><span className="font-mono mr-1">{d.code}</span>{d.name}</TableCell>
                                      <TableCell className="py-1.5 text-right">{fmtRs(d.amount)}</TableCell>
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
                {monthly.some((m) => m.total !== 0) && (
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-center">{monthly.reduce((s, m) => s + m.count, 0)}</TableCell>
                    <TableCell className="text-right">{fmtRs(metrics.total)}</TableCell>
                    <TableCell className="text-right">100%</TableCell>
                  </TableRow>
                )}
                {!isLoading && metrics.total === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No expense postings found for this period</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
