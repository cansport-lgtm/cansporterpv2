import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BookOpen, ArrowRight, Printer } from "lucide-react";
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

const fmtNum = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function WIPLedgerPage() {
  const today = new Date();
  const [fromDate, setFromDate] = useState(format(startOfMonth(today), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(endOfMonth(today), "yyyy-MM-dd"));
  const [levelFilter, setLevelFilter] = useState<string>("all");

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
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_entries")
        .select("entry_date, department_id, quantity_ok")
        .gte("entry_date", fromDate)
        .lte("entry_date", toDate);
      if (error) throw error;
      return (data || []) as ProdEntry[];
    },
  });

  const { data: openingEntries = [] } = useQuery({
    queryKey: ["wip-ledger-opening-entries", fromDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_entries")
        .select("entry_date, department_id, quantity_ok")
        .lt("entry_date", fromDate);
      if (error) throw error;
      return (data || []) as ProdEntry[];
    },
  });

  const { data: domesticDispatches = [] } = useQuery({
    queryKey: ["wip-ledger-domestic-dispatches", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_dispatches")
        .select("dispatch_date, sales_dispatch_items(quantity_dozens)")
        .eq("sales_segment", "domestic")
        .gte("dispatch_date", fromDate)
        .lte("dispatch_date", toDate);
      if (error) throw error;
      return (data || []) as Array<{ dispatch_date: string; sales_dispatch_items: Array<{ quantity_dozens: number }> }>;
    },
  });

  const { data: openingDispatches = [] } = useQuery({
    queryKey: ["wip-ledger-opening-dispatches", fromDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_dispatches")
        .select("dispatch_date, sales_dispatch_items(quantity_dozens)")
        .eq("sales_segment", "domestic")
        .lt("dispatch_date", fromDate);
      if (error) throw error;
      return (data || []) as Array<{ dispatch_date: string; sales_dispatch_items: Array<{ quantity_dozens: number }> }>;
    },
  });

  // Domestic sales returns bring finished goods back into stock — they appear at
  // the final (FG) level as an inflow, netting off the dispatched-out quantity.
  const { data: returns = [] } = useQuery({
    queryKey: ["wip-ledger-returns", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_returns")
        .select("return_date, sales_dispatches!inner(sales_segment), sales_return_items(quantity_dozens)")
        .eq("sales_dispatches.sales_segment", "domestic")
        .gte("return_date", fromDate)
        .lte("return_date", toDate);
      if (error) throw error;
      return (data || []) as Array<{ return_date: string; sales_return_items: Array<{ quantity_dozens: number }> }>;
    },
  });

  const { data: openingReturns = [] } = useQuery({
    queryKey: ["wip-ledger-opening-returns", fromDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_returns")
        .select("return_date, sales_dispatches!inner(sales_segment), sales_return_items(quantity_dozens)")
        .eq("sales_dispatches.sales_segment", "domestic")
        .lt("return_date", fromDate);
      if (error) throw error;
      return (data || []) as Array<{ return_date: string; sales_return_items: Array<{ quantity_dozens: number }> }>;
    },
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

  const dates = useMemo(() => {
    try {
      return eachDayOfInterval({ start: parseISO(fromDate), end: parseISO(toDate) }).map(d => format(d, "yyyy-MM-dd"));
    } catch { return []; }
  }, [fromDate, toDate]);

  const buildLedger = (levelIdx: number) => {
    const lvl = levels[levelIdx];
    const prev = levelIdx > 0 ? levels[levelIdx - 1] : null;
    const next = levelIdx < levels.length - 1 ? levels[levelIdx + 1] : null;
    const isLast = levelIdx === levels.length - 1;

    // Opening balance = (prior input from previous level) - (prior outflow of this level)
    const openingIn = prev ? sumLevelOpening(prev) : 0;
    // At the final level, returns add FG back, so they net off opening sales-out.
    const openingOut = isLast ? (openingSalesTotal - openingReturnsTotal) : sumLevelOpening(lvl);
    const openingBalance = openingIn - openingOut;

    let balance = openingBalance;
    const rows: Array<{ date: string; ref: string; inQty: number; outQty: number; balance: number; isOpening?: boolean }> = [];
    rows.push({ date: fromDate, ref: "Opening Balance", inQty: 0, outQty: 0, balance: openingBalance, isOpening: true });

    for (const d of dates) {
      const inQty = prev ? sumLevel(prev, d) : 0;
      const retIn = isLast ? (returnsMap.get(d) || 0) : 0;   // FG returned by customers
      const outQty = isLast ? (salesMap.get(d) || 0) : sumLevel(lvl, d);
      if (inQty === 0 && outQty === 0 && retIn === 0) continue;
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
    }
    const totalIn = rows.reduce((s, r) => s + r.inQty, 0);
    const totalOut = rows.reduce((s, r) => s + r.outQty, 0);
    return { rows, totalIn, totalOut, closing: balance, openingBalance };
  };

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
                  <div className="flex gap-4 text-sm font-normal">
                    <span className="text-muted-foreground">Opening: <span className="font-semibold">{fmtNum(openingBalance)}</span></span>
                    <span className="text-muted-foreground">In: <span className="font-semibold text-green-500">{fmtNum(totalIn)}</span></span>
                    <span className="text-muted-foreground">Out: <span className="font-semibold text-blue-500">{fmtNum(totalOut)}</span></span>
                    <span className="text-muted-foreground">Closing: <span className="font-semibold">{fmtNum(closing)}</span></span>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
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
                        <TableCell>{r.ref}</TableCell>
                        <TableCell className="text-right text-green-500">{r.inQty ? fmtNum(r.inQty) : "—"}</TableCell>
                        <TableCell className="text-right text-blue-500">{r.outQty ? fmtNum(r.outQty) : "—"}</TableCell>
                        <TableCell className="text-right font-medium">{fmtNum(r.balance)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </ERPLayout>
  );
}
