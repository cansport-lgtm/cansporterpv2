import { useState, useMemo, Fragment } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, ComposedChart, Line, AreaChart, Area,
} from "recharts";
import {
  Download, TrendingUp, TrendingDown, Truck, Package, ShoppingCart, Trophy, Target, PackageCheck, Clock, AlertTriangle,
  ChevronDown, ChevronRight,
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

const CATEGORIES = [
  { key: "all", label: "All Categories" },
  { key: "raw_material", label: "Raw Material" },
  { key: "office_supplies", label: "Office Supplies" },
  { key: "general_supplies", label: "General Supplies" },
  { key: "spare_maintenance", label: "Spare & Maintenance" },
];

const CATEGORY_LABELS: Record<string, string> = {
  raw_material: "Raw Material",
  office_supplies: "Office Supplies",
  general_supplies: "General Supplies",
  spare_maintenance: "Spare & Maintenance",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-400",
  pending_approval: "bg-amber-500",
  approved: "bg-blue-500",
  ordered: "bg-cyan-500",
  partially_received: "bg-purple-500",
  received: "bg-green-500",
  cancelled: "bg-red-500",
};

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

type POLineRow = {
  po_id: string;
  po_number: string;
  order_date: string;
  expected_date: string | null;
  status: string;
  category: string;
  supplier_id: string;
  supplier_name: string;
  supplier_code: string;
  lead_time_days: number;
  item_id: string;
  item_name: string;
  item_code: string;
  qty: number;
  unit_price: number;
  amount: number;
  qty_received: number;
};

// Purchase order LINE rows, by PO order_date. Cancelled POs are dropped so the
// headline spend reflects committed purchasing only. The price/value here is
// operational (PO-line value), parallel to how the Sales Analysis page reads
// order-price value rather than the posted ledger.
async function fetchPurchaseLines(fromDate: string, toDate: string, category: string): Promise<POLineRow[]> {
  const rows = await fetchAllRows((from, to) => {
    let q = sb
      .from("purchase_order_items")
      .select(
        "id, quantity, unit_price, amount, quantity_received, item_id, " +
        "items:item_id(code, name), " +
        "order:purchase_orders!inner(id, po_number, order_date, expected_date, status, category, supplier_id, suppliers:supplier_id(id, name, code, lead_time_days))"
      )
      .gte("order.order_date", fromDate)
      .lte("order.order_date", toDate)
      .neq("order.status", "cancelled")
      .order("id", { ascending: true })
      .range(from, to);
    if (category !== "all") q = q.eq("order.category", category);
    return q;
  });

  const out: POLineRow[] = [];
  (rows || []).forEach((row: any) => {
    const order = row.order;
    if (!order) return;
    const supplier = order.suppliers || {};
    const item = row.items || {};
    const qty = Number(row.quantity || 0);
    const unitPrice = Number(row.unit_price || 0);
    const amount = Number(row.amount || qty * unitPrice);
    out.push({
      po_id: order.id || "",
      po_number: order.po_number || "",
      order_date: order.order_date || "",
      expected_date: order.expected_date || null,
      status: order.status || "draft",
      category: order.category || "raw_material",
      supplier_id: supplier.id || "unknown",
      supplier_name: supplier.name || "—",
      supplier_code: supplier.code || "",
      lead_time_days: Number(supplier.lead_time_days || 0),
      item_id: row.item_id || "unknown",
      item_name: item.name || row.description || "—",
      item_code: item.code || "",
      qty,
      unit_price: unitPrice,
      amount,
      qty_received: Number(row.quantity_received || 0),
    });
  });
  return out;
}

type GRNRow = {
  grn_id: string;
  grn_number: string;
  receipt_date: string;
  total_amount: number;
  invoice_amount: number | null;
  status: string;
  category: string;
  expected_date: string | null;
  order_date: string | null;
  supplier_name: string;
};

// Goods Receipt Notes by receipt_date — the actual inflow of received goods,
// used for received-value, fulfilment and on-time delivery analysis.
async function fetchGRNs(fromDate: string, toDate: string, category: string): Promise<GRNRow[]> {
  const rows = await fetchAllRows((from, to) => {
    let q = sb
      .from("goods_receipt_notes")
      .select(
        "id, grn_number, receipt_date, total_amount, invoice_amount, status, " +
        "purchase_orders:purchase_order_id!inner(category, expected_date, order_date), " +
        "suppliers:supplier_id(name)"
      )
      .gte("receipt_date", fromDate)
      .lte("receipt_date", toDate)
      .neq("status", "cancelled")
      .order("id", { ascending: true })
      .range(from, to);
    if (category !== "all") q = q.eq("purchase_orders.category", category);
    return q;
  });

  return (rows || []).map((g: any) => ({
    grn_id: g.id || "",
    grn_number: g.grn_number || "",
    receipt_date: g.receipt_date || "",
    total_amount: Number(g.total_amount || 0),
    invoice_amount: g.invoice_amount != null ? Number(g.invoice_amount) : null,
    status: g.status || "draft",
    category: g.purchase_orders?.category || "raw_material",
    expected_date: g.purchase_orders?.expected_date || null,
    order_date: g.purchase_orders?.order_date || null,
    supplier_name: g.suppliers?.name || "—",
  }));
}

export default function PurchaseAnalysisPage() {
  const initial = applyPreset("last_30");
  const [preset, setPreset] = useState("last_30");
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);
  const [category, setCategory] = useState("all");

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
    queryKey: ["pa-current-lines", fromDate, toDate, category],
    queryFn: () => fetchPurchaseLines(fromDate, toDate, category),
  });

  const { data: priorLines } = useQuery({
    queryKey: ["pa-prior-lines", prior.from, prior.to, category],
    queryFn: () => fetchPurchaseLines(prior.from, prior.to, category),
  });

  const { data: grns } = useQuery({
    queryKey: ["pa-grns", fromDate, toDate, category],
    queryFn: () => fetchGRNs(fromDate, toDate, category),
  });

  // Authoritative purchase/expense value from the posted ledger. Mirrors how the
  // Sales Analysis page derives a GL-backed headline: sum of debit − credit over
  // active expense + inventory-asset accounts, by voucher_date. This reconciles
  // the headline with the books; the supplier/item breakdowns below stay on the
  // operational (PO-line) value, since the ledger carries no per-line item detail.
  const { data: glPurchaseAccounts } = useQuery({
    queryKey: ["pa-gl-accounts"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_chart_of_accounts")
        .select("id, account_type, sub_category")
        .in("account_type", ["expense"])
        .eq("is_active", true);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: glPurchaseLines } = useQuery({
    queryKey: ["pa-gl-lines", fromDate, toDate],
    queryFn: () =>
      fetchAllRows((from, to) =>
        sb
          .from("accounting_voucher_lines")
          .select("account_id, debit_amount, credit_amount, voucher:accounting_vouchers!inner(voucher_date)")
          .gte("voucher.voucher_date", fromDate)
          .lte("voucher.voucher_date", toDate)
          .order("id", { ascending: true })
          .range(from, to)),
  });

  const purchaseExpenseGL = useMemo(() => {
    const expIds = new Set((glPurchaseAccounts || []).map((a: any) => a.id));
    return (glPurchaseLines || []).reduce((s: number, l: any) => {
      if (!expIds.has(l.account_id)) return s;
      return s + Number(l.debit_amount || 0) - Number(l.credit_amount || 0);
    }, 0);
  }, [glPurchaseAccounts, glPurchaseLines]);

  // KPIs current period — operational committed spend (sum of PO-line value)
  const totalSpend = (lines || []).reduce((s, r) => s + r.amount, 0);
  const totalQty = (lines || []).reduce((s, r) => s + r.qty, 0);
  const poSet = new Set((lines || []).map((r) => r.po_id).filter(Boolean));
  const supplierSet = new Set((lines || []).map((r) => r.supplier_id).filter(Boolean));
  const itemSet = new Set((lines || []).map((r) => r.item_id).filter(Boolean));
  const avgPOValue = poSet.size > 0 ? totalSpend / poSet.size : 0;
  const spendPerSupplier = supplierSet.size > 0 ? totalSpend / supplierSet.size : 0;

  // Outstanding (open) commitments — POs not yet fully received
  const openLines = (lines || []).filter((r) => r.status !== "received");
  const openValue = openLines.reduce((s, r) => s + r.amount, 0);
  const openPOSet = new Set(openLines.map((r) => r.po_id).filter(Boolean));

  // Received value (GRN inflow) in the period
  const receivedValue = (grns || []).reduce((s, g) => s + g.total_amount, 0);
  const grnSet = new Set((grns || []).map((g) => g.grn_id).filter(Boolean));

  // Prior period
  const priorSpend = (priorLines || []).reduce((s, r) => s + r.amount, 0);
  const priorSuppliers = new Set((priorLines || []).map((r) => r.supplier_id).filter(Boolean));
  const priorPOs = new Set((priorLines || []).map((r) => r.po_id).filter(Boolean));
  const priorAvgPO = priorPOs.size > 0 ? priorSpend / priorPOs.size : 0;

  const spendDelta = priorSpend > 0 ? ((totalSpend - priorSpend) / priorSpend) * 100 : 0;
  const supplierDelta = priorSuppliers.size > 0 ? ((supplierSet.size - priorSuppliers.size) / priorSuppliers.size) * 100 : 0;
  const avgPODelta = priorAvgPO > 0 ? ((avgPOValue - priorAvgPO) / priorAvgPO) * 100 : 0;

  // New suppliers (not present in prior period)
  const newSuppliers = useMemo(() => {
    return Array.from(supplierSet).filter((s) => !priorSuppliers.has(s)).length;
  }, [supplierSet, priorSuppliers]);

  // Fulfilment rate — qty received vs qty ordered across PO lines
  const fulfilment = useMemo(() => {
    let ordered = 0;
    let received = 0;
    (lines || []).forEach((r) => {
      ordered += r.qty;
      received += Math.min(r.qty_received, r.qty);
    });
    return { ordered, received, rate: ordered > 0 ? (received / ordered) * 100 : 0 };
  }, [lines]);

  // On-time delivery — GRNs received on or before the PO expected date
  const onTime = useMemo(() => {
    const withExpected = (grns || []).filter((g) => g.expected_date && g.receipt_date);
    if (!withExpected.length) return { rate: 0, count: 0, onTime: 0 };
    const onTimeCount = withExpected.filter(
      (g) => differenceInCalendarDays(parseISO(g.receipt_date), parseISO(g.expected_date as string)) <= 0
    ).length;
    return { rate: (onTimeCount / withExpected.length) * 100, count: withExpected.length, onTime: onTimeCount };
  }, [grns]);

  // PO → Receipt cycle: average days from order_date to receipt_date
  const cycleTime = useMemo(() => {
    const withDates = (grns || []).filter((g) => g.order_date && g.receipt_date);
    let total = 0;
    let count = 0;
    withDates.forEach((g) => {
      const days = differenceInCalendarDays(parseISO(g.receipt_date), parseISO(g.order_date as string));
      if (days < 0 || days > 365) return;
      total += days;
      count += 1;
    });
    return { avg: count > 0 ? total / count : 0, count };
  }, [grns]);

  // Supplier ranking with Pareto cumulative %
  const supplierRows = useMemo(() => {
    const map: Record<string, { id: string; name: string; code: string; spend: number; qty: number; pos: Set<string>; items: Set<string> }> = {};
    (lines || []).forEach((r) => {
      const id = r.supplier_id || "unknown";
      if (!map[id]) map[id] = { id, name: r.supplier_name, code: r.supplier_code, spend: 0, qty: 0, pos: new Set(), items: new Set() };
      map[id].spend += r.amount;
      map[id].qty += r.qty;
      if (r.po_id) map[id].pos.add(r.po_id);
      if (r.item_id) map[id].items.add(r.item_id);
    });
    const rows = Object.values(map).map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      spend: s.spend,
      qty: s.qty,
      pos: s.pos.size,
      items: s.items.size,
    })).sort((a, b) => b.spend - a.spend);
    let cum = 0;
    return rows.map((s) => {
      cum += s.spend;
      return { ...s, cumulative: cum, cumulativePct: totalSpend > 0 ? (cum / totalSpend) * 100 : 0, share: totalSpend > 0 ? (s.spend / totalSpend) * 100 : 0 };
    });
  }, [lines, totalSpend]);

  // 80/20 rule — suppliers driving 80% of spend
  const top80Index = supplierRows.findIndex((s) => s.cumulativePct >= 80);
  const top80Count = top80Index >= 0 ? top80Index + 1 : supplierRows.length;
  const top80Share = supplierRows.length > 0 ? (top80Count / supplierRows.length) * 100 : 0;

  const top5Spend = supplierRows.slice(0, 5).reduce((s, c) => s + c.spend, 0);
  const top10Spend = supplierRows.slice(0, 10).reduce((s, c) => s + c.spend, 0);
  const top5Share = totalSpend > 0 ? (top5Spend / totalSpend) * 100 : 0;
  const top10Share = totalSpend > 0 ? (top10Spend / totalSpend) * 100 : 0;

  // Item rankings
  const itemRows = useMemo(() => {
    const map: Record<string, { id: string; name: string; code: string; spend: number; receivedSpend: number; qty: number; suppliers: Set<string>; received: number }> = {};
    (lines || []).forEach((r) => {
      const id = r.item_id || "unknown";
      if (!map[id]) map[id] = { id, name: r.item_name, code: r.item_code, spend: 0, receivedSpend: 0, qty: 0, suppliers: new Set(), received: 0 };
      const recvQty = Math.min(r.qty_received, r.qty);
      map[id].spend += r.amount;
      map[id].receivedSpend += recvQty * r.unit_price;
      map[id].qty += r.qty;
      map[id].received += recvQty;
      if (r.supplier_id) map[id].suppliers.add(r.supplier_id);
    });
    return Object.values(map).map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      spend: p.spend,
      receivedSpend: p.receivedSpend,
      qty: p.qty,
      received: p.received,
      suppliers: p.suppliers.size,
      avgPrice: p.qty > 0 ? p.spend / p.qty : 0,
      fulfilment: p.qty > 0 ? (p.received / p.qty) * 100 : 0,
    })).sort((a, b) => b.spend - a.spend);
  }, [lines]);

  // Per-item purchase breakup — every PO line for an item, ordered sequence-wise
  // (oldest order first, then by PO number) so the expanded leaderboard row shows
  // the chronological purchasing trail behind each item's headline spend.
  const itemPurchaseMap = useMemo(() => {
    const map: Record<string, POLineRow[]> = {};
    (lines || []).forEach((r) => {
      const id = r.item_id || "unknown";
      if (!map[id]) map[id] = [];
      map[id].push(r);
    });
    Object.keys(map).forEach((id) => {
      map[id].sort((a, b) => {
        if (a.order_date !== b.order_date) return a.order_date.localeCompare(b.order_date);
        return a.po_number.localeCompare(b.po_number);
      });
    });
    return map;
  }, [lines]);

  // Expand/collapse state for item leaderboard rows
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const toggleItem = (id: string) =>
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Category breakdown
  const categoryRows = useMemo(() => {
    const map: Record<string, { category: string; spend: number; qty: number; suppliers: Set<string>; pos: Set<string> }> = {};
    (lines || []).forEach((r) => {
      const k = r.category || "raw_material";
      if (!map[k]) map[k] = { category: k, spend: 0, qty: 0, suppliers: new Set(), pos: new Set() };
      map[k].spend += r.amount;
      map[k].qty += r.qty;
      if (r.supplier_id) map[k].suppliers.add(r.supplier_id);
      if (r.po_id) map[k].pos.add(r.po_id);
    });
    return Object.values(map).map((c) => ({
      category: c.category,
      label: CATEGORY_LABELS[c.category] || c.category,
      spend: c.spend,
      qty: c.qty,
      suppliers: c.suppliers.size,
      pos: c.pos.size,
      share: totalSpend > 0 ? (c.spend / totalSpend) * 100 : 0,
    })).sort((a, b) => b.spend - a.spend);
  }, [lines, totalSpend]);

  // Status distribution (by PO, valued by line amount)
  const statusRows = useMemo(() => {
    const map: Record<string, { status: string; spend: number; pos: Set<string> }> = {};
    (lines || []).forEach((r) => {
      const k = r.status || "draft";
      if (!map[k]) map[k] = { status: k, spend: 0, pos: new Set() };
      map[k].spend += r.amount;
      if (r.po_id) map[k].pos.add(r.po_id);
    });
    return Object.values(map).map((s) => ({
      status: s.status,
      label: s.status.replace(/_/g, " "),
      spend: s.spend,
      pos: s.pos.size,
      share: totalSpend > 0 ? (s.spend / totalSpend) * 100 : 0,
    })).sort((a, b) => b.spend - a.spend);
  }, [lines, totalSpend]);

  // Monthly trend (ordered spend vs received value)
  const monthlyTrend = useMemo(() => {
    if (!fromDate || !toDate) return [];
    const start = parseISO(fromDate);
    const end = parseISO(toDate);
    if (end < start) return [];
    const months = eachMonthOfInterval({ start, end });
    return months.map((m) => {
      const monthStart = startOfMonth(m);
      const monthEnd = endOfMonth(m);
      const spend = (lines || [])
        .filter((r) => { const d = parseISO(r.order_date); return d >= monthStart && d <= monthEnd; })
        .reduce((s, r) => s + r.amount, 0);
      const received = (grns || [])
        .filter((g) => { const d = parseISO(g.receipt_date); return d >= monthStart && d <= monthEnd; })
        .reduce((s, g) => s + g.total_amount, 0);
      return {
        month: format(m, "MMM yy"),
        spend: Math.round(spend),
        received: Math.round(received),
      };
    });
  }, [lines, grns, fromDate, toDate]);

  // Daily ordered spend (area chart) if window ≤ ~90 days
  const dailyTrend = useMemo(() => {
    if (!fromDate || !toDate) return [];
    const start = parseISO(fromDate);
    const end = parseISO(toDate);
    const days = differenceInCalendarDays(end, start) + 1;
    if (days <= 0 || days > 92) return [];
    const result: { day: string; spend: number }[] = [];
    for (let i = 0; i < days; i++) {
      const d = addDays(start, i);
      const dStr = format(d, "yyyy-MM-dd");
      const spend = (lines || [])
        .filter((r) => r.order_date === dStr)
        .reduce((s, r) => s + r.amount, 0);
      result.push({ day: format(d, "dd MMM"), spend: Math.round(spend) });
    }
    return result;
  }, [lines, fromDate, toDate]);

  const handleExport = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { Metric: "Period", Value: `${fromDate} to ${toDate}` },
      { Metric: "Prior Period", Value: `${prior.from} to ${prior.to}` },
      { Metric: "Category", Value: category },
      { Metric: "Purchase Expense (per GL)", Value: purchaseExpenseGL },
      { Metric: "Committed Spend (operational)", Value: totalSpend },
      { Metric: "Prior Committed Spend", Value: priorSpend },
      { Metric: "Growth %", Value: spendDelta.toFixed(2) },
      { Metric: "Goods Received Value (GRN)", Value: receivedValue },
      { Metric: "Open / Outstanding Value", Value: openValue },
      { Metric: "Total Quantity", Value: totalQty },
      { Metric: "# Purchase Orders", Value: poSet.size },
      { Metric: "# Open Purchase Orders", Value: openPOSet.size },
      { Metric: "# GRNs", Value: grnSet.size },
      { Metric: "# Suppliers", Value: supplierSet.size },
      { Metric: "New Suppliers", Value: newSuppliers },
      { Metric: "# Items", Value: itemSet.size },
      { Metric: "Avg PO Value", Value: avgPOValue.toFixed(2) },
      { Metric: "Spend per Supplier", Value: spendPerSupplier.toFixed(2) },
      { Metric: "Top 5 Supplier Share %", Value: top5Share.toFixed(1) },
      { Metric: "Top 10 Supplier Share %", Value: top10Share.toFixed(1) },
      { Metric: "80% Spend from # Suppliers", Value: top80Count },
      { Metric: "Fulfilment Rate %", Value: fulfilment.rate.toFixed(1) },
      { Metric: "On-time Delivery %", Value: onTime.rate.toFixed(1) },
      { Metric: "Avg PO → Receipt Days", Value: cycleTime.avg.toFixed(1) },
    ]), "KPIs");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(supplierRows.map((s, i) => ({
      Rank: i + 1, Code: s.code, Supplier: s.name, Spend: s.spend, POs: s.pos, Items: s.items,
      Qty: s.qty, "Share %": s.share.toFixed(2), "Cumulative %": s.cumulativePct.toFixed(2),
    }))), "Suppliers");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(itemRows.map((p, i) => ({
      Rank: i + 1, Code: p.code, Item: p.name, Spend: p.spend, Qty: p.qty,
      "Avg Price": p.avgPrice.toFixed(2), Suppliers: p.suppliers, "Fulfilment %": p.fulfilment.toFixed(1),
    }))), "Items");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(categoryRows.map((c) => ({
      Category: c.label, Spend: c.spend, Qty: c.qty, Suppliers: c.suppliers, POs: c.pos, "Share %": c.share.toFixed(2),
    }))), "Categories");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(monthlyTrend), "Monthly");
    XLSX.writeFile(wb, `Purchase_Analysis_${fromDate}_to_${toDate}.xlsx`);
  };

  return (
    <ERPLayout>
      <PageHeader title="Purchase Analysis" description="Deep insights — spend, supplier concentration, items, fulfilment & delivery">
        <div className="grid grid-cols-2 gap-2 items-center w-full sm:flex sm:flex-wrap sm:w-auto">
          <Select value={preset} onValueChange={onPresetChange}>
            <SelectTrigger className="w-full sm:w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRESETS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-full sm:w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPreset("custom"); }} className="w-full sm:w-[150px]" />
          <Input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPreset("custom"); }} className="w-full sm:w-[150px]" />
          <Button size="sm" variant="outline" onClick={handleExport} disabled={!lines?.length} className="col-span-2 w-full sm:w-auto">
            <Download className="h-4 w-4 mr-1" />Export
          </Button>
        </div>
      </PageHeader>

      <div className="text-xs text-muted-foreground mb-4">
        Comparing <span className="font-medium text-foreground">{fromDate} → {toDate}</span> vs prior period <span className="font-medium text-foreground">{prior.from} → {prior.to}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Purchase Expense (per GL)"
          value={`Rs. ${purchaseExpenseGL.toLocaleString()}`}
          icon={ShoppingCart}
          description="Posted expense ledger (net debits)"
        />
        <MetricCard
          title="Committed Spend (PO)"
          value={`Rs. ${totalSpend.toLocaleString()}`}
          icon={TrendingUp}
          trend={priorSpend > 0 ? { value: Math.abs(Math.round(spendDelta * 10) / 10), isPositive: spendDelta >= 0 } : undefined}
          description={`PO-line value · vs Rs. ${priorSpend.toLocaleString()}`}
        />
        <MetricCard
          title="Goods Received"
          value={`Rs. ${receivedValue.toLocaleString()}`}
          icon={PackageCheck}
          description={`${grnSet.size} GRN(s) in period`}
        />
        <MetricCard
          title="Open Commitments"
          value={`Rs. ${openValue.toLocaleString()}`}
          icon={AlertTriangle}
          iconColor="text-amber-500"
          description={`${openPOSet.size} PO(s) not fully received`}
        />
        <MetricCard
          title="Suppliers"
          value={supplierSet.size.toString()}
          icon={Truck}
          trend={priorSuppliers.size > 0 ? { value: Math.abs(Math.round(supplierDelta * 10) / 10), isPositive: supplierDelta >= 0 } : undefined}
          description={`${newSuppliers} new this period`}
        />
        <MetricCard
          title="Avg PO Value"
          value={`Rs. ${avgPOValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          icon={Package}
          trend={priorAvgPO > 0 ? { value: Math.abs(Math.round(avgPODelta * 10) / 10), isPositive: avgPODelta >= 0 } : undefined}
          description={`${poSet.size} purchase order(s)`}
        />
        <MetricCard
          title="Fulfilment Rate"
          value={`${fulfilment.rate.toFixed(0)}%`}
          icon={PackageCheck}
          description="Qty received vs ordered"
        />
        <MetricCard
          title="Items Purchased"
          value={itemSet.size.toString()}
          icon={Package}
          description={`${totalQty.toLocaleString()} total qty`}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Trophy className="h-3 w-3" />Top 5 Suppliers</div>
          <div className="text-2xl font-semibold">{top5Share.toFixed(1)}%</div>
          <div className="text-xs text-muted-foreground">of total spend</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Trophy className="h-3 w-3" />Top 10 Suppliers</div>
          <div className="text-2xl font-semibold">{top10Share.toFixed(1)}%</div>
          <div className="text-xs text-muted-foreground">of total spend</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Target className="h-3 w-3" />80/20 Rule</div>
          <div className="text-2xl font-semibold">{top80Count}</div>
          <div className="text-xs text-muted-foreground">
            supplier(s) drive 80% of spend {supplierRows.length > 0 && <span>({top80Share.toFixed(0)}% of base)</span>}
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />On-time Delivery</div>
          <div className="text-2xl font-semibold">{onTime.rate.toFixed(0)}%</div>
          <div className="text-xs text-muted-foreground">
            {onTime.onTime}/{onTime.count} GRNs · avg cycle {cycleTime.avg.toFixed(1)}d
          </div>
        </CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3"><CardTitle className="text-sm">Purchase Trend — Ordered vs Received</CardTitle></CardHeader>
          <CardContent>
            {dailyTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={dailyTrend}>
                  <defs>
                    <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => `Rs. ${v.toLocaleString()}`} />
                  <Area type="monotone" dataKey="spend" name="Ordered" stroke="hsl(var(--primary))" fill="url(#spendGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : monthlyTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => `Rs. ${v.toLocaleString()}`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="spend" fill="hsl(var(--primary))" name="Ordered (Rs.)" />
                  <Bar dataKey="received" fill="hsl(var(--chart-2))" name="Received (Rs.)" />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center text-sm text-muted-foreground py-12">No data in selected range</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Category Mix</CardTitle></CardHeader>
          <CardContent>
            {categoryRows.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={categoryRows} dataKey="spend" nameKey="label" cx="50%" cy="50%" outerRadius={90} label={(e: any) => `${e.share.toFixed(0)}%`}>
                    {categoryRows.map((_, i) => (
                      <Cell key={i} fill={`hsl(var(--chart-${(i % 5) + 1}))`} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => `Rs. ${v.toLocaleString()}`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center text-sm text-muted-foreground py-12">No data</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="suppliers" className="mb-6">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList className="w-max">
            <TabsTrigger value="suppliers">Supplier Leaderboard</TabsTrigger>
            <TabsTrigger value="items">Item Leaderboard</TabsTrigger>
            <TabsTrigger value="categories">Categories</TabsTrigger>
            <TabsTrigger value="status">Status Mix</TabsTrigger>
            <TabsTrigger value="pareto">Pareto / Concentration</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="suppliers">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">#</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead className="text-right">POs</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Spend</TableHead>
                    <TableHead className="text-right">Share %</TableHead>
                    <TableHead className="text-right">Cumulative %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!supplierRows.length && (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No data</TableCell></TableRow>
                  )}
                  {supplierRows.slice(0, 50).map((s, i) => (
                    <TableRow key={s.id}>
                      <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="text-sm">
                        {s.code && <span className="font-mono text-xs text-muted-foreground mr-1">{s.code}</span>}
                        {s.name}{" "}
                        {i < top80Count && <Badge variant="outline" className="ml-1 text-[10px] py-0">80%</Badge>}
                      </TableCell>
                      <TableCell className="text-right">{s.pos}</TableCell>
                      <TableCell className="text-right">{s.items}</TableCell>
                      <TableCell className="text-right">{s.qty.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-medium">Rs. {s.spend.toLocaleString()}</TableCell>
                      <TableCell className="text-right text-xs">{s.share.toFixed(1)}%</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{s.cumulativePct.toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {supplierRows.length > 50 && (
                <div className="px-4 py-2 text-xs text-muted-foreground border-t">
                  Showing top 50 of {supplierRows.length}. Export for full list.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="items">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]"></TableHead>
                    <TableHead className="w-[40px]">#</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Received Qty</TableHead>
                    <TableHead className="text-right">Received Spend</TableHead>
                    <TableHead className="text-right">Total Spend</TableHead>
                    <TableHead className="text-right">Avg Price</TableHead>
                    <TableHead className="text-right">Suppliers</TableHead>
                    <TableHead className="text-right">Fulfilment</TableHead>
                    <TableHead className="text-right">Share %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!itemRows.length && (
                    <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground">No data</TableCell></TableRow>
                  )}
                  {itemRows.slice(0, 50).map((p, i) => {
                    const breakup = itemPurchaseMap[p.id] || [];
                    const isExpanded = expandedItems.has(p.id);
                    return (
                      <Fragment key={p.id}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => breakup.length > 0 && toggleItem(p.id)}
                        >
                          <TableCell className="text-muted-foreground">
                            {breakup.length > 0 && (
                              isExpanded
                                ? <ChevronDown className="h-4 w-4" />
                                : <ChevronRight className="h-4 w-4" />
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                          <TableCell className="font-mono text-xs">{p.code || "—"}</TableCell>
                          <TableCell className="text-sm">{p.name}</TableCell>
                          <TableCell className="text-right">{p.received.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-medium">Rs. {Math.round(p.receivedSpend).toLocaleString()}</TableCell>
                          <TableCell className="text-right text-muted-foreground">Rs. {p.spend.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-xs">Rs. {p.avgPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                          <TableCell className="text-right">{p.suppliers}</TableCell>
                          <TableCell className="text-right text-xs">{p.fulfilment.toFixed(0)}%</TableCell>
                          <TableCell className="text-right text-xs">{totalSpend > 0 ? `${((p.spend / totalSpend) * 100).toFixed(1)}%` : "—"}</TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={11} className="p-0">
                              <div className="px-6 py-3">
                                <div className="text-xs font-semibold mb-2 text-muted-foreground">
                                  Purchase Breakup — {breakup.length} order line{breakup.length !== 1 ? "s" : ""}, sequence-wise
                                </div>
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b text-muted-foreground">
                                      <th className="text-left py-1 pr-3 font-medium w-[40px]">#</th>
                                      <th className="text-left py-1 pr-3 font-medium">PO Number</th>
                                      <th className="text-left py-1 pr-3 font-medium">Date</th>
                                      <th className="text-left py-1 pr-3 font-medium">Supplier</th>
                                      <th className="text-left py-1 pr-3 font-medium">Status</th>
                                      <th className="text-right py-1 pr-3 font-medium">Qty</th>
                                      <th className="text-right py-1 pr-3 font-medium">Unit Price</th>
                                      <th className="text-right py-1 pr-3 font-medium">Amount</th>
                                      <th className="text-right py-1 font-medium">Received</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {breakup.map((b, bi) => (
                                      <tr key={`${b.po_id}-${bi}`} className="border-b border-muted/50 last:border-0">
                                        <td className="py-1 pr-3 text-muted-foreground">{bi + 1}</td>
                                        <td className="py-1 pr-3 font-mono">{b.po_number || "—"}</td>
                                        <td className="py-1 pr-3 whitespace-nowrap">{b.order_date ? format(parseISO(b.order_date), "dd MMM yyyy") : "—"}</td>
                                        <td className="py-1 pr-3">{b.supplier_name}</td>
                                        <td className="py-1 pr-3">
                                          <Badge variant="outline" className="text-[10px] capitalize font-normal">
                                            {b.status.replace(/_/g, " ")}
                                          </Badge>
                                        </td>
                                        <td className="py-1 pr-3 text-right">{b.qty.toLocaleString()}</td>
                                        <td className="py-1 pr-3 text-right">Rs. {b.unit_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                                        <td className="py-1 pr-3 text-right font-medium">Rs. {b.amount.toLocaleString()}</td>
                                        <td className="py-1 text-right">{b.qty_received.toLocaleString()}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
              {itemRows.length > 50 && (
                <div className="px-4 py-2 text-xs text-muted-foreground border-t">
                  Showing top 50 of {itemRows.length}. Export for full list.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="categories">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">POs</TableHead>
                    <TableHead className="text-right">Suppliers</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Spend</TableHead>
                    <TableHead className="text-right">Share %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!categoryRows.length && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No data</TableCell></TableRow>
                  )}
                  {categoryRows.map((c) => (
                    <TableRow key={c.category}>
                      <TableCell className="text-sm font-medium">{c.label}</TableCell>
                      <TableCell className="text-right">{c.pos}</TableCell>
                      <TableCell className="text-right">{c.suppliers}</TableCell>
                      <TableCell className="text-right">{c.qty.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-medium">Rs. {c.spend.toLocaleString()}</TableCell>
                      <TableCell className="text-right text-xs">{c.share.toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="status">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">POs</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Share %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!statusRows.length && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No data</TableCell></TableRow>
                  )}
                  {statusRows.map((s) => (
                    <TableRow key={s.status}>
                      <TableCell className="text-sm capitalize">
                        <span className={`inline-block h-2 w-2 rounded-full mr-2 ${STATUS_COLORS[s.status] || "bg-gray-400"}`} />
                        {s.label}
                      </TableCell>
                      <TableCell className="text-right">{s.pos}</TableCell>
                      <TableCell className="text-right font-medium">Rs. {s.spend.toLocaleString()}</TableCell>
                      <TableCell className="text-right text-xs">{s.share.toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pareto">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Supplier Pareto — Spend Concentration</CardTitle>
            </CardHeader>
            <CardContent>
              {supplierRows.length > 0 ? (
                <ResponsiveContainer width="100%" height={400}>
                  <ComposedChart data={supplierRows.slice(0, 25)}>
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
                    <Bar yAxisId="left" dataKey="spend" fill="hsl(var(--primary))" name="Spend" />
                    <Line yAxisId="right" type="monotone" dataKey="cumulativePct" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} name="Cumulative %" />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center text-sm text-muted-foreground py-12">No data</div>
              )}
              <div className="mt-4 text-xs text-muted-foreground">
                The red line shows cumulative spend % as we move through suppliers ranked by purchase value. Where it crosses 80% reveals your "vital few" suppliers. High concentration on a handful of vendors is a supply-risk signal — consider dual-sourcing for critical categories.
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
                <TableCell>Committed Spend</TableCell>
                <TableCell className="text-right font-medium">Rs. {totalSpend.toLocaleString()}</TableCell>
                <TableCell className="text-right">Rs. {priorSpend.toLocaleString()}</TableCell>
                <TableCell className={`text-right text-xs ${spendDelta >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {spendDelta >= 0 ? <TrendingUp className="h-3 w-3 inline mr-1" /> : <TrendingDown className="h-3 w-3 inline mr-1" />}
                  {priorSpend > 0 ? `${spendDelta.toFixed(1)}%` : "—"}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Suppliers</TableCell>
                <TableCell className="text-right font-medium">{supplierSet.size}</TableCell>
                <TableCell className="text-right">{priorSuppliers.size}</TableCell>
                <TableCell className="text-right text-xs">
                  {priorSuppliers.size > 0 ? `${supplierDelta.toFixed(1)}%` : "—"}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Purchase Orders</TableCell>
                <TableCell className="text-right font-medium">{poSet.size}</TableCell>
                <TableCell className="text-right">{priorPOs.size}</TableCell>
                <TableCell className="text-right text-xs">
                  {priorPOs.size > 0 ? `${(((poSet.size - priorPOs.size) / priorPOs.size) * 100).toFixed(1)}%` : "—"}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Avg PO Value</TableCell>
                <TableCell className="text-right font-medium">Rs. {avgPOValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                <TableCell className="text-right">Rs. {priorAvgPO.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                <TableCell className={`text-right text-xs ${avgPODelta >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {priorAvgPO > 0 ? `${avgPODelta.toFixed(1)}%` : "—"}
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
