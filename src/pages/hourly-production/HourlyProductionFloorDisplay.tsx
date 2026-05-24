import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Clock, Settings, RefreshCw, ClipboardList, PackageOpen } from "lucide-react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { Monitor } from "lucide-react";
import { useMemo } from "react";

const REFRESH_INTERVAL = 15000;
const STORAGE_KEY = "hourly-production-floor-processes";
const DEPT_STORAGE_KEY = "hourly-production-floor-department";

const MACHINE_STATUS_COLORS: Record<string, { bg: string; text: string; border: string; pulse?: boolean }> = {
  Running: { bg: "bg-green-500/20", text: "text-green-600 dark:text-green-400", border: "border-green-500" },
  Stopped: { bg: "bg-slate-500/20", text: "text-slate-600 dark:text-slate-400", border: "border-slate-500" },
  Idle: { bg: "bg-yellow-500/20", text: "text-yellow-600 dark:text-yellow-400", border: "border-yellow-500" },
  Breakdown: { bg: "bg-red-500/20", text: "text-red-600 dark:text-red-400", border: "border-red-500", pulse: true },
  Maintenance: { bg: "bg-blue-500/20", text: "text-blue-600 dark:text-blue-400", border: "border-blue-500" },
  Setup: { bg: "bg-purple-500/20", text: "text-purple-600 dark:text-purple-400", border: "border-purple-500" },
};
const getMachineStatusStyle = (s: string) => MACHINE_STATUS_COLORS[s] || { bg: "bg-muted/50", text: "text-muted-foreground", border: "border-muted" };

function getHourLabel(h: number) {
  const start = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? "AM" : "PM";
  return `${start}:00 ${ampm}`;
}

