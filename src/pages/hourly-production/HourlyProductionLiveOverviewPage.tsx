import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Activity, Clock, Monitor, RefreshCw, AlertTriangle, Factory, ClipboardList, Package } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const REFRESH_INTERVAL = 15000;
const DEPT_KEY = "hp-live-overview-dept";

const MACHINE_STATUS_COLORS: Record<string, { bg: string; text: string; border: string; pulse?: boolean }> = {
  Running: { bg: "bg-green-500/15", text: "text-green-600 dark:text-green-400", border: "border-green-500/60" },
  Stopped: { bg: "bg-slate-500/15", text: "text-slate-600 dark:text-slate-400", border: "border-slate-500/60" },
  Idle: { bg: "bg-yellow-500/15", text: "text-yellow-600 dark:text-yellow-400", border: "border-yellow-500/60" },
  Breakdown: { bg: "bg-red-500/15", text: "text-red-600 dark:text-red-400", border: "border-red-500/70", pulse: true },
  "Performance Issue": { bg: "bg-yellow-500/15", text: "text-yellow-600 dark:text-yellow-400", border: "border-yellow-500/60" },
  Maintenance: { bg: "bg-blue-500/15", text: "text-blue-600 dark:text-blue-400", border: "border-blue-500/60" },
  Setup: { bg: "bg-purple-500/15", text: "text-purple-600 dark:text-purple-400", border: "border-purple-500/60" },
};
const parseBaseStatus = (s: string) => {
  const i = s.indexOf(" — ");
  return i > 0 ? s.substring(0, i) : s;
};
const machineStyle = (s: string) => MACHINE_STATUS_COLORS[parseBaseStatus(s)] || { bg: "bg-muted/50", text: "text-muted-foreground", border: "border-muted" };

const STATUS_ORDER = ["Breakdown", "Performance Issue", "Running", "Idle", "Stopped", "Maintenance", "Setup"];

function getHourLabel(h: number) {
  const start = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? "AM" : "PM";
  return `${start}:00 ${ampm}`;
}

