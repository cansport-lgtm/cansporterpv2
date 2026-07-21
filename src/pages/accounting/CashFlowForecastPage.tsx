import { Fragment, useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
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
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Wallet, ArrowUpRight, ArrowDownRight, TrendingUp, AlertTriangle, ChevronRight, ChevronDown, CalendarClock, Plus, Pencil, Trash2 } from "lucide-react";
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

type PartyAmount = { partyId: string; amount: number };

type SchedOccurrence = {
  name: string;
  category: string;
  direction: "inflow" | "outflow";
  amount: number;
  due: string;
};

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
  arParties: PartyAmount[];
  apParties: PartyAmount[];
  // Composition of the "other" columns: smoothed run-rate + dated items.
  runIn: number;
  runOut: number;
  schedItems: SchedOccurrence[];
};

const SCHED_CATEGORIES = [
  { value: "bill", label: "Bill" },
  { value: "rent", label: "Rent" },
  { value: "drawings", label: "Drawings" },
  { value: "other", label: "Other" },
];

interface SchedForm {
  name: string;
  direction: "inflow" | "outflow";
  category: string;
  amount: string;
  frequency: "monthly" | "one_time";
  due_day: string;
  due_date: string;
  account_id: string;
  is_active: boolean;
}

const defaultSchedForm: SchedForm = {
  name: "",
  direction: "outflow",
  category: "bill",
  amount: "",
  frequency: "monthly",
  due_day: "1",
  due_date: "",
  account_id: "",
  is_active: true,
};