export default function HourlyProductionFloorDisplay() {
  const [selectedDepartment, setSelectedDepartment] = useState<string>(() => {
    try { return localStorage.getItem(DEPT_STORAGE_KEY) || "all"; } catch { return "all"; }
  });
  const [selectedProcesses, setSelectedProcesses] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
  });
  const [showSettings, setShowSettings] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedProcesses));
  }, [selectedProcesses]);

  useEffect(() => {
    localStorage.setItem(DEPT_STORAGE_KEY, selectedDepartment);
  }, [selectedDepartment]);

  const today = format(new Date(), "yyyy-MM-dd");
  const currentHour = new Date().getHours();
  const checkHour = currentHour - 1;

  const { data: departments = [] } = useQuery({
    queryKey: ["departments-floor"],
    queryFn: async () => {
      const { data, error } = await supabase.from("production_departments").select("id, name").eq("is_active", true).order("name");
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const { data: processes = [] } = useQuery({
    queryKey: ["qa-processes-hourly", selectedDepartment],
    queryFn: async () => {
      let query = (supabase as any).from("qa_processes").select("id, name, code, department_id").eq("is_active", true).eq("is_hourly_tracked", true);
      if (selectedDepartment !== "all") {
        query = query.eq("department_id", selectedDepartment);
      }
      const { data, error } = await query.order("name");
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  const { data: entries = [] } = useQuery({
    queryKey: ["hourly-production-floor", today],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("hourly_production_entries").select("*").eq("entry_date", today);
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  const { data: losses = [] } = useQuery({
    queryKey: ["hourly-production-floor-losses", today],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("hourly_production_losses").select("*").eq("entry_date", today);
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  const selectedDeptName = selectedDepartment === "all" ? null : (departments.find((d: any) => d.id === selectedDepartment)?.name || null);

  // Today's job orders scoped to selected department (required date = today)
  const { data: todayJobOrders = [] } = useQuery({
    queryKey: ["floor-job-orders", today, selectedDepartment],
    queryFn: async () => {
      let q = (supabase as any)
        .from("job_orders")
        .select("*")
        .eq("required_by_date", today)
        .in("status", ["Issued", "Closed"]);
      if (selectedDepartment !== "all") q = q.eq("department_id", selectedDepartment);
      const { data, error } = await q.order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  const jobOrderIds = todayJobOrders.map((o: any) => o.id);
  const { data: jobOrderItems = [] } = useQuery({
    queryKey: ["floor-job-order-items", jobOrderIds.join(",")],
    enabled: jobOrderIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("job_order_items")
        .select("*")
        .in("job_order_id", jobOrderIds)
        .order("sort_order");
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  const planningItemIds = Array.from(new Set(jobOrderItems.map((it: any) => it.planning_item_id))).filter(Boolean);
  const { data: planningItemsForJO = [] } = useQuery({
    queryKey: ["floor-planning-items", planningItemIds.join(",")],
    enabled: planningItemIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("planning_items")
        .select("id, name, unit")
        .in("id", planningItemIds);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const planningItemMap = useMemo(
    () => Object.fromEntries(planningItemsForJO.map((p: any) => [p.id, p])),
    [planningItemsForJO]
  );
  const deptMap = useMemo(
    () => Object.fromEntries(departments.map((d: any) => [d.id, d])),
    [departments]
  );
  const itemsByJobOrder = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const it of jobOrderItems) {
      (m[it.job_order_id] = m[it.job_order_id] || []).push(it);
    }
    return m;
  }, [jobOrderItems]);

  // Part-of-N continuation: group by required_by_date + department
  const joSeriesMap = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const o of todayJobOrders) {
      const k = `${o.required_by_date}::${o.department_id}`;
      (groups[k] = groups[k] || []).push(o);
    }
    const map: Record<string, { seq: number; total: number }> = {};
    for (const k of Object.keys(groups)) {
      const sorted = [...groups[k]].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      sorted.forEach((o, i) => { map[o.id] = { seq: i + 1, total: sorted.length }; });
    }
    return map;
  }, [todayJobOrders]);

  const { data: machines = [] } = useQuery({
    queryKey: ["machine-monitor-floor", selectedDeptName],
    queryFn: async () => {
      let q = (supabase as any).from("machine_monitor_machines").select("*").eq("is_active", true);
      if (selectedDeptName) q = q.eq("department", selectedDeptName);
      const { data, error } = await q.order("sort_order", { ascending: true }).order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  // Auto carry-forward (yesterday's leftover balance reissued today) — scoped to selected dept
  const { data: carryHeaders = [] } = useQuery({
    queryKey: ["floor-carry-headers", today, selectedDepartment],
    queryFn: async () => {
      let q = (supabase as any)
        .from("hp_material_issuance")
        .select("id, department_id")
        .eq("issue_date", today)
        .eq("notes", "Last Day Balance Reissuance");
      if (selectedDepartment !== "all") q = q.eq("department_id", selectedDepartment);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  const carryHeaderIds = carryHeaders.map((h: any) => h.id);
  const { data: carryItems = [] } = useQuery({
    queryKey: ["floor-carry-items", carryHeaderIds.join(",")],
    enabled: carryHeaderIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("hp_material_issuance_items")
        .select("*")
        .in("issuance_id", carryHeaderIds);
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  const carryMaterialIds = Array.from(new Set(carryItems.map((it: any) => it.material_id))).filter(Boolean);
  const { data: carryMaterials = [] } = useQuery({
    queryKey: ["floor-carry-materials", carryMaterialIds.join(",")],
    enabled: carryMaterialIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("hp_materials")
        .select("id, code, name, unit")
        .in("id", carryMaterialIds);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
  const carryMaterialMap = useMemo(
    () => Object.fromEntries(carryMaterials.map((m: any) => [m.id, m])),
    [carryMaterials]
  );
  const carryHeaderDeptMap = useMemo(
    () => Object.fromEntries(carryHeaders.map((h: any) => [h.id, h.department_id])),
    [carryHeaders]
  );

  // Group: when single dept -> by material; when all -> by department then material
  const carryGrouped = useMemo(() => {
    const byDept: Record<string, Record<string, number>> = {};
    for (const it of carryItems as any[]) {
      const deptId = carryHeaderDeptMap[it.issuance_id] || "—";
      const matId = it.material_id;
      if (!byDept[deptId]) byDept[deptId] = {};
      byDept[deptId][matId] = (byDept[deptId][matId] || 0) + Number(it.issued_qty || 0);
    }
    return byDept;
  }, [carryItems, carryHeaderDeptMap]);

  const machineRunning = machines.filter((m: any) => m.current_status === "Running").length;
  const machineBreakdown = machines.filter((m: any) => m.current_status === "Breakdown").length;
  const machineIdleStopped = machines.filter((m: any) => m.current_status === "Idle" || m.current_status === "Stopped").length;

  useEffect(() => {
    if (selectedProcesses.length === 0 && processes.length > 0) {
      setSelectedProcesses(processes.map((p: any) => p.name));
    }
  }, [processes]);

  const displayProcesses = processes.filter((p: any) => selectedProcesses.includes(p.name));
  const totalToday = entries.reduce((s: number, e: any) => s + Number(e.quantity || 0), 0);
  const totalLastHour = entries.filter((e: any) => e.hour_slot === checkHour).reduce((s: number, e: any) => s + Number(e.quantity || 0), 0);

  const toggleProcess = (name: string) => {
    setSelectedProcesses((prev) => prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]);
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Clock className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Hourly Production Monitor</h1>
            <p className="text-muted-foreground text-sm">{format(currentTime, "EEEE, dd MMM yyyy — hh:mm:ss a")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedDepartment} onValueChange={(val) => {
            setSelectedDepartment(val);
            setSelectedProcesses([]);
          }}>
            <SelectTrigger className="w-48"><SelectValue placeholder="All Departments" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map((d: any) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Dialog open={showSettings} onOpenChange={setShowSettings}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm"><Settings className="h-4 w-4 mr-1" /> Processes</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Display Settings</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label className="text-sm font-medium mb-2 block">Processes</Label>
                  <div className="space-y-3 max-h-60 overflow-y-auto">
                    {processes.map((p: any) => (
                      <div key={p.id} className="flex items-center gap-2">
                        <Checkbox checked={selectedProcesses.includes(p.name)} onCheckedChange={() => toggleProcess(p.name)} />
                        <Label>{p.name}</Label>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-muted rounded-xl p-4 text-center">
          <p className="text-sm text-muted-foreground">Today's Total</p>
          <p className="text-5xl font-bold">{totalToday.toLocaleString()}</p>
        </div>
        <div className="bg-muted rounded-xl p-4 text-center">
          <p className="text-sm text-muted-foreground">Last Hour ({getHourLabel(checkHour)})</p>
          <p className="text-5xl font-bold">{totalLastHour.toLocaleString()}</p>
        </div>
        <div className="bg-muted rounded-xl p-4 text-center">
          <p className="text-sm text-muted-foreground">Processes Active</p>
          <p className="text-5xl font-bold">{displayProcesses.length}</p>
        </div>
      </div>

      {/* Today's Job Orders */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <ClipboardList className="h-6 w-6 text-primary" />
          <h2 className="text-xl font-bold">Today's Job Orders</h2>
          {selectedDeptName && <span className="text-sm text-muted-foreground">— {selectedDeptName}</span>}
          <span className="ml-auto text-xs px-2 py-1 rounded bg-muted">Total: <b>{todayJobOrders.length}</b></span>
        </div>
        {todayJobOrders.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground border border-dashed rounded-xl">
            <ClipboardList className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p>No job orders for today</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {todayJobOrders.map((jo: any) => {
              const items = itemsByJobOrder[jo.id] || [];
              const totalQty = items.reduce((s: number, it: any) => s + Number(it.quantity || 0), 0);
              const series = joSeriesMap[jo.id];
              const isClosed = jo.status === "Closed";
              return (
                <div key={jo.id} className={cn("rounded-xl p-3 border-2", isClosed ? "border-muted bg-muted/30" : "border-primary/60 bg-primary/5")}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-sm">{jo.job_order_number}</span>
                      {series && series.total > 1 && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Part {series.seq} of {series.total}</Badge>
                      )}
                    </div>
                    <Badge variant={isClosed ? "outline" : "default"} className="text-[10px]">{jo.status}</Badge>
                  </div>
                  {selectedDepartment === "all" && (
                    <p className="text-xs text-muted-foreground mb-1">{deptMap[jo.department_id]?.name || "—"}</p>
                  )}
                  <div className="space-y-0.5 max-h-32 overflow-y-auto mt-2">
                    {items.map((it: any) => {
                      const pi = planningItemMap[it.planning_item_id];
                      const detail = it.item_detail && String(it.item_detail).trim();
                      return (
                        <div key={it.id} className="flex justify-between text-xs gap-2">
                          <span className="truncate">
                            {pi?.name || "—"}
                            {detail && (
                              <span className="text-muted-foreground"> — {detail}</span>
                            )}
                          </span>
                          <span className="font-semibold whitespace-nowrap">{Number(it.quantity).toLocaleString()} {it.unit || pi?.unit || ""}</span>
                        </div>
                      );
                    })}
                    {items.length === 0 && <p className="text-xs text-muted-foreground italic">No items</p>}
                  </div>
                  {items.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border flex justify-between text-xs">
                      <span className="text-muted-foreground">Total qty</span>
                      <span className="font-bold">{totalQty.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Auto Carry-Forward (Yesterday's Balance Reissued Today) */}
      {Object.keys(carryGrouped).length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <PackageOpen className="h-6 w-6 text-amber-600 dark:text-amber-400" />
            <h2 className="text-xl font-bold">Auto Carry-Forward — Yesterday's Balance Reissued Today</h2>
            <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-300 ml-2">Auto</Badge>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(carryGrouped).map(([deptId, matMap]) => {
              const entries = Object.entries(matMap)
                .map(([mid, qty]) => ({ mat: carryMaterialMap[mid], qty }))
                .filter((r: any) => r.mat)
                .sort((a: any, b: any) => String(a.mat.code).localeCompare(String(b.mat.code)));
              if (entries.length === 0) return null;
              return (
                <div key={deptId} className="rounded-xl p-3 border-2 border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-950/20">
                  {selectedDepartment === "all" && (
                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-2">
                      {deptMap[deptId]?.name || "—"}
                    </p>
                  )}
                  <div className="space-y-1">
                    {entries.map((r: any) => (
                      <div key={r.mat.id} className="flex justify-between text-xs gap-2">
                        <span className="truncate">
                          <span className="font-mono text-muted-foreground">{r.mat.code}</span>
                          <span> — {r.mat.name}</span>
                        </span>
                        <span className="font-semibold whitespace-nowrap">
                          {Number(r.qty).toLocaleString()} {r.mat.unit || ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}



      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-4">
        {displayProcesses.map((proc: any) => {
          const procEntries = entries.filter((e: any) => e.process_name === proc.name);
          const todayTotal = procEntries.reduce((s: number, e: any) => s + Number(e.quantity || 0), 0);
          const lastHourEntries = procEntries.filter((e: any) => e.hour_slot === checkHour);
          const lastHourTotal = lastHourEntries.reduce((s: number, e: any) => s + Number(e.quantity || 0), 0);
          const completedHourEntries = procEntries.filter((e: any) => e.hour_slot < currentHour);
          const hasNoEntriesToday = completedHourEntries.length === 0 && checkHour >= 6;
          const hasNoEntriesLastHour = checkHour >= 6 && lastHourEntries.length === 0;

          // Last-hour losses for this process
          const lastHourLosses = losses.filter((l: any) => l.process_name === proc.name && l.hour_slot === checkHour);
          const lostMinutes = lastHourLosses.reduce((s: number, l: any) => s + Number(l.lost_minutes || 0), 0);
          const lostQuantity = lastHourLosses.reduce((s: number, l: any) => s + Number(l.lost_quantity || 0), 0);
          const hasLoss = lostMinutes > 0 || lostQuantity > 0;

          // Group by worker
          const workerMap: Record<string, { today: number; lastHr: number }> = {};
          procEntries.forEach((e: any) => {
            const name = e.worker_name || "Unassigned";
            if (!workerMap[name]) workerMap[name] = { today: 0, lastHr: 0 };
            workerMap[name].today += Number(e.quantity || 0);
            if (e.hour_slot === checkHour) workerMap[name].lastHr += Number(e.quantity || 0);
          });
          const workers = Object.entries(workerMap)
            .map(([name, vals]) => ({ name, ...vals }))
            .sort((a, b) => b.today - a.today);

          let cardClass = "rounded-xl p-4 border-2 transition-all ";
          if (hasNoEntriesToday) {
            cardClass += "border-destructive bg-destructive/10 animate-pulse";
          } else if (hasNoEntriesLastHour) {
            cardClass += "border-yellow-500 bg-yellow-500/10 animate-pulse";
          } else {
            cardClass += "border-primary bg-primary/10";
          }

          const workerSection = workers.length > 0 && !hasNoEntriesToday && (
            <div className="mt-3 border-t border-border pt-2">
              <div className="flex justify-between text-[10px] text-muted-foreground font-medium mb-1 px-1">
                <span>Worker</span>
                <div className="flex gap-4">
                  <span>Today</span>
                  <span className="w-10 text-right">Last Hr</span>
                </div>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-0.5">
                {workers.map((w) => (
                  <div key={w.name} className="flex justify-between items-center text-xs px-1 py-0.5 rounded hover:bg-muted/50">
                    <span className="truncate max-w-[45%] font-medium">{w.name}</span>
                    <div className="flex gap-4">
                      <span className="font-semibold">{w.today.toLocaleString()}</span>
                      <span className="w-10 text-right text-muted-foreground">{w.lastHr}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );

          return (
            <div key={proc.id} className={cardClass}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-lg truncate">{proc.name}</h3>
              </div>
              {hasNoEntriesToday ? (
                <div className="text-center py-4"><p className="text-3xl font-bold text-destructive">NO ENTRIES TODAY</p></div>
              ) : hasNoEntriesLastHour ? (
                <>
                  <p className="text-4xl font-bold text-center">{todayTotal.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground text-center mt-1">Today's total</p>
                  <div className="mt-2 text-center"><p className="text-sm font-semibold text-yellow-500">NO ENTRY LAST HOUR</p></div>
                  {hasLoss && (
                    <div className="mt-2 flex justify-center gap-4 rounded-md bg-amber-500/10 border border-amber-500/40 py-1.5 px-2">
                      <div className="text-center"><p className="text-base font-bold text-amber-600 dark:text-amber-400 leading-none">{lostMinutes}<span className="text-[10px] ml-0.5">m</span></p><p className="text-[10px] text-muted-foreground mt-0.5">Lost min</p></div>
                      <div className="w-px bg-amber-500/30" />
                      <div className="text-center"><p className="text-base font-bold text-amber-600 dark:text-amber-400 leading-none">{lostQuantity.toLocaleString()}</p><p className="text-[10px] text-muted-foreground mt-0.5">Lost qty</p></div>
                    </div>
                  )}
                  {workerSection}
                </>
              ) : (
                <>
                  <p className="text-4xl font-bold text-center">{todayTotal.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground text-center mt-1">Today's total</p>
                  <div className="mt-2 flex justify-center gap-4 text-sm">
                    <div className="text-center"><p className="font-semibold text-lg">{lastHourTotal}</p><p className="text-xs text-muted-foreground">Last hour</p></div>
                  </div>
                  {hasLoss && (
                    <div className="mt-2 flex justify-center gap-4 rounded-md bg-amber-500/10 border border-amber-500/40 py-1.5 px-2">
                      <div className="text-center"><p className="text-base font-bold text-amber-600 dark:text-amber-400 leading-none">{lostMinutes}<span className="text-[10px] ml-0.5">m</span></p><p className="text-[10px] text-muted-foreground mt-0.5">Lost min</p></div>
                      <div className="w-px bg-amber-500/30" />
                      <div className="text-center"><p className="text-base font-bold text-amber-600 dark:text-amber-400 leading-none">{lostQuantity.toLocaleString()}</p><p className="text-[10px] text-muted-foreground mt-0.5">Lost qty</p></div>
                    </div>
                  )}
                  {workerSection}
                </>
              )}
            </div>
          );
        })}
      </div>

      {displayProcesses.length === 0 && (
        <div className="text-center py-20 text-muted-foreground"><p className="text-xl">No processes configured</p><p>Add processes from the Hourly Entry page first</p></div>
      )}

      {/* Machine Status Section */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Monitor className="h-6 w-6 text-primary" />
            <h2 className="text-xl font-bold">Machine Status</h2>
            {selectedDeptName && <span className="text-sm text-muted-foreground">— {selectedDeptName}</span>}
          </div>
          <div className="flex gap-2 text-xs">
            <span className="px-2 py-1 rounded bg-muted">Total: <b>{machines.length}</b></span>
            <span className="px-2 py-1 rounded bg-green-500/10 text-green-600 dark:text-green-400">Running: <b>{machineRunning}</b></span>
            <span className="px-2 py-1 rounded bg-red-500/10 text-red-600 dark:text-red-400">Breakdown: <b>{machineBreakdown}</b></span>
            <span className="px-2 py-1 rounded bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">Idle/Stopped: <b>{machineIdleStopped}</b></span>
          </div>
        </div>
        {machines.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground border border-dashed rounded-xl">
            <Monitor className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p>No machines {selectedDeptName ? `in ${selectedDeptName}` : "configured"}</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
            {machines.map((m: any) => {
              const style = getMachineStatusStyle(m.current_status);
              const timeSince = m.current_status_since ? formatDistanceToNow(new Date(m.current_status_since), { addSuffix: false }) : "";
              return (
                <div key={m.id} className={cn("rounded-lg border-2 p-2", style.bg, style.border, style.pulse && "animate-pulse")}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-mono text-muted-foreground truncate">{m.code}</span>
                  </div>
                  <div className="text-xs font-semibold leading-tight truncate" title={m.name}>{m.name}</div>
                  <div className={cn("text-sm font-bold uppercase tracking-wide mt-1", style.text)}>{m.current_status}</div>
                  <div className="text-[9px] text-muted-foreground">{timeSince}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="fixed bottom-4 right-4 flex items-center gap-2 text-xs text-muted-foreground bg-muted rounded-full px-3 py-1">
        <RefreshCw className="h-3 w-3 animate-spin" /> Auto-refresh: 15s
      </div>
    </div>
  );
}
