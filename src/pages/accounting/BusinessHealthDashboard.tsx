import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/accounting/fetchAllRows";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Activity, Wallet, TrendingUp, TrendingDown, Package, ArrowUpRight, ArrowDownRight,
  Scale, AlertTriangle, CheckCircle, HeartPulse, Hourglass, Truck, ShoppingCart,
  ClipboardList, Receipt, FileWarning, PackageCheck,
} from "lucide-react";
import { format, subMonths, subDays, startOfMonth, parseISO, differenceInCalendarDays } from "date-fns";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, AreaChart, Area, BarChart, PieChart, Pie, Cell, LineChart, ReferenceLine,
} from "recharts";

const sb = supabase as any;

const fmtRs = (n: number) => `Rs. ${Math.round(n).toLocaleString()}`;
const fmtRsShort = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 100_000) return `${(n / 1_000).toFixed(0)}k`;
  return Math.round(n).toLocaleString();
};

type Bucket = { b0_30: number; b31_60: number; b61_90: number; b90p: number };
type AgedParty = { party_id: string; total: number } & Bucket;

/**
 * FIFO open-item aging reconciled to the net GL balance — same algorithm as
 * ReceivablesPayablesReportPage.ageParty (see that file for the full rationale).
 */
function ageParty(lines: any[], asOfDate: string, isAR: boolean): Bucket & { total: number } {
  const sorted = [...lines].sort((a, b) => {
    const ad = a.voucher?.voucher_date || "";
    const bd = b.voucher?.voucher_date || "";
    return ad < bd ? -1 : ad > bd ? 1 : 0;
  });

  const opens: { date: string; remaining: number }[] = [];
  let net = 0;
  for (const l of sorted) {
    const open = isAR ? Number(l.debit_amount || 0) : Number(l.credit_amount || 0);
    let settle = isAR ? Number(l.credit_amount || 0) : Number(l.debit_amount || 0);
    net += open - settle;
    if (open > 0) opens.push({ date: l.voucher?.voucher_date || asOfDate, remaining: open });
    while (settle > 0 && opens.length) {
      const head = opens[0];
      if (head.remaining <= settle) { settle -= head.remaining; opens.shift(); }
      else { head.remaining -= settle; settle = 0; }
    }
  }

  const out: Bucket & { total: number } = { b0_30: 0, b31_60: 0, b61_90: 0, b90p: 0, total: 0 };
  if (net <= 0.005) return out;
  let remaining = net;
  for (const o of opens) {
    if (remaining <= 0) break;
    const amt = Math.min(o.remaining, remaining);
    const days = differenceInCalendarDays(parseISO(asOfDate), parseISO(o.date));
    if (days <= 30) out.b0_30 += amt;
    else if (days <= 60) out.b31_60 += amt;
    else if (days <= 90) out.b61_90 += amt;
    else out.b90p += amt;
    out.total += amt;
    remaining -= amt;
  }
  if (remaining > 0.005) { out.b0_30 += remaining; out.total += remaining; }
  return out;
}

const PIE_COLORS = ["#3b82f6", "#f59e0b", "#22c55e", "#8b5cf6", "#ef4444", "#06b6d4", "#ec4899", "#64748b"];

