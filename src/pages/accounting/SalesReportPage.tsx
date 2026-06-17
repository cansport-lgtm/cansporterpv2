import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/accounting/fetchAllRows";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";
import {
  Download, TrendingUp, RotateCcw, ShoppingCart, Users, Package, CheckCircle, AlertTriangle,
} from "lucide-react";
import { format, parseISO, startOfMonth, endOfMonth, startOfYear, subDays, eachMonthOfInterval } from "date-fns";
import * as XLSX from "xlsx";

const sb = supabase as any;
const SEGMENT_COLORS: Record<string, string> = {
  domestic: "hsl(var(--primary))",
  export: "hsl(var(--chart-2))",
  private_label: "hsl(var(--chart-3))",
};

type DispatchRow = {
  id: string;
  dispatch_number: string;
  dispatch_date: string;
  sales_segment: string;
  delivery_status: string;
  order_id: string;
  amount: number;
  qtyDozens: number;
  customer_id: string | null;
  customer_name: string;
};

type ReturnRow = {
  id: string;
  return_date: string;
  total_amount: number;
  customer_id: string | null;
  customer_name: string;
  status: string;
  sales_segment: string;
};

const PRESETS = [
  { key: "this_month", label: "This Month" },
  { key: "last_30", label: "Last 30 Days" },
  { key: "ytd", label: "Year to Date" },
  { key: "last_month", label: "Last Month" },
  { key: "custom", label: "Custom" },
];

function applyPreset(preset: string): { from: string; to: string } {
  const today = new Date();
  if (preset === "this_month") return { from: format(startOfMonth(today), "yyyy-MM-dd"), to: format(today, "yyyy-MM-dd") };
  if (preset === "last_30") return { from: format(subDays(today, 29), "yyyy-MM-dd"), to: format(today, "yyyy-MM-dd") };
  if (preset === "ytd") return { from: format(startOfYear(today), "yyyy-MM-dd"), to: format(today, "yyyy-MM-dd") };
  if (preset === "last_month") {
    const firstOfThisMonth = startOfMonth(today);
    const lastMonthEnd = subDays(firstOfThisMonth, 1);
    return { from: format(startOfMonth(lastMonthEnd), "yyyy-MM-dd"), to: format(lastMonthEnd, "yyyy-MM-dd") };
  }
  return { from: format(startOfMonth(today), "yyyy-MM-dd"), to: format(today, "yyyy-MM-dd") };
}

