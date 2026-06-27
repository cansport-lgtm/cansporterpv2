import { useMemo, useState, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  format,
  parseISO,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  subYears,
  subDays,
  eachMonthOfInterval,
  isWithinInterval,
} from "date-fns";
import { supabase } from "@/integrations/supabase/client";
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
 * Month-wise analysis of operating expenses (petty cash + general expenses +
 * utility bills) with date presets and a custom date range. Mirrors the
 * Operating Expenses Analysis under the Expenses module but follows the
 * accounting module's conventions (Rs. currency, preset + date-range filters).
 */
export default function ExpensesAnalysisPage() {
  const initial = applyPreset("this_year");
  const [preset, setPreset] = useState("this_year");
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  const onPresetChange = (key: string) => {
    setPreset(key);
    if (key !== "custom") {
      const r = applyPreset(key);
      setFromDate(r.from);
      setToDate(r.to);
    }
  };
  const onFromChange = (v: string) => { setFromDate(v); setPreset("custom"); };
  const onToChange = (v: string) => { setToDate(v); setPreset("custom"); };

  const { data: pettyCash = [], isLoading: l1 } = useQuery({
    queryKey: ["acc-opex-petty", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("petty_cash_entries")
        .select("entry_date, amount, entry_type, expense_categories(name)")
        .eq("entry_type", "expense")
        .gte("entry_date", fromDate)
        .lte("entry_date", toDate);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: general = [], isLoading: l2 } = useQuery({
    queryKey: ["acc-opex-general", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("general_expenses")
        .select("expense_date, total_amount, expense_categories(name)")
        .gte("expense_date", fromDate)
        .lte("expense_date", toDate);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: utilities = [], isLoading: l3 } = useQuery({
    queryKey: ["acc-opex-utilities", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("utility_bills")
        .select("bill_date, total_amount, utility_types(name)")
        .gte("bill_date", fromDate)
        .lte("bill_date", toDate);
      if (error) throw error;
      return data || [];
    },
  });

  const isLoading = l1 || l2 || l3;

  const allEntries = useMemo(() => {
    const rows: Array<{ date: string; amount: number; source: string; category: string }> = [];
    pettyCash.forEach((e: any) =>
      rows.push({ date: e.entry_date, amount: Number(e.amount || 0), source: "Petty Cash", category: e.expense_categories?.name || "Uncategorized" }));
    general.forEach((e: any) =>
      rows.push({ date: e.expense_date, amount: Number(e.total_amount || 0), source: "General", category: e.expense_categories?.name || "Uncategorized" }));
    utilities.forEach((b: any) =>
      rows.push({ date: b.bill_date, amount: Number(b.total_amount || 0), source: "Utilities", category: `Utility - ${b.utility_types?.name || "Other"}` }));
    return rows;
  }, [pettyCash, general, utilities]);

  const monthly = useMemo(() => {
    let start: Date, end: Date;
    try { start = parseISO(fromDate); end = parseISO(toDate); } catch { return []; }
    if (!(start <= end)) return [];
    const months = eachMonthOfInterval({ start: startOfMonth(start), end: endOfMonth(end) });
    const buckets = months.map((m) => ({
      key: format(m, "yyyy-MM"),
      label: format(m, "MMM yy"),
      start: startOfMonth(m),
      end: endOfMonth(m),
      pettyCash: 0, general: 0, utilities: 0, total: 0, count: 0,
    }));
    const index = new Map(buckets.map((b) => [b.key, b]));
    allEntries.forEach((r) => {
      if (!r.date) return;
      const bucket = index.get(r.date.slice(0, 7));
      if (!bucket) return;
      if (r.source === "Petty Cash") bucket.pettyCash += r.amount;
      else if (r.source === "General") bucket.general += r.amount;
      else bucket.utilities += r.amount;
      bucket.total += r.amount;
      bucket.count += 1;
    });
    return buckets;
  }, [allEntries, fromDate, toDate]);

  const metrics = useMemo(() => {
    const total = allEntries.reduce((s, r) => s + r.amount, 0);
    const monthsWithSpend = monthly.filter((m) => m.total > 0).length;
    const avgPerMonth = monthsWithSpend > 0 ? total / monthsWithSpend : 0;
    const peak = monthly.reduce((best, m) => (m.total > best.total ? { label: m.label, total: m.total } : best), { label: "—", total: 0 });
    return { total, avgPerMonth, peak };
  }, [allEntries, monthly]);

  const bySource = useMemo(() => {
    const map = new Map<string, number>();
    allEntries.forEach((r) => map.set(r.source, (map.get(r.source) || 0) + r.amount));
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [allEntries]);

  const byCategory = useMemo(() => {
    const map = new Map<string, { amount: number; count: number }>();
    allEntries.forEach((r) => {
      const cur = map.get(r.category) || { amount: 0, count: 0 };
      cur.amount += r.amount; cur.count += 1;
      map.set(r.category, cur);
    });
    return Array.from(map.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.amount - a.amount);
  }, [allEntries]);

  return (
    <ERPLayout>
      <PageHeader title="Expenses Analysis" description="Operating expenses — month-wise trends, sources & categories">
        <div className="flex flex-wrap gap-2 items-center">
          <Select value={preset} onValueChange={onPresetChange}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRESETS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={fromDate} onChange={(e) => onFromChange(e.target.value)} className="w-[150px]" />
          <Input type="date" value={toDate} onChange={(e) => onToChange(e.target.value)} className="w-[150px]" />
        </div>
      </PageHeader>

      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard title="Total Operating Expenses" value={fmtRs(metrics.total)} icon={DollarSign} description={`${fromDate} → ${toDate}`} />
          <MetricCard title="Avg / Active Month" value={fmtRs(metrics.avgPerMonth)} icon={TrendingUp} description="Average monthly spend" />
          <MetricCard title="Peak Month" value={fmtRs(metrics.peak.total)} icon={CalendarRange} description={metrics.peak.label} />
          <MetricCard title="Categories" value={byCategory.length.toString()} icon={Layers} description={`${allEntries.length} entries`} />
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Month-wise Operating Expenses</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[340px]">
              {isLoading ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Loading…</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthly}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={monthly.length > 12 ? -35 : 0} textAnchor={monthly.length > 12 ? "end" : "middle"} height={monthly.length > 12 ? 50 : 30} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => (v >= 1000 ? `Rs.${(v / 1000).toFixed(0)}k` : `Rs.${v}`)} />
                    <Tooltip formatter={(value: number, name) => [fmtRs(value), name]} />
                    <Legend />
                    <Bar dataKey="pettyCash" stackId="a" fill={COLORS[0]} name="Petty Cash" />
                    <Bar dataKey="general" stackId="a" fill={COLORS[1]} name="General" />
                    <Bar dataKey="utilities" stackId="a" fill={COLORS[2]} name="Utilities" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Spend by Source</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[300px]">
                {bySource.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No data for this period</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={bySource} cx="50%" cy="50%" labelLine={false} outerRadius={100} dataKey="value"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                        {bySource.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(value: number) => fmtRs(value)} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Category-wise Breakdown</CardTitle></CardHeader>
            <CardContent>
              <div className="max-h-[300px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-center">Entries</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">% Share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byCategory.map((c) => (
                      <TableRow key={c.name}>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell className="text-center">{c.count}</TableCell>
                        <TableCell className="text-right">{fmtRs(c.amount)}</TableCell>
                        <TableCell className="text-right">{metrics.total > 0 ? ((c.amount / metrics.total) * 100).toFixed(1) : 0}%</TableCell>
                      </TableRow>
                    ))}
                    {byCategory.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No expenses found</TableCell></TableRow>
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
                  <TableHead className="text-right">Petty Cash</TableHead>
                  <TableHead className="text-right">General</TableHead>
                  <TableHead className="text-right">Utilities</TableHead>
                  <TableHead className="text-center">Entries</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">% Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthly.map((m) => {
                  const monthEntries = allEntries
                    .filter((r) => r.date && isWithinInterval(parseISO(r.date), { start: m.start, end: m.end }))
                    .sort((a, b) => a.date.localeCompare(b.date));
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
                        <TableCell className="text-right">{fmtRs(m.pettyCash)}</TableCell>
                        <TableCell className="text-right">{fmtRs(m.general)}</TableCell>
                        <TableCell className="text-right">{fmtRs(m.utilities)}</TableCell>
                        <TableCell className="text-center">{m.count}</TableCell>
                        <TableCell className="text-right font-medium">{fmtRs(m.total)}</TableCell>
                        <TableCell className="text-right">{metrics.total > 0 ? ((m.total / metrics.total) * 100).toFixed(1) : 0}%</TableCell>
                      </TableRow>
                      {expandedMonth === m.key && m.count > 0 && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={7} className="p-0">
                            <div className="px-6 py-3">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="h-8 text-xs">Date</TableHead>
                                    <TableHead className="h-8 text-xs">Source</TableHead>
                                    <TableHead className="h-8 text-xs">Category</TableHead>
                                    <TableHead className="h-8 text-xs text-right">Amount</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {monthEntries.map((e, ei) => (
                                    <TableRow key={ei} className="text-xs">
                                      <TableCell className="py-1.5">{format(parseISO(e.date), "dd MMM yyyy")}</TableCell>
                                      <TableCell className="py-1.5"><Badge variant="outline" className="text-[10px] px-1.5 py-0">{e.source}</Badge></TableCell>
                                      <TableCell className="py-1.5">{e.category}</TableCell>
                                      <TableCell className="py-1.5 text-right">{fmtRs(e.amount)}</TableCell>
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
                {monthly.some((m) => m.total > 0) && (
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right">{fmtRs(monthly.reduce((s, m) => s + m.pettyCash, 0))}</TableCell>
                    <TableCell className="text-right">{fmtRs(monthly.reduce((s, m) => s + m.general, 0))}</TableCell>
                    <TableCell className="text-right">{fmtRs(monthly.reduce((s, m) => s + m.utilities, 0))}</TableCell>
                    <TableCell className="text-center">{monthly.reduce((s, m) => s + m.count, 0)}</TableCell>
                    <TableCell className="text-right">{fmtRs(metrics.total)}</TableCell>
                    <TableCell className="text-right">100%</TableCell>
                  </TableRow>
                )}
                {!isLoading && metrics.total === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No operating expenses found for this period</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
