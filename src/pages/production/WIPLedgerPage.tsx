import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { gpDb } from "@/lib/gatePass";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { BookOpen, ArrowRight, Printer, SlidersHorizontal, Trash2, Loader2 } from "lucide-react";
import { format, startOfMonth, endOfMonth, parseISO, eachDayOfInterval } from "date-fns";

interface Dept {
  id: string;
  name: string;
  code: string;
}

interface SeqRow {
  department_id: string;
  wip_order: number;
  is_included: boolean;
}

interface ProdEntry {
  entry_date: string;
  department_id: string;
  quantity_ok: number;
}

interface Level {
  order: number;
  depts: Dept[];
  label: string;
}

// Super-admin stock correction, stored in wip_ledger_adjustments. Anchored to a
// department so it follows its level if the WIP sequence is renumbered.
interface Adjustment {
  id: string;
  txn_date: string;
  department_id: string;
  quantity: number;   // bags; + adds stock, − removes it
  reason: string;
  reference: string | null;
}

interface LedgerRow {
  date: string;
  ref: string;
  inQty: number;
  outQty: number;
  balance: number;
  isOpening?: boolean;
  adjustmentId?: string;
}

type AdjMode = "add" | "remove" | "count";

const fmtNum = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

// Supabase/PostgREST caps a single request at 1000 rows by default. The WIP ledger
// sums *all* historical rows before a custom "from date" to derive opening balances,
// so any unpaginated query here silently drops rows once history grows past the cap —
// producing different (wrong) results depending on which date range happens to cross it.
const PAGE_SIZE = 1000;
async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = data || [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

export default function WIPLedgerPage() {
  const today = new Date();
  const [fromDate, setFromDate] = useState(format(startOfMonth(today), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(endOfMonth(today), "yyyy-MM-dd"));
  const [levelFilter, setLevelFilter] = useState<string>("all");

  const { hasRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isSuperAdmin = hasRole("super_admin");

  // Adjustment dialog: which level it is for (by wip_order) and the form.
  const [adjLevel, setAdjLevel] = useState<number | null>(null);
  const [adj, setAdj] = useState({
    date: format(today, "yyyy-MM-dd"),
    mode: "add" as AdjMode,
    quantity: "",
    reason: "",
    reference: "",
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["wip-ledger-depts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("id, name, code")
        .eq("is_active", true);
      if (error) throw error;
      return data as Dept[];
    },
  });

  const { data: sequence = [] } = useQuery({
    queryKey: ["production_wip_sequence"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_wip_sequence" as any)
        .select("*");
      if (error) throw error;
      return (data || []) as unknown as SeqRow[];
    },
  });

  const { data: entries = [] } = useQuery({
    queryKey: ["wip-ledger-entries", fromDate, toDate],
    queryFn: () =>
      fetchAllRows<ProdEntry>((from, to) =>
        supabase
          .from("production_entries")
          .select("entry_date, department_id, quantity_ok")
          .gte("entry_date", fromDate)
          .lte("entry_date", toDate)
          .order("id")
          .range(from, to)
      ),
  });

  const { data: openingEntries = [] } = useQuery({
    queryKey: ["wip-ledger-opening-entries", fromDate],
    queryFn: () =>
      fetchAllRows<ProdEntry>((from, to) =>
        supabase
          .from("production_entries")
          .select("entry_date, department_id, quantity_ok")
          .lt("entry_date", fromDate)
          .order("id")
          .range(from, to)
      ),
  });

  const { data: domesticDispatches = [] } = useQuery({
    queryKey: ["wip-ledger-domestic-dispatches", fromDate, toDate],
    queryFn: () =>
      fetchAllRows<{ dispatch_date: string; sales_dispatch_items: Array<{ quantity_dozens: number }> }>((from, to) =>
        supabase
          .from("sales_dispatches")
          .select("dispatch_date, sales_dispatch_items(quantity_dozens)")
          .eq("sales_segment", "domestic")
          .gte("dispatch_date", fromDate)
          .lte("dispatch_date", toDate)
          .order("id")
          .range(from, to)
      ),
  });

  const { data: openingDispatches = [] } = useQuery({
    queryKey: ["wip-ledger-opening-dispatches", fromDate],
    queryFn: () =>
      fetchAllRows<{ dispatch_date: string; sales_dispatch_items: Array<{ quantity_dozens: number }> }>((from, to) =>
        supabase
          .from("sales_dispatches")
          .select("dispatch_date, sales_dispatch_items(quantity_dozens)")
          .eq("sales_segment", "domestic")
          .lt("dispatch_date", fromDate)
          .order("id")
          .range(from, to)
      ),
  });

  // Domestic sales returns bring finished goods back into stock — they appear at
  // the final (FG) level as an inflow, netting off the dispatched-out quantity.
  const { data: returns = [] } = useQuery({
    queryKey: ["wip-ledger-returns", fromDate, toDate],
    queryFn: () =>
      fetchAllRows<{ return_date: string; sales_return_items: Array<{ quantity_dozens: number }> }>((from, to) =>
        supabase
          .from("sales_returns")
          .select("return_date, sales_dispatches!inner(sales_segment), sales_return_items(quantity_dozens)")
          .eq("sales_dispatches.sales_segment", "domestic")
          .gte("return_date", fromDate)
          .lte("return_date", toDate)
          .order("id")
          .range(from, to)
      ),
  });

  const { data: openingReturns = [] } = useQuery({
    queryKey: ["wip-ledger-opening-returns", fromDate],
    queryFn: () =>
      fetchAllRows<{ return_date: string; sales_return_items: Array<{ quantity_dozens: number }> }>((from, to) =>
        supabase
          .from("sales_returns")
          .select("return_date, sales_dispatches!inner(sales_segment), sales_return_items(quantity_dozens)")
          .eq("sales_dispatches.sales_segment", "domestic")
          .lt("return_date", fromDate)
          .order("id")
          .range(from, to)
      ),
  });

  // Finished-goods samples that left on a gate pass (Gate Pass module) — an FG
  // outflow next to Sales. Dated by when the vehicle went out. The view is
  // missing until the gate pass migration is applied; treat that as none.
  const { data: samples = [] } = useQuery({
    queryKey: ["wip-ledger-gate-samples", fromDate, toDate],
    queryFn: () =>
      fetchAllRows<{ out_date: string; quantity_dozens: number }>((from, to) =>
        gpDb
          .from("v_gate_pass_fg_samples")
          .select("out_date, quantity_dozens")
          .gte("out_date", fromDate)
          .lte("out_date", toDate)
          .order("gate_pass_id")
          .range(from, to)
      ).catch(() => []),
  });

  const { data: openingSamples = [] } = useQuery({
    queryKey: ["wip-ledger-opening-gate-samples", fromDate],
    queryFn: () =>
      fetchAllRows<{ out_date: string; quantity_dozens: number }>((from, to) =>
        gpDb
          .from("v_gate_pass_fg_samples")
          .select("out_date, quantity_dozens")
          .lt("out_date", fromDate)
          .order("gate_pass_id")
          .range(from, to)
      ).catch(() => []),
  });

  // Super-admin adjustments, all dates: the ones before fromDate feed the
  // opening balance. The table is missing until its migration is applied;
  // treat that as none.
  const { data: adjustments = [] } = useQuery({
    queryKey: ["wip-ledger-adjustments"],
    queryFn: () =>
      fetchAllRows<Adjustment>((from, to) =>
        (supabase as any)
          .from("wip_ledger_adjustments")
          .select("id, txn_date, department_id, quantity, reason, reference")
          .order("created_at")
          .order("id")
          .range(from, to)
      ).catch(() => []),
  });

  // Build ordered levels (group departments by wip_order)
  const levels: Level[] = useMemo(() => {
    const deptMap = new Map(departments.map(d => [d.id, d]));
    const grouped = new Map<number, Dept[]>();
    for (const s of sequence) {
      if (!s.is_included) continue;
      const d = deptMap.get(s.department_id);
      if (!d) continue;
      const arr = grouped.get(s.wip_order) || [];
      arr.push(d);
      grouped.set(s.wip_order, arr);
    }
    return [...grouped.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([order, depts]) => ({
        order,
        depts,
        label: depts.map(d => d.name).join(" + "),
      }));
  }, [sequence, departments]);

  const visibleLevels = useMemo(() => {
    if (levelFilter === "all") return levels;
    return levels.filter(l => String(l.order) === levelFilter);
  }, [levels, levelFilter]);

  // Aggregate quantity_ok per (dept, date)
  const prodMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) {
      const k = `${e.department_id}::${e.entry_date}`;
      m.set(k, (m.get(k) || 0) + Number(e.quantity_ok || 0));
    }
    return m;
  }, [entries]);

  // Aggregate opening quantity_ok per dept (all dates before fromDate)
  const openingProdByDept = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of openingEntries) {
      m.set(e.department_id, (m.get(e.department_id) || 0) + Number(e.quantity_ok || 0));
    }
    return m;
  }, [openingEntries]);

  const sumLevel = (lvl: Level, date: string) =>
    lvl.depts.reduce((s, d) => s + (prodMap.get(`${d.id}::${date}`) || 0), 0);

  const sumLevelOpening = (lvl: Level) =>
    lvl.depts.reduce((s, d) => s + (openingProdByDept.get(d.id) || 0), 0);

  // Aggregate domestic sales dozens per date (in-range), divided by 25 for standard bag size
  const salesMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of domesticDispatches) {
      const total = (d.sales_dispatch_items || []).reduce((s, it) => s + Number(it.quantity_dozens || 0), 0) / 25;
      m.set(d.dispatch_date, (m.get(d.dispatch_date) || 0) + total);
    }
    return m;
  }, [domesticDispatches]);

  // Opening domestic sales total (before fromDate), divided by 25
  const openingSalesTotal = useMemo(() => {
    let total = 0;
    for (const d of openingDispatches) {
      total += (d.sales_dispatch_items || []).reduce((s, it) => s + Number(it.quantity_dozens || 0), 0) / 25;
    }
    return total / 1; // already divided per dispatch
  }, [openingDispatches]);

  // Domestic sales returns per date (in-range), divided by 25 to match sales units
  const returnsMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of returns) {
      const total = (r.sales_return_items || []).reduce((s, it) => s + Number(it.quantity_dozens || 0), 0) / 25;
      m.set(r.return_date, (m.get(r.return_date) || 0) + total);
    }
    return m;
  }, [returns]);

  // Opening domestic returns total (before fromDate), divided by 25
  const openingReturnsTotal = useMemo(() => {
    let total = 0;
    for (const r of openingReturns) {
      total += (r.sales_return_items || []).reduce((s, it) => s + Number(it.quantity_dozens || 0), 0) / 25;
    }
    return total;
  }, [openingReturns]);

  // Gate pass samples per date (in-range) and before fromDate, divided by 25 like sales
  const samplesMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of samples) m.set(r.out_date, (m.get(r.out_date) || 0) + Number(r.quantity_dozens || 0) / 25);
    return m;
  }, [samples]);

  const openingSamplesTotal = useMemo(
    () => openingSamples.reduce((s, r) => s + Number(r.quantity_dozens || 0) / 25, 0),
    [openingSamples]
  );

  const dates = useMemo(() => {
    try {
      return eachDayOfInterval({ start: parseISO(fromDate), end: parseISO(toDate) }).map(d => format(d, "yyyy-MM-dd"));
    } catch { return []; }
  }, [fromDate, toDate]);

  // Adjustments per level (wip_order), in posting order.
  const adjByLevel = useMemo(() => {
    const deptLevel = new Map<string, number>();
    for (const l of levels) for (const d of l.depts) deptLevel.set(d.id, l.order);
    const m = new Map<number, Adjustment[]>();
    for (const a of adjustments) {
      const order = deptLevel.get(a.department_id);
      if (order === undefined) continue;
      const arr = m.get(order) || [];
      arr.push(a);
      m.set(order, arr);
    }
    return m;
  }, [adjustments, levels]);

  const buildLedger = (levelIdx: number) => {
    const lvl = levels[levelIdx];
    const prev = levelIdx > 0 ? levels[levelIdx - 1] : null;
    const next = levelIdx < levels.length - 1 ? levels[levelIdx + 1] : null;
    const isLast = levelIdx === levels.length - 1;

    // Opening balance = (prior input from previous level) - (prior outflow of this level)
    const openingIn = prev ? sumLevelOpening(prev) : 0;
    // At the final level, returns add FG back, so they net off opening sales-out.
    const openingOut = isLast ? (openingSalesTotal - openingReturnsTotal + openingSamplesTotal) : sumLevelOpening(lvl);
    const levelAdjs = adjByLevel.get(lvl.order) || [];
    const openingAdj = levelAdjs
      .filter(a => a.txn_date < fromDate)
      .reduce((s, a) => s + Number(a.quantity || 0), 0);
    const openingBalance = openingIn - openingOut + openingAdj;

    let balance = openingBalance;
    const rows: LedgerRow[] = [];
    rows.push({ date: fromDate, ref: "Opening Balance", inQty: 0, outQty: 0, balance: openingBalance, isOpening: true });

    for (const d of dates) {
      const inQty = prev ? sumLevel(prev, d) : 0;
      const retIn = isLast ? (returnsMap.get(d) || 0) : 0;   // FG returned by customers
      const outQty = isLast ? (salesMap.get(d) || 0) : sumLevel(lvl, d);
      const sampleOut = isLast ? (samplesMap.get(d) || 0) : 0;   // FG samples out on a gate pass
      const dayAdjs = levelAdjs.filter(a => a.txn_date === d);
      if (inQty === 0 && outQty === 0 && retIn === 0 && sampleOut === 0 && dayAdjs.length === 0) continue;
      if (inQty > 0) {
        balance += inQty;
        rows.push({ date: d, ref: prev ? `From ${prev.label}` : "Input", inQty, outQty: 0, balance });
      }
      if (retIn > 0) {
        balance += retIn;
        rows.push({ date: d, ref: "Sales Return", inQty: retIn, outQty: 0, balance });
      }
      if (outQty > 0) {
        balance -= outQty;
        rows.push({ date: d, ref: isLast ? "Sales" : (next ? `To ${next.label}` : "Produced"), inQty: 0, outQty, balance });
      }
      if (sampleOut > 0) {
        balance -= sampleOut;
        rows.push({ date: d, ref: "Samples (gate pass)", inQty: 0, outQty: sampleOut, balance });
      }
      // Adjustments last, so a "set to physical count" lands on the day's closing.
      for (const a of dayAdjs) {
        const q = Number(a.quantity || 0);
        balance += q;
        rows.push({
          date: d,
          ref: `Adjustment — ${a.reason}${a.reference ? ` (Ref: ${a.reference})` : ""}`,
          inQty: q > 0 ? q : 0,
          outQty: q < 0 ? -q : 0,
          balance,
          adjustmentId: a.id,
        });
      }
    }
    const totalIn = rows.reduce((s, r) => s + r.inQty, 0);
    const totalOut = rows.reduce((s, r) => s + r.outQty, 0);
    return { rows, totalIn, totalOut, closing: balance, openingBalance };
  };

  // --- Adjustment dialog ------------------------------------------------------
  const adjLevelIdx = adjLevel === null ? -1 : levels.findIndex(l => l.order === adjLevel);
  const adjLevelObj = adjLevelIdx >= 0 ? levels[adjLevelIdx] : null;
  const adjDateInRange = !!adj.date && adj.date >= fromDate && adj.date <= toDate;

  // Book balance at the end of the adjustment date. Only known when the date
  // is inside the period on screen, which is all the page has loaded.
  const adjBookBalance = (() => {
    if (adjLevelIdx < 0 || !adjDateInRange) return null;
    const { rows } = buildLedger(adjLevelIdx);
    let bal = rows[0].balance;
    for (const r of rows) if (r.date <= adj.date) bal = r.balance;
    return bal;
  })();

  const adjQtyNum = Number(adj.quantity);
  const adjQtyValid = adj.quantity.trim() !== "" && Number.isFinite(adjQtyNum);
  const adjSigned = !adjQtyValid
    ? null
    : adj.mode === "add" ? adjQtyNum
    : adj.mode === "remove" ? -adjQtyNum
    : adjBookBalance === null ? null
    : Math.round((adjQtyNum - adjBookBalance) * 100) / 100;
  const adjError =
    !adj.date ? "Pick a date."
    : !adjQtyValid ? null
    : adj.mode !== "count" && adjQtyNum <= 0 ? "Quantity must be greater than zero."
    : adj.mode === "count" && !adjDateInRange ? "To set a physical count, pick a date inside the period shown on the ledger."
    : adjSigned === 0 ? "The book balance already matches this count."
    : null;
  const canPostAdj = !!adjLevelObj && adjSigned !== null && adjSigned !== 0 && !adjError && adj.reason.trim() !== "";

  const openAdjust = (order: number) => {
    const todayStr = format(new Date(), "yyyy-MM-dd");
    setAdj({
      date: todayStr >= fromDate && todayStr <= toDate ? todayStr : toDate,
      mode: "add", quantity: "", reason: "", reference: "",
    });
    setAdjLevel(order);
  };

  const addAdjustment = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("wip_ledger_add_adjustment", {
        p_date: adj.date,
        p_department: adjLevelObj!.depts[0].id,
        p_quantity: adjSigned,
        p_reason: adj.reason.trim(),
        p_reference: adj.reference.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Adjustment posted" });
      setAdjLevel(null);
      queryClient.invalidateQueries({ queryKey: ["wip-ledger-adjustments"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteAdjustment = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("wip_ledger_delete_adjustment", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Adjustment deleted" });
      queryClient.invalidateQueries({ queryKey: ["wip-ledger-adjustments"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const confirmDelete = (id: string) => {
    if (window.confirm("Delete this adjustment? The level balance will change from its date onward.")) {
      deleteAdjustment.mutate(id);
    }
  };

  const deleteButton = (id?: string) =>
    isSuperAdmin && id ? (
      <Button
        variant="ghost" size="icon" className="no-print h-7 w-7 text-destructive"
        title="Delete adjustment" disabled={deleteAdjustment.isPending}
        onClick={() => confirmDelete(id)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    ) : null;

  return (
    <ERPLayout>
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 12mm; }
          body { background: white !important; }
          .no-print, [data-sidebar], header { display: none !important; }
          .print-area { padding: 0 !important; }
          .print-area .card, .print-area [class*="rounded"] { box-shadow: none !important; border: 1px solid #ccc !important; }
          .print-title { display: block !important; margin-bottom: 12px; font-size: 18px; font-weight: 700; }
          table { font-size: 11px; }
        }
        .print-title { display: none; }
      `}</style>
      <div className="space-y-6 print-area">
        <div className="print-title">
          WIP Ledger — {format(parseISO(fromDate), "dd MMM yyyy")} to {format(parseISO(toDate), "dd MMM yyyy")}
        </div>
        <div className="flex items-start justify-between gap-3">
          <PageHeader
            title="WIP Ledger"
            description="Level-wise running balance of WIP through the production chain. Each level opens with the closing balance carried forward from prior dates."
            icon={BookOpen}
            iconColor="bg-amber-500/10 text-amber-500"
          />
          <Button variant="outline" className="no-print" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-2" /> Print
          </Button>
        </div>

        <Card className="no-print">
          <CardContent className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label>From Date</Label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>To Date</Label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Level</Label>
              <Select value={levelFilter} onValueChange={setLevelFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All levels in chain</SelectItem>
                  {levels.map(l => (
                    <SelectItem key={l.order} value={String(l.order)}>L{l.order}. {l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {levels.length === 0 && (
          <Card><CardContent className="p-8 text-center text-muted-foreground">
            No WIP sequence configured. Go to <span className="font-medium">Production → WIP Sequence</span> to set one up.
          </CardContent></Card>
        )}

        {levels.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground mb-2">Production chain (parallel departments are merged at the same level)</div>
              <div className="flex flex-wrap items-center gap-2">
                {levels.map((l) => (
                  <div key={l.order} className="flex items-center gap-2">
                    <span className="px-3 py-1 rounded-md bg-primary/10 text-primary text-sm font-medium">
                      L{l.order}. {l.label}
                    </span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                ))}
                <span className="px-3 py-1 rounded-md bg-green-500/10 text-green-600 text-sm font-medium">
                  Sales
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {visibleLevels.map((lvl) => {
          const idx = levels.findIndex(l => l.order === lvl.order);
          const { rows, totalIn, totalOut, closing, openingBalance } = buildLedger(idx);
          return (
            <Card key={lvl.order}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between flex-wrap gap-2">
                  <span>L{lvl.order}. {lvl.label}</span>
                  <div className="flex items-center flex-wrap gap-4 text-sm font-normal">
                    <span className="text-muted-foreground">Opening: <span className="font-semibold">{fmtNum(openingBalance)}</span></span>
                    <span className="text-muted-foreground">In: <span className="font-semibold text-green-500">{fmtNum(totalIn)}</span></span>
                    <span className="text-muted-foreground">Out: <span className="font-semibold text-blue-500">{fmtNum(totalOut)}</span></span>
                    <span className="text-muted-foreground">Closing: <span className="font-semibold">{fmtNum(closing)}</span></span>
                    {isSuperAdmin && (
                      <Button variant="outline" size="sm" className="no-print" onClick={() => openAdjust(lvl.order)}>
                        <SlidersHorizontal className="h-4 w-4 mr-2" /> Adjustment
                      </Button>
                    )}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-32">Date</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead className="text-right">In</TableHead>
                        <TableHead className="text-right">Out</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.length === 0 ? (
                        <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No movements in selected period</TableCell></TableRow>
                      ) : rows.map((r, i) => (
                        <TableRow key={i} className={r.isOpening ? "bg-muted/40 font-medium" : ""}>
                          <TableCell>{format(parseISO(r.date), "dd MMM yyyy")}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span>{r.ref}</span>
                              {deleteButton(r.adjustmentId)}
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-green-500">{r.inQty ? fmtNum(r.inQty) : "—"}</TableCell>
                          <TableCell className="text-right text-blue-500">{r.outQty ? fmtNum(r.outQty) : "—"}</TableCell>
                          <TableCell className="text-right font-medium">{fmtNum(r.balance)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile card list */}
                <div className="md:hidden p-3 space-y-2">
                  {rows.length === 0 ? (
                    <div className="text-center text-muted-foreground py-6 text-sm">No movements in selected period</div>
                  ) : rows.map((r, i) => (
                    <div key={i} className={`border rounded-lg p-3 flex items-center justify-between gap-2 ${r.isOpening ? "bg-muted/40 font-medium" : "bg-card"}`}>
                      <div className="min-w-0">
                        <div className={`text-sm ${r.adjustmentId ? "break-words" : "truncate"}`}>{r.ref}</div>
                        <div className="text-xs text-muted-foreground">{format(parseISO(r.date), "dd MMM yyyy")}</div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 text-xs text-right">
                        {deleteButton(r.adjustmentId)}
                        <div>
                          <div className="text-[10px] text-muted-foreground">In</div>
                          <div className="text-green-500">{r.inQty ? fmtNum(r.inQty) : "—"}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground">Out</div>
                          <div className="text-blue-500">{r.outQty ? fmtNum(r.outQty) : "—"}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground">Balance</div>
                          <div className="font-semibold">{fmtNum(r.balance)}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={adjLevel !== null} onOpenChange={(o) => { if (!o) setAdjLevel(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stock adjustment{adjLevelObj ? ` — L${adjLevelObj.order}. ${adjLevelObj.label}` : ""}</DialogTitle>
            <DialogDescription>
              Corrects this level's balance from the chosen date onward. Quantities are in bags. Super admin only.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Date</Label>
                <Input type="date" value={adj.date} onChange={(e) => setAdj(a => ({ ...a, date: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Type</Label>
                <Select value={adj.mode} onValueChange={(v) => setAdj(a => ({ ...a, mode: v as AdjMode }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="add">Add stock (+)</SelectItem>
                    <SelectItem value="remove">Remove stock (−)</SelectItem>
                    <SelectItem value="count">Set to physical count</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>{adj.mode === "count" ? "Counted balance (bags)" : "Quantity (bags)"}</Label>
              <Input
                type="number" step="any" min={adj.mode === "count" ? undefined : 0}
                value={adj.quantity} onChange={(e) => setAdj(a => ({ ...a, quantity: e.target.value }))}
              />
              <div className="text-xs text-muted-foreground">
                {adjBookBalance === null
                  ? "Book balance is shown only for dates inside the period on the ledger."
                  : <>Book balance at end of {format(parseISO(adj.date), "dd MMM yyyy")}: <span className="font-medium">{fmtNum(adjBookBalance)}</span>
                      {adjSigned !== null && adjSigned !== 0 && !adjError && (
                        <> → after adjustment ({adjSigned > 0 ? "+" : "−"}{fmtNum(Math.abs(adjSigned))}): <span className="font-medium">{fmtNum(adjBookBalance + adjSigned)}</span></>
                      )}
                    </>}
              </div>
              {adjError && <div className="text-xs text-destructive">{adjError}</div>}
            </div>
            <div className="space-y-1">
              <Label>Reason <span className="text-destructive">*</span></Label>
              <Textarea
                rows={2} value={adj.reason} placeholder="Why is this adjustment needed?"
                onChange={(e) => setAdj(a => ({ ...a, reason: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Reference (optional)</Label>
              <Input
                value={adj.reference} placeholder="e.g. stock count sheet no."
                onChange={(e) => setAdj(a => ({ ...a, reference: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjLevel(null)}>Cancel</Button>
            <Button disabled={!canPostAdj || addAdjustment.isPending} onClick={() => addAdjustment.mutate()}>
              {addAdjustment.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Post adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