export default function SalesReportPage() {
  const initial = applyPreset("this_month");
  const [preset, setPreset] = useState("this_month");
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

  // Dispatches with segment filter applied
  const { data: dispatches, isLoading: dispatchesLoading } = useQuery<DispatchRow[]>({
    queryKey: ["sales-report-dispatches", fromDate, toDate, segment],
    queryFn: async () => {
      let q = sb
        .from("sales_dispatches")
        .select("id, dispatch_number, dispatch_date, sales_segment, delivery_status, order_id")
        .gte("dispatch_date", fromDate)
        .lte("dispatch_date", toDate);
      if (segment !== "all") q = q.eq("sales_segment", segment);
      const { data, error } = await q.order("dispatch_date", { ascending: false });
      if (error) throw error;
      return (data || []).map((d: any) => ({
        ...d, amount: 0, qtyDozens: 0, customer_id: null, customer_name: "—",
      }));
    },
  });

  const dispatchIds = useMemo(() => (dispatches || []).map((d) => d.id), [dispatches]);

  // Item-level: amount & qty per dispatch + customer mapping (via order)
  const { data: itemMap } = useQuery({
    queryKey: ["sales-report-items", dispatchIds.join(",")],
    queryFn: async () => {
      if (!dispatchIds.length) return {} as Record<string, { amount: number; qty: number; customerId: string | null; customerName: string }>;
      const { data, error } = await sb
        .from("sales_dispatch_items")
        .select("dispatch_id, quantity_dozens, order_item:sales_order_items(price_per_dozen, sales_orders:order_id(customer_id, customers:customer_id(id, name)))")
        .in("dispatch_id", dispatchIds);
      if (error) throw error;
      const map: Record<string, { amount: number; qty: number; customerId: string | null; customerName: string }> = {};
      (data || []).forEach((row: any) => {
        const qty = Number(row.quantity_dozens || 0);
        const price = Number(row.order_item?.price_per_dozen || 0);
        const amount = qty * price;
        const customer = row.order_item?.sales_orders?.customers || null;
        const existing = map[row.dispatch_id] || { amount: 0, qty: 0, customerId: null, customerName: "—" };
        existing.amount += amount;
        existing.qty += qty;
        if (customer && !existing.customerId) {
          existing.customerId = customer.id;
          existing.customerName = customer.name;
        }
        map[row.dispatch_id] = existing;
      });
      return map;
    },
    enabled: dispatchIds.length > 0,
  });

  // Returns (posted only, by return_date)
  const { data: returns } = useQuery<ReturnRow[]>({
    queryKey: ["sales-report-returns", fromDate, toDate, segment],
    queryFn: async () => {
      let q = sb
        .from("sales_returns")
        .select("id, return_date, total_amount, status, customer_id, dispatch:dispatch_id(sales_segment), customers:customer_id(name)")
        .gte("return_date", fromDate)
        .lte("return_date", toDate)
        .eq("status", "posted");
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data || []).map((r: any) => ({
        id: r.id,
        return_date: r.return_date,
        total_amount: Number(r.total_amount || 0),
        customer_id: r.customer_id,
        customer_name: r.customers?.name || "—",
        status: r.status,
        sales_segment: r.dispatch?.sales_segment || "domestic",
      }));
      if (segment !== "all") rows = rows.filter((r: any) => r.sales_segment === segment);
      return rows;
    },
  });

  // GL-posted reconciliation: count of dispatches with posted vouchers
  const { data: postedMap } = useQuery({
    queryKey: ["sales-report-posted", dispatchIds.join(",")],
    queryFn: async () => {
      if (!dispatchIds.length) return {} as Record<string, number>;
      const { data, error } = await sb
        .from("accounting_vouchers")
        .select("source_reference_id, total_amount")
        .eq("source_module", "domestic_sales")
        .in("source_reference_id", dispatchIds);
      if (error) throw error;
      const map: Record<string, number> = {};
      (data || []).forEach((v: any) => {
        map[v.source_reference_id] = (map[v.source_reference_id] || 0) + Number(v.total_amount || 0);
      });
      return map;
    },
    enabled: dispatchIds.length > 0,
  });

  // ── GL-based reconciliation ──────────────────────────────────────────────
  // Revenue figures computed the SAME way the Profit & Loss does: sum of
  // (credit − debit) over active revenue accounts, by voucher_date. This makes
  // the "Net Sales (per GL)" figure equal the P&L "Total Revenue" by construction.
  // NOTE: posted ledger is not segment-tagged, so this block ignores the segment filter.
  const { data: glRevenueAccounts } = useQuery({
    queryKey: ["sales-report-gl-accounts"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_chart_of_accounts")
        .select("id, code, name, account_type, sub_category")
        .eq("account_type", "revenue")
        .eq("is_active", true)
        .not("sub_category", "is", null)
        .order("sort_order")
        .order("code");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: glRevenueLines } = useQuery({
    queryKey: ["sales-report-gl-lines", fromDate, toDate],
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

  const glRevenue = useMemo(() => {
    const totals: Record<string, { dr: number; cr: number }> = {};
    (glRevenueLines || []).forEach((l: any) => {
      if (!totals[l.account_id]) totals[l.account_id] = { dr: 0, cr: 0 };
      totals[l.account_id].dr += Number(l.debit_amount || 0);
      totals[l.account_id].cr += Number(l.credit_amount || 0);
    });
    const accountRows = (glRevenueAccounts || [])
      .map((a: any) => {
        const t = totals[a.id] || { dr: 0, cr: 0 };
        return { ...a, net: t.cr - t.dr };
      })
      .filter((r: any) => r.net !== 0);
    const netSalesGL = accountRows.reduce((s: number, r: any) => s + r.net, 0);
    return { accountRows, netSalesGL };
  }, [glRevenueAccounts, glRevenueLines]);

  // Enriched rows
  const rows: DispatchRow[] = useMemo(() => {
    return (dispatches || []).map((d) => {
      const item = itemMap?.[d.id];
      return {
        ...d,
        amount: item?.amount || 0,
        qtyDozens: item?.qty || 0,
        customer_id: item?.customerId || null,
        customer_name: item?.customerName || "—",
      };
    });
  }, [dispatches, itemMap]);

  // KPIs
  const grossSales = rows.reduce((s, r) => s + r.amount, 0);
  const totalReturns = (returns || []).reduce((s, r) => s + r.total_amount, 0);
  const netSales = grossSales - totalReturns;
  const totalDozens = rows.reduce((s, r) => s + r.qtyDozens, 0);
  const customerCount = new Set(rows.map((r) => r.customer_id).filter(Boolean)).size;
  const dispatchCount = rows.length;
  const aov = dispatchCount > 0 ? grossSales / dispatchCount : 0;
  const postedDispatches = rows.filter((r) => (postedMap?.[r.id] || 0) > 0).length;
  const reconcilationPct = dispatchCount > 0 ? Math.round((postedDispatches / dispatchCount) * 100) : 0;

  // Delivered goods that carry quantity but no price → value is Rs 0, so the
  // auto-posting routine skips them (postDispatchVoucher.ts: `if (lineAmount <= 0) continue`).
  // The sale never reaches the GL or P&L, silently understating revenue. Surface
  // these so an unpriced order can't quietly drop out of sales.
  const unpricedDispatches = useMemo(
    () =>
      rows.filter(
        (r) => r.qtyDozens > 0 && r.amount === 0 && (postedMap?.[r.id] || 0) === 0,
      ),
    [rows, postedMap],
  );
  const unpricedDozens = unpricedDispatches.reduce((s, r) => s + r.qtyDozens, 0);

  // Segment breakdown
  const segmentBreakdown = useMemo(() => {
    const map: Record<string, { segment: string; gross: number; returns: number; net: number; dispatches: number; qty: number }> = {};
    rows.forEach((r) => {
      const k = r.sales_segment || "domestic";
      if (!map[k]) map[k] = { segment: k, gross: 0, returns: 0, net: 0, dispatches: 0, qty: 0 };
      map[k].gross += r.amount;
      map[k].dispatches += 1;
      map[k].qty += r.qtyDozens;
    });
    (returns || []).forEach((rt: any) => {
      const k = rt.sales_segment || "domestic";
      if (!map[k]) map[k] = { segment: k, gross: 0, returns: 0, net: 0, dispatches: 0, qty: 0 };
      map[k].returns += rt.total_amount;
    });
    Object.values(map).forEach((v) => (v.net = v.gross - v.returns));
    return Object.values(map).sort((a, b) => b.net - a.net);
  }, [rows, returns]);

  // Customer breakdown — top 20
  const customerBreakdown = useMemo(() => {
    const map: Record<string, { id: string; name: string; gross: number; returns: number; net: number; dispatches: number; qty: number }> = {};
    rows.forEach((r) => {
      const id = r.customer_id || "unknown";
      if (!map[id]) map[id] = { id, name: r.customer_name, gross: 0, returns: 0, net: 0, dispatches: 0, qty: 0 };
      map[id].gross += r.amount;
      map[id].dispatches += 1;
      map[id].qty += r.qtyDozens;
    });
    (returns || []).forEach((rt) => {
      const id = rt.customer_id || "unknown";
      if (!map[id]) map[id] = { id, name: rt.customer_name, gross: 0, returns: 0, net: 0, dispatches: 0, qty: 0 };
      map[id].returns += rt.total_amount;
    });
    Object.values(map).forEach((v) => (v.net = v.gross - v.returns));
    return Object.values(map).sort((a, b) => b.net - a.net);
  }, [rows, returns]);

  // Monthly trend (months in range)
  const monthlyTrend = useMemo(() => {
    if (!fromDate || !toDate) return [];
    const start = parseISO(fromDate);
    const end = parseISO(toDate);
    if (end < start) return [];
    const months = eachMonthOfInterval({ start, end });
    return months.map((m) => {
      const monthStart = startOfMonth(m);
      const monthEnd = endOfMonth(m);
      const gross = rows
        .filter((r) => {
          const d = parseISO(r.dispatch_date);
          return d >= monthStart && d <= monthEnd;
        })
        .reduce((s, r) => s + r.amount, 0);
      const rets = (returns || [])
        .filter((rt) => {
          const d = parseISO(rt.return_date);
          return d >= monthStart && d <= monthEnd;
        })
        .reduce((s, r) => s + r.total_amount, 0);
      return {
        month: format(m, "MMM yy"),
        gross: Math.round(gross),
        returns: Math.round(rets),
        net: Math.round(gross - rets),
      };
    });
  }, [rows, returns, fromDate, toDate]);

  const handleExport = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { Metric: "From", Value: fromDate },
      { Metric: "To", Value: toDate },
      { Metric: "Segment", Value: segment },
      { Metric: "Gross Sales", Value: grossSales },
      { Metric: "Sales Returns", Value: totalReturns },
      { Metric: "Net Sales (operational)", Value: netSales },
      { Metric: "Net Sales (per GL — matches P&L)", Value: glRevenue.netSalesGL },
      { Metric: "Total Dispatches", Value: dispatchCount },
      { Metric: "Total Dozens", Value: totalDozens },
      { Metric: "Unique Customers", Value: customerCount },
      { Metric: "Average Order Value", Value: aov.toFixed(2) },
      { Metric: "Posted to GL %", Value: `${reconcilationPct}%` },
    ]), "Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(segmentBreakdown.map((s) => ({
      Segment: s.segment, "Gross Sales": s.gross, Returns: s.returns, "Net Sales": s.net,
      Dispatches: s.dispatches, "Quantity (Dz)": s.qty,
    }))), "Segment");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(customerBreakdown.map((c) => ({
      Customer: c.name, "Gross Sales": c.gross, Returns: c.returns, "Net Sales": c.net,
      Dispatches: c.dispatches, "Quantity (Dz)": c.qty,
    }))), "Customers");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map((r) => ({
      "Dispatch #": r.dispatch_number,
      Date: r.dispatch_date,
      Segment: r.sales_segment,
      Customer: r.customer_name,
      "Qty (Dz)": r.qtyDozens,
      Amount: r.amount,
      "Posted to GL": (postedMap?.[r.id] || 0) > 0 ? "Yes" : "No",
    }))), "Dispatches");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(monthlyTrend), "Monthly Trend");
    XLSX.writeFile(wb, `Sales_Report_${fromDate}_to_${toDate}.xlsx`);
  };

  return (
    <ERPLayout>
      <PageHeader title="Sales Report" description="Revenue, returns & net sales — reconciled against GL postings">
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
              <SelectItem value="domestic">Sales</SelectItem>
              <SelectItem value="export">Export</SelectItem>
              <SelectItem value="private_label">Private Label</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={handleExport} disabled={!rows.length}>
            <Download className="h-4 w-4 mr-1" />Export
          </Button>
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard title="Net Sales (per GL)" value={`Rs. ${glRevenue.netSalesGL.toLocaleString()}`} icon={ShoppingCart} description="Authoritative — matches Profit & Loss" />
        <MetricCard title="Gross Sales (operational)" value={`Rs. ${grossSales.toLocaleString()}`} icon={TrendingUp} description={`${totalDozens.toLocaleString()} dz · order-price estimate`} />
        <MetricCard title="Sales Returns" value={`Rs. ${totalReturns.toLocaleString()}`} icon={RotateCcw} iconColor="text-amber-500" />
        <MetricCard title="Avg Order Value" value={`Rs. ${aov.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} icon={Package} description={`${customerCount} unique customer(s)`} />
      </div>

      {/* Unpriced dispatches — delivered goods with Rs 0 value never post to sales */}
      {unpricedDispatches.length > 0 && (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Delivered but unpriced — missing from sales</AlertTitle>
          <AlertDescription>
            <div className="space-y-1">
              <p>
                <strong>{unpricedDispatches.length}</strong> delivered dispatch
                {unpricedDispatches.length === 1 ? "" : "es"} ({unpricedDozens.toLocaleString()} dz) have items but a
                price of <strong>Rs. 0</strong>, so they were <strong>not posted to the ledger</strong> and contribute
                nothing to Net Sales, the GL, or the Profit &amp; Loss. Set the price per dozen on these orders, then
                re-post the dispatch.
              </p>
              <ul className="text-xs list-disc pl-5">
                {unpricedDispatches.slice(0, 10).map((r) => (
                  <li key={r.id}>
                    {r.dispatch_number || r.id.slice(0, 8)} · {r.dispatch_date} · {r.customer_name} ·{" "}
                    {r.qtyDozens.toLocaleString()} dz
                  </li>
                ))}
                {unpricedDispatches.length > 10 && <li>…and {unpricedDispatches.length - 10} more (see Export).</li>}
              </ul>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* GL reconciliation — ties this report to the Profit & Loss "Sales Revenue" */}
      <Card className="mb-6 border-primary/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-primary" />
            Net Sales per General Ledger — matches Profit &amp; Loss
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <div className="text-xs text-muted-foreground">Net Sales (per GL)</div>
              <div className="text-3xl font-bold text-primary">Rs. {glRevenue.netSalesGL.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground mt-2">
                Computed from posted ledger entries on revenue accounts (credit − debit), by voucher date —
                identical to the Profit &amp; Loss "Total Revenue" for the same dates. This is the authoritative
                sales figure. Posted entries aren't segment-tagged, so this total covers all segments and ignores
                the segment filter above.
              </p>
            </div>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-8 text-xs">Revenue Account</TableHead>
                    <TableHead className="h-8 text-xs text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!glRevenue.accountRows.length && (
                    <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground text-sm">No posted revenue in this period</TableCell></TableRow>
                  )}
                  {glRevenue.accountRows.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="py-1 text-sm">{r.code} · {r.name}</TableCell>
                      <TableCell className={`py-1 text-sm text-right ${r.net < 0 ? "text-amber-600" : ""}`}>Rs. {r.net.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/40 font-semibold">
                    <TableCell className="py-1">Net Sales (per GL)</TableCell>
                    <TableCell className="py-1 text-right">Rs. {glRevenue.netSalesGL.toLocaleString()}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
          <div className="mt-4 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Why the operational "Net Sales" above can differ:</span>{" "}
            the operational figure recomputes value from current dispatch prices and subtracts only returns,
            whereas this GL figure uses the amounts actually posted and also nets discounts &amp; adjustments.
            Difference vs operational Net Sales:{" "}
            <span className="font-medium text-foreground">Rs. {(netSales - glRevenue.netSalesGL).toLocaleString()}</span>.
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3"><CardTitle className="text-sm">Monthly Trend</CardTitle></CardHeader>
          <CardContent>
            {monthlyTrend.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-12">No data in selected range</div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => `Rs. ${v.toLocaleString()}`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="gross" stroke="hsl(var(--primary))" strokeWidth={2} name="Gross" />
                  <Line type="monotone" dataKey="returns" stroke="hsl(var(--destructive))" strokeWidth={2} name="Returns" />
                  <Line type="monotone" dataKey="net" stroke="hsl(var(--chart-2))" strokeWidth={2} name="Net" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Segment Mix</CardTitle></CardHeader>
          <CardContent>
            {segmentBreakdown.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-12">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={segmentBreakdown} dataKey="net" nameKey="segment" cx="50%" cy="50%" outerRadius={90} label={(e: any) => e.segment}>
                    {segmentBreakdown.map((s, i) => (
                      <Cell key={i} fill={SEGMENT_COLORS[s.segment] || `hsl(var(--chart-${(i % 5) + 1}))`} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => `Rs. ${v.toLocaleString()}`} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Breakdown by Sales Segment</CardTitle>
          {dispatchCount > 0 && (
            <Badge variant={reconcilationPct === 100 ? "default" : "outline"} className={reconcilationPct === 100 ? "bg-green-600" : "bg-amber-100 text-amber-800"}>
              {reconcilationPct === 100 ? <CheckCircle className="h-3 w-3 mr-1" /> : <AlertTriangle className="h-3 w-3 mr-1" />}
              {postedDispatches}/{dispatchCount} posted to GL ({reconcilationPct}%)
            </Badge>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Segment</TableHead>
                <TableHead className="text-right">Dispatches</TableHead>
                <TableHead className="text-right">Quantity (Dz)</TableHead>
                <TableHead className="text-right">Gross Sales</TableHead>
                <TableHead className="text-right">Returns</TableHead>
                <TableHead className="text-right">Net Sales</TableHead>
                <TableHead className="text-right">% of Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!segmentBreakdown.length && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No sales in selected range</TableCell></TableRow>
              )}
              {segmentBreakdown.map((s) => (
                <TableRow key={s.segment}>
                  <TableCell className="font-medium capitalize">{s.segment.replace("_", " ")}</TableCell>
                  <TableCell className="text-right">{s.dispatches}</TableCell>
                  <TableCell className="text-right">{s.qty.toLocaleString()}</TableCell>
                  <TableCell className="text-right">Rs. {s.gross.toLocaleString()}</TableCell>
                  <TableCell className="text-right text-amber-600">{s.returns > 0 ? `Rs. ${s.returns.toLocaleString()}` : "—"}</TableCell>
                  <TableCell className="text-right font-medium">Rs. {s.net.toLocaleString()}</TableCell>
                  <TableCell className="text-right text-xs">{netSales > 0 ? `${((s.net / netSales) * 100).toFixed(1)}%` : "—"}</TableCell>
                </TableRow>
              ))}
              {segmentBreakdown.length > 0 && (
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">{dispatchCount}</TableCell>
                  <TableCell className="text-right">{totalDozens.toLocaleString()}</TableCell>
                  <TableCell className="text-right">Rs. {grossSales.toLocaleString()}</TableCell>
                  <TableCell className="text-right">Rs. {totalReturns.toLocaleString()}</TableCell>
                  <TableCell className="text-right">Rs. {netSales.toLocaleString()}</TableCell>
                  <TableCell className="text-right">100%</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4" />Top Customers</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]">#</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Dispatches</TableHead>
                <TableHead className="text-right">Quantity (Dz)</TableHead>
                <TableHead className="text-right">Gross Sales</TableHead>
                <TableHead className="text-right">Returns</TableHead>
                <TableHead className="text-right">Net Sales</TableHead>
                <TableHead className="text-right">Avg Per Dispatch</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!customerBreakdown.length && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No customers in selected range</TableCell></TableRow>
              )}
              {customerBreakdown.slice(0, 25).map((c, i) => (
                <TableRow key={c.id}>
                  <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="text-sm">{c.name}</TableCell>
                  <TableCell className="text-right">{c.dispatches}</TableCell>
                  <TableCell className="text-right">{c.qty.toLocaleString()}</TableCell>
                  <TableCell className="text-right">Rs. {c.gross.toLocaleString()}</TableCell>
                  <TableCell className="text-right text-amber-600">{c.returns > 0 ? `Rs. ${c.returns.toLocaleString()}` : "—"}</TableCell>
                  <TableCell className="text-right font-medium">Rs. {c.net.toLocaleString()}</TableCell>
                  <TableCell className="text-right text-xs">Rs. {c.dispatches ? Math.round(c.gross / c.dispatches).toLocaleString() : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {customerBreakdown.length > 25 && (
            <div className="px-4 py-2 text-xs text-muted-foreground border-t">
              Showing top 25 of {customerBreakdown.length} customers. Export to see full list.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Top Customers — Net Sales</CardTitle></CardHeader>
        <CardContent>
          {customerBreakdown.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-12">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.min(400, Math.max(220, customerBreakdown.slice(0, 10).length * 36))}>
              <BarChart data={customerBreakdown.slice(0, 10)} layout="vertical" margin={{ left: 80 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
                <Tooltip formatter={(v: number) => `Rs. ${v.toLocaleString()}`} />
                <Bar dataKey="net" fill="hsl(var(--primary))" name="Net Sales" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {dispatchesLoading && <div className="text-center text-sm text-muted-foreground py-4">Loading...</div>}
    </ERPLayout>
  );
}
