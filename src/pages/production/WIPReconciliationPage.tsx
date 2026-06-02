import { useState, useMemo, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Scale, Printer, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

interface Dept { id: string; name: string; code: string; }
interface SeqRow { department_id: string; wip_order: number; is_included: boolean; }
interface ProdEntry { department_id: string; quantity_ok: number; }
interface PlanningItem { id: string; code: string; name: string; department_id: string; }
interface ClosingRow { planning_item_id: string; department_id: string; closing_quantity: number; }
interface Level { order: number; depts: Dept[]; label: string; isLast: boolean; }

const fmtNum = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function WIPReconciliationPage() {
  const [asOfDate, setAsOfDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const { data: departments = [] } = useQuery({
    queryKey: ["wip-rec-depts"],
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
    queryKey: ["wip-rec-sequence"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_wip_sequence" as any)
        .select("*");
      if (error) throw error;
      return (data || []) as unknown as SeqRow[];
    },
  });

  const { data: entries = [] } = useQuery({
    queryKey: ["wip-rec-entries", asOfDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_entries")
        .select("department_id, quantity_ok")
        .lte("entry_date", asOfDate);
      if (error) throw error;
      return (data || []) as ProdEntry[];
    },
  });

  const { data: dispatches = [] } = useQuery({
    queryKey: ["wip-rec-dispatches", asOfDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_dispatches")
        .select("dispatch_date, sales_dispatch_items(quantity_dozens)")
        .eq("sales_segment", "domestic")
        .lte("dispatch_date", asOfDate);
      if (error) throw error;
      return (data || []) as Array<{ dispatch_date: string; sales_dispatch_items: Array<{ quantity_dozens: number }> }>;
    },
  });

  const { data: planningItems = [] } = useQuery({
    queryKey: ["wip-rec-planning-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("planning_items")
        .select("id, code, name, department_id")
        .eq("is_active", true);
      if (error) throw error;
      return (data || []) as PlanningItem[];
    },
  });

  const { data: closings = [] } = useQuery({
    queryKey: ["wip-rec-closing", asOfDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_stock_closing")
        .select("planning_item_id, department_id, closing_quantity")
        .eq("closing_date", asOfDate);
      if (error) throw error;
      return (data || []) as ClosingRow[];
    },
  });

  // Ordered levels
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
    const sorted = [...grouped.entries()].sort((a, b) => a[0] - b[0]);
    return sorted.map(([order, depts], idx) => ({
      order,
      depts,
      label: depts.map(d => d.name).join(" + "),
      isLast: idx === sorted.length - 1,
    }));
  }, [sequence, departments]);

  const visibleLevels = useMemo(
    () => (levelFilter === "all" ? levels : levels.filter(l => String(l.order) === levelFilter)),
    [levels, levelFilter]
  );

  // Aggregate produced per department (up to as-of)
  const prodByDept = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) m.set(e.department_id, (m.get(e.department_id) || 0) + Number(e.quantity_ok || 0));
    return m;
  }, [entries]);

  // Domestic sales total in bags (dozens / 25)
  const salesTotal = useMemo(() => {
    let s = 0;
    for (const d of dispatches) {
      for (const it of d.sales_dispatch_items || []) s += Number(it.quantity_dozens || 0);
    }
    return s / 25;
  }, [dispatches]);

  // Closings: by department and by planning_item
  const closingByDept = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of closings) m.set(c.department_id, (m.get(c.department_id) || 0) + Number(c.closing_quantity || 0));
    return m;
  }, [closings]);

  const closingByItem = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of closings) m.set(c.planning_item_id, (m.get(c.planning_item_id) || 0) + Number(c.closing_quantity || 0));
    return m;
  }, [closings]);

  const itemsByDept = useMemo(() => {
    const m = new Map<string, PlanningItem[]>();
    for (const it of planningItems) {
      const arr = m.get(it.department_id) || [];
      arr.push(it);
      m.set(it.department_id, arr);
    }
    return m;
  }, [planningItems]);

  // Build reconciliation rows
  const rows = useMemo(() => {
    return visibleLevels.map((lvl, idx) => {
      const levelIdx = levels.findIndex(l => l.order === lvl.order);
      const produced = lvl.depts.reduce((s, d) => s + (prodByDept.get(d.id) || 0), 0);
      const nextLvl = levels[levelIdx + 1];
      let consumed = 0;
      if (nextLvl) {
        consumed = nextLvl.depts.reduce((s, d) => s + (prodByDept.get(d.id) || 0), 0);
      } else {
        consumed = salesTotal;
      }
      const systemClosing = produced - consumed;
      const planningClosing = lvl.depts.reduce((s, d) => s + (closingByDept.get(d.id) || 0), 0);
      const variance = systemClosing - planningClosing;
      const variancePct = systemClosing !== 0 ? (variance / systemClosing) * 100 : (planningClosing === 0 ? 0 : 100);
      return { lvl, systemClosing, planningClosing, variance, variancePct };
    });
  }, [visibleLevels, levels, prodByDept, salesTotal, closingByDept]);

  const totals = useMemo(() => {
    return rows.reduce((acc, r) => ({
      system: acc.system + r.systemClosing,
      planning: acc.planning + r.planningClosing,
      variance: acc.variance + r.variance,
    }), { system: 0, planning: 0, variance: 0 });
  }, [rows]);

  const statusBadge = (variance: number, pct: number) => {
    if (Math.abs(variance) < 0.001) return <Badge className="bg-emerald-600 hover:bg-emerald-600">Matched</Badge>;
    if (Math.abs(pct) <= 2) return <Badge className="bg-amber-500 hover:bg-amber-500">Minor</Badge>;
    return <Badge variant="destructive">Mismatch</Badge>;
  };

  const noClosing = closings.length === 0;

  return (
    <ERPLayout>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          aside, header { display: none !important; }
          body { background: white !important; }
          .print-area { box-shadow: none !important; border: none !important; }
        }
      `}</style>
      <div className="space-y-6">
        <PageHeader
          title="WIP Reconciliation"
          description="Compare system WIP closing per department with daily stock closing from Production Planning"
          icon={Scale}
          iconColor="bg-amber-500 text-white"
        >
          <Button variant="outline" onClick={() => window.print()} className="no-print">
            <Printer className="h-4 w-4 mr-2" /> Print
          </Button>
        </PageHeader>

        <Card className="no-print">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>As-of Date</Label>
                <Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
              </div>
              <div>
                <Label>Level Filter</Label>
                <Select value={levelFilter} onValueChange={setLevelFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Levels</SelectItem>
                    {levels.map(l => (
                      <SelectItem key={l.order} value={String(l.order)}>
                        L{l.order} — {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {noClosing && (
          <Card className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
            <CardContent className="pt-6 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
              <div>
                <div className="font-medium">No daily stock closing entered for {asOfDate}</div>
                <div className="text-sm text-muted-foreground">
                  Planning closing values will show as 0. Enter values in Production Planning → Daily Stock Closing.
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="print-area">
          <CardHeader>
            <CardTitle>Reconciliation as of {asOfDate}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Department(s)</TableHead>
                  <TableHead className="text-right">System Closing</TableHead>
                  <TableHead className="text-right">Planning Closing</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right">Variance %</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No WIP sequence configured.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((r) => {
                  const isOpen = !!expanded[r.lvl.order];
                  return (
                    <Fragment key={r.lvl.order}>
                      <TableRow className="cursor-pointer" onClick={() => setExpanded(p => ({ ...p, [r.lvl.order]: !isOpen }))}>
                        <TableCell>
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell className="font-medium">L{r.lvl.order}</TableCell>
                        <TableCell>{r.lvl.label}</TableCell>
                        <TableCell className="text-right font-mono">{fmtNum(r.systemClosing)}</TableCell>
                        <TableCell className="text-right font-mono">{fmtNum(r.planningClosing)}</TableCell>
                        <TableCell className={`text-right font-mono ${r.variance < 0 ? "text-destructive" : r.variance > 0 ? "text-emerald-600" : ""}`}>
                          {fmtNum(r.variance)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {r.systemClosing === 0 && r.planningClosing === 0 ? "—" : `${fmtNum(r.variancePct)}%`}
                        </TableCell>
                        <TableCell>{statusBadge(r.variance, r.variancePct)}</TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow>
                          <TableCell colSpan={8} className="bg-muted/30 p-0">
                            <div className="p-4 space-y-3">
                              {r.lvl.depts.map(d => {
                                const deptItems = itemsByDept.get(d.id) || [];
                                const deptProduced = prodByDept.get(d.id) || 0;
                                const deptPlanning = closingByDept.get(d.id) || 0;
                                return (
                                  <div key={d.id}>
                                    <div className="text-sm font-medium mb-2">
                                      {d.name} — Produced (cum): {fmtNum(deptProduced)} · Planning Closing: {fmtNum(deptPlanning)}
                                    </div>
                                    {deptItems.length === 0 ? (
                                      <div className="text-xs text-muted-foreground">No planning items mapped to this department.</div>
                                    ) : (
                                      <Table>
                                        <TableHeader>
                                          <TableRow>
                                            <TableHead>Code</TableHead>
                                            <TableHead>Item</TableHead>
                                            <TableHead className="text-right">Planning Closing</TableHead>
                                          </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                          {deptItems.map(it => (
                                            <TableRow key={it.id}>
                                              <TableCell className="font-mono text-xs">{it.code}</TableCell>
                                              <TableCell>{it.name}</TableCell>
                                              <TableCell className="text-right font-mono">{fmtNum(closingByItem.get(it.id) || 0)}</TableCell>
                                            </TableRow>
                                          ))}
                                        </TableBody>
                                      </Table>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
                {rows.length > 0 && (
                  <TableRow className="font-semibold bg-muted/50">
                    <TableCell></TableCell>
                    <TableCell colSpan={2}>Total</TableCell>
                    <TableCell className="text-right font-mono">{fmtNum(totals.system)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtNum(totals.planning)}</TableCell>
                    <TableCell className={`text-right font-mono ${totals.variance < 0 ? "text-destructive" : totals.variance > 0 ? "text-emerald-600" : ""}`}>
                      {fmtNum(totals.variance)}
                    </TableCell>
                    <TableCell colSpan={2}></TableCell>
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
