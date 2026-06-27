import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  format,
  parseISO,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  eachMonthOfInterval,
  isWithinInterval,
} from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import {
  DollarSign,
  TrendingUp,
  CalendarRange,
  Layers,
  CalendarIcon,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  PieChart as RePieChart,
  Pie,
  Cell,
} from "recharts";

const COLORS = ["hsl(var(--primary))", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#3b82f6", "#14b8a6"];

const fmtRs = (n: number) => `₹${Math.round(n).toLocaleString()}`;

/**
 * Operating Expenses Analysis
 *
 * Month-wise analysis of operating expenses (petty cash expenses + general
 * expenses + utility bills). By default it analyses a full calendar year and
 * breaks the spend down month by month. A custom date-range filter can be
 * applied to scope the whole analysis to an arbitrary period.
 */
export default function OperatingExpensesAnalysisPage() {
  const currentDate = new Date();
  const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  const customActive = !!(fromDate && toDate);

  // The effective analysis window: a custom range when both ends are set,
  // otherwise the whole selected calendar year.
  const rangeStart = customActive ? startOfMonth(fromDate!) : startOfYear(new Date(selectedYear, 0, 1));
  const rangeEnd = customActive ? endOfMonth(toDate!) : endOfYear(new Date(selectedYear, 0, 1));
  const rangeStartStr = format(rangeStart, "yyyy-MM-dd");
  const rangeEndStr = format(rangeEnd, "yyyy-MM-dd");

  const { data: pettyCash = [], isLoading: l1 } = useQuery({
    queryKey: ["opex-petty", rangeStartStr, rangeEndStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("petty_cash_entries")
        .select("entry_date, amount, entry_type, expense_categories(name)")
        .eq("entry_type", "expense")
        .gte("entry_date", rangeStartStr)
        .lte("entry_date", rangeEndStr);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: general = [], isLoading: l2 } = useQuery({
    queryKey: ["opex-general", rangeStartStr, rangeEndStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("general_expenses")
        .select("expense_date, total_amount, expense_categories(name)")
        .gte("expense_date", rangeStartStr)
        .lte("expense_date", rangeEndStr);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: utilities = [], isLoading: l3 } = useQuery({
    queryKey: ["opex-utilities", rangeStartStr, rangeEndStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("utility_bills")
        .select("bill_date, total_amount, utility_types(name)")
        .gte("bill_date", rangeStartStr)
        .lte("bill_date", rangeEndStr);
      if (error) throw error;
      return data || [];
    },
  });

  const isLoading = l1 || l2 || l3;

  // Normalise every source into a single shape: { date, amount, source, category }.
  const allEntries = useMemo(() => {
    const rows: Array<{ date: string; amount: number; source: string; category: string }> = [];
    pettyCash.forEach((e: any) =>
      rows.push({
        date: e.entry_date,
        amount: Number(e.amount || 0),
        source: "Petty Cash",
        category: e.expense_categories?.name || "Uncategorized",
      }),
    );
    general.forEach((e: any) =>
      rows.push({
        date: e.expense_date,
        amount: Number(e.total_amount || 0),
        source: "General",
        category: e.expense_categories?.name || "Uncategorized",
      }),
    );
    utilities.forEach((b: any) =>
      rows.push({
        date: b.bill_date,
        amount: Number(b.total_amount || 0),
        source: "Utilities",
        category: `Utility - ${b.utility_types?.name || "Other"}`,
      }),
    );
    return rows;
  }, [pettyCash, general, utilities]);

  // Month-wise breakdown across the analysis window.
  const monthly = useMemo(() => {
    const months = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });
    const buckets = months.map((m) => ({
      key: format(m, "yyyy-MM"),
      label: format(m, "MMM yy"),
      start: startOfMonth(m),
      end: endOfMonth(m),
      pettyCash: 0,
      general: 0,
      utilities: 0,
      total: 0,
      count: 0,
    }));
    const index = new Map(buckets.map((b) => [b.key, b]));
    allEntries.forEach((r) => {
      if (!r.date) return;
      const key = r.date.slice(0, 7); // yyyy-MM
      const bucket = index.get(key);
      if (!bucket) return;
      if (r.source === "Petty Cash") bucket.pettyCash += r.amount;
      else if (r.source === "General") bucket.general += r.amount;
      else bucket.utilities += r.amount;
      bucket.total += r.amount;
      bucket.count += 1;
    });
    return buckets;
  }, [allEntries, rangeStart, rangeEnd]);

  // Headline metrics.
  const metrics = useMemo(() => {
    const total = allEntries.reduce((s, r) => s + r.amount, 0);
    const monthsWithSpend = monthly.filter((m) => m.total > 0).length;
    const avgPerMonth = monthsWithSpend > 0 ? total / monthsWithSpend : 0;
    const peak = monthly.reduce(
      (best, m) => (m.total > best.total ? { label: m.label, total: m.total } : best),
      { label: "—", total: 0 },
    );
    return {
      total,
      avgPerMonth,
      peak,
      months: monthly.length,
    };
  }, [allEntries, monthly]);

  // Source split (for the pie + cards).
  const bySource = useMemo(() => {
    const map = new Map<string, number>();
    allEntries.forEach((r) => map.set(r.source, (map.get(r.source) || 0) + r.amount));
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [allEntries]);

  // Category-wise breakdown table.
  const byCategory = useMemo(() => {
    const map = new Map<string, { amount: number; count: number }>();
    allEntries.forEach((r) => {
      const cur = map.get(r.category) || { amount: 0, count: 0 };
      cur.amount += r.amount;
      cur.count += 1;
      map.set(r.category, cur);
    });
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.amount - a.amount);
  }, [allEntries]);

  const months = [
    { value: 1, label: "January" }, { value: 2, label: "February" }, { value: 3, label: "March" },
    { value: 4, label: "April" }, { value: 5, label: "May" }, { value: 6, label: "June" },
    { value: 7, label: "July" }, { value: 8, label: "August" }, { value: 9, label: "September" },
    { value: 10, label: "October" }, { value: 11, label: "November" }, { value: 12, label: "December" },
  ];
  const years = Array.from({ length: 6 }, (_, i) => currentDate.getFullYear() - 4 + i);

  const periodLabel = customActive
    ? `${format(fromDate!, "dd MMM yyyy")} – ${format(toDate!, "dd MMM yyyy")}`
    : `Year ${selectedYear}`;

  return (
    <ERPLayout>
      <div className="space-y-6">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <PageHeader
            title="Operating Expenses Analysis"
            description="Month-wise analysis of operating expenses with custom date filters"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={selectedYear.toString()}
              onValueChange={(v) => setSelectedYear(parseInt(v))}
              disabled={customActive}
            >
              <SelectTrigger className="w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("h-9 text-xs justify-start", !fromDate && "text-muted-foreground")}>
                  <CalendarIcon className="mr-1 h-3 w-3" />
                  {fromDate ? format(fromDate, "dd MMM yyyy") : "From"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={fromDate} onSelect={setFromDate} initialFocus className={cn("p-3 pointer-events-auto")} />
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("h-9 text-xs justify-start", !toDate && "text-muted-foreground")}>
                  <CalendarIcon className="mr-1 h-3 w-3" />
                  {toDate ? format(toDate, "dd MMM yyyy") : "To"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={toDate} onSelect={setToDate} initialFocus className={cn("p-3 pointer-events-auto")} />
              </PopoverContent>
            </Popover>
            {(fromDate || toDate) && (
              <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={() => { setFromDate(undefined); setToDate(undefined); }}>
                Clear
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline" className="font-normal">
            <CalendarRange className="h-3 w-3 mr-1" />
            {periodLabel}
          </Badge>
          {customActive && <span className="text-xs">Custom date filter active — month selector is disabled.</span>}
        </div>

        {/* Headline metrics */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Total Operating Expenses"
            value={fmtRs(metrics.total)}
            icon={DollarSign}
            description={periodLabel}
          />
          <MetricCard
            title="Avg / Active Month"
            value={fmtRs(metrics.avgPerMonth)}
            icon={TrendingUp}
            description="Average monthly spend"
          />
          <MetricCard
            title="Peak Month"
            value={fmtRs(metrics.peak.total)}
            icon={CalendarRange}
            description={metrics.peak.label}
          />
          <MetricCard
            title="Categories"
            value={byCategory.length.toString()}
            icon={Layers}
            description={`${allEntries.length} entries`}
          />
        </div>

        {/* Month-wise stacked bar chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Month-wise Operating Expenses</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[340px]">
              {isLoading ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Loading…</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthly}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={monthly.length > 12 ? -35 : 0} textAnchor={monthly.length > 12 ? "end" : "middle"} height={monthly.length > 12 ? 50 : 30} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => (v >= 1000 ? `₹${(v / 1000).toFixed(0)}k` : `₹${v}`)} />
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
          {/* Source split pie */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Spend by Source</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                {bySource.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No data for this period</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <RePieChart>
                      <Pie
                        data={bySource}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        outerRadius={100}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      >
                        {bySource.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => fmtRs(value)} />
                    </RePieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Category breakdown table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Category-wise Breakdown</CardTitle>
            </CardHeader>
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
                        <TableCell className="text-right">
                          {metrics.total > 0 ? ((c.amount / metrics.total) * 100).toFixed(1) : 0}%
                        </TableCell>
                      </TableRow>
                    ))}
                    {byCategory.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground py-8">No expenses found</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Month-wise detail table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monthly Summary</CardTitle>
          </CardHeader>
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
                    <React.Fragment key={m.key}>
                      <TableRow
                        className={cn("hover:bg-muted/50", m.count > 0 && "cursor-pointer")}
                        onClick={() => m.count > 0 && setExpandedMonth(expandedMonth === m.key ? null : m.key)}
                      >
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-1">
                            {m.count > 0 ? (
                              expandedMonth === m.key ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
                            ) : (
                              <span className="w-3.5" />
                            )}
                            {m.label}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">{fmtRs(m.pettyCash)}</TableCell>
                        <TableCell className="text-right">{fmtRs(m.general)}</TableCell>
                        <TableCell className="text-right">{fmtRs(m.utilities)}</TableCell>
                        <TableCell className="text-center">{m.count}</TableCell>
                        <TableCell className="text-right font-medium">{fmtRs(m.total)}</TableCell>
                        <TableCell className="text-right">
                          {metrics.total > 0 ? ((m.total / metrics.total) * 100).toFixed(1) : 0}%
                        </TableCell>
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
                                      <TableCell className="py-1.5">
                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">{e.source}</Badge>
                                      </TableCell>
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
                    </React.Fragment>
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
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No operating expenses found for this period</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
