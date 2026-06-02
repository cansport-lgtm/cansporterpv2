import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, ComposedChart, Line, AreaChart, Area,
} from "recharts";
import {
  Download, TrendingUp, TrendingDown, Users, Package, ArrowRightLeft, Trophy, Target, Repeat,
} from "lucide-react";
import { format, parseISO, startOfMonth, endOfMonth, startOfYear, subDays, differenceInCalendarDays, eachMonthOfInterval, addDays } from "date-fns";
import * as XLSX from "xlsx";

const sb = supabase as any;

const PRESETS = [
  { key: "this_month", label: "This Month" },
  { key: "last_30", label: "Last 30 Days" },
  { key: "last_90", label: "Last 90 Days" },
  { key: "ytd", label: "Year to Date" },
  { key: "last_month", label: "Last Month" },
  { key: "custom", label: "Custom" },
];

function applyPreset(preset: string): { from: string; to: string } {
  const today = new Date();
  if (preset === "this_month") return { from: format(startOfMonth(today), "yyyy-MM-dd"), to: format(today, "yyyy-MM-dd") };
  if (preset === "last_30") return { from: format(subDays(today, 29), "yyyy-MM-dd"), to: format(today, "yyyy-MM-dd") };
  if (preset === "last_90") return { from: format(subDays(today, 89), "yyyy-MM-dd"), to: format(today, "yyyy-MM-dd") };
  if (preset === "ytd") return { from: format(startOfYear(today), "yyyy-MM-dd"), to: format(today, "yyyy-MM-dd") };
  if (preset === "last_month") {
    const firstOfThisMonth = startOfMonth(today);
    const lastMonthEnd = subDays(firstOfThisMonth, 1);
    return { from: format(startOfMonth(lastMonthEnd), "yyyy-MM-dd"), to: format(lastMonthEnd, "yyyy-MM-dd") };
  }
  return { from: format(startOfMonth(today), "yyyy-MM-dd"), to: format(today, "yyyy-MM-dd") };
}

function priorPeriod(from: string, to: string): { from: string; to: string } {
  const f = parseISO(from);
  const t = parseISO(to);
  const days = differenceInCalendarDays(t, f) + 1;
  const prevTo = subDays(f, 1);
  const prevFrom = subDays(prevTo, days - 1);
  return { from: format(prevFrom, "yyyy-MM-dd"), to: format(prevTo, "yyyy-MM-dd") };
}

type LineRow = {
  dispatch_id: string;
  dispatch_date: string;
  sales_segment: string;
  order_id: string;
  order_number: string;
  order_date: string;
  customer_id: string;
  customer_name: string;
  product_id: string;
  product_name: string;
  product_code: string;
  qty: number;
  price: number;
  amount: number;
};

async function fetchDispatchLines(fromDate: string, toDate: string, segment: string): Promise<LineRow[]> {
  let dq = sb
    .from("sales_dispatches")
    .select("id, dispatch_date, sales_segment, order_id")
    .gte("dispatch_date", fromDate)
    .lte("dispatch_date", toDate);
  if (segment !== "all") dq = dq.eq("sales_segment", segment);
  const { data: dispatches, error: dErr } = await dq;
  if (dErr) throw dErr;
  const dispatchIds = (dispatches || []).map((d: any) => d.id);
  if (!dispatchIds.length) return [];
  const { data: items, error: iErr } = await sb
    .from("sales_dispatch_items")
    .select("dispatch_id, quantity_dozens, order_item:sales_order_items(price_per_dozen, product_id, products:product_id(name, code), sales_orders:order_id(id, order_number, order_date, customer_id, customers:customer_id(id, name)))")
    .in("dispatch_id", dispatchIds);
  if (iErr) throw iErr;
  const dispatchMap: Record<string, any> = {};
  (dispatches || []).forEach((d: any) => (dispatchMap[d.id] = d));
  const rows: LineRow[] = [];
  (items || []).forEach((row: any) => {
    const d = dispatchMap[row.dispatch_id];
    if (!d) return;
    const oi = row.order_item;
    if (!oi) return;
    const order = oi.sales_orders || {};
    const customer = order.customers || {};
    const product = oi.products || {};
    const qty = Number(row.quantity_dozens || 0);
    const price = Number(oi.price_per_dozen || 0);
    rows.push({
      dispatch_id: row.dispatch_id,
      dispatch_date: d.dispatch_date,
      sales_segment: d.sales_segment,
      order_id: order.id || "",
      order_number: order.order_number || "",
      order_date: order.order_date || "",
      customer_id: customer.id || "unknown",
      customer_name: customer.name || "—",
      product_id: oi.product_id || "unknown",
      product_name: product.name || "—",
      product_code: product.code || "",
      qty,
      price,
      amount: qty * price,
    });
  });
  return rows;
}

