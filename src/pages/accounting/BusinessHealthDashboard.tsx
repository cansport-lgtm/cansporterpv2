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
  ClipboardList, Receipt, FileWarning,
} from "lucide-react";
import { format, subMonths, startOfMonth, parseISO, differenceInCalendarDays } from "date-fns";
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

type RatioStatus = "good" | "watch" | "bad" | null;

const RATIO_BADGE: Record<Exclude<RatioStatus, null>, { cls: string; text: string }> = {
  good: { cls: "bg-green-600", text: "Good" },
  watch: { cls: "bg-amber-500", text: "Watch" },
  bad: { cls: "bg-red-600", text: "Poor" },
};

function RatioTile({ label, value, status, formula, note, trend, trendFmt }: {
  label: string;
  value: string;
  status: RatioStatus;
  formula: string;
  note: string;
  trend?: { month: string; v: number | null }[];
  trendFmt?: (v: number) => string;
}) {
  const hasTrend = trend && trend.some((t) => t.v !== null);
  const stroke = status === "bad" ? "#ef4444" : status === "watch" ? "#f59e0b" : "#22c55e";
  return (
    <div className="rounded-lg border p-3 flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        {status && <Badge className={`text-[10px] px-1.5 py-0 shrink-0 ${RATIO_BADGE[status].cls}`}>{RATIO_BADGE[status].text}</Badge>}
      </div>
      <div className={`text-2xl font-semibold ${status === "bad" ? "text-red-600" : status === "watch" ? "text-amber-600" : ""}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground mt-1">{formula}</div>
      <div className="text-[11px] mt-0.5">{note}</div>
      {hasTrend && (
        <div className="h-10 mt-auto pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
              <Tooltip
                formatter={(v: any) => [trendFmt ? trendFmt(Number(v)) : v, label]}
                labelFormatter={(_: any, p: any) => p?.[0]?.payload?.month ?? ""}
                contentStyle={{ fontSize: 11, padding: "2px 8px" }}
              />
              <Line type="monotone" dataKey="v" stroke={stroke} strokeWidth={1.5} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/**
 * Ratio definitions: formula strings carry the actual GL numbers so the user
 * can see exactly what went into each figure. Thresholds are the conventional
 * healthy bands for a trading/manufacturing business.
 */
function buildRatioGroups(c: any): { title: string; cols: string; items: any[] }[] {
  const tr = (key: string) => (c.ratioTrend as any[]).map((t) => ({ month: t.month, v: t[key] }));
  const hi = (v: number | null, good: number, bad: number): RatioStatus => (v === null ? null : v >= good ? "good" : v < bad ? "bad" : "watch");
  const lo = (v: number | null, good: number, bad: number): RatioStatus => (v === null ? null : v <= good ? "good" : v > bad ? "bad" : "watch");
  const money = (n: number) => `Rs ${fmtRsShort(n)}`;
  const days = (v: number) => `${Math.round(v)} days`;
  const pct = (v: number) => `${v.toFixed(1)}%`;

  return [
    {
      title: "Liquidity",
      cols: "xl:grid-cols-3",
      items: [
        {
          label: "Current Ratio",
          value: c.currentRatio !== null ? c.currentRatio.toFixed(2) : "—",
          status: hi(c.currentRatio, 1.5, 1),
          formula: `Current assets ${money(c.glCurrentAssets)} ÷ current liabilities ${money(c.glCurrentLiabilities)}`,
          note: c.currentRatio === null
            ? "No current liabilities on the books yet."
            : `Rs ${c.currentRatio.toFixed(2)} of current assets per Rs 1 due within a year — healthy is 1.5 or more.`,
          trend: tr("currentRatio"),
        },
        {
          label: "Quick Ratio",
          value: c.quickRatio !== null ? c.quickRatio.toFixed(2) : "—",
          status: hi(c.quickRatio, 1, 0.7),
          formula: `(Cash + bank + receivables) ${money(c.glQuickAssets)} ÷ current liabilities ${money(c.glCurrentLiabilities)}`,
          note: c.quickRatio === null
            ? "No current liabilities on the books yet."
            : `Short-term dues covered ${c.quickRatio.toFixed(2)}× without having to sell inventory — healthy is 1.0 or more.`,
          trend: tr("quickRatio"),
        },
        {
          label: "Working Capital",
          value: fmtRs(c.workingCapital),
          status: (c.workingCapital >= 0 ? "good" : "bad") as RatioStatus,
          formula: `Current assets ${money(c.glCurrentAssets)} − current liabilities ${money(c.glCurrentLiabilities)}`,
          note: c.workingCapital >= 0
            ? "Positive buffer available to fund day-to-day operations."
            : "Short-term dues exceed short-term assets — cash squeeze risk.",
          trend: tr("workingCapital"),
          trendFmt: money,
        },
      ],
    },
    {
      title: "Profitability",
      cols: "xl:grid-cols-4",
      items: [
        {
          label: "Gross Margin (3 mo)",
          value: c.grossMargin3m !== null ? pct(c.grossMargin3m) : "—",
          status: hi(c.grossMargin3m, 25, 10),
          formula: `(Revenue ${money(c.rev90)} − COGS ${money(c.cogs90)}) ÷ revenue, last 3 months`,
          note: c.grossMargin3m === null
            ? "No revenue posted in the last 3 months."
            : `Rs ${c.grossMargin3m.toFixed(0)} of every Rs 100 sold remains after direct production cost.`,
          trend: tr("grossMargin"),
          trendFmt: pct,
        },
        {
          label: "Net Margin (3 mo)",
          value: c.netMargin3m !== null ? pct(c.netMargin3m) : "—",
          status: hi(c.netMargin3m, 10, 0),
          formula: `Net profit ${money(c.net3m)} ÷ revenue ${money(c.rev90)}, last 3 months`,
          note: c.netMargin3m === null
            ? "No revenue posted in the last 3 months."
            : c.netMargin3m >= 0
              ? `Rs ${c.netMargin3m.toFixed(0)} of every Rs 100 of sales is kept as profit after all expenses.`
              : "Operating at a loss over the last 3 months.",
          trend: tr("netMargin"),
          trendFmt: pct,
        },
        {
          label: "Return on Assets (ROA)",
          value: c.roa !== null ? pct(c.roa) : "—",
          status: hi(c.roa, 10, 0),
          formula: `Net profit 12-mo ${money(c.net12)} ÷ total assets ${money(c.glTotalAssets)}`,
          note: "Yearly profit generated per rupee tied up in assets — 10%+ is solid.",
          trend: tr("roa"),
          trendFmt: pct,
        },
        {
          label: "Return on Equity (ROE)",
          value: c.roe !== null ? pct(c.roe) : "—",
          status: hi(c.roe, 15, 0),
          formula: `Net profit 12-mo ${money(c.net12)} ÷ equity ${money(c.totalEquity)}`,
          note: "Return the owners earn on their invested capital — 15%+ is solid.",
          trend: tr("roe"),
          trendFmt: pct,
        },
      ],
    },
    {
      title: "Efficiency",
      cols: "xl:grid-cols-5",
      items: [
        {
          label: "DSO — Days Sales Outstanding",
          value: c.dso !== null ? days(c.dso) : "—",
          status: lo(c.dso, 45, 60),
          formula: `Receivables ${money(c.arAging.total)} ÷ avg daily sales ${money(c.rev90 / 90)}`,
          note: "Average days customers take to pay — under 45 keeps cash moving.",
          trend: tr("dso"),
          trendFmt: days,
        },
        {
          label: "DPO — Days Payables Outstanding",
          value: c.dpo !== null ? days(c.dpo) : "—",
          status: lo(c.dpo, 60, 90),
          formula: `Payables ${money(c.apAging.total)} ÷ avg daily COGS ${money(c.cogs90 / 90)}`,
          note: "Average days we take to pay suppliers — very high values strain vendor trust.",
          trend: tr("dpo"),
          trendFmt: days,
        },
        {
          label: "DIO — Days Inventory Outstanding",
          value: c.dio !== null ? days(c.dio) : "—",
          status: lo(c.dio, 60, 90),
          formula: `Inventory ${money(c.totalInventory)} ÷ avg daily COGS ${money(c.cogs90 / 90)}`,
          note: "Days of production cost sitting in stock — lower means faster turnover.",
          trend: tr("dio"),
          trendFmt: days,
        },
        {
          label: "Cash Conversion Cycle",
          value: c.ccc !== null ? days(c.ccc) : "—",
          status: lo(c.ccc, 60, 90),
          formula: c.dso !== null && c.dio !== null && c.dpo !== null
            ? `DSO ${Math.round(c.dso)}d + DIO ${Math.round(c.dio)}d − DPO ${Math.round(c.dpo)}d`
            : "Needs sales, inventory and purchase activity",
          note: "Days each rupee stays locked in operations before returning as cash.",
          trend: tr("ccc"),
          trendFmt: days,
        },
        {
          label: "Asset Turnover",
          value: c.assetTurnover !== null ? `${c.assetTurnover.toFixed(2)}×` : "—",
          status: (c.assetTurnover === null ? null : c.assetTurnover >= 1 ? "good" : "watch") as RatioStatus,
          formula: `Revenue 12-mo ${money(c.rev12)} ÷ total assets ${money(c.glTotalAssets)}`,
          note: "Sales generated per rupee of assets in a year — higher means assets work harder.",
          trend: tr("assetTurnover"),
        },
      ],
    },
    {
      title: "Solvency",
      cols: "xl:grid-cols-3",
      items: [
        {
          label: "Debt / Equity",
          value: c.debtToEquity !== null ? c.debtToEquity.toFixed(2) : "—",
          status: lo(c.debtToEquity, 1, 2),
          formula: `Total liabilities ${money(c.totalLiabilities)} ÷ equity ${money(c.totalEquity)} (incl. retained earnings)`,
          note: c.debtToEquity === null
            ? "Equity is zero or negative — ratio not meaningful."
            : `Rs ${c.debtToEquity.toFixed(2)} of debt per Rs 1 of owner funds — above 2 is highly leveraged.`,
          trend: tr("debtToEquity"),
        },
        {
          label: "Debt Ratio",
          value: c.debtRatio !== null ? c.debtRatio.toFixed(2) : "—",
          status: lo(c.debtRatio, 0.5, 0.7),
          formula: `Total liabilities ${money(c.totalLiabilities)} ÷ total assets ${money(c.glTotalAssets)}`,
          note: "Share of assets financed by debt — above 0.70 leaves little cushion.",
          trend: tr("debtRatio"),
        },
        {
          label: "Gearing (Long-term)",
          value: c.gearing !== null ? pct(c.gearing) : "—",
          status: lo(c.gearing, 30, 50),
          formula: `Long-term debt ${money(c.glLongTermLiabilities)} ÷ (long-term debt + equity ${money(c.totalEquity)})`,
          note: "Reliance on long-term borrowing in the capital structure.",
          trend: tr("gearing"),
          trendFmt: pct,
        },
      ],
    },
  ];
}

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

    // Balance-sheet classification via CoA sub-categories: liabilities count as
    // current unless explicitly long-term, assets as current unless fixed.
    const isFixedAsset = (a: any) => /fixed|non.?current|intangible/i.test(a.sub_category || "");
    const isLongTerm = (a: any) => /long.?term|non.?current/i.test(a.sub_category || "");
    const isReceivable = (a: any, id: string) => id === defaults?.ar || /receivable/i.test(a.sub_category || "");
    const isInventory = (a: any) => /inventor/i.test(a.sub_category || "") || ["1130", "1131", "1132"].includes(a.code);

    type BSClass = { totAssets: number; curAssets: number; quick: number; ar: number; ap: number; inv: number; curLiab: number; totLiab: number; equity: number; pl: number };
    const zeroBS = (): BSClass => ({ totAssets: 0, curAssets: 0, quick: 0, ar: 0, ap: 0, inv: 0, curLiab: 0, totLiab: 0, equity: 0, pl: 0 });
    const openingBS = zeroBS();
    const bsDeltas: Record<string, BSClass> = {};
    months.forEach((m) => { bsDeltas[m] = zeroBS(); });

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

      // Bucket balance-sheet movement by month (pre-window → opening) so every
      // ratio can show a 12-month trend and the final month equals the all-time totals.
      if (acc) {
        const bucket = monthSet.has(m) ? bsDeltas[m] : m && m > thisMonth ? bsDeltas[thisMonth] : openingBS;
        const net = dr - cr;
        if (acc.account_type === "asset") {
          bucket.totAssets += net;
          if (!isFixedAsset(acc)) bucket.curAssets += net;
          if (acc.is_cash_account || acc.is_bank_account) bucket.quick += net;
          if (isReceivable(acc, l.account_id)) { bucket.quick += net; bucket.ar += net; }
          if (isInventory(acc)) bucket.inv += net;
        } else if (acc.account_type === "liability") {
          bucket.totLiab -= net;
          if (!isLongTerm(acc)) bucket.curLiab -= net;
          if (defaults?.ap && l.account_id === defaults.ap) bucket.ap -= net;
        } else if (acc.account_type === "equity") {
          bucket.equity -= net;
        } else if (acc.account_type === "revenue" || acc.account_type === "expense") {
          bucket.pl -= net;
        }
      }
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
    // Month-end cumulative balance-sheet positions (opening + each month's delta)
    const bsCum: BSClass[] = [];
    {
      const run = { ...openingBS };
      months.forEach((m) => {
        (Object.keys(run) as (keyof BSClass)[]).forEach((k) => { run[k] += bsDeltas[m][k]; });
        bsCum.push({ ...run });
      });
    }
    const bs = bsCum[bsCum.length - 1];
    const glCurrentAssets = bs.curAssets;
    const glCurrentLiabilities = bs.curLiab;
    const glQuickAssets = bs.quick;
    const glTotalAssets = bs.totAssets;
    const glLongTermLiabilities = bs.totLiab - bs.curLiab;

    const rev90 = last3.reduce((s, m) => s + monthly[m].revenue, 0);
    const cogs90 = last3.reduce((s, m) => s + monthly[m].cogs, 0);
    const rev12 = months.reduce((s, m) => s + monthly[m].revenue, 0);
    const net12 = months.reduce((s, m) => s + monthly[m].revenue - monthly[m].cogs - monthly[m].opex, 0);

    const currentRatio = glCurrentLiabilities > 0 ? glCurrentAssets / glCurrentLiabilities : null;
    const quickRatio = glCurrentLiabilities > 0 ? glQuickAssets / glCurrentLiabilities : null;
    const debtToEquity = totalEquity > 0 ? totalLiabilities / totalEquity : null;
    const debtRatio = glTotalAssets > 0 ? totalLiabilities / glTotalAssets : null;
    const gearing = glLongTermLiabilities + totalEquity > 0 ? (glLongTermLiabilities / (glLongTermLiabilities + totalEquity)) * 100 : null;
    const dso = rev90 > 0 ? arAging.total / (rev90 / 90) : null;
    const dpo = cogs90 > 0 ? apAging.total / (cogs90 / 90) : null;
    const dio = cogs90 > 0 ? totalInventory / (cogs90 / 90) : null;
    const ccc = dso !== null && dio !== null && dpo !== null ? dso + dio - dpo : null;
    const roa = glTotalAssets > 0 ? (net12 / glTotalAssets) * 100 : null;
    const roe = totalEquity > 0 ? (net12 / totalEquity) * 100 : null;
    const assetTurnover = glTotalAssets > 0 && rev12 > 0 ? rev12 / glTotalAssets : null;
    const grossMargin3m = rev90 > 0 ? ((rev90 - cogs90) / rev90) * 100 : null;

    // 12-point trend per ratio: balances cumulative to month end, flows from the
    // trailing ≤3 months (annualized for ROA/ROE/turnover).
    const ratioTrend = months.map((m, i) => {
      const b = bsCum[i];
      const win = months.slice(Math.max(0, i - 2), i + 1);
      const winDays = win.length * 30;
      const rev = win.reduce((s, mm) => s + monthly[mm].revenue, 0);
      const cog = win.reduce((s, mm) => s + monthly[mm].cogs, 0);
      const net = win.reduce((s, mm) => s + monthly[mm].revenue - monthly[mm].cogs - monthly[mm].opex, 0);
      const eq = b.equity + b.pl;
      const lt = b.totLiab - b.curLiab;
      const ann = 365 / winDays;
      const dsoM = rev > 0 ? b.ar / (rev / winDays) : null;
      const dpoM = cog > 0 ? b.ap / (cog / winDays) : null;
      const dioM = cog > 0 ? b.inv / (cog / winDays) : null;
      return {
        month: format(parseISO(`${m}-01`), "MMM yy"),
        currentRatio: b.curLiab > 0 ? +(b.curAssets / b.curLiab).toFixed(2) : null,
        quickRatio: b.curLiab > 0 ? +(b.quick / b.curLiab).toFixed(2) : null,
        workingCapital: Math.round(b.curAssets - b.curLiab),
        debtToEquity: eq > 0 ? +(b.totLiab / eq).toFixed(2) : null,
        debtRatio: b.totAssets > 0 ? +(b.totLiab / b.totAssets).toFixed(2) : null,
        gearing: lt + eq > 0 ? +((lt / (lt + eq)) * 100).toFixed(1) : null,
        dso: dsoM !== null ? Math.round(dsoM) : null,
        dpo: dpoM !== null ? Math.round(dpoM) : null,
        dio: dioM !== null ? Math.round(dioM) : null,
        ccc: dsoM !== null && dioM !== null && dpoM !== null ? Math.round(dsoM + dioM - dpoM) : null,
        grossMargin: rev > 0 ? +(((rev - cog) / rev) * 100).toFixed(1) : null,
        netMargin: rev > 0 ? +((net / rev) * 100).toFixed(1) : null,
        roa: b.totAssets > 0 && rev > 0 ? +(((net * ann) / b.totAssets) * 100).toFixed(1) : null,
        roe: eq > 0 && rev > 0 ? +(((net * ann) / eq) * 100).toFixed(1) : null,
        assetTurnover: b.totAssets > 0 && rev > 0 ? +((rev * ann) / b.totAssets).toFixed(2) : null,
      };
    });

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
      currentRatio, quickRatio, debtToEquity, debtRatio, gearing, dso, dpo, dio, ccc,
      roa, roe, assetTurnover, grossMargin3m, netMargin3m, net3m, runwayMonths,
      glCurrentAssets, glCurrentLiabilities, glQuickAssets, glTotalAssets, glLongTermLiabilities,
      rev90, cogs90, rev12, net12, ratioTrend,
      workingCapital: glCurrentAssets - glCurrentLiabilities,
      healthScore, healthLabel,
      scoreParts: { liquidityScore, profitScore, collectionScore, cashScore },
      alerts,
    };
  }, [accounts, allLines, defaults, creditLimits, ops, today]);

  const c = computed;
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
                  {c.alerts.length === 0
                    ? <Badge className="bg-green-600"><CheckCircle className="h-3 w-3 mr-1" />All clear</Badge>
                    : <Badge variant="destructive">{c.alerts.length} issue(s)</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {c.alerts.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center">No health issues detected — cash, inventory, receivables and approvals all look fine.</p>
                )}
                <div className="space-y-2">
                  {c.alerts.map((a, i) => (
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
            <MetricCard title="Working Capital" value={fmtRs(c.workingCapital)} icon={Scale} description="Current assets − current liabilities" />
            <MetricCard
              title="Cash Runway"
              value={c.runwayMonths === Infinity ? "Positive" : `~${c.runwayMonths.toFixed(1)} mo`}
              icon={Hourglass}
              description={c.runwayMonths === Infinity ? "Cash flow positive (3-mo avg)" : "At current 3-mo avg burn"}
            />
          </div>

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

          {/* Financial ratios — grouped, with formula numbers, health bands and trends */}
          <Card className="mb-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Financial Ratios</CardTitle>
              <p className="text-xs text-muted-foreground font-normal">
                Each ratio shows its formula with live ledger numbers, a health band, and the 12-month trend.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              {buildRatioGroups(c).map((g) => (
                <div key={g.title}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{g.title}</div>
                  <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 ${g.cols} gap-3`}>
                    {g.items.map((it) => <RatioTile key={it.label} {...it} />)}
                  </div>
                </div>
              ))}
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