export default function HourlyProductionLiveOverviewPage() {
  const [selectedDepartment, setSelectedDepartment] = useState<string>(() => {
    try { return localStorage.getItem(DEPT_KEY) || "all"; } catch { return "all"; }
  });
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(DEPT_KEY, selectedDepartment); } catch {}
  }, [selectedDepartment]);

  const isToday = selectedDate === format(new Date(), "yyyy-MM-dd");
  const currentHour = new Date().getHours();
  const checkHour = currentHour - 1;

  const { data: departments = [] } = useQuery({
    queryKey: ["departments-live-overview"],
    queryFn: async () => {
      const { data: procs, error: pErr } = await (supabase as any)
        .from("qa_processes")
        .select("department_id")
        .eq("is_active", true)
        .eq("is_hourly_tracked", true);
      if (pErr) throw pErr;
      const ids = Array.from(new Set((procs || []).map((p: any) => p.department_id).filter(Boolean)));
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from("production_departments")
        .select("id, name")
        .eq("is_active", true)
        .in("id", ids as string[])
        .order("name");
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const selectedDeptName = selectedDepartment === "all"
    ? null
    : (departments.find((d: any) => d.id === selectedDepartment)?.name || null);

  const { data: processes = [] } = useQuery({
    queryKey: ["live-overview-processes", selectedDepartment],
    queryFn: async () => {
      let q = (supabase as any)
        .from("qa_processes")
        .select("id, name, code, department_id")
        .eq("is_active", true)
        .eq("is_hourly_tracked", true);
      if (selectedDepartment !== "all") q = q.eq("department_id", selectedDepartment);
      const { data, error } = await q.order("name");
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  const { data: entries = [] } = useQuery({
    queryKey: ["live-overview-entries", selectedDate],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("hourly_production_entries")
        .select("*")
        .eq("entry_date", selectedDate);
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  const { data: losses = [] } = useQuery({
    queryKey: ["live-overview-losses", selectedDate],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("hourly_production_losses")
        .select("process_name, hour_slot, lost_minutes, lost_quantity")
        .eq("entry_date", selectedDate);
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  const { data: dailyTargets = [] } = useQuery({
    queryKey: ["live-overview-daily-targets", selectedDate],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("hourly_production_daily_targets")
        .select("process_id, target_per_hour")
        .eq("entry_date", selectedDate);
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  const { data: masterDefaults = [] } = useQuery({
    queryKey: ["live-overview-master-targets"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("hourly_production_processes")
        .select("name, target_per_hour");
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const masterTargetMap = useMemo(() => {
    const m = new Map<string, number>();
    masterDefaults.forEach((d: any) => m.set(d.name, Number(d.target_per_hour) || 0));
    return m;
  }, [masterDefaults]);

  const dailyTargetMap = useMemo(() => {
    const m = new Map<string, number>();
    dailyTargets.forEach((d: any) => m.set(d.process_id, Number(d.target_per_hour) || 0));
    return m;
  }, [dailyTargets]);

  const { data: machines = [] } = useQuery({
    queryKey: ["live-overview-machines", selectedDeptName],
    queryFn: async () => {
      let q = (supabase as any)
        .from("machine_monitor_machines")
        .select("*")
        .eq("is_active", true);
      if (selectedDeptName) q = q.eq("department", selectedDeptName);
      const { data, error } = await q
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  // Job Orders for selected date scoped by department
  const { data: jobOrders = [] } = useQuery({
    queryKey: ["live-overview-job-orders", selectedDate, selectedDepartment],
    queryFn: async () => {
      let q = (supabase as any)
        .from("job_orders")
        .select("*")
        .eq("required_by_date", selectedDate)
        .in("status", ["Issued", "Closed"]);
      if (selectedDepartment !== "all") q = q.eq("department_id", selectedDepartment);
      const { data, error } = await q.order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  const jobOrderIds = jobOrders.map((o: any) => o.id);
  const { data: jobOrderItems = [] } = useQuery({
    queryKey: ["live-overview-job-order-items", jobOrderIds.join(",")],
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
    queryKey: ["live-overview-planning-items", planningItemIds.join(",")],
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
  const joSeriesMap = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const o of jobOrders) {
      const k = `${o.required_by_date}::${o.department_id}`;
      (groups[k] = groups[k] || []).push(o);
    }
    const map: Record<string, { seq: number; total: number }> = {};
    for (const k of Object.keys(groups)) {
      const sorted = [...groups[k]].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      sorted.forEach((o, i) => { map[o.id] = { seq: i + 1, total: sorted.length }; });
    }
    return map;
  }, [jobOrders]);

  // Material Issuances for selected date scoped by department
  const { data: matIssuances = [] } = useQuery({
    queryKey: ["live-overview-mat-issuances", selectedDate, selectedDepartment],
    queryFn: async () => {
      let q = (supabase as any)
        .from("hp_material_issuance")
        .select("*")
        .eq("issue_date", selectedDate);
      if (selectedDepartment !== "all") q = q.eq("department_id", selectedDepartment);
      const { data, error } = await q.order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  const matIssuanceIds = matIssuances.map((i: any) => i.id);
  const { data: matIssuanceItems = [] } = useQuery({
    queryKey: ["live-overview-mat-issuance-items", matIssuanceIds.join(",")],
    enabled: matIssuanceIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("hp_material_issuance_items")
        .select("*")
        .in("issuance_id", matIssuanceIds);
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  const { data: hpMaterials = [] } = useQuery({
    queryKey: ["live-overview-hp-materials"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("hp_materials")
        .select("id, name, unit, category");
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const matUserIds = useMemo(() => {
    const ids = new Set<string>();
    matIssuances.forEach((i: any) => { if (i.issued_by) ids.add(i.issued_by); });
    matIssuanceItems.forEach((it: any) => { if (it.receiver_user_id) ids.add(it.receiver_user_id); });
    return Array.from(ids);
  }, [matIssuances, matIssuanceItems]);

  const { data: matUsers = [] } = useQuery({
    queryKey: ["live-overview-mat-users", matUserIds.join(",")],
    enabled: matUserIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("app_users")
        .select("id, full_name")
        .in("id", matUserIds);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const matMap = useMemo(() => Object.fromEntries(hpMaterials.map((m: any) => [m.id, m])), [hpMaterials]);
  const matUserMap = useMemo(() => Object.fromEntries(matUsers.map((u: any) => [u.id, u])), [matUsers]);
  const itemsByIssuance = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const it of matIssuanceItems) {
      (m[it.issuance_id] = m[it.issuance_id] || []).push(it);
    }
    return m;
  }, [matIssuanceItems]);



  // Restrict entries to processes of the selected department
  const processNames = useMemo(() => new Set(processes.map((p: any) => p.name)), [processes]);
  const filteredEntries = useMemo(
    () => entries.filter((e: any) => processNames.has(e.process_name)),
    [entries, processNames]
  );

  // KPIs
  const totalToday = filteredEntries.reduce((s: number, e: any) => s + Number(e.quantity || 0), 0);
  const totalLastHour = filteredEntries
    .filter((e: any) => e.hour_slot === checkHour)
    .reduce((s: number, e: any) => s + Number(e.quantity || 0), 0);
  const machineRunning = machines.filter((m: any) => m.current_status === "Running").length;
  const machineBreakdown = machines.filter((m: any) => m.current_status === "Breakdown").length;
  const machineIdleStopped = machines.filter((m: any) => m.current_status === "Idle" || m.current_status === "Stopped").length;

  // Group machines by status
  const groupedMachines = useMemo(() => {
    const map: Record<string, any[]> = {};
    machines.forEach((m: any) => {
      const s = parseBaseStatus(m.current_status || "Stopped");
      (map[s] = map[s] || []).push(m);
    });
    const ordered: { status: string; items: any[] }[] = [];
    STATUS_ORDER.forEach((s) => { if (map[s]?.length) ordered.push({ status: s, items: map[s] }); });
    Object.keys(map).forEach((s) => { if (!STATUS_ORDER.includes(s)) ordered.push({ status: s, items: map[s] }); });
    return ordered;
  }, [machines]);




  return (
    <div className="min-h-screen bg-background text-foreground p-3 sm:p-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <Activity className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">Live Production &amp; Machine Overview</h1>
            <p className="text-xs text-muted-foreground">{format(now, "EEEE, dd MMM yyyy — hh:mm:ss a")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
            <SelectTrigger className="w-44 sm:w-52"><SelectValue placeholder="All Departments" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map((d: any) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-40"
          />
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
        <KpiCard
          icon={<Factory className="h-5 w-5" />}
          label={isToday ? "Today's Total Production" : "Day Total Production"}
          value={totalToday.toLocaleString()}
          tone="sky"
          sub={isToday ? `Last Hr (${getHourLabel(checkHour)}): ${totalLastHour.toLocaleString()}` : undefined}
        />
        <KpiCard
          icon={<Clock className="h-5 w-5" />}
          label="Active Processes"
          value={processes.length.toString()}
          tone="violet"
          sub={selectedDeptName ? selectedDeptName : "All departments"}
        />
        <KpiCard
          icon={<Package className="h-5 w-5" />}
          label="Materials Received"
          value={matIssuanceItems.reduce((s: number, it: any) => s + Number(it.issued_qty || 0), 0).toLocaleString()}
          tone="amber"
          sub={`${matIssuances.length} issuance${matIssuances.length === 1 ? "" : "s"}`}
        />
        <KpiCard
          icon={<ClipboardList className="h-5 w-5" />}
          label="Job Orders Qty"
          value={jobOrderItems.reduce((s: number, it: any) => s + Number(it.quantity || 0), 0).toLocaleString()}
          tone="indigo"
          sub={`${jobOrders.length} job order${jobOrders.length === 1 ? "" : "s"}`}
        />

        <KpiCard
          icon={<Monitor className="h-5 w-5" />}
          label="Machines Running"
          value={`${machineRunning} / ${machines.length}`}
          tone="emerald"
          sub={`${machineIdleStopped} idle/stopped`}
        />
        <KpiCard
          icon={<AlertTriangle className="h-5 w-5" />}
          label="Machines in Breakdown"
          value={machineBreakdown.toString()}
          tone={machineBreakdown > 0 ? "rose" : "muted"}
          pulse={machineBreakdown > 0}
        />
      </div>

      {/* Job Orders for selected date */}
      <div className="mb-4 rounded-xl border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <ClipboardList className="h-5 w-5 text-primary" />
          <h2 className="font-bold text-lg">{isToday ? "Today's Job Orders" : "Job Orders"}</h2>
          {selectedDeptName && <span className="text-xs text-muted-foreground">— {selectedDeptName}</span>}
          <span className="ml-auto text-xs px-2 py-1 rounded bg-muted">Total: <b>{jobOrders.length}</b></span>
        </div>
        {jobOrders.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground border border-dashed rounded-lg">
            <ClipboardList className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No job orders for {isToday ? "today" : "this date"}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {jobOrders.map((jo: any) => {
              const items = itemsByJobOrder[jo.id] || [];
              const totalQty = items.reduce((s: number, it: any) => s + Number(it.quantity || 0), 0);
              const series = joSeriesMap[jo.id];
              const isClosed = jo.status === "Closed";
              return (
                <div key={jo.id} className={cn("rounded-lg p-3 border-2", isClosed ? "border-muted bg-muted/30" : "border-primary/60 bg-primary/5")}>
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
                            {detail && <span className="text-muted-foreground"> — {detail}</span>}
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

      {/* Materials Received */}
      <div className="mb-4 rounded-xl border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Package className="h-5 w-5 text-primary" />
          <h2 className="font-bold text-lg">Materials Received</h2>
          {selectedDeptName && <span className="text-xs text-muted-foreground">— {selectedDeptName}</span>}
          <span className="ml-auto text-xs px-2 py-1 rounded bg-muted">Total: <b>{matIssuances.length}</b></span>
        </div>
        {matIssuances.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground border border-dashed rounded-lg">
            <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No materials received for {isToday ? "today" : "this date"}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {matIssuances.map((iss: any) => {
              const items = itemsByIssuance[iss.id] || [];
              const totalIssued = items.reduce((s: number, it: any) => s + Number(it.issued_qty || 0), 0);
              const issuedByName = matUserMap[iss.issued_by]?.full_name || "—";
              const isCarryForward = iss.notes === "Last Day Balance Reissuance";
              return (
                <div
                  key={iss.id}
                  className={cn(
                    "rounded-lg p-3 border-2",
                    isCarryForward
                      ? "border-yellow-500/60 bg-yellow-500/10"
                      : "border-primary/40 bg-primary/5"
                  )}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs text-muted-foreground">Issued by</span>
                    <span className="text-xs font-semibold truncate">{issuedByName}</span>
                  </div>
                  {isCarryForward && (
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 mb-1 border-yellow-500/60 text-yellow-700 dark:text-yellow-400">
                      Carry Forward
                    </Badge>
                  )}
                  {selectedDepartment === "all" && (
                    <p className="text-xs text-muted-foreground mb-1">{deptMap[iss.department_id]?.name || "—"}</p>
                  )}
                  <div className="space-y-1 max-h-40 overflow-y-auto mt-2">
                    {items.map((it: any) => {
                      const mat = matMap[it.material_id];
                      const recv = matUserMap[it.receiver_user_id]?.full_name || "—";
                      const statusTone =
                        it.status === "Closed" ? "outline" :
                        it.status === "Accepted" ? "default" :
                        "secondary";
                      return (
                        <div key={it.id} className="text-xs border-b border-border/40 pb-1 last:border-0">
                          <div className="flex justify-between gap-2">
                            <span className="font-semibold truncate">{mat?.name || "—"}</span>
                            <span className="font-bold whitespace-nowrap">{Number(it.issued_qty).toLocaleString()} {mat?.unit || ""}</span>
                          </div>
                          <div className="flex justify-between items-center gap-2 mt-0.5">
                            <span className="text-muted-foreground truncate">→ {recv}</span>
                            <Badge variant={statusTone as any} className="text-[9px] px-1 py-0">{it.status || "Issued"}</Badge>
                          </div>
                          {Number(it.consumed_qty || 0) > 0 && (
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              Consumed: {Number(it.consumed_qty).toLocaleString()} {mat?.unit || ""}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {items.length === 0 && <p className="text-xs text-muted-foreground italic">No items</p>}
                  </div>
                  {items.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border flex justify-between text-xs">
                      <span className="text-muted-foreground">Total issued</span>
                      <span className="font-bold">{totalIssued.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Split panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Hourly Production panel */}
        <div className="rounded-xl border bg-card">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              <h2 className="font-bold text-lg">Hourly Production</h2>
            </div>
            <div className="text-xs text-muted-foreground">{processes.length} processes</div>
          </div>
          <div className="p-3 max-h-[70vh] overflow-y-auto">
            {processes.length === 0 ? (
              <EmptyBlock icon={<Clock className="h-10 w-10 opacity-30" />} title="No processes" subtitle="Configure hourly-tracked processes" />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {processes.map((p: any) => {
                  const procEntries = filteredEntries.filter((e: any) => e.process_name === p.name);
                  const todayTotal = procEntries.reduce((s: number, e: any) => s + Number(e.quantity || 0), 0);
                  const lastHourTotal = procEntries
                    .filter((e: any) => e.hour_slot === checkHour)
                    .reduce((s: number, e: any) => s + Number(e.quantity || 0), 0);
                  const completedHourEntries = procEntries.filter((e: any) => e.hour_slot < currentHour);
                  const noToday = isToday && completedHourEntries.length === 0 && checkHour >= 6;
                  const noLastHour = isToday && checkHour >= 6 && lastHourTotal === 0 && !noToday;

                  const procLosses = losses.filter((l: any) => l.process_name === p.name);
                  const dayLostMinutes = procLosses.reduce((s: number, l: any) => s + Number(l.lost_minutes || 0), 0);
                  const dayLostQuantity = procLosses.reduce((s: number, l: any) => s + Number(l.lost_quantity || 0), 0);
                  const hasDayLoss = !noToday && (dayLostMinutes > 0 || dayLostQuantity > 0);
                  const lastHourLosses = procLosses.filter((l: any) => l.hour_slot === checkHour);
                  const lostMinutes = lastHourLosses.reduce((s: number, l: any) => s + Number(l.lost_minutes || 0), 0);
                  const lostQuantity = lastHourLosses.reduce((s: number, l: any) => s + Number(l.lost_quantity || 0), 0);
                  const hasLoss = isToday && !noToday && (lostMinutes > 0 || lostQuantity > 0);

                  // Effective target/hr: daily override → master default
                  const dailyT = dailyTargetMap.get(p.id);
                  const masterT = masterTargetMap.get(p.name) || 0;
                  const target = dailyT ?? masterT;
                  const isCustomTarget = dailyT !== undefined;
                  const hasTarget = target > 0;
                  // hours elapsed = distinct hour slots with any entry for this process
                  const hoursElapsed = new Set(procEntries.map((e: any) => e.hour_slot)).size;
                  const expected = hasTarget ? target * hoursElapsed : 0;
                  const dayPct = expected > 0 ? Math.round((todayTotal / expected) * 100) : null;
                  const lastHourPct = hasTarget ? Math.round((lastHourTotal / target) * 100) : null;
                  const pctTone = (pct: number | null) =>
                    pct === null ? "bg-muted text-muted-foreground" :
                    pct >= 100 ? "bg-green-500/15 text-green-700 dark:text-green-400 border border-green-500/40" :
                    pct >= 80 ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/40" :
                    "bg-destructive/15 text-destructive border border-destructive/40";

                  let cls = "rounded-lg p-3 border-2 transition-all ";
                  if (noToday) cls += "border-destructive bg-destructive/10 animate-pulse";
                  else if (noLastHour) cls += "border-yellow-500 bg-yellow-500/10";
                  else cls += "border-primary/40 bg-primary/5";

                  return (
                    <div key={p.id} className={cls}>
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="font-semibold text-sm truncate" title={p.name}>{p.name}</h3>
                        {p.code && <span className="text-[10px] font-mono text-muted-foreground">{p.code}</span>}
                      </div>
                      {/* Target/Hr line */}
                      <div className="flex items-center justify-center gap-1.5 mb-1.5">
                        {hasTarget ? (
                          <>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold">
                              Target: {target}/hr
                            </span>
                            <span className={cn(
                              "text-[9px] px-1 py-0.5 rounded uppercase tracking-wide",
                              isCustomTarget ? "bg-blue-500/15 text-blue-700 dark:text-blue-400" : "bg-muted text-muted-foreground"
                            )}>
                              {isCustomTarget ? "Custom" : "Default"}
                            </span>
                          </>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">No target</span>
                        )}
                      </div>
                      {noToday ? (
                        <div className="text-center py-2"><p className="text-base font-bold text-destructive">NO ENTRIES</p></div>
                      ) : (
                        <>
                          <p className="text-3xl font-bold text-center">{todayTotal.toLocaleString()}</p>
                          <div className="flex items-center justify-center gap-1.5">
                            <p className="text-[10px] text-muted-foreground">Day total</p>
                            {hasTarget && expected > 0 && (
                              <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-semibold", pctTone(dayPct))}>
                                {todayTotal.toLocaleString()} / {expected.toLocaleString()} ({dayPct}%)
                              </span>
                            )}
                          </div>
                          {isToday && (
                            <div className="mt-1 flex justify-center">
                              <div className="text-center">
                                <p className={cn("font-semibold text-sm", noLastHour ? "text-yellow-600 dark:text-yellow-400" : "")}>
                                  {lastHourTotal}
                                </p>
                                <div className="flex items-center justify-center gap-1.5">
                                  <p className="text-[10px] text-muted-foreground">Last hour</p>
                                  {hasTarget && (
                                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-semibold", pctTone(lastHourPct))}>
                                      {lastHourTotal} / {target} ({lastHourPct}%)
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                          {hasDayLoss && (
                            <div className="mt-2 flex justify-center gap-3 rounded-md bg-rose-500/10 border border-rose-500/40 py-1 px-2">
                              <div className="text-center">
                                <p className="text-sm font-bold text-rose-600 dark:text-rose-400">{dayLostMinutes}m</p>
                                <p className="text-[9px] text-muted-foreground">Day lost min</p>
                              </div>
                              <div className="w-px bg-rose-500/30" />
                              <div className="text-center">
                                <p className="text-sm font-bold text-rose-600 dark:text-rose-400">{dayLostQuantity}</p>
                                <p className="text-[9px] text-muted-foreground">Day lost qty</p>
                              </div>
                            </div>
                          )}
                          {hasLoss && (
                            <div className="mt-2 flex justify-center gap-3 rounded-md bg-amber-500/10 border border-amber-500/40 py-1 px-2">
                              <div className="text-center">
                                <p className="text-sm font-bold text-amber-600 dark:text-amber-400">{lostMinutes}m</p>
                                <p className="text-[9px] text-muted-foreground">Lost min (last hr)</p>
                              </div>
                              <div className="w-px bg-amber-500/30" />
                              <div className="text-center">
                                <p className="text-sm font-bold text-amber-600 dark:text-amber-400">{lostQuantity}</p>
                                <p className="text-[9px] text-muted-foreground">Lost qty (last hr)</p>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Machine Status panel */}
        <div className="rounded-xl border bg-card">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="flex items-center gap-2">
              <Monitor className="h-5 w-5 text-primary" />
              <h2 className="font-bold text-lg">Machine Status</h2>
              {selectedDeptName && <span className="text-xs text-muted-foreground">— {selectedDeptName}</span>}
            </div>
            <div className="text-xs text-muted-foreground">{machines.length} machines</div>
          </div>
          <div className="p-3 max-h-[70vh] overflow-y-auto space-y-4">
            {machines.length === 0 ? (
              <EmptyBlock icon={<Monitor className="h-10 w-10 opacity-30" />} title="No machines" subtitle={selectedDeptName ? `None in ${selectedDeptName}` : "None configured"} />
            ) : (
              groupedMachines.map((group) => {
                const style = machineStyle(group.status);
                return (
                  <div key={group.status}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={cn("inline-block w-2 h-2 rounded-full", style.border.replace("border-", "bg-"))} />
                      <h3 className={cn("text-sm font-bold uppercase tracking-wider", style.text)}>{group.status}</h3>
                      <span className="text-xs text-muted-foreground">({group.items.length})</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {group.items.map((m: any) => {
                        const since = m.current_status_since
                          ? formatDistanceToNow(new Date(m.current_status_since), { addSuffix: false })
                          : "";
                        return (
                          <div
                            key={m.id}
                            className={cn(
                              "rounded-lg border-2 p-2",
                              style.bg, style.border,
                              style.pulse && "animate-pulse"
                            )}
                          >
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-[10px] font-mono text-muted-foreground truncate">{m.code}</span>
                            </div>
                            <div className="text-xs font-semibold leading-tight truncate" title={m.name}>{m.name}</div>
                            <div className={cn("text-[11px] font-bold uppercase tracking-wide mt-1", style.text)}>{m.current_status}</div>
                            <div className="text-[9px] text-muted-foreground">{since}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>


      <div className="fixed bottom-4 right-4 flex items-center gap-2 text-xs text-muted-foreground bg-muted rounded-full px-3 py-1 shadow">
        <RefreshCw className="h-3 w-3 animate-spin" /> Auto-refresh: 15s
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value, sub, tone = "default", pulse }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "success" | "danger" | "muted" | "sky" | "emerald" | "amber" | "violet" | "rose" | "indigo";
  pulse?: boolean;
}) {
  const toneCls =
    tone === "success" ? "border-green-500/40 bg-green-500/10" :
    tone === "danger" ? "border-destructive bg-destructive/10" :
    tone === "muted" ? "border-border bg-muted/30" :
    tone === "sky" ? "border-sky-500/40 bg-sky-500/10" :
    tone === "emerald" ? "border-emerald-500/40 bg-emerald-500/10" :
    tone === "amber" ? "border-amber-500/40 bg-amber-500/10" :
    tone === "violet" ? "border-violet-500/40 bg-violet-500/10" :
    tone === "rose" ? "border-rose-500/40 bg-rose-500/10" :
    tone === "indigo" ? "border-indigo-500/40 bg-indigo-500/10" :
    "border-border bg-card";
  const valueCls =
    tone === "success" ? "text-green-600 dark:text-green-400" :
    tone === "danger" ? "text-destructive" :
    tone === "sky" ? "text-sky-600 dark:text-sky-400" :
    tone === "emerald" ? "text-emerald-600 dark:text-emerald-400" :
    tone === "amber" ? "text-amber-600 dark:text-amber-400" :
    tone === "violet" ? "text-violet-600 dark:text-violet-400" :
    tone === "rose" ? "text-rose-600 dark:text-rose-400" :
    tone === "indigo" ? "text-indigo-600 dark:text-indigo-400" :
    "text-foreground";
  const iconCls =
    tone === "sky" ? "text-sky-600 dark:text-sky-400" :
    tone === "emerald" ? "text-emerald-600 dark:text-emerald-400" :
    tone === "amber" ? "text-amber-600 dark:text-amber-400" :
    tone === "violet" ? "text-violet-600 dark:text-violet-400" :
    tone === "rose" ? "text-rose-600 dark:text-rose-400" :
    tone === "indigo" ? "text-indigo-600 dark:text-indigo-400" :
    tone === "success" ? "text-green-600 dark:text-green-400" :
    tone === "danger" ? "text-destructive" :
    "text-muted-foreground";
  return (
    <div className={cn("rounded-xl border-2 p-3 sm:p-4", toneCls, pulse && "animate-pulse")}>
      <div className={cn("flex items-center gap-2 text-xs mb-1", iconCls)}>
        {icon}
        <span className="uppercase tracking-wider truncate font-semibold">{label}</span>
      </div>
      <div className={cn("text-2xl sm:text-3xl font-bold", valueCls)}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1 truncate">{sub}</div>}
    </div>
  );
}

function EmptyBlock({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="text-center py-10 text-muted-foreground border border-dashed rounded-lg">
      <div className="flex justify-center mb-2">{icon}</div>
      <p className="font-semibold">{title}</p>
      {subtitle && <p className="text-xs">{subtitle}</p>}
    </div>
  );
}