export default function SalesAnalysisPage() {
  const initial = applyPreset("last_30");
  const [preset, setPreset] = useState("last_30");
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);
  const [segment, setSegment] = useState<"all" | "domestic" | "export" | "private_label">("all");

  const onPresetChange = (val: string) => {
    setPreset(val);
    if (val !== "custom") {
      const r = applyPreset(val);
      setFromDate(r.from);
      setToDate(r.to);
    }
  };

  const prior = useMemo(() => priorPeriod(fromDate, toDate), [fromDate, toDate]);

  const { data: lines, isLoading } = useQuery({
    queryKey: ["sa-current-lines", fromDate, toDate, segment],
    queryFn: () => fetchDispatchLines(fromDate, toDate, segment),
  });

  const { data: priorLines } = useQuery({
    queryKey: ["sa-prior-lines", prior.from, prior.to, segment],
    queryFn: () => fetchDispatchLines(prior.from, prior.to, segment),
  });

  // KPIs current period
  const grossSales = (lines || []).reduce((s, r) => s + r.amount, 0);
  const totalQty = (lines || []).reduce((s, r) => s + r.qty, 0);
  const dispatchSet = new Set((lines || []).map((r) => r.dispatch_id));
  const orderSet = new Set((lines || []).map((r) => r.order_id).filter(Boolean));
  const customerSet = new Set((lines || []).map((r) => r.customer_id).filter(Boolean));
  const productSet = new Set((lines || []).map((r) => r.product_id).filter(Boolean));
  const aov = orderSet.size > 0 ? grossSales / orderSet.size : 0;
  const arpc = customerSet.size > 0 ? grossSales / customerSet.size : 0;

  // KPIs prior period
  const priorGross = (priorLines || []).reduce((s, r) => s + r.amount, 0);
  const priorCustomers = new Set((priorLines || []).map((r) => r.customer_id).filter(Boolean));
  const priorOrders = new Set((priorLines || []).map((r) => r.order_id).filter(Boolean));
  const priorAOV = priorOrders.size > 0 ? priorGross / priorOrders.size : 0;

  const grossDelta = priorGross > 0 ? ((grossSales - priorGross) / priorGross) * 100 : 0;
  const customerDelta = priorCustomers.size > 0 ? ((customerSet.size - priorCustomers.size) / priorCustomers.size) * 100 : 0;
  const aovDelta = priorAOV > 0 ? ((aov - priorAOV) / priorAOV) * 100 : 0;

  // Repeat customer ratio (customers with > 1 order in period)
  const ordersPerCustomer = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    (lines || []).forEach((r) => {
      if (!r.customer_id) return;
      (map[r.customer_id] ||= new Set()).add(r.order_id);
    });
    return map;
  }, [lines]);
  const repeatCustomers = Object.values(ordersPerCustomer).filter((s) => s.size > 1).length;
  const repeatRatio = customerSet.size > 0 ? (repeatCustomers / customerSet.size) * 100 : 0;

  // New vs returning: customer appeared in prior period?
  const newCustomers = useMemo(() => {
    const prevSet = priorCustomers;
    return Array.from(customerSet).filter((c) => !prevSet.has(c)).length;
  }, [customerSet, priorCustomers]);

  // Customer ranking with Pareto cumulative %
  const customerRows = useMemo(() => {
    const map: Record<string, { id: string; name: string; revenue: number; qty: number; orders: Set<string>; dispatches: Set<string> }> = {};
    (lines || []).forEach((r) => {
      const id = r.customer_id || "unknown";
      if (!map[id]) map[id] = { id, name: r.customer_name, revenue: 0, qty: 0, orders: new Set(), dispatches: new Set() };
      map[id].revenue += r.amount;
      map[id].qty += r.qty;
      if (r.order_id) map[id].orders.add(r.order_id);
      map[id].dispatches.add(r.dispatch_id);
    });
    const rows = Object.values(map).map((c) => ({
      id: c.id,
      name: c.name,
      revenue: c.revenue,
      qty: c.qty,
      orders: c.orders.size,
      dispatches: c.dispatches.size,
    })).sort((a, b) => b.revenue - a.revenue);
    let cum = 0;
    return rows.map((c) => {
      cum += c.revenue;
      return { ...c, cumulative: cum, cumulativePct: grossSales > 0 ? (cum / grossSales) * 100 : 0, share: grossSales > 0 ? (c.revenue / grossSales) * 100 : 0 };
    });
  }, [lines, grossSales]);

  // 80/20 rule — customers driving 80% of revenue
  const top80Index = customerRows.findIndex((c) => c.cumulativePct >= 80);
  const top80Count = top80Index >= 0 ? top80Index + 1 : customerRows.length;
  const top80Share = customerRows.length > 0 ? (top80Count / customerRows.length) * 100 : 0;

  // Top 5 / Top 10 concentration
  const top5Revenue = customerRows.slice(0, 5).reduce((s, c) => s + c.revenue, 0);
  const top10Revenue = customerRows.slice(0, 10).reduce((s, c) => s + c.revenue, 0);
  const top5Share = grossSales > 0 ? (top5Revenue / grossSales) * 100 : 0;
  const top10Share = grossSales > 0 ? (top10Revenue / grossSales) * 100 : 0;

  // Product rankings
  const productRows = useMemo(() => {
    const map: Record<string, { id: string; name: string; code: string; revenue: number; qty: number; customers: Set<string> }> = {};
    (lines || []).forEach((r) => {
      const id = r.product_id || "unknown";
      if (!map[id]) map[id] = { id, name: r.product_name, code: r.product_code, revenue: 0, qty: 0, customers: new Set() };
      map[id].revenue += r.amount;
      map[id].qty += r.qty;
      if (r.customer_id) map[id].customers.add(r.customer_id);
    });
    return Object.values(map).map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      revenue: p.revenue,
      qty: p.qty,
      customers: p.customers.size,
      avgPrice: p.qty > 0 ? p.revenue / p.qty : 0,
    })).sort((a, b) => b.revenue - a.revenue);
  }, [lines]);

  // Segment breakdown
  const segmentRows = useMemo(() => {
    const map: Record<string, { segment: string; revenue: number; qty: number; customers: Set<string> }> = {};
    (lines || []).forEach((r) => {
      const k = r.sales_segment || "domestic";
      if (!map[k]) map[k] = { segment: k, revenue: 0, qty: 0, customers: new Set() };
      map[k].revenue += r.amount;
      map[k].qty += r.qty;
      if (r.customer_id) map[k].customers.add(r.customer_id);
    });
    return Object.values(map).map((s) => ({ ...s, customers: s.customers.size, share: grossSales > 0 ? (s.revenue / grossSales) * 100 : 0 }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [lines, grossSales]);

  // Monthly trend (current vs prior period overlay by month bucket)
  const monthlyTrend = useMemo(() => {
    if (!fromDate || !toDate) return [];
    const start = parseISO(fromDate);
    const end = parseISO(toDate);
    if (end < start) return [];
    const months = eachMonthOfInterval({ start, end });
    return months.map((m) => {
      const monthStart = startOfMonth(m);
      const monthEnd = endOfMonth(m);
      const revenue = (lines || [])
        .filter((r) => {
          const d = parseISO(r.dispatch_date);
          return d >= monthStart && d <= monthEnd;
        })
        .reduce((s, r) => s + r.amount, 0);
      const qty = (lines || [])
        .filter((r) => {
          const d = parseISO(r.dispatch_date);
          return d >= monthStart && d <= monthEnd;
        })
        .reduce((s, r) => s + r.qty, 0);
      return {
        month: format(m, "MMM yy"),
        revenue: Math.round(revenue),
        qty: Math.round(qty),
      };
    });
  }, [lines, fromDate, toDate]);

  // Daily revenue (last 30 days area chart, if window is ≤ 90 days)
  const dailyTrend = useMemo(() => {
    if (!fromDate || !toDate) return [];
    const start = parseISO(fromDate);
    const end = parseISO(toDate);
    const days = differenceInCalendarDays(end, start) + 1;
    if (days <= 0 || days > 92) return [];
    const result: { day: string; revenue: number }[] = [];
    for (let i = 0; i < days; i++) {
      const d = addDays(start, i);
      const dStr = format(d, "yyyy-MM-dd");
      const revenue = (lines || [])
        .filter((r) => r.dispatch_date === dStr)
        .reduce((s, r) => s + r.amount, 0);
      result.push({ day: format(d, "dd MMM"), revenue: Math.round(revenue) });
    }
    return result;
  }, [lines, fromDate, toDate]);

  // Order → Dispatch cycle: avg days
  const cycleTime = useMemo(() => {
    if (!lines || !lines.length) return { avg: 0, count: 0 };
    let total = 0;
    let count = 0;
    lines.forEach((r) => {
      if (!r.order_date || !r.dispatch_date) return;
      const days = differenceInCalendarDays(parseISO(r.dispatch_date), parseISO(r.order_date));
      if (days < 0 || days > 365) return;
      total += days;
      count += 1;
    });
    return { avg: count > 0 ? total / count : 0, count };
  }, [lines]);

  const handleExport = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { Metric: "Period", Value: `${fromDate} to ${toDate}` },
      { Metric: "Prior Period", Value: `${prior.from} to ${prior.to}` },
      { Metric: "Segment", Value: segment },
      { Metric: "Gross Sales", Value: grossSales },
      { Metric: "Prior Gross Sales", Value: priorGross },
      { Metric: "Growth %", Value: grossDelta.toFixed(2) },
      { Metric: "Total Quantity (Dz)", Value: totalQty },
      { Metric: "# Dispatches", Value: dispatchSet.size },
      { Metric: "# Orders", Value: orderSet.size },
      { Metric: "# Customers", Value: customerSet.size },
      { Metric: "New Customers", Value: newCustomers },
      { Metric: "Repeat Customer %", Value: repeatRatio.toFixed(1) },
      { Metric: "AOV", Value: aov.toFixed(2) },
      { Metric: "Revenue per Customer", Value: arpc.toFixed(2) },
      { Metric: "Top 5 Customer Share %", Value: top5Share.toFixed(1) },
      { Metric: "Top 10 Customer Share %", Value: top10Share.toFixed(1) },
      { Metric: "80% Revenue from # Customers", Value: top80Count },
      { Metric: "Avg Order → Dispatch Days", Value: cycleTime.avg.toFixed(1) },
    ]), "KPIs");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(customerRows.map((c, i) => ({
      Rank: i + 1, Customer: c.name, Revenue: c.revenue, Orders: c.orders, Dispatches: c.dispatches,
      "Qty (Dz)": c.qty, "Share %": c.share.toFixed(2), "Cumulative %": c.cumulativePct.toFixed(2),
    }))), "Customers");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(productRows.map((p, i) => ({
      Rank: i + 1, Code: p.code, Product: p.name, Revenue: p.revenue, "Qty (Dz)": p.qty,
      "Avg Price": p.avgPrice.toFixed(2), Customers: p.customers,
    }))), "Products");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(segmentRows.map((s) => ({
      Segment: s.segment, Revenue: s.revenue, "Qty (Dz)": s.qty, Customers: s.customers, "Share %": s.share.toFixed(2),
    }))), "Segments");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(monthlyTrend), "Monthly");
    XLSX.writeFile(wb, `Sales_Analysis_${fromDate}_to_${toDate}.xlsx`);
  };

  return (
    <ERPLayout>
      <PageHeader title="Sales Analysis" description="Deep insights — growth, concentration, products & customer behaviour">
        <div className="flex flex-wrap gap-2 items-center">
          <Select value={preset} onValueChange={onPresetChange}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRESETS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPreset("custom"); }} className="w-[150px]" />
          <Input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPreset("custom"); }} className="w-[150px]" />
          <Select value={segment} onValueChange={(v) => setSegment(v as any)}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Segments</SelectItem>
              <SelectItem value="domestic">Domestic</SelectItem>
              <SelectItem value="export">Export</SelectItem>
              <SelectItem value="private_label">Private Label</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={handleExport} disabled={!lines?.length}>
            <Download className="h-4 w-4 mr-1" />Export
          </Button>
        </div>
      </PageHeader>

      <div className="text-xs text-muted-foreground mb-4">
        Comparing <span className="font-medium text-foreground">{fromDate} → {toDate}</span> vs prior period <span className="font-medium text-foreground">{prior.from} → {prior.to}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Gross Sales"
          value={`Rs. ${grossSales.toLocaleString()}`}
          icon={TrendingUp}
          trend={priorGross > 0 ? { value: Math.abs(Math.round(grossDelta * 10) / 10), isPositive: grossDelta >= 0 } : undefined}
          description={`vs Rs. ${priorGross.toLocaleString()}`}
        />
        <MetricCard
          title="Unique Customers"
          value={customerSet.size.toString()}
          icon={Users}
          trend={priorCustomers.size > 0 ? { value: Math.abs(Math.round(customerDelta * 10) / 10), isPositive: customerDelta >= 0 } : undefined}
          description={`${newCustomers} new this period`}
        />
        <MetricCard
          title="Avg Order Value"
          value={`Rs. ${aov.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          icon={Package}
          trend={priorAOV > 0 ? { value: Math.abs(Math.round(aovDelta * 10) / 10), isPositive: aovDelta >= 0 } : undefined}
          description={`${orderSet.size} order(s)`}
        />
        <MetricCard
          title="Repeat Customers"
          value={`${repeatRatio.toFixed(0)}%`}
          icon={Repeat}
          description={`${repeatCustomers} of ${customerSet.size} bought 2+ times`}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Trophy className="h-3 w-3" />Top 5 Customers</div>
          <div className="text-2xl font-semibold">{top5Share.toFixed(1)}%</div>
          <div className="text-xs text-muted-foreground">of total revenue</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Trophy className="h-3 w-3" />Top 10 Customers</div>
          <div className="text-2xl font-semibold">{top10Share.toFixed(1)}%</div>
          <div className="text-xs text-muted-foreground">of total revenue</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Target className="h-3 w-3" />80/20 Rule</div>
          <div className="text-2xl font-semibold">{top80Count}</div>
          <div className="text-xs text-muted-foreground">
            customer(s) drive 80% of revenue {customerRows.length > 0 && <span>({top80Share.toFixed(0)}% of base)</span>}
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><ArrowRightLeft className="h-3 w-3" />Order → Dispatch</div>
          <div className="text-2xl font-semibold">{cycleTime.avg.toFixed(1)}d</div>
          <div className="text-xs text-muted-foreground">avg cycle (n={cycleTime.count})</div>
        </CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3"><CardTitle className="text-sm">Revenue Trend</CardTitle></CardHeader>
          <CardContent>
            {dailyTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={dailyTrend}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => `Rs. ${v.toLocaleString()}`} />
                  <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" fill="url(#revGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : monthlyTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="left" dataKey="revenue" fill="hsl(var(--primary))" name="Revenue (Rs.)" />
                  <Line yAxisId="right" type="monotone" dataKey="qty" stroke="hsl(var(--chart-2))" name="Qty (Dz)" />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center text-sm text-muted-foreground py-12">No data in selected range</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Segment Mix</CardTitle></CardHeader>
          <CardContent>
            {segmentRows.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={segmentRows} dataKey="revenue" nameKey="segment" cx="50%" cy="50%" outerRadius={90} label={(e: any) => `${e.segment} ${e.share.toFixed(0)}%`}>
                    {segmentRows.map((_, i) => (
                      <Cell key={i} fill={`hsl(var(--chart-${(i % 5) + 1}))`} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => `Rs. ${v.toLocaleString()}`} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center text-sm text-muted-foreground py-12">No data</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="customers" className="mb-6">
        <TabsList>
          <TabsTrigger value="customers">Customer Leaderboard</TabsTrigger>
          <TabsTrigger value="products">Product Leaderboard</TabsTrigger>
          <TabsTrigger value="pareto">Pareto / Concentration</TabsTrigger>
        </TabsList>

        <TabsContent value="customers">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">#</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Dispatches</TableHead>
                    <TableHead className="text-right">Qty (Dz)</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Share %</TableHead>
                    <TableHead className="text-right">Cumulative %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!customerRows.length && (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No data</TableCell></TableRow>
                  )}
                  {customerRows.slice(0, 50).map((c, i) => (
                    <TableRow key={c.id}>
                      <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="text-sm">
                        {c.name}{" "}
                        {i < top80Count && <Badge variant="outline" className="ml-1 text-[10px] py-0">80%</Badge>}
                      </TableCell>
                      <TableCell className="text-right">{c.orders}</TableCell>
                      <TableCell className="text-right">{c.dispatches}</TableCell>
                      <TableCell className="text-right">{c.qty.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-medium">Rs. {c.revenue.toLocaleString()}</TableCell>
                      <TableCell className="text-right text-xs">{c.share.toFixed(1)}%</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{c.cumulativePct.toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {customerRows.length > 50 && (
                <div className="px-4 py-2 text-xs text-muted-foreground border-t">
                  Showing top 50 of {customerRows.length}. Export for full list.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="products">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">#</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty (Dz)</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Avg Price/Dz</TableHead>
                    <TableHead className="text-right">Customers</TableHead>
                    <TableHead className="text-right">Share %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!productRows.length && (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No data</TableCell></TableRow>
                  )}
                  {productRows.slice(0, 50).map((p, i) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-mono text-xs">{p.code || "—"}</TableCell>
                      <TableCell className="text-sm">{p.name}</TableCell>
                      <TableCell className="text-right">{p.qty.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-medium">Rs. {p.revenue.toLocaleString()}</TableCell>
                      <TableCell className="text-right text-xs">Rs. {p.avgPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                      <TableCell className="text-right">{p.customers}</TableCell>
                      <TableCell className="text-right text-xs">{grossSales > 0 ? `${((p.revenue / grossSales) * 100).toFixed(1)}%` : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {productRows.length > 50 && (
                <div className="px-4 py-2 text-xs text-muted-foreground border-t">
                  Showing top 50 of {productRows.length}. Export for full list.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pareto">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Customer Pareto — Revenue Concentration</CardTitle>
            </CardHeader>
            <CardContent>
              {customerRows.length > 0 ? (
                <ResponsiveContainer width="100%" height={400}>
                  <ComposedChart data={customerRows.slice(0, 25)}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={90} interval={0} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      formatter={(v: number, name: string) =>
                        name === "Cumulative %" ? `${v.toFixed(1)}%` : `Rs. ${v.toLocaleString()}`
                      }
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar yAxisId="left" dataKey="revenue" fill="hsl(var(--primary))" name="Revenue" />
                    <Line yAxisId="right" type="monotone" dataKey="cumulativePct" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} name="Cumulative %" />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center text-sm text-muted-foreground py-12">No data</div>
              )}
              <div className="mt-4 text-xs text-muted-foreground">
                The red line shows cumulative revenue % as we move through customers ranked by sales. Where it crosses 80% reveals your "vital few" — the customers driving the bulk of your business. Concentration risk is high if just a handful of customers cover 80%+.
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Period Comparison</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metric</TableHead>
                <TableHead className="text-right">Current ({fromDate} → {toDate})</TableHead>
                <TableHead className="text-right">Prior ({prior.from} → {prior.to})</TableHead>
                <TableHead className="text-right">Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Gross Sales</TableCell>
                <TableCell className="text-right font-medium">Rs. {grossSales.toLocaleString()}</TableCell>
                <TableCell className="text-right">Rs. {priorGross.toLocaleString()}</TableCell>
                <TableCell className={`text-right text-xs ${grossDelta >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {grossDelta >= 0 ? <TrendingUp className="h-3 w-3 inline mr-1" /> : <TrendingDown className="h-3 w-3 inline mr-1" />}
                  {priorGross > 0 ? `${grossDelta.toFixed(1)}%` : "—"}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Unique Customers</TableCell>
                <TableCell className="text-right font-medium">{customerSet.size}</TableCell>
                <TableCell className="text-right">{priorCustomers.size}</TableCell>
                <TableCell className={`text-right text-xs ${customerDelta >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {priorCustomers.size > 0 ? `${customerDelta.toFixed(1)}%` : "—"}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Orders</TableCell>
                <TableCell className="text-right font-medium">{orderSet.size}</TableCell>
                <TableCell className="text-right">{priorOrders.size}</TableCell>
                <TableCell className="text-right text-xs">
                  {priorOrders.size > 0 ? `${(((orderSet.size - priorOrders.size) / priorOrders.size) * 100).toFixed(1)}%` : "—"}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Avg Order Value</TableCell>
                <TableCell className="text-right font-medium">Rs. {aov.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                <TableCell className="text-right">Rs. {priorAOV.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                <TableCell className={`text-right text-xs ${aovDelta >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {priorAOV > 0 ? `${aovDelta.toFixed(1)}%` : "—"}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {isLoading && <div className="text-center text-sm text-muted-foreground py-4">Loading...</div>}
    </ERPLayout>
  );
}
