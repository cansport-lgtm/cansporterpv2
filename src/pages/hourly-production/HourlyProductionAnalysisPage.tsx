import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  LineChart, Line, ReferenceLine,
} from "recharts";
import { Activity, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { format, subDays, eachDayOfInterval, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

interface Entry {
  id: string;
  entry_date: string;
  hour_slot: number;
  process_name: string;
  worker_name: string | null;
  quantity: number;
  unit: string | null;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
}

interface ProcessMaster {
  id: string;
  name: string;
  target_per_hour: number | null;
  unit: string | null;
}

const ALL = "all";
const PAGE_SIZE = 50;

export default function HourlyProductionAnalysisPage() {
  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 7), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [processFilter, setProcessFilter] = useState<string>(ALL);
  const [workerFilter, setWorkerFilter] = useState<string>(ALL);
  const [hourFrom, setHourFrom] = useState<number>(8);
  const [hourTo, setHourTo] = useState<number>(20);
  const [page, setPage] = useState(1);

  const { data: processes = [] } = useQuery({
    queryKey: ["hp-analysis-processes"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("hourly_production_processes")
        .select("id, name, target_per_hour, unit")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as ProcessMaster[];
    },
  });

  const { data: entries = [] } = useQuery({
    queryKey: ["hp-analysis-entries", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("hourly_production_entries")
        .select("id, entry_date, hour_slot, process_name, worker_name, quantity, unit, remarks, created_by, created_at")
        .gte("entry_date", fromDate)
        .lte("entry_date", toDate)
        .order("entry_date", { ascending: false })
        .order("hour_slot", { ascending: false });
      if (error) throw error;
      return (data || []) as Entry[];
    },
  });

  const { data: qaProcs = [] } = useQuery({
    queryKey: ["hp-analysis-qa-procs"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("qa_processes")
        .select("id, name")
        .eq("is_hourly_tracked", true);
      if (error) return [];
      return (data || []) as any[];
    },
  });

  const { data: dailyTargetsRange = [] } = useQuery({
    queryKey: ["hp-analysis-daily-targets", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("hourly_production_daily_targets")
        .select("entry_date, process_id, target_per_hour")
        .gte("entry_date", fromDate)
        .lte("entry_date", toDate);
      if (error) return [];
      return (data || []) as any[];
    },
  });

  const dailyTargetByDateName = useMemo(() => {
    const idToName = new Map(qaProcs.map((p: any) => [p.id, p.name]));
    const m = new Map<string, number>();
    dailyTargetsRange.forEach((t: any) => {
      const name = idToName.get(t.process_id);
      if (name) m.set(`${t.entry_date}::${name}`, Number(t.target_per_hour) || 0);
    });
    return m;
  }, [dailyTargetsRange, qaProcs]);

  const effectiveTarget = (date: string, name: string) =>
    dailyTargetByDateName.get(`${date}::${name}`) ?? (processTargetMap.get(name) || 0);


  const { data: users = [] } = useQuery({
    queryKey: ["hp-analysis-users"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("app_users").select("id, full_name, user_id");
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const userMap = useMemo(
    () => new Map(users.map((u: any) => [u.id, u.full_name || u.user_id])),
    [users]
  );

  const processTargetMap = useMemo(
    () => new Map(processes.map((p) => [p.name, Number(p.target_per_hour) || 0])),
    [processes]
  );

  const workerOptions = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => { if (e.worker_name) set.add(e.worker_name); });
    return Array.from(set).sort();
  }, [entries]);

  // Apply filters
  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (processFilter !== ALL && e.process_name !== processFilter) return false;
      if (workerFilter !== ALL && e.worker_name !== workerFilter) return false;
      if (e.hour_slot < hourFrom || e.hour_slot > hourTo) return false;
      return true;
    });
  }, [entries, processFilter, workerFilter, hourFrom, hourTo]);

  // KPIs
  const kpis = useMemo(() => {
    const totalQty = filtered.reduce((s, e) => s + Number(e.quantity || 0), 0);
    const slotKeys = new Set(filtered.map((e) => `${e.entry_date}::${e.hour_slot}::${e.process_name}`));
    const avgPerHour = slotKeys.size ? totalQty / slotKeys.size : 0;

    let targetSum = 0;
    filtered.forEach((e) => { targetSum += effectiveTarget(e.entry_date, e.process_name); });
    const achievement = targetSum ? (totalQty / targetSum) * 100 : 0;

    const hourQty = new Map<number, number>();
    filtered.forEach((e) => { hourQty.set(e.hour_slot, (hourQty.get(e.hour_slot) || 0) + Number(e.quantity || 0)); });
    let bestHour = -1, bestVal = -1;
    hourQty.forEach((v, h) => { if (v > bestVal) { bestVal = v; bestHour = h; } });

    const workers = new Set(filtered.filter((e) => e.worker_name).map((e) => e.worker_name!));
    const procs = new Set(filtered.map((e) => e.process_name));

    return {
      totalQty,
      avgPerHour,
      achievement,
      bestHour,
      bestHourQty: bestVal < 0 ? 0 : bestVal,
      workerCount: workers.size,
      processCount: procs.size,
    };
  }, [filtered, processTargetMap]);

  // Hour-of-day bar
  const hourBarData = useMemo(() => {
    const map = new Map<number, number>();
    for (let h = hourFrom; h <= hourTo; h++) map.set(h, 0);
    filtered.forEach((e) => { map.set(e.hour_slot, (map.get(e.hour_slot) || 0) + Number(e.quantity || 0)); });
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]).map(([h, q]) => ({
      hour: `${String(h).padStart(2, "0")}:00`,
      quantity: q,
    }));
  }, [filtered, hourFrom, hourTo]);

  const avgTargetPerHourBar = useMemo(() => {
    // mean target across processes present in filter
    const procs = new Set(filtered.map((e) => e.process_name));
    if (!procs.size) return 0;
    let sum = 0;
    procs.forEach((p) => { sum += processTargetMap.get(p) || 0; });
    return sum;
  }, [filtered, processTargetMap]);

  // Date x Hour matrix
  const matrix = useMemo(() => {
    const dates = (() => {
      try {
        return eachDayOfInterval({ start: parseISO(fromDate), end: parseISO(toDate) })
          .map((d) => format(d, "yyyy-MM-dd"));
      } catch { return []; }
    })();
    const hours: number[] = [];
    for (let h = hourFrom; h <= hourTo; h++) hours.push(h);
    const grid = new Map<string, number>(); // key: date::hour
    filtered.forEach((e) => {
      const k = `${e.entry_date}::${e.hour_slot}`;
      grid.set(k, (grid.get(k) || 0) + Number(e.quantity || 0));
    });
    const rowMax = new Map<string, number>();
    dates.forEach((d) => {
      let m = 0;
      hours.forEach((h) => { m = Math.max(m, grid.get(`${d}::${h}`) || 0); });
      rowMax.set(d, m);
    });
    return { dates, hours, grid, rowMax };
  }, [filtered, fromDate, toDate, hourFrom, hourTo]);

  // Process performance
  const processRows = useMemo(() => {
    const map = new Map<string, { qty: number; slots: Set<string>; unit: string | null; expected: number }>();
    filtered.forEach((e) => {
      const r = map.get(e.process_name) || { qty: 0, slots: new Set<string>(), unit: e.unit, expected: 0 };
      r.qty += Number(e.quantity || 0);
      const slotKey = `${e.entry_date}::${e.hour_slot}`;
      if (!r.slots.has(slotKey)) {
        r.expected += effectiveTarget(e.entry_date, e.process_name);
        r.slots.add(slotKey);
      }
      r.unit = r.unit || e.unit;
      map.set(e.process_name, r);
    });
    return Array.from(map.entries()).map(([name, r]) => {
      const hours = r.slots.size;
      const avg = hours ? r.qty / hours : 0;
      const expected = r.expected;
      const target = hours ? expected / hours : (processTargetMap.get(name) || 0);
      const achPct = expected ? (r.qty / expected) * 100 : 0;
      return {
        name, qty: r.qty, hours, avg, target, achPct, variance: r.qty - expected, unit: r.unit,
      };
    }).sort((a, b) => b.qty - a.qty);
  }, [filtered, processTargetMap, dailyTargetByDateName]);

  // Worker leaderboard
  const workerRows = useMemo(() => {
    const map = new Map<string, { qty: number; procs: Set<string>; slots: Set<string>; bestHourQty: number; bestHour: number }>();
    filtered.forEach((e) => {
      if (!e.worker_name) return;
      const r = map.get(e.worker_name) || { qty: 0, procs: new Set<string>(), slots: new Set<string>(), bestHourQty: -1, bestHour: -1 };
      r.qty += Number(e.quantity || 0);
      r.procs.add(e.process_name);
      r.slots.add(`${e.entry_date}::${e.hour_slot}`);
      map.set(e.worker_name, r);
    });
    // recompute best hour per worker from raw entries
    const workerHour = new Map<string, Map<number, number>>();
    filtered.forEach((e) => {
      if (!e.worker_name) return;
      const hm = workerHour.get(e.worker_name) || new Map<number, number>();
      hm.set(e.hour_slot, (hm.get(e.hour_slot) || 0) + Number(e.quantity || 0));
      workerHour.set(e.worker_name, hm);
    });
    workerHour.forEach((hm, w) => {
      const r = map.get(w);
      if (!r) return;
      hm.forEach((v, h) => { if (v > r.bestHourQty) { r.bestHourQty = v; r.bestHour = h; } });
    });
    return Array.from(map.entries()).map(([name, r]) => ({
      name, qty: r.qty, procs: Array.from(r.procs).join(", "), hours: r.slots.size,
      avg: r.slots.size ? r.qty / r.slots.size : 0,
      bestHour: r.bestHour, bestHourQty: r.bestHourQty < 0 ? 0 : r.bestHourQty,
    })).sort((a, b) => b.qty - a.qty);
  }, [filtered]);

  // Daily trend + 3-day MA
  const trendData = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach((e) => { m.set(e.entry_date, (m.get(e.entry_date) || 0) + Number(e.quantity || 0)); });
    const sorted = Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return sorted.map(([d, q], i) => {
      const window = sorted.slice(Math.max(0, i - 2), i + 1);
      const ma = window.reduce((s, [, v]) => s + v, 0) / window.length;
      return { date: format(parseISO(d), "dd MMM"), quantity: q, ma3: Math.round(ma) };
    });
  }, [filtered]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const exportCsv = () => {
    const headers = ["Date", "Hour", "Process", "Worker", "Quantity", "Unit", "Remarks", "Entered By", "Entered At"];
    const rows = filtered.map((e) => [
      e.entry_date,
      `${String(e.hour_slot).padStart(2, "0")}:00`,
      e.process_name,
      e.worker_name || "",
      e.quantity,
      e.unit || "",
      (e.remarks || "").replace(/[\r\n,]+/g, " "),
      (e.created_by ? userMap.get(e.created_by) : "") || "",
      e.created_at ? format(new Date(e.created_at), "yyyy-MM-dd HH:mm") : "",
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hourly-production-analysis-${fromDate}_to_${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const cellShade = (val: number, max: number) => {
    if (!val || !max) return "";
    const pct = val / max;
    if (pct >= 0.8) return "bg-violet-500/30 text-foreground font-semibold";
    if (pct >= 0.5) return "bg-violet-500/20 text-foreground";
    if (pct >= 0.25) return "bg-violet-500/10";
    return "bg-violet-500/5";
  };

  const achColor = (pct: number) => {
    if (pct >= 100) return "text-emerald-600 font-semibold";
    if (pct >= 80) return "text-amber-600 font-medium";
    return "text-red-600 font-medium";
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Hourly Production Analysis"
          description="Detailed hour-by-hour performance, target achievement, and worker analytics"
          icon={Activity}
          iconColor="bg-violet-600 text-white"
        />

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
              <div>
                <Label>From Date</Label>
                <Input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(1); }} />
              </div>
              <div>
                <Label>To Date</Label>
                <Input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(1); }} />
              </div>
              <div>
                <Label>Process</Label>
                <Select value={processFilter} onValueChange={(v) => { setProcessFilter(v); setPage(1); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All Processes</SelectItem>
                    {processes.map((p) => (<SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Worker</Label>
                <Select value={workerFilter} onValueChange={(v) => { setWorkerFilter(v); setPage(1); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All Workers</SelectItem>
                    {workerOptions.map((w) => (<SelectItem key={w} value={w}>{w}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Hour From</Label>
                <Input type="number" min={0} max={23} value={hourFrom}
                  onChange={(e) => setHourFrom(Math.max(0, Math.min(23, Number(e.target.value) || 0)))} />
              </div>
              <div>
                <Label>Hour To</Label>
                <Input type="number" min={0} max={23} value={hourTo}
                  onChange={(e) => setHourTo(Math.max(0, Math.min(23, Number(e.target.value) || 0)))} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* KPI Strip */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <MetricCard title="Total Quantity" value={kpis.totalQty.toLocaleString()} icon={Activity} iconColor="text-violet-600" />
          <MetricCard title="Avg / Hour" value={kpis.avgPerHour.toFixed(1)} icon={Activity} iconColor="text-blue-600" />
          <MetricCard
            title="Target Achievement"
            value={`${kpis.achievement.toFixed(1)}%`}
            icon={Activity}
            iconColor={kpis.achievement >= 100 ? "text-emerald-600" : kpis.achievement >= 80 ? "text-amber-600" : "text-red-600"}
          />
          <MetricCard
            title="Best Hour"
            value={kpis.bestHour < 0 ? "—" : `${String(kpis.bestHour).padStart(2, "0")}:00`}
            description={kpis.bestHour < 0 ? "" : `${kpis.bestHourQty.toLocaleString()} units`}
            icon={Activity}
            iconColor="text-emerald-600"
          />
          <MetricCard title="Active Workers" value={kpis.workerCount} icon={Activity} iconColor="text-cyan-600" />
          <MetricCard title="Active Processes" value={kpis.processCount} icon={Activity} iconColor="text-amber-600" />
        </div>

        {/* Hour-of-day bar */}
        <Card>
          <CardHeader><CardTitle>Hour of Day Performance</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourBarData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="hour" fontSize={12} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="quantity" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  {avgTargetPerHourBar > 0 && (
                    <ReferenceLine y={avgTargetPerHourBar} stroke="hsl(var(--destructive))" strokeDasharray="4 4" label="Target/hr" />
                  )}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Date x Hour Matrix */}
        <Card>
          <CardHeader><CardTitle>Date × Hour Heatmap</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-auto max-h-[420px]">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-background z-10">
                  <tr>
                    <th className="sticky left-0 bg-background border p-2 text-left">Date</th>
                    {matrix.hours.map((h) => (
                      <th key={h} className="border p-2 text-center min-w-[60px]">{String(h).padStart(2, "0")}</th>
                    ))}
                    <th className="border p-2 text-center bg-muted">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.dates.map((d) => {
                    const rowTotal = matrix.hours.reduce((s, h) => s + (matrix.grid.get(`${d}::${h}`) || 0), 0);
                    const max = matrix.rowMax.get(d) || 0;
                    return (
                      <tr key={d}>
                        <td className="sticky left-0 bg-background border p-2 font-medium">{format(parseISO(d), "dd MMM (EEE)")}</td>
                        {matrix.hours.map((h) => {
                          const v = matrix.grid.get(`${d}::${h}`) || 0;
                          return (
                            <td key={h} className={cn("border p-2 text-center", cellShade(v, max))}>
                              {v ? v.toLocaleString() : ""}
                            </td>
                          );
                        })}
                        <td className="border p-2 text-center font-semibold bg-muted/50">{rowTotal.toLocaleString()}</td>
                      </tr>
                    );
                  })}
                  {matrix.dates.length === 0 && (
                    <tr><td className="p-4 text-center text-muted-foreground" colSpan={matrix.hours.length + 2}>No data in range</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Process performance */}
        <Card>
          <CardHeader><CardTitle>Process Performance vs Target</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Process</TableHead>
                  <TableHead className="text-right">Total Qty</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">Avg/Hr</TableHead>
                  <TableHead className="text-right">Target/Hr</TableHead>
                  <TableHead className="text-right">Achievement</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {processRows.map((r) => (
                  <TableRow key={r.name}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-right">{r.qty.toLocaleString()} {r.unit || ""}</TableCell>
                    <TableCell className="text-right">{r.hours}</TableCell>
                    <TableCell className="text-right">{r.avg.toFixed(1)}</TableCell>
                    <TableCell className="text-right">{r.target || "—"}</TableCell>
                    <TableCell className={cn("text-right", r.target ? achColor(r.achPct) : "text-muted-foreground")}>
                      {r.target ? `${r.achPct.toFixed(1)}%` : "—"}
                    </TableCell>
                    <TableCell className={cn("text-right", r.target ? (r.variance >= 0 ? "text-emerald-600" : "text-red-600") : "")}>
                      {r.target ? (r.variance >= 0 ? "+" : "") + r.variance.toLocaleString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {processRows.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No data</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Worker Leaderboard */}
        <Card>
          <CardHeader><CardTitle>Worker Leaderboard</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Worker</TableHead>
                  <TableHead>Process(es)</TableHead>
                  <TableHead className="text-right">Total Qty</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">Avg/Hr</TableHead>
                  <TableHead className="text-right">Best Hour</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workerRows.map((w, i) => (
                  <TableRow key={w.name} className={cn(i < 3 && "bg-amber-500/5")}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell className="font-medium">{w.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{w.procs}</TableCell>
                    <TableCell className="text-right font-semibold">{w.qty.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{w.hours}</TableCell>
                    <TableCell className="text-right">{w.avg.toFixed(1)}</TableCell>
                    <TableCell className="text-right">
                      {w.bestHour >= 0 ? `${String(w.bestHour).padStart(2, "0")}:00 (${w.bestHourQty})` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {workerRows.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No worker data</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Daily Trend + MA */}
        <Card>
          <CardHeader><CardTitle>Daily Trend with 3-Day Moving Average</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={12} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="quantity" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="ma3" stroke="hsl(var(--destructive))" strokeWidth={2} strokeDasharray="5 5" dot={false} name="3-Day MA" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Detailed entries */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Detailed Entries ({filtered.length})</CardTitle>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
              <Download className="h-4 w-4 mr-2" /> Export CSV
            </Button>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Hour</TableHead>
                    <TableHead>Process</TableHead>
                    <TableHead>Worker</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Remarks</TableHead>
                    <TableHead>Entered By</TableHead>
                    <TableHead>Entered At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>{format(parseISO(e.entry_date), "dd MMM yyyy")}</TableCell>
                      <TableCell>{String(e.hour_slot).padStart(2, "0")}:00</TableCell>
                      <TableCell className="font-medium">{e.process_name}</TableCell>
                      <TableCell>{e.worker_name || "—"}</TableCell>
                      <TableCell className="text-right">{Number(e.quantity).toLocaleString()}</TableCell>
                      <TableCell>{e.unit || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate" title={e.remarks || ""}>{e.remarks || "—"}</TableCell>
                      <TableCell className="text-xs">{(e.created_by ? userMap.get(e.created_by) : "") || "—"}</TableCell>
                      <TableCell className="text-xs">{e.created_at ? format(new Date(e.created_at), "dd MMM HH:mm") : "—"}</TableCell>
                    </TableRow>
                  ))}
                  {paged.length === 0 && (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">No entries</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-4">
                <p className="text-sm text-muted-foreground">Page {page} of {totalPages}</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    <ChevronLeft className="h-4 w-4" /> Prev
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                    Next <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