export default function BusinessHealthDashboard() {
  const today = format(new Date(), "yyyy-MM-dd");
  const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");

  const { data: accounts } = useQuery({
    queryKey: ["bh-accounts"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_chart_of_accounts")
        .select("id, code, name, account_type, sub_category, is_cash_account, is_bank_account")
        .eq("is_active", true);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: allLines, isLoading: linesLoading } = useQuery({
    queryKey: ["bh-lines"],
    queryFn: async () => {
      const data = await fetchAllRows((from, to) =>
        sb
          .from("accounting_voucher_lines")
          .select("voucher_id, account_id, party_id, debit_amount, credit_amount, voucher:accounting_vouchers!inner(voucher_date)")
          .order("id", { ascending: true })
          .range(from, to));
      return data;
    },
  });

  const { data: defaults } = useQuery({
    queryKey: ["bh-default-accounts"],
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

  const { data: parties } = useQuery({
    queryKey: ["bh-parties"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_parties")
        .select("id, name, party_type");
      if (error) throw error;
      const map: Record<string, { name: string; party_type: string | null }> = {};
      (data || []).forEach((p: any) => { map[p.id] = { name: p.name, party_type: p.party_type ?? null }; });
      return map;
    },
  });

  // Resilient to the credit_limit column not existing — badges simply don't show.
  const { data: creditLimits } = useQuery({
    queryKey: ["bh-credit-limits"],
    queryFn: async () => {
      const map: Record<string, number> = {};
      const { data, error } = await sb
        .from("accounting_parties")
        .select("id, credit_limit")
        .gt("credit_limit", 0);
      if (error) return map;
      (data || []).forEach((r: any) => { map[r.id] = Number(r.credit_limit); });
      return map;
    },
  });

  // ---- Physical inventory (live) ----
  // The generic inventory_stock / stock_movements / floor_inventory tables are
  // unused in production. Real stock lives in the daily closing tables:
  //   raw materials  -> consumption_stock_closing (consumption module)
  //   finished/floor -> daily_stock_closing per department (planning module)
  // Both are point-in-time snapshots, so we take the latest closing per item
  // within a recent window and poll for new postings.
  const stockWindowStart = format(subDays(new Date(), 30), "yyyy-MM-dd");

  const { data: rmStock, dataUpdatedAt: rmUpdatedAt } = useQuery({
    queryKey: ["bh-rm-stock", stockWindowStart],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await sb
        .from("consumption_stock_closing")
        .select("closing_date, closing_quantity, raw_material_id, consumption_raw_materials(name, unit, cost_value, threshold, is_active)")
        .gte("closing_date", stockWindowStart);
      if (error) throw error;
      const latest: Record<string, any> = {};
      (data || []).forEach((r: any) => {
        if (r.consumption_raw_materials?.is_active === false) return;
        const cur = latest[r.raw_material_id];
        if (!cur || r.closing_date > cur.closing_date) latest[r.raw_material_id] = r;
      });
      return Object.values(latest);
    },
  });

  const { data: fgStock, dataUpdatedAt: fgUpdatedAt } = useQuery({
    queryKey: ["bh-fg-stock", stockWindowStart],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await sb
        .from("daily_stock_closing")
        .select("closing_date, closing_quantity, department_id, planning_item_id, planning_items(name, unit, costing_value, threshold_inventory), production_departments(name)")
        .gte("closing_date", stockWindowStart);
      if (error) throw error;
      const latest: Record<string, any> = {};
      (data || []).forEach((r: any) => {
        const key = `${r.department_id}:${r.planning_item_id}`;
        const cur = latest[key];
        if (!cur || r.closing_date > cur.closing_date) latest[key] = r;
      });
      return Object.values(latest);
    },
  });

  // ---- Operations pulse (non-GL) ----
  const { data: ops } = useQuery({
    queryKey: ["bh-ops", monthStart],
    queryFn: async () => {
      const [so, disp, po, grn, exp] = await Promise.all([
        sb.from("sales_orders").select("id, total_amount, net_amount").gte("order_date", monthStart),
        sb.from("sales_dispatches").select("id").gte("dispatch_date", monthStart),
        sb.from("purchase_orders").select("id, total_amount, status").in("status", ["draft", "pending_approval", "approved"]),
        sb.from("goods_receipt_notes").select("id, total_amount").gte("receipt_date", monthStart),
        sb.from("general_expenses").select("id, total_amount").eq("approval_status", "pending"),
      ]);
      const soRows = so.data || [];
      const soValue = soRows.reduce((s: number, r: any) => s + Number(r.net_amount ?? r.total_amount ?? 0), 0);
      const poRows = po.data || [];
      const expRows = exp.data || [];
      return {
        soCount: soRows.length,
        soValue,
        dispatchCount: (disp.data || []).length,
        openPOCount: poRows.length,
        openPOValue: poRows.reduce((s: number, r: any) => s + Number(r.total_amount || 0), 0),
        grnCount: (grn.data || []).length,
        pendingExpCount: expRows.length,
        pendingExpValue: expRows.reduce((s: number, r: any) => s + Number(r.total_amount || 0), 0),
      };
    },
  });

  const computed = useMemo(() => {
    if (!accounts || !allLines) return null;

    const accMap: Record<string, any> = {};
    accounts.forEach((a: any) => { accMap[a.id] = a; });

    // Trailing 12 calendar months (oldest → newest)
    const months: string[] = [];
    for (let i = 11; i >= 0; i--) months.push(format(subMonths(new Date(), i), "yyyy-MM"));
    const monthSet = new Set(months);
    const thisMonth = months[11];
    const prevMonth = months[10];
    const last3 = months.slice(9);

    type MonthAgg = { revenue: number; cogs: number; opex: number };
    const monthly: Record<string, MonthAgg> = {};
    months.forEach((m) => { monthly[m] = { revenue: 0, cogs: 0, opex: 0 }; });

    // Per-account all-time totals + monthly P&L buckets + cash-pool movement per
    // voucher (so a cash→bank contra doesn't inflate gross in/out).
    const perAccount: Record<string, { dr: number; cr: number }> = {};
    const cashByVoucher: Record<string, { month: string; net: number }> = {};
    const arLinesByParty: Record<string, any[]> = {};
    const apLinesByParty: Record<string, any[]> = {};

    for (const l of allLines as any[]) {
      const acc = accMap[l.account_id];
      const dr = Number(l.debit_amount || 0);
      const cr = Number(l.credit_amount || 0);
      (perAccount[l.account_id] ||= { dr: 0, cr: 0 });
      perAccount[l.account_id].dr += dr;
      perAccount[l.account_id].cr += cr;

      const date: string = l.voucher?.voucher_date || "";
      const m = date.slice(0, 7);

      if (acc && monthSet.has(m)) {
        if (acc.account_type === "revenue") monthly[m].revenue += cr - dr;
        else if (acc.account_type === "expense") {
          if (acc.sub_category === "COGS") monthly[m].cogs += dr - cr;
          else monthly[m].opex += dr - cr;
        }
      }
      if (acc && (acc.is_cash_account || acc.is_bank_account) && m) {
        const entry = (cashByVoucher[l.voucher_id] ||= { month: m, net: 0 });
        entry.net += dr - cr;
      }
      if (defaults?.ar && l.account_id === defaults.ar && l.party_id) (arLinesByParty[l.party_id] ||= []).push(l);
      if (defaults?.ap && l.account_id === defaults.ap && l.party_id) (apLinesByParty[l.party_id] ||= []).push(l);
    }

    const balanceFor = (id: string) => (perAccount[id]?.dr || 0) - (perAccount[id]?.cr || 0);

    // ---- Balances ----
    const cashAccounts = accounts.filter((a: any) => a.is_cash_account);
    const bankAccounts = accounts.filter((a: any) => a.is_bank_account);
    const totalCash = cashAccounts.reduce((s: number, a: any) => s + balanceFor(a.id), 0);
    const totalBank = bankAccounts.reduce((s: number, a: any) => s + balanceFor(a.id), 0);
    const cashPool = totalCash + totalBank;

    const inventoryAccounts = accounts.filter((a: any) => ["1130", "1131", "1132"].includes(a.code));
    const inventoryRows = inventoryAccounts.map((a: any) => ({ ...a, balance: balanceFor(a.id) }));
    const totalInventory = inventoryRows.reduce((s: number, a: any) => s + a.balance, 0);
    const negativeInventory = inventoryRows.filter((a: any) => a.balance < 0);

    const totalLiabilities = accounts
      .filter((a: any) => a.account_type === "liability")
      .reduce((s: number, a: any) => s + ((perAccount[a.id]?.cr || 0) - (perAccount[a.id]?.dr || 0)), 0);
    const paidEquity = accounts
      .filter((a: any) => a.account_type === "equity")
      .reduce((s: number, a: any) => s + ((perAccount[a.id]?.cr || 0) - (perAccount[a.id]?.dr || 0)), 0);
    const retained = accounts.reduce((s: number, a: any) => {
      if (a.account_type === "revenue") return s + ((perAccount[a.id]?.cr || 0) - (perAccount[a.id]?.dr || 0));
      if (a.account_type === "expense") return s - ((perAccount[a.id]?.dr || 0) - (perAccount[a.id]?.cr || 0));
      return s;
    }, 0);
    const totalEquity = paidEquity + retained;

    // ---- AR / AP aging ----
    const ageAll = (byParty: Record<string, any[]>, isAR: boolean): AgedParty[] =>
      Object.entries(byParty)
        .map(([pid, ls]) => ({ party_id: pid, ...ageParty(ls, today, isAR) }))
        .filter((r) => r.total > 0.005)
        .sort((a, b) => b.total - a.total);
    const arRows = ageAll(arLinesByParty, true);
    const apRows = ageAll(apLinesByParty, false);
    const sumBuckets = (rows: AgedParty[]): Bucket & { total: number } =>
      rows.reduce((s, r) => ({
        b0_30: s.b0_30 + r.b0_30, b31_60: s.b31_60 + r.b31_60,
        b61_90: s.b61_90 + r.b61_90, b90p: s.b90p + r.b90p, total: s.total + r.total,
      }), { b0_30: 0, b31_60: 0, b61_90: 0, b90p: 0, total: 0 });
    const arAging = sumBuckets(arRows);
    const apAging = sumBuckets(apRows);
    const overLimitCustomers = arRows.filter((r) => creditLimits?.[r.party_id] != null && r.total > creditLimits[r.party_id]);

    // ---- Monthly cash in/out + running balance ----
    const cashFlowByMonth: Record<string, { cashIn: number; cashOut: number }> = {};
    months.forEach((m) => { cashFlowByMonth[m] = { cashIn: 0, cashOut: 0 }; });
    let netCashInWindow = 0;
    Object.values(cashByVoucher).forEach(({ month, net }) => {
      if (!monthSet.has(month)) return;
      netCashInWindow += net;
      if (net > 0) cashFlowByMonth[month].cashIn += net;
      else cashFlowByMonth[month].cashOut += -net;
    });
    const openingCashPool = cashPool - netCashInWindow;
    let running = openingCashPool;
    const cashTrend = months.map((m) => {
      running += cashFlowByMonth[m].cashIn - cashFlowByMonth[m].cashOut;
      return { month: format(parseISO(`${m}-01`), "MMM yy"), balance: Math.round(running) };
    });
    const cashFlowSeries = months.slice(6).map((m) => ({
      month: format(parseISO(`${m}-01`), "MMM yy"),
      cashIn: Math.round(cashFlowByMonth[m].cashIn),
      cashOut: Math.round(cashFlowByMonth[m].cashOut),
    }));

    // ---- P&L series ----
    const plSeries = months.map((m) => {
      const { revenue, cogs, opex } = monthly[m];
      return {
        month: format(parseISO(`${m}-01`), "MMM yy"),
        revenue: Math.round(revenue),
        expenses: Math.round(cogs + opex),
        net: Math.round(revenue - cogs - opex),
      };
    });
    const marginSeries = months.map((m) => {
      const { revenue, cogs, opex } = monthly[m];
      return {
        month: format(parseISO(`${m}-01`), "MMM yy"),
        gross: revenue > 0 ? +(((revenue - cogs) / revenue) * 100).toFixed(1) : null,
        net: revenue > 0 ? +(((revenue - cogs - opex) / revenue) * 100).toFixed(1) : null,
      };
    });

    const mtd = monthly[thisMonth];
    const prev = monthly[prevMonth];
    const mtdNet = mtd.revenue - mtd.cogs - mtd.opex;
    const prevNet = prev.revenue - prev.cogs - prev.opex;
    const pct = (cur: number, before: number) =>
      before !== 0 ? Math.round(Math.abs(((cur - before) / Math.abs(before)) * 100)) : undefined;

    // ---- Expense mix, last 3 months, grouped by sub-category ----
    const expByGroup: Record<string, number> = {};
    for (const l of allLines as any[]) {
      const acc = accMap[l.account_id];
      if (!acc || acc.account_type !== "expense") continue;
      const m = (l.voucher?.voucher_date || "").slice(0, 7);
      if (!last3.includes(m)) continue;
      const net = Number(l.debit_amount || 0) - Number(l.credit_amount || 0);
      const key = acc.sub_category || "Other";
      expByGroup[key] = (expByGroup[key] || 0) + net;
    }
    const expenseMix = Object.entries(expByGroup)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, value]) => ({ name, value: Math.round(value) }));

    // ---- Ratios ----
    const rev90 = last3.reduce((s, m) => s + monthly[m].revenue, 0);
    const cogs90 = last3.reduce((s, m) => s + monthly[m].cogs, 0);
    const currentAssets = cashPool + arAging.total + totalInventory;
    const currentLiabilities = apAging.total;
    const currentRatio = currentLiabilities > 0 ? currentAssets / currentLiabilities : null;
    const quickRatio = currentLiabilities > 0 ? (cashPool + arAging.total) / currentLiabilities : null;
    const debtToEquity = totalEquity > 0 ? totalLiabilities / totalEquity : null;
    const dso = rev90 > 0 ? arAging.total / (rev90 / 90) : null;
    const dpo = cogs90 > 0 ? apAging.total / (cogs90 / 90) : null;

    // Runway from average net cash flow of the last 3 months
    const avgNetCash = last3.reduce((s, m) => s + cashFlowByMonth[m].cashIn - cashFlowByMonth[m].cashOut, 0) / 3;
    const runwayMonths = avgNetCash >= 0 ? Infinity : cashPool / -avgNetCash;

    // ---- Health score (0-100) ----
    const net3m = last3.reduce((s, m) => s + monthly[m].revenue - monthly[m].cogs - monthly[m].opex, 0);
    const netMargin3m = rev90 > 0 ? (net3m / rev90) * 100 : null;
    const pct90 = arAging.total > 0 ? (arAging.b90p / arAging.total) * 100 : 0;

    const liquidityScore = currentRatio === null ? 25 : currentRatio >= 1.5 ? 25 : currentRatio >= 1 ? 15 : currentRatio >= 0.5 ? 8 : 0;
    const profitScore = netMargin3m === null ? 12 : netMargin3m >= 10 ? 25 : netMargin3m >= 5 ? 18 : netMargin3m >= 0 ? 12 : netMargin3m >= -10 ? 5 : 0;
    const collectionScore = pct90 <= 5 ? 25 : pct90 <= 15 ? 18 : pct90 <= 30 ? 10 : 4;
    const cashScore = runwayMonths === Infinity ? 25 : runwayMonths >= 6 ? 20 : runwayMonths >= 3 ? 12 : runwayMonths >= 1 ? 5 : 0;
    const healthScore = liquidityScore + profitScore + collectionScore + cashScore;
    const healthLabel = healthScore >= 80 ? "Healthy" : healthScore >= 55 ? "Stable" : healthScore >= 35 ? "Watch" : "Critical";

    // ---- Alerts ----
    const alerts: { severity: "critical" | "warning"; text: string; href: string }[] = [];
    if (cashPool < 0) alerts.push({ severity: "critical", text: `Combined cash & bank balance is negative (${fmtRs(cashPool)})`, href: "/accounting/cash-book" });
    if (negativeInventory.length > 0) alerts.push({ severity: "critical", text: `${negativeInventory.length} inventory account(s) have a negative GL balance`, href: "/accounting/dashboard" });
    if (mtd.revenue > 0 && mtd.cogs === 0) alerts.push({ severity: "critical", text: `This month has ${fmtRs(mtd.revenue)} revenue but Rs. 0 COGS — gross profit is overstated`, href: "/accounting/periodic-cogs" });
    if (pct90 > 25 && arAging.b90p > 0) alerts.push({ severity: "warning", text: `${pct90.toFixed(0)}% of receivables (${fmtRs(arAging.b90p)}) are overdue 90+ days`, href: "/accounting/ar-ap-report" });
    if (overLimitCustomers.length > 0) alerts.push({ severity: "warning", text: `${overLimitCustomers.length} customer(s) are over their credit limit`, href: "/accounting/ar-ap-report" });
    if (runwayMonths !== Infinity && runwayMonths < 3) alerts.push({ severity: "critical", text: `Cash runway is under 3 months at the current burn rate`, href: "/accounting/cash-flow-forecast" });
    if ((ops?.pendingExpCount || 0) > 0) alerts.push({ severity: "warning", text: `${ops!.pendingExpCount} expense(s) worth ${fmtRs(ops!.pendingExpValue)} awaiting approval`, href: "/expenses/general" });

    return {
      totalCash, totalBank, cashPool, totalInventory, negativeInventory,
      totalLiabilities, totalEquity,
      arRows, apRows, arAging, apAging, overLimitCustomers,
      plSeries, marginSeries, cashTrend, cashFlowSeries, expenseMix,
      mtd, mtdNet, prevNet, prev,
      revTrendPct: pct(mtd.revenue, prev.revenue),
      netTrendPct: pct(mtdNet, prevNet),
      expTrendPct: pct(mtd.cogs + mtd.opex, prev.cogs + prev.opex),
      grossMarginMtd: mtd.revenue > 0 ? ((mtd.revenue - mtd.cogs) / mtd.revenue) * 100 : null,
      currentRatio, quickRatio, debtToEquity, dso, dpo, runwayMonths,
      workingCapital: currentAssets - currentLiabilities,
      healthScore, healthLabel,
      scoreParts: { liquidityScore, profitScore, collectionScore, cashScore },
      alerts,
    };
  }, [accounts, allLines, defaults, creditLimits, ops, today]);

  const phys = useMemo(() => {
    if (!rmStock && !fgStock) return null;

    type StockItem = { name: string; dept?: string; qty: number; unit: string; cost: number; value: number; low: boolean; date: string };

    const rmItems: StockItem[] = (rmStock || []).map((r: any) => {
      const m = r.consumption_raw_materials || {};
      const qty = Number(r.closing_quantity) || 0;
      const cost = Number(m.cost_value) || 0;
      const threshold = Number(m.threshold) || 0;
      return {
        name: m.name || "—", qty, unit: m.unit || "", cost, value: qty * cost,
        low: threshold > 0 && qty <= threshold, date: r.closing_date,
      };
    });

    const fgItems: StockItem[] = (fgStock || []).map((r: any) => {
      const p = r.planning_items || {};
      const qty = Number(r.closing_quantity) || 0;
      const cost = Number(p.costing_value) || 0;
      const threshold = Number(p.threshold_inventory) || 0;
      return {
        name: p.name || "—", dept: r.production_departments?.name || "Unassigned",
        qty, unit: p.unit || "", cost, value: qty * cost,
        low: threshold > 0 && qty <= threshold, date: r.closing_date,
      };
    });

    const summarize = (items: StockItem[]) => {
      const asOf = items.reduce((m, i) => (i.date > m ? i.date : m), "");
      return {
        items,
        totalValue: items.reduce((s, i) => s + i.value, 0),
        itemCount: items.length,
        lowItems: items.filter((i) => i.low).sort((a, b) => a.qty - b.qty),
        top: [...items].sort((a, b) => b.value - a.value).slice(0, 5),
        asOf: asOf || null,
        staleDays: asOf ? differenceInCalendarDays(parseISO(today), parseISO(asOf)) : null,
      };
    };

    const rm = summarize(rmItems);
    const fg = summarize(fgItems);

    const deptMap: Record<string, { name: string; value: number; items: number; low: number }> = {};
    fgItems.forEach((i) => {
      const d = (deptMap[i.dept!] ||= { name: i.dept!, value: 0, items: 0, low: 0 });
      d.value += i.value; d.items += 1; if (i.low) d.low += 1;
    });
    const fgDepts = Object.values(deptMap).sort((a, b) => b.value - a.value);

    const alerts: { severity: "critical" | "warning"; text: string; href: string }[] = [];
    if (rm.lowItems.length > 0)
      alerts.push({ severity: "warning", text: `${rm.lowItems.length} raw material(s) at or below reorder threshold (${rm.lowItems.slice(0, 3).map((i) => i.name).join(", ")}${rm.lowItems.length > 3 ? "…" : ""})`, href: "/consumption/stock-closing-dashboard" });
    if (fg.lowItems.length > 0)
      alerts.push({ severity: "warning", text: `${fg.lowItems.length} finished/floor stock item(s) below threshold`, href: "/planning/closing-dashboard" });
    if (rm.staleDays !== null && rm.staleDays > 3)
      alerts.push({ severity: "warning", text: `Raw material stock closing is ${rm.staleDays} days old — ask the store to post today's closing`, href: "/consumption/stock-closing" });
    if (fg.staleDays !== null && fg.staleDays > 3)
      alerts.push({ severity: "warning", text: `Department stock closing is ${fg.staleDays} days old — ask planning to post today's closing`, href: "/planning/stock-closing" });

    return { rm, fg, fgDepts, alerts };
  }, [rmStock, fgStock, today]);

  const c = computed;
  const allAlerts = [...(c?.alerts || []), ...(phys?.alerts || [])];
  const scoreColor = !c ? "" : c.healthScore >= 80 ? "text-green-600" : c.healthScore >= 55 ? "text-blue-600" : c.healthScore >= 35 ? "text-amber-600" : "text-red-600";
  const scoreBg = !c ? "" : c.healthScore >= 80 ? "bg-green-600" : c.healthScore >= 55 ? "bg-blue-600" : c.healthScore >= 35 ? "bg-amber-500" : "bg-red-600";

  return (
    <ERPLayout>
      <PageHeader
        title="Business Health Dashboard"
        description="Full financial and operational insight — profitability, cash, receivables, ratios and alerts"
      />

      {linesLoading && (
        <Card className="mb-6"><CardContent className="p-8 text-center text-muted-foreground">
          Crunching the general ledger…
        </CardContent></Card>
      )}

      {c && (
        <>
          {/* Health score + alerts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><HeartPulse className="h-4 w-4" />Overall Health Score</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end gap-3">
                  <span className={`text-5xl font-bold ${scoreColor}`}>{c.healthScore}</span>
                  <span className="text-muted-foreground mb-1">/ 100</span>
                  <Badge className={`${scoreBg} mb-2 ml-auto`}>{c.healthLabel}</Badge>
                </div>
                <div className="mt-4 space-y-2 text-xs">
                  {[
                    { label: "Liquidity", val: c.scoreParts.liquidityScore },
                    { label: "Profitability", val: c.scoreParts.profitScore },
                    { label: "Collections", val: c.scoreParts.collectionScore },
                    { label: "Cash runway", val: c.scoreParts.cashScore },
                  ].map((p) => (
                    <div key={p.label} className="flex items-center gap-2">
                      <span className="w-24 text-muted-foreground">{p.label}</span>
                      <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
                        <div className={`h-full ${scoreBg}`} style={{ width: `${(p.val / 25) * 100}%` }} />
                      </div>
                      <span className="w-10 text-right font-medium">{p.val}/25</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Alerts</span>
                  {allAlerts.length === 0
                    ? <Badge className="bg-green-600"><CheckCircle className="h-3 w-3 mr-1" />All clear</Badge>
                    : <Badge variant="destructive">{allAlerts.length} issue(s)</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {allAlerts.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center">No health issues detected — cash, inventory, receivables and approvals all look fine.</p>
                )}
                <div className="space-y-2">
                  {allAlerts.map((a, i) => (
                    <Link key={i} to={a.href} className="flex items-start gap-2 rounded-md border p-2 text-sm hover:bg-muted/50">
                      {a.severity === "critical"
                        ? <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                        : <FileWarning className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />}
                      <span>{a.text}</span>
                      <ArrowUpRight className="h-3 w-3 ml-auto mt-1 text-muted-foreground shrink-0" />
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Profitability KPIs (month-to-date vs last month) */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <MetricCard
              title="Revenue (MTD)"
              value={fmtRs(c.mtd.revenue)}
              icon={TrendingUp}
              trend={c.revTrendPct !== undefined ? { value: c.revTrendPct, isPositive: c.mtd.revenue >= c.prev.revenue } : undefined}
            />
            <MetricCard
              title="Expenses (MTD)"
              value={fmtRs(c.mtd.cogs + c.mtd.opex)}
              icon={TrendingDown}
              trend={c.expTrendPct !== undefined ? { value: c.expTrendPct, isPositive: c.mtd.cogs + c.mtd.opex <= c.prev.cogs + c.prev.opex } : undefined}
            />
            <MetricCard
              title={`Net ${c.mtdNet >= 0 ? "Profit" : "Loss"} (MTD)`}
              value={fmtRs(Math.abs(c.mtdNet))}
              icon={Activity}
              iconColor={c.mtdNet >= 0 ? "text-green-600" : "text-red-600"}
              trend={c.netTrendPct !== undefined ? { value: c.netTrendPct, isPositive: c.mtdNet >= c.prevNet } : undefined}
            />
            <MetricCard
              title="Gross Margin (MTD)"
              value={c.grossMarginMtd !== null ? `${c.grossMarginMtd.toFixed(1)}%` : "—"}
              icon={Scale}
              description="Revenue minus COGS, as % of revenue"
            />
          </div>

          {/* Position KPIs */}
          <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
            <MetricCard title="Cash + Bank" value={fmtRs(c.cashPool)} icon={Wallet} description={`Cash ${fmtRsShort(c.totalCash)} · Bank ${fmtRsShort(c.totalBank)}`} />
            <MetricCard title="Receivables" value={fmtRs(c.arAging.total)} icon={ArrowUpRight} description={`${c.arRows.length} customer(s) owe us`} />
            <MetricCard title="Payables" value={fmtRs(c.apAging.total)} icon={ArrowDownRight} description={`${c.apRows.length} vendor(s) we owe`} />
            <MetricCard title="Inventory (GL)" value={fmtRs(c.totalInventory)} icon={Package} description="RM + WIP + FG accounts" />
            <MetricCard title="Working Capital" value={fmtRs(c.workingCapital)} icon={Scale} description="Current assets − payables" />
            <MetricCard
              title="Cash Runway"
              value={c.runwayMonths === Infinity ? "Positive" : `~${c.runwayMonths.toFixed(1)} mo`}
              icon={Hourglass}
              description={c.runwayMonths === Infinity ? "Cash flow positive (3-mo avg)" : "At current 3-mo avg burn"}
            />
          </div>

          {/* Physical inventory — live from daily stock closings */}
          {phys && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
              {[
                {
                  key: "rm", title: "Raw Material Stock", icon: <Package className="h-4 w-4" />,
                  s: phys.rm, updatedAt: rmUpdatedAt, showDept: false,
                  emptyText: "No raw material closing posted in the last 30 days",
                  detailHref: "/consumption/stock-closing-dashboard", detailLabel: "Raw material stock dashboard →",
                },
                {
                  key: "fg", title: "Finished Goods & Floor Stock", icon: <PackageCheck className="h-4 w-4" />,
                  s: phys.fg, updatedAt: fgUpdatedAt, showDept: true,
                  emptyText: "No department closing posted in the last 30 days",
                  detailHref: "/planning/closing-dashboard", detailLabel: "Daily closing dashboard →",
                },
              ].map((card) => (
                <Card key={card.key}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span className="flex items-center gap-2">{card.icon}{card.title}</span>
                      <span className="flex items-center gap-2 font-normal">
                        {card.s.asOf && (
                          <Badge variant="outline" className={card.s.staleDays !== null && card.s.staleDays > 3 ? "bg-amber-100 text-amber-800" : ""}>
                            Closing: {format(parseISO(card.s.asOf), "dd MMM")}
                          </Badge>
                        )}
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                          </span>
                          Live · {card.updatedAt ? format(new Date(card.updatedAt), "HH:mm") : "—"}
                        </span>
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {card.s.itemCount === 0 ? (
                      <p className="text-sm text-muted-foreground py-8 text-center">{card.emptyText}</p>
                    ) : (
                      <>
                        <div className="flex items-end justify-between mb-3">
                          <div>
                            <div className="text-2xl font-semibold">{fmtRs(card.s.totalValue)}</div>
                            <div className="text-xs text-muted-foreground">Estimated value · {card.s.itemCount} item(s) tracked</div>
                          </div>
                          {card.s.lowItems.length > 0
                            ? <Badge variant="outline" className="bg-red-100 text-red-800">{card.s.lowItems.length} below threshold</Badge>
                            : <Badge variant="outline" className="bg-green-100 text-green-800">Stock levels OK</Badge>}
                        </div>
                        {card.showDept && (
                          <div className="flex flex-wrap gap-2 mb-3">
                            {phys.fgDepts.map((d) => (
                              <div key={d.name} className="rounded-md border px-2 py-1 text-xs">
                                <span className="font-medium">{d.name}</span>
                                <span className="text-muted-foreground"> · {d.items} items · {fmtRsShort(d.value)}</span>
                                {d.low > 0 && <span className="text-red-600"> · {d.low} low</span>}
                              </div>
                            ))}
                          </div>
                        )}
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Top items by value</TableHead>
                              <TableHead className="text-right">Qty</TableHead>
                              <TableHead className="text-right">Value</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {card.s.top.map((i: any, idx: number) => (
                              <TableRow key={idx}>
                                <TableCell className="text-sm">
                                  {i.name}
                                  {card.showDept && <span className="text-xs text-muted-foreground"> · {i.dept}</span>}
                                  {i.low && <Badge variant="outline" className="ml-2 bg-red-100 text-red-800">Low</Badge>}
                                </TableCell>
                                <TableCell className={`text-right text-sm ${i.low ? "text-red-600 font-medium" : ""}`}>
                                  {i.qty.toLocaleString()} {i.unit}
                                </TableCell>
                                <TableCell className="text-right text-sm font-medium">{i.cost > 0 ? fmtRs(i.value) : "—"}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {card.s.lowItems.length > 0 && (
                          <div className="mt-2 text-xs text-red-600">
                            Low: {card.s.lowItems.slice(0, 4).map((i: any) => `${i.name} (${i.qty.toLocaleString()} ${i.unit})`).join(", ")}
                            {card.s.lowItems.length > 4 ? ` +${card.s.lowItems.length - 4} more` : ""}
                          </div>
                        )}
                      </>
                    )}
                    <div className="mt-2 text-right">
                      <Link to={card.detailHref} className="text-xs text-primary hover:underline">{card.detailLabel}</Link>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Revenue vs Expenses vs Net — 12 months */}
          <Card className="mb-4">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Revenue vs Expenses vs Net Profit — last 12 months</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={c.plSeries}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="month" fontSize={12} />
                  <YAxis fontSize={12} tickFormatter={fmtRsShort} />
                  <Tooltip formatter={(v: any) => fmtRs(Number(v))} />
                  <Legend />
                  <Bar dataKey="revenue" name="Revenue" fill="#22c55e" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="expenses" name="Expenses (COGS + Opex)" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                  <Line type="monotone" dataKey="net" name="Net Profit" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                  <ReferenceLine y={0} stroke="#94a3b8" />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Cash trend + in/out */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Cash & Bank Balance Trend — 12 months</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={c.cashTrend}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="month" fontSize={12} />
                    <YAxis fontSize={12} tickFormatter={fmtRsShort} />
                    <Tooltip formatter={(v: any) => fmtRs(Number(v))} />
                    <Area type="monotone" dataKey="balance" name="Cash + Bank" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.15} strokeWidth={2} />
                    <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 4" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Cash In vs Cash Out — last 6 months</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={c.cashFlowSeries}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="month" fontSize={12} />
                    <YAxis fontSize={12} tickFormatter={fmtRsShort} />
                    <Tooltip formatter={(v: any) => fmtRs(Number(v))} />
                    <Legend />
                    <Bar dataKey="cashIn" name="Cash In" fill="#22c55e" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="cashOut" name="Cash Out" fill="#ef4444" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Margins + expense mix */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Margin Trend (% of revenue)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={c.marginSeries}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="month" fontSize={12} />
                    <YAxis fontSize={12} unit="%" />
                    <Tooltip formatter={(v: any) => `${v}%`} />
                    <Legend />
                    <Line type="monotone" dataKey="gross" name="Gross Margin" stroke="#22c55e" strokeWidth={2} connectNulls dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="net" name="Net Margin" stroke="#8b5cf6" strokeWidth={2} connectNulls dot={{ r: 3 }} />
                    <ReferenceLine y={0} stroke="#94a3b8" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Expense Mix — last 3 months (by category)</CardTitle></CardHeader>
              <CardContent>
                {c.expenseMix.length === 0
                  ? <p className="text-sm text-muted-foreground py-10 text-center">No expense postings in the last 3 months</p>
                  : (
                    <ResponsiveContainer width="100%" height={260}>
                      <PieChart>
                        <Pie data={c.expenseMix} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={50} paddingAngle={2}>
                          {c.expenseMix.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: any) => fmtRs(Number(v))} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
              </CardContent>
            </Card>
          </div>

          {/* AR / AP aging + top parties */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
            {[
              { label: "Receivables Aging", rows: c.arRows, aging: c.arAging, isAR: true, ledgerType: "customer", color: "#22c55e" },
              { label: "Payables Aging", rows: c.apRows, aging: c.apAging, isAR: false, ledgerType: "supplier", color: "#ef4444" },
            ].map((side) => (
              <Card key={side.label}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span>{side.label}</span>
                    <span className="font-normal text-muted-foreground">{fmtRs(side.aging.total)}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={[
                      { bucket: "0-30 days", amount: Math.round(side.aging.b0_30) },
                      { bucket: "31-60", amount: Math.round(side.aging.b31_60) },
                      { bucket: "61-90", amount: Math.round(side.aging.b61_90) },
                      { bucket: "90+", amount: Math.round(side.aging.b90p) },
                    ]}>
                      <XAxis dataKey="bucket" fontSize={11} />
                      <YAxis fontSize={11} tickFormatter={fmtRsShort} />
                      <Tooltip formatter={(v: any) => fmtRs(Number(v))} />
                      <Bar dataKey="amount" name="Outstanding" radius={[3, 3, 0, 0]}>
                        {[0, 1, 2, 3].map((i) => <Cell key={i} fill={i === 3 ? "#ef4444" : side.color} fillOpacity={i === 3 ? 1 : 0.4 + i * 0.2} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{side.isAR ? "Top customers by balance" : "Top vendors by balance"}</TableHead>
                        <TableHead className="text-right">90+</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {side.rows.length === 0 && (
                        <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">Nothing outstanding</TableCell></TableRow>
                      )}
                      {side.rows.slice(0, 5).map((r) => (
                        <TableRow key={r.party_id}>
                          <TableCell className="text-sm">
                            <Link to={`/accounting/party-ledger?type=${side.ledgerType}&party=${r.party_id}`} className="text-primary hover:underline">
                              {parties?.[r.party_id]?.name || "—"}
                            </Link>
                            {side.isAR && creditLimits?.[r.party_id] != null && r.total > creditLimits[r.party_id] && (
                              <Badge variant="outline" className="ml-2 bg-red-100 text-red-800">Over limit</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs text-red-600">{r.b90p ? fmtRs(r.b90p) : "—"}</TableCell>
                          <TableCell className="text-right text-sm font-medium">{fmtRs(r.total)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="mt-2 text-right">
                    <Link to="/accounting/ar-ap-report" className="text-xs text-primary hover:underline">Full aging report →</Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Financial ratios */}
          <Card className="mb-4">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Financial Ratios</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {[
                  { label: "Current Ratio", value: c.currentRatio !== null ? c.currentRatio.toFixed(2) : "—", hint: "(Cash + AR + Inventory) / Payables. Healthy ≥ 1.5", bad: c.currentRatio !== null && c.currentRatio < 1 },
                  { label: "Quick Ratio", value: c.quickRatio !== null ? c.quickRatio.toFixed(2) : "—", hint: "(Cash + AR) / Payables. Healthy ≥ 1.0", bad: c.quickRatio !== null && c.quickRatio < 1 },
                  { label: "Debt / Equity", value: c.debtToEquity !== null ? c.debtToEquity.toFixed(2) : "—", hint: "Total liabilities / equity incl. retained earnings", bad: c.debtToEquity !== null && c.debtToEquity > 2 },
                  { label: "DSO", value: c.dso !== null ? `${Math.round(c.dso)} days` : "—", hint: "Avg days to collect (AR vs 90-day revenue)", bad: c.dso !== null && c.dso > 60 },
                  { label: "DPO", value: c.dpo !== null ? `${Math.round(c.dpo)} days` : "—", hint: "Avg days to pay (AP vs 90-day COGS)", bad: false },
                ].map((r) => (
                  <div key={r.label} className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">{r.label}</div>
                    <div className={`text-2xl font-semibold ${r.bad ? "text-red-600" : ""}`}>{r.value}</div>
                    <div className="text-[11px] text-muted-foreground mt-1">{r.hint}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Operations pulse */}
          <Card className="mb-6">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Operations Pulse — this month</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <MetricCard title="Sales Orders (MTD)" value={(ops?.soCount ?? 0).toString()} icon={ShoppingCart} description={fmtRs(ops?.soValue ?? 0)} />
                <MetricCard title="Dispatches (MTD)" value={(ops?.dispatchCount ?? 0).toString()} icon={Truck} />
                <MetricCard title="Open Purchase Orders" value={(ops?.openPOCount ?? 0).toString()} icon={ClipboardList} description={fmtRs(ops?.openPOValue ?? 0)} />
                <MetricCard title="GRNs Received (MTD)" value={(ops?.grnCount ?? 0).toString()} icon={Package} />
                <MetricCard
                  title="Expenses Pending Approval"
                  value={(ops?.pendingExpCount ?? 0).toString()}
                  icon={Receipt}
                  iconColor={(ops?.pendingExpCount ?? 0) > 0 ? "text-amber-600" : "text-primary"}
                  description={fmtRs(ops?.pendingExpValue ?? 0)}
                />
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </ERPLayout>
  );
}