export default function CashFlowForecastPage() {
  const today = format(new Date(), "yyyy-MM-dd");

  // ----- Assumptions (page-local; nothing is persisted) -----
  const [interval, setIntervalMode] = useState<"weekly" | "monthly">("weekly");
  const [periods, setPeriods] = useState(8);
  const [collectionDays, setCollectionDays] = useState(30);
  const [paymentDays, setPaymentDays] = useState(30);
  // Run-rate is split by direction: outflows (salaries, utilities…) genuinely
  // recur, so they default ON. Inflows default OFF — this business's real
  // inflows are AR collections and scheduled rent; historical cash-ins are
  // mostly one-off capital injections that shouldn't be projected forward.
  const [includeRunOut, setIncludeRunOut] = useState(true);
  const [includeRunIn, setIncludeRunIn] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [schedDialogOpen, setSchedDialogOpen] = useState(false);
  const [schedEditId, setSchedEditId] = useState<string | null>(null);
  const [schedForm, setSchedForm] = useState<SchedForm>(defaultSchedForm);
  const queryClient = useQueryClient();

  const toggleExpanded = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

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

  // Per-account breakup of the same lines — where the money sits right now.
  const accountBalances = useMemo(() => {
    const byAccount: Record<string, number> = {};
    (cashLines || []).forEach((l: any) => {
      byAccount[l.account_id] =
        (byAccount[l.account_id] || 0) + Number(l.debit_amount || 0) - Number(l.credit_amount || 0);
    });
    return (cashBankAccounts || [])
      .map((a: any) => ({
        id: a.id as string,
        code: (a.code as string) || "",
        name: a.name as string,
        isCash: !!a.is_cash_account,
        balance: byAccount[a.id] || 0,
      }))
      .sort((x, y) => y.balance - x.balance);
  }, [cashLines, cashBankAccounts]);

  // Per-party credit terms and limits. Resilient to the columns not existing
  // yet (frontend deploy and DB migration are not atomic) — falls back to the
  // page-level defaults for everyone.
  const { data: partyTerms } = useQuery({
    queryKey: ["cff-party-terms"],
    queryFn: async () => {
      const days: Record<string, number> = {};
      const limits: Record<string, number> = {};
      const { data, error } = await sb
        .from("accounting_parties")
        .select("id, credit_days, credit_limit")
        .or("credit_days.not.is.null,credit_limit.not.is.null");
      if (error) return { days, limits };
      (data || []).forEach((r: any) => {
        if (r.credit_days != null) days[r.id] = Number(r.credit_days);
        if (r.credit_limit != null && Number(r.credit_limit) > 0) limits[r.id] = Number(r.credit_limit);
      });
      return { days, limits };
    },
  });

  // Scheduled cash items (bills, rent, drawings). Resilient to the table not
  // existing yet — the feature simply stays empty until the migration lands.
  const { data: schedItemsAll } = useQuery({
    queryKey: ["cff-scheduled-items"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_scheduled_cash_items")
        .select("*")
        .order("name");
      if (error) return [];
      return data || [];
    },
  });
  const activeSchedItems = useMemo(
    () => (schedItemsAll || []).filter((i: any) => i.is_active),
    [schedItemsAll]
  );
  const linkedAccountIds = useMemo(
    () => Array.from(new Set(activeSchedItems.map((i: any) => i.account_id).filter(Boolean))) as string[],
    [activeSchedItems]
  );

  // Accounts the scheduled-item dialog can link to (postable heads).
  const { data: postableAccounts } = useQuery({
    queryKey: ["cff-postable-accounts"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_chart_of_accounts")
        .select("id, code, name")
        .eq("is_active", true)
        .not("sub_category", "is", null)
        .order("code");
      if (error) throw error;
      return data || [];
    },
  });

  const saveSchedMutation = useMutation({
    mutationFn: async (f: SchedForm) => {
      const payload = {
        name: f.name.trim(),
        direction: f.direction,
        category: f.category,
        amount: Math.max(0, Number(f.amount) || 0),
        frequency: f.frequency,
        due_day: f.frequency === "monthly" ? Math.min(31, Math.max(1, Math.round(Number(f.due_day)) || 1)) : null,
        due_date: f.frequency === "one_time" ? f.due_date : null,
        account_id: f.account_id || null,
        is_active: f.is_active,
      };
      if (f.frequency === "one_time" && !payload.due_date) throw new Error("Pick a due date for a one-time item");
      if (schedEditId) {
        const { error } = await sb.from("accounting_scheduled_cash_items").update(payload).eq("id", schedEditId);
        if (error) throw error;
      } else {
        const { error } = await sb.from("accounting_scheduled_cash_items").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cff-scheduled-items"] });
      toast({ title: schedEditId ? "Scheduled item updated" : "Scheduled item added" });
      setSchedEditId(null);
      setSchedForm(defaultSchedForm);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteSchedMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("accounting_scheduled_cash_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cff-scheduled-items"] });
      toast({ title: "Scheduled item deleted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // Outstanding AR / AP lines (same shape as the Receivables & Payables report)
  const partyLinesQuery = (account: string | null | undefined) => async () => {
    if (!account) return [];
    return fetchAllRows((from, to) =>
      sb
        .from("accounting_voucher_lines")
        .select("party_id, debit_amount, credit_amount, voucher:accounting_vouchers!inner(voucher_date, voucher_number), party:accounting_parties(name)")
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

  // Vouchers that touched an account linked to a scheduled item — excluded
  // from the run-rate so a bill isn't counted both as run-rate and as its
  // dated scheduled item.
  const { data: histLinkedIds } = useQuery({
    queryKey: ["cff-hist-linked", linkedAccountIds.join(","), histFrom, today],
    queryFn: async () => {
      if (!linkedAccountIds.length) return new Set<string>();
      const rows = await fetchAllRows((from, to) =>
        sb
          .from("accounting_voucher_lines")
          .select("voucher_id, voucher:accounting_vouchers!inner(voucher_date)")
          .in("account_id", linkedAccountIds)
          .gte("voucher.voucher_date", histFrom)
          .lte("voucher.voucher_date", today)
          .order("id", { ascending: true })
          .range(from, to));
      return new Set<string>(rows.map((r: any) => r.voucher_id));
    },
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
      if (histLinkedIds?.has(vid)) return;
      if (net > 0) inflow += net;
      else outflow += -net;
    });
    return { inflow: inflow / 90, outflow: outflow / 90 };
  }, [histCashLines, histSettlementIds, histLinkedIds]);

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

  const partyNames = useMemo(() => {
    const m: Record<string, string> = {};
    [...(arLines || []), ...(apLines || [])].forEach((l: any) => {
      if (l.party_id && l.party?.name) m[l.party_id] = l.party.name;
    });
    return m;
  }, [arLines, apLines]);

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
      arParties: [], apParties: [],
      runIn: 0, runOut: 0, schedItems: [],
    }));

    // Per-period, per-party accumulators behind the expandable breakup rows.
    const arByParty: Record<string, number>[] = rows.map(() => ({}));
    const apByParty: Record<string, number>[] = rows.map(() => ({}));

    // Place an expected cash event (item date + credit terms) into a period.
    // A party with its own credit_days (set in Accounting → Parties) uses
    // those; others use the page-level default. Anything already due (or
    // overdue) lands in period 1; anything past the horizon is reported
    // separately instead of silently dropped.
    let arBeyond = 0, apBeyond = 0, overdueAR = 0, overdueAP = 0;
    const place = (item: OpenItem, defaultTermDays: number, isIn: boolean, dueOverride?: Date) => {
      const termDays = partyTerms?.days?.[item.partyId] ?? defaultTermDays;
      const due = dueOverride ?? addDays(parseISO(item.date), termDays);
      if (due > horizonEnd) {
        if (isIn) arBeyond += item.amount; else apBeyond += item.amount;
        return;
      }
      let idx = 0;
      if (due > start) idx = bounds.findIndex((b) => due >= b.start && due <= b.end);
      if (idx < 0) idx = rows.length - 1;
      if (isIn) {
        rows[idx].arIn += item.amount;
        arByParty[idx][item.partyId] = (arByParty[idx][item.partyId] || 0) + item.amount;
        if (due <= start) overdueAR += item.amount;
      } else {
        rows[idx].apOut += item.amount;
        apByParty[idx][item.partyId] = (apByParty[idx][item.partyId] || 0) + item.amount;
        if (due <= start) overdueAP += item.amount;
      }
    };
    arItems.forEach((i) => place(i, collectionDays, true));

    // Vendors with a credit limit are treated as revolving accounts: only the
    // outstanding ABOVE the limit is considered due — payable immediately —
    // and the balance within the limit is carried, not scheduled. The excess
    // consumes the oldest invoices first (items arrive in FIFO order).
    let apWithinLimit = 0;
    const apByPartyItems: Record<string, OpenItem[]> = {};
    apItems.forEach((i) => { (apByPartyItems[i.partyId] ||= []).push(i); });
    Object.entries(apByPartyItems).forEach(([pid, items]) => {
      const limit = partyTerms?.limits?.[pid];
      if (!limit) {
        items.forEach((i) => place(i, paymentDays, false));
        return;
      }
      const total = items.reduce((s, i) => s + i.amount, 0);
      let excess = Math.max(0, total - limit);
      apWithinLimit += total - excess;
      for (const it of items) {
        if (excess <= 0) break;
        const amt = Math.min(it.amount, excess);
        place({ ...it, amount: amt }, paymentDays, false, start);
        excess -= amt;
      }
    });

    rows.forEach((r, idx) => {
      const toSorted = (m: Record<string, number>): PartyAmount[] =>
        Object.entries(m)
          .map(([partyId, amount]) => ({ partyId, amount }))
          .sort((a, b) => b.amount - a.amount);
      r.arParties = toSorted(arByParty[idx]);
      r.apParties = toSorted(apByParty[idx]);
    });

    // Scheduled cash items: monthly items fall due on their due day each month
    // (clamped to month length); one-time items on their date. Only occurrences
    // after today are forecast — an already-passed due day is assumed settled
    // and reflected in the opening balance.
    let drawingsTotal = 0;
    activeSchedItems.forEach((item: any) => {
      const occs: Date[] = [];
      if (item.frequency === "one_time") {
        if (item.due_date) {
          const d = parseISO(item.due_date);
          if (d > start && d <= horizonEnd) occs.push(d);
        }
      } else {
        let m = new Date(start.getFullYear(), start.getMonth(), 1);
        while (m <= horizonEnd) {
          const lastDay = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
          const d = new Date(m.getFullYear(), m.getMonth(), Math.min(Number(item.due_day) || 1, lastDay));
          if (d > start && d <= horizonEnd) occs.push(d);
          m = addMonths(m, 1);
        }
      }
      occs.forEach((due) => {
        const idx = bounds.findIndex((b) => due >= b.start && due <= b.end);
        if (idx < 0) return;
        const amt = Number(item.amount) || 0;
        rows[idx].schedItems.push({
          name: item.name,
          category: item.category,
          direction: item.direction,
          amount: amt,
          due: format(due, "yyyy-MM-dd"),
        });
        if (item.category === "drawings" && item.direction === "outflow") drawingsTotal += amt;
      });
    });

    // "Other" columns = smoothed run-rate (toggleable) + dated scheduled items.
    rows.forEach((r) => {
      const days = differenceInCalendarDays(parseISO(r.end), parseISO(r.start)) + 1;
      r.runIn = includeRunIn ? otherDaily.inflow * days : 0;
      r.runOut = includeRunOut ? otherDaily.outflow * days : 0;
      r.schedItems.sort((a, b) => a.due.localeCompare(b.due));
      const schedIn = r.schedItems.filter((s) => s.direction === "inflow").reduce((sum, s) => sum + s.amount, 0);
      const schedOut = r.schedItems.filter((s) => s.direction === "outflow").reduce((sum, s) => sum + s.amount, 0);
      r.otherIn = r.runIn + schedIn;
      r.otherOut = r.runOut + schedOut;
    });

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

    return { rows, arBeyond, apBeyond, overdueAR, overdueAP, apWithinLimit, drawingsTotal, totalIn, totalOut, minRow, firstNegative };
  }, [arItems, apItems, otherDaily, openingCash, periods, interval, collectionDays, paymentDays, includeRunIn, includeRunOut, partyTerms, activeSchedItems, today]);

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
      XLSX.utils.json_to_sheet(
        forecast.rows.flatMap((r) => [
          ...r.arParties.map((p) => ({
            Period: r.label,
            Type: "AR Collection",
            Party: partyNames[p.partyId] || "—",
            Amount: Math.round(p.amount),
          })),
          ...r.apParties.map((p) => ({
            Period: r.label,
            Type: "AP Payment",
            Party: partyNames[p.partyId] || "—",
            Amount: Math.round(p.amount),
          })),
        ])
      ),
      "By Party"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        forecast.rows.flatMap((r) =>
          r.schedItems.map((s) => ({
            Period: r.label,
            Name: s.name,
            Category: SCHED_CATEGORIES.find((c) => c.value === s.category)?.label || s.category,
            Direction: s.direction === "inflow" ? "Inflow" : "Outflow",
            "Due Date": s.due,
            Amount: Math.round(s.amount),
          }))
        )
      ),
      "Scheduled"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        accountBalances.map((a) => ({
          Account: a.code ? `${a.code} — ${a.name}` : a.name,
          Type: a.isCash ? "Cash" : "Bank",
          Balance: Math.round(a.balance),
        }))
      ),
      "Cash & Bank"
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
        { Label: "Payables within vendor credit limits (not scheduled)", Amount: Math.round(forecast.apWithinLimit) },
        { Label: "Owner drawings scheduled in horizon", Amount: Math.round(forecast.drawingsTotal) },
        { Label: "Assumption: customer credit days", Amount: collectionDays },
        { Label: "Assumption: supplier credit days", Amount: paymentDays },
        { Label: "Assumption: include run-rate outflows", Amount: includeRunOut ? 1 : 0 },
        { Label: "Assumption: include run-rate inflows", Amount: includeRunIn ? 1 : 0 },
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
          <div className="flex flex-col gap-1 pb-2">
            <div className="flex items-center gap-2">
              <Switch id="cff-run-out" checked={includeRunOut} onCheckedChange={setIncludeRunOut} />
              <Label htmlFor="cff-run-out" className="text-xs">
                Run-rate outflows — salaries, utilities etc. ({fmt(otherDaily.outflow * 30)}/month)
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="cff-run-in" checked={includeRunIn} onCheckedChange={setIncludeRunIn} />
              <Label htmlFor="cff-run-in" className="text-xs">
                Run-rate inflows ({fmt(otherDaily.inflow * 30)}/month) — off by default: past cash-ins are mostly one-off capital, real inflows are AR + scheduled rent
              </Label>
            </div>
          </div>
          <div className="pb-1">
            <Dialog
              open={schedDialogOpen}
              onOpenChange={(o) => { setSchedDialogOpen(o); if (!o) { setSchedEditId(null); setSchedForm(defaultSchedForm); } }}
            >
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <CalendarClock className="h-4 w-4 mr-1" />
                  Scheduled Items ({(schedItemsAll || []).length})
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Scheduled Cash Items</DialogTitle>
                </DialogHeader>
                <p className="text-xs text-muted-foreground">
                  Bills, rent receipts and drawings forecast on their due date instead of the run-rate. Linking an
                  account excludes its vouchers from the run-rate so nothing is counted twice.
                </p>
                <div className="border rounded-md p-3 space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="col-span-2">
                      <Label className="text-xs">Name *</Label>
                      <Input value={schedForm.name} onChange={(e) => setSchedForm({ ...schedForm, name: e.target.value })} placeholder="LESCO electricity bill" />
                    </div>
                    <div>
                      <Label className="text-xs">Direction</Label>
                      <Select value={schedForm.direction} onValueChange={(v: "inflow" | "outflow") => setSchedForm({ ...schedForm, direction: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="outflow">Outflow (payment)</SelectItem>
                          <SelectItem value="inflow">Inflow (receipt)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Category</Label>
                      <Select value={schedForm.category} onValueChange={(v) => setSchedForm({ ...schedForm, category: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {SCHED_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Amount (Rs.) *</Label>
                      <Input type="number" min={0} value={schedForm.amount} onChange={(e) => setSchedForm({ ...schedForm, amount: e.target.value })} placeholder="Estimate" />
                    </div>
                    <div>
                      <Label className="text-xs">Frequency</Label>
                      <Select value={schedForm.frequency} onValueChange={(v: "monthly" | "one_time") => setSchedForm({ ...schedForm, frequency: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="monthly">Monthly</SelectItem>
                          <SelectItem value="one_time">One-time</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {schedForm.frequency === "monthly" ? (
                      <div>
                        <Label className="text-xs">Due day of month</Label>
                        <Input type="number" min={1} max={31} value={schedForm.due_day} onChange={(e) => setSchedForm({ ...schedForm, due_day: e.target.value })} />
                      </div>
                    ) : (
                      <div>
                        <Label className="text-xs">Due date</Label>
                        <Input type="date" value={schedForm.due_date} onChange={(e) => setSchedForm({ ...schedForm, due_date: e.target.value })} />
                      </div>
                    )}
                    <div className="col-span-2 md:col-span-3">
                      <Label className="text-xs">Linked account (optional — excludes it from run-rate)</Label>
                      <Select
                        value={schedForm.account_id || "none"}
                        onValueChange={(v) => setSchedForm({ ...schedForm, account_id: v === "none" ? "" : v })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Not linked</SelectItem>
                          {(postableAccounts || []).map((a: any) => (
                            <SelectItem key={a.id} value={a.id}>{a.code ? `${a.code} — ${a.name}` : a.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="flex items-center gap-2 pb-2">
                        <Switch checked={schedForm.is_active} onCheckedChange={(v) => setSchedForm({ ...schedForm, is_active: v })} />
                        <Label className="text-xs">Active</Label>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => saveSchedMutation.mutate(schedForm)}
                      disabled={!schedForm.name.trim() || !(Number(schedForm.amount) > 0) || saveSchedMutation.isPending}
                    >
                      {schedEditId ? "Update item" : <><Plus className="h-4 w-4 mr-1" />Add item</>}
                    </Button>
                    {schedEditId && (
                      <Button size="sm" variant="ghost" onClick={() => { setSchedEditId(null); setSchedForm(defaultSchedForm); }}>
                        Cancel edit
                      </Button>
                    )}
                  </div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Schedule</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-20" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!(schedItemsAll || []).length && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground text-sm">No scheduled items yet.</TableCell></TableRow>
                    )}
                    {(schedItemsAll || []).map((i: any) => (
                      <TableRow key={i.id}>
                        <TableCell className="text-sm">{i.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={i.direction === "inflow" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                            {i.direction === "inflow" ? "In" : "Out"}
                          </Badge>
                          <span className="ml-1 text-xs text-muted-foreground">
                            {SCHED_CATEGORIES.find((c) => c.value === i.category)?.label || i.category}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-sm">{fmt(Number(i.amount))}</TableCell>
                        <TableCell className="text-xs">
                          {i.frequency === "monthly" ? `Monthly, day ${i.due_day}` : `Once, ${i.due_date}`}
                        </TableCell>
                        <TableCell>
                          {i.is_active
                            ? <Badge variant="outline" className="bg-green-100 text-green-800">Active</Badge>
                            : <Badge variant="outline" className="bg-gray-100 text-gray-600">Off</Badge>}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              size="icon" variant="ghost" className="h-7 w-7"
                              onClick={() => {
                                setSchedEditId(i.id);
                                setSchedForm({
                                  name: i.name,
                                  direction: i.direction,
                                  category: i.category,
                                  amount: String(i.amount),
                                  frequency: i.frequency,
                                  due_day: i.due_day == null ? "1" : String(i.due_day),
                                  due_date: i.due_date || "",
                                  account_id: i.account_id || "",
                                  is_active: i.is_active ?? true,
                                });
                              }}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              size="icon" variant="ghost" className="h-7 w-7 text-red-600"
                              onClick={() => deleteSchedMutation.mutate(i.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </DialogContent>
            </Dialog>
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

      {/* Cash & bank breakup */}
      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Cash &amp; bank breakup (today)</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {!accountBalances.length && (
            <p className="text-sm text-muted-foreground">
              No cash or bank accounts found. Mark accounts as cash/bank in the Chart of Accounts.
            </p>
          )}
          {accountBalances.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="text-right">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accountBalances.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-sm">
                      <Link
                        to={a.isCash ? "/accounting/cash-book" : "/accounting/bank-book"}
                        className="text-primary hover:underline"
                      >
                        {a.code ? `${a.code} — ${a.name}` : a.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {a.isCash
                        ? <Badge variant="outline" className="bg-amber-100 text-amber-800">Cash</Badge>
                        : <Badge variant="outline" className="bg-blue-100 text-blue-800">Bank</Badge>}
                    </TableCell>
                    <TableCell className={`text-right text-sm font-medium ${a.balance < 0 ? "text-red-600" : ""}`}>
                      {fmt(a.balance)}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {openingCash > 0 && a.balance > 0 ? `${((a.balance / openingCash) * 100).toFixed(1)}%` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell colSpan={2}>Total</TableCell>
                  <TableCell className={`text-right ${openingCash < 0 ? "text-red-600" : ""}`}>{fmt(openingCash)}</TableCell>
                  <TableCell className="text-right text-xs">100%</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

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
        <div className="px-4 py-3 border-b bg-muted/40 font-semibold text-sm flex items-center justify-between">
          <span>FORECAST DETAIL ({interval === "weekly" ? "weekly" : "monthly"})</span>
          <span className="text-xs font-normal text-muted-foreground">click a row → AR/AP breakup by party</span>
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
            {forecast.rows.map((r) => {
              const hasBreakup = r.arParties.length > 0 || r.apParties.length > 0 || r.schedItems.length > 0;
              const isOpen = expanded.has(r.start);
              return (
                <Fragment key={r.start}>
                  <TableRow
                    className={hasBreakup ? "cursor-pointer" : undefined}
                    onClick={hasBreakup ? () => toggleExpanded(r.start) : undefined}
                  >
                    <TableCell className="text-sm whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        {hasBreakup
                          ? (isOpen ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />)
                          : <span className="w-3" />}
                        {r.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-xs">{fmt(r.opening)}</TableCell>
                    <TableCell className="text-right text-xs text-green-600">{r.arIn ? fmt(r.arIn) : "—"}</TableCell>
                    <TableCell className="text-right text-xs text-green-600">{r.otherIn ? fmt(r.otherIn) : "—"}</TableCell>
                    <TableCell className="text-right text-xs text-red-600">{r.apOut ? fmt(r.apOut) : "—"}</TableCell>
                    <TableCell className="text-right text-xs text-red-600">{r.otherOut ? fmt(r.otherOut) : "—"}</TableCell>
                    <TableCell className={`text-right text-xs font-medium ${r.net >= 0 ? "text-green-600" : "text-red-600"}`}>{fmt(r.net)}</TableCell>
                    <TableCell className={`text-right text-sm font-semibold ${r.closing >= 0 ? "" : "text-red-600"}`}>{fmt(r.closing)}</TableCell>
                  </TableRow>
                  {isOpen && (
                    <TableRow className="bg-muted/20 hover:bg-muted/20">
                      <TableCell colSpan={8} className="py-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-2">
                          <div>
                            <div className="text-xs font-semibold text-green-700 dark:text-green-500 mb-1">
                              AR Collections — {r.arParties.length} customer{r.arParties.length === 1 ? "" : "s"}
                            </div>
                            {!r.arParties.length && <div className="text-xs text-muted-foreground">None expected this period.</div>}
                            {r.arParties.map((p) => (
                              <div key={p.partyId} className="flex justify-between text-xs py-0.5">
                                <Link
                                  to={`/accounting/party-ledger?type=customer&party=${p.partyId}`}
                                  className="text-primary hover:underline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {partyNames[p.partyId] || "—"}
                                </Link>
                                <span className="font-medium">{fmt(p.amount)}</span>
                              </div>
                            ))}
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-red-700 dark:text-red-500 mb-1">
                              AP Payments — {r.apParties.length} vendor{r.apParties.length === 1 ? "" : "s"}
                            </div>
                            {!r.apParties.length && <div className="text-xs text-muted-foreground">None expected this period.</div>}
                            {r.apParties.map((p) => (
                              <div key={p.partyId} className="flex justify-between text-xs py-0.5">
                                <Link
                                  to={`/accounting/party-ledger?type=supplier&party=${p.partyId}`}
                                  className="text-primary hover:underline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {partyNames[p.partyId] || "—"}
                                </Link>
                                <span className="inline-flex items-center gap-2">
                                  {partyTerms?.limits?.[p.partyId] != null && (
                                    <span className="text-muted-foreground">
                                      above limit of {fmt(partyTerms.limits[p.partyId])}
                                    </span>
                                  )}
                                  <span className="font-medium">{fmt(p.amount)}</span>
                                </span>
                              </div>
                            ))}
                          </div>
                          {r.schedItems.length > 0 && (
                            <div className="md:col-span-2 border-t pt-2">
                              <div className="text-xs font-semibold mb-1">
                                Scheduled items — {r.schedItems.length}
                                {(r.runIn > 0.5 || r.runOut > 0.5) && (
                                  <span className="font-normal text-muted-foreground">
                                    {" "}(plus run-rate: +{fmt(r.runIn)} / −{fmt(r.runOut)})
                                  </span>
                                )}
                              </div>
                              {r.schedItems.map((s, i) => (
                                <div key={i} className="flex justify-between text-xs py-0.5">
                                  <span>
                                    {s.name}
                                    <span className="text-muted-foreground">
                                      {" "}({SCHED_CATEGORIES.find((c) => c.value === s.category)?.label || s.category}, due {format(parseISO(s.due), "d MMM")})
                                    </span>
                                  </span>
                                  <span className={`font-medium ${s.direction === "inflow" ? "text-green-600" : "text-red-600"}`}>
                                    {s.direction === "inflow" ? "+" : "−"}{fmt(s.amount)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
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
          are the default for everyone else{partyTerms && Object.keys(partyTerms.days).length > 0 ? ` — ${Object.keys(partyTerms.days).length} part${Object.keys(partyTerms.days).length === 1 ? "y has" : "ies have"} specific terms` : ""}.
          Open items use the same FIFO settlement logic as the Receivables &amp; Payables report, so totals reconcile with
          the trial balance.
        </p>
        {(forecast.arBeyond > 0.5 || forecast.apBeyond > 0.5) && (
          <p>
            Beyond this horizon: {fmt(forecast.arBeyond)} receivables and {fmt(forecast.apBeyond)} payables are excluded
            from the projection above.
          </p>
        )}
        {forecast.apWithinLimit > 0.5 && (
          <p>
            Vendors with a credit limit are treated as revolving accounts: only the outstanding above the limit is due
            (scheduled in the first period); {fmt(forecast.apWithinLimit)} currently sits within vendor limits and is
            not scheduled for payment.
          </p>
        )}
        <p>
          "Other" flows are the daily run-rate of cash-book movements over the last 90 days that did not touch the AR/AP
          control accounts (cash sales, payroll, utilities, cash expenses); cash↔bank transfers are netted out.
          {activeSchedItems.length > 0 &&
            ` ${activeSchedItems.length} scheduled item${activeSchedItems.length === 1 ? " is" : "s are"} forecast on due dates instead, and accounts linked to them are excluded from the run-rate.`}
        </p>
        {forecast.drawingsTotal > 0.5 && (
          <p>
            Scheduled outflows include {fmt(forecast.drawingsTotal)} of owner drawings within this horizon.
          </p>
        )}
      </div>
    </ERPLayout>
  );
}
