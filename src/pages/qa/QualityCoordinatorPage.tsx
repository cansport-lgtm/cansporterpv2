import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/shared/PageHeader";
import { ShieldCheck, AlertTriangle, Target, RefreshCw } from "lucide-react";
import { format, startOfMonth, startOfWeek, eachDayOfInterval, parseISO, subDays } from "date-fns";
import { cn } from "@/lib/utils";
import ProductionRequirementsSection from "@/components/shared/ProductionRequirementsSection";
import MaterialReceivedSection from "@/components/shared/MaterialReceivedSection";
import { fetchStages, fetchThresholds, fetchEntriesAsOf, latestPerStage, statusFromUtil, fmtNum } from "@/pages/wip/wipShared";
import { Badge } from "@/components/ui/badge";
import { Workflow } from "lucide-react";
import { Link } from "react-router-dom";

const REFRESH_INTERVAL = 60_000;

function Kpi({ label, value, sub, accent }: { label: string; value: number | string; sub?: string; accent?: string }) {
  return (
    <div className={cn("rounded-lg border bg-card p-2 sm:p-3 min-w-0", accent)}>
      <div className="text-[10px] sm:text-xs text-muted-foreground truncate">{label}</div>
      <div className="text-base sm:text-lg font-semibold truncate">{value}</div>
      {sub && <div className="text-[10px] sm:text-[11px] text-muted-foreground mt-0.5 leading-tight break-words">{sub}</div>}
    </div>
  );
}

export default function QualityCoordinatorPage() {
  const today = format(new Date(), "yyyy-MM-dd");
  const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");

  const [fromDate, setFromDate] = useState<string>(monthStart);
  const [toDate, setToDate] = useState<string>(today);
  const [compliancePeriod, setCompliancePeriod] = useState<"today" | "yesterday" | "week" | "month">("today");

  // Lookups
  const { data: departments = [] } = useQuery({
    queryKey: ["qcoord-departments"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("production_departments")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as any[];
    },
  });
  const deptMap = useMemo(() => Object.fromEntries(departments.map((d: any) => [d.id, d.name])), [departments]);

  const { data: reasons = [] } = useQuery({
    queryKey: ["qcoord-reasons"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("rw_reasons").select("id, name");
      if (error) throw error;
      return (data || []) as any[];
    },
  });
  const reasonMap = useMemo(() => Object.fromEntries(reasons.map((r: any) => [r.id, r.name])), [reasons]);

  // ----- Section 2: Rejections / Wastages / Leakages -----
  const { data: rejections = [], refetch: refetchRej } = useQuery({
    queryKey: ["qcoord-rejections", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("rw_rejections")
        .select("id, entry_date, department_id, rejected_qty, reason_id, total_cost")
        .gte("entry_date", fromDate).lte("entry_date", toDate);
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  const { data: wastages = [], refetch: refetchWas } = useQuery({
    queryKey: ["qcoord-wastages", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("rw_wastages")
        .select("id, entry_date, department_id, wasted_qty, reason_id, total_cost")
        .gte("entry_date", fromDate).lte("entry_date", toDate);
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  const { data: leakages = [], refetch: refetchLeak } = useQuery({
    queryKey: ["qcoord-leakages", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("rw_leakages")
        .select("id, entry_date, department_id, leaked_qty, reason_id, total_cost")
        .gte("entry_date", fromDate).lte("entry_date", toDate);
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  const rwKpis = useMemo(() => {
    const sum = (arr: any[], key: string) => arr.reduce((s, x) => s + Number(x[key] || 0), 0);
    return {
      rejQty: sum(rejections, "rejected_qty"),
      rejCost: sum(rejections, "total_cost"),
      wasQty: sum(wastages, "wasted_qty"),
      wasCost: sum(wastages, "total_cost"),
      leakQty: sum(leakages, "leaked_qty"),
      leakCost: sum(leakages, "total_cost"),
      rejEntries: rejections.length,
      wasEntries: wastages.length,
      leakEntries: leakages.length,
    };
  }, [rejections, wastages, leakages]);

  const rwByDept = useMemo(() => {
    const buckets: Record<string, { rej: number; was: number; leak: number }> = {};
    rejections.forEach((r: any) => { (buckets[r.department_id] ||= { rej: 0, was: 0, leak: 0 }).rej += Number(r.rejected_qty || 0); });
    wastages.forEach((r: any) => { (buckets[r.department_id] ||= { rej: 0, was: 0, leak: 0 }).was += Number(r.wasted_qty || 0); });
    leakages.forEach((r: any) => { (buckets[r.department_id] ||= { rej: 0, was: 0, leak: 0 }).leak += Number(r.leaked_qty || 0); });
    return Object.entries(buckets).map(([deptId, v]) => ({
      deptId,
      deptName: deptMap[deptId] || "—",
      ...v,
      total: v.rej + v.was + v.leak,
    })).sort((a, b) => b.total - a.total);
  }, [rejections, wastages, leakages, deptMap]);

  const topReasons = useMemo(() => {
    const buckets: Record<string, number> = {};
    rejections.forEach((r: any) => { if (r.reason_id) buckets[r.reason_id] = (buckets[r.reason_id] || 0) + Number(r.rejected_qty || 0); });
    wastages.forEach((r: any) => { if (r.reason_id) buckets[r.reason_id] = (buckets[r.reason_id] || 0) + Number(r.wasted_qty || 0); });
    leakages.forEach((r: any) => { if (r.reason_id) buckets[r.reason_id] = (buckets[r.reason_id] || 0) + Number(r.leaked_qty || 0); });
    return Object.entries(buckets)
      .map(([id, qty]) => ({ name: reasonMap[id] || "—", qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
  }, [rejections, wastages, leakages, reasonMap]);

  // ----- Section 3: Quality Compliances -----
  const [complianceFromDate, setComplianceFromDate] = useState<string>(today);
  const [complianceToDate, setComplianceToDate] = useState<string>(today);

  const complianceRange = useMemo(() => ({
    from: complianceFromDate,
    to: complianceToDate,
  }), [complianceFromDate, complianceToDate]);

  const { data: processes = [] } = useQuery({
    queryKey: ["qcoord-processes"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("qa_processes")
        .select("id, name, department_id, is_active")
        .eq("is_active", true);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
  const processMap = useMemo(() => Object.fromEntries(processes.map((p: any) => [p.id, p])), [processes]);

  // Fetch ALL targets to derive both range targets and per-process latest (recurring fallback)
  const { data: allTargets = [], refetch: refetchTargets } = useQuery({
    queryKey: ["qcoord-all-targets"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("qa_inspection_targets")
        .select("id, target_date, process_id, target_count")
        .order("target_date", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  // Latest target per process (recurring fallback)
  const latestTargetByProcess = useMemo(() => {
    const m: Record<string, number> = {};
    allTargets.forEach((t: any) => {
      if (!(t.process_id in m)) m[t.process_id] = Number(t.target_count || 0);
    });
    return m;
  }, [allTargets]);

  // Explicit target rows keyed by `${process_id}::${target_date}`
  const explicitTargetMap = useMemo(() => {
    const m: Record<string, number> = {};
    allTargets.forEach((t: any) => {
      m[`${t.process_id}::${t.target_date}`] = Number(t.target_count || 0);
    });
    return m;
  }, [allTargets]);

  const { data: inspections = [], refetch: refetchInsp } = useQuery({
    queryKey: ["qcoord-inspections", complianceRange.from, complianceRange.to],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("qa_inspections")
        .select("id, inspection_date, process_id, department_id")
        .gte("inspection_date", complianceRange.from).lte("inspection_date", complianceRange.to);
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  const complianceByDept = useMemo(() => {
    const buckets: Record<string, { target: number; actual: number }> = {};

    // Per-day, per-active-process expected target with recurring fallback
    const days = eachDayOfInterval({
      start: parseISO(complianceRange.from),
      end: parseISO(complianceRange.to),
    });
    days.forEach((d) => {
      const dStr = format(d, "yyyy-MM-dd");
      processes.forEach((proc: any) => {
        const deptId = proc.department_id;
        if (!deptId) return;
        const explicit = explicitTargetMap[`${proc.id}::${dStr}`];
        const tgt = explicit !== undefined ? explicit : (latestTargetByProcess[proc.id] ?? 0);
        if (tgt <= 0) return;
        (buckets[deptId] ||= { target: 0, actual: 0 }).target += tgt;
      });
    });

    inspections.forEach((ins: any) => {
      const deptId = ins.department_id || processMap[ins.process_id]?.department_id;
      if (!deptId) return;
      (buckets[deptId] ||= { target: 0, actual: 0 }).actual += 1;
    });
    return Object.entries(buckets).map(([deptId, v]) => {
      const pct = v.target > 0 ? Math.round((v.actual / v.target) * 100) : (v.actual > 0 ? 100 : 0);
      return {
        deptId,
        deptName: deptMap[deptId] || "—",
        target: v.target,
        actual: v.actual,
        pct,
      };
    }).sort((a, b) => a.deptName.localeCompare(b.deptName));
  }, [processes, explicitTargetMap, latestTargetByProcess, inspections, processMap, deptMap, complianceRange]);

  const complianceTotals = useMemo(() => {
    const target = complianceByDept.reduce((s, r) => s + r.target, 0);
    const actual = complianceByDept.reduce((s, r) => s + r.actual, 0);
    const pct = target > 0 ? Math.round((actual / target) * 100) : (actual > 0 ? 100 : 0);
    return { target, actual, pct };
  }, [complianceByDept]);

  const pctBadge = (pct: number) => {
    const cls = pct >= 100 ? "bg-green-100 text-green-800 border-green-200"
      : pct >= 70 ? "bg-amber-100 text-amber-800 border-amber-200"
      : "bg-red-100 text-red-800 border-red-200";
    return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border", cls)}>{pct}%</span>;
  };

  const refreshAll = () => {
    refetchRej(); refetchWas(); refetchLeak(); refetchTargets(); refetchInsp();
  };

  return (
    <div className="p-2 sm:p-4 space-y-3 sm:space-y-4">
      <PageHeader
        title="Quality Coordinator"
        description="Live quality command center — production demand, leakage/rejection/wastage status and compliance"
        icon={ShieldCheck}
      />

      {/* Date filter (drives section 1 + 2) */}
      <Card>
        <CardContent className="p-2 sm:p-3 grid grid-cols-2 sm:flex sm:flex-wrap sm:items-end gap-2 sm:gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] sm:text-xs text-muted-foreground">From</label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-full sm:w-40 h-9" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] sm:text-xs text-muted-foreground">To</label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-full sm:w-40 h-9" />
          </div>
          <div className="col-span-2 sm:ml-auto">
            <Button variant="outline" onClick={refreshAll} size="sm" className="w-full sm:w-auto">
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <WIPMonitorSection today={today} />

      {/* Section 1: Production Requirements (shared with Production Coordinator) */}
      <ProductionRequirementsSection fromDate={fromDate} toDate={toDate} permissionModule="qa" />

      {/* Material Received (from Hourly Production module) */}
      <MaterialReceivedSection />

      {/* Section 2: Leakage, Rejection & Wastage Status */}
      <Card>
        <CardHeader className="pb-2 px-3 sm:px-6 pt-3 sm:pt-6">
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
            <span className="leading-tight">Leakage, Rejection &amp; Wastage Status</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 px-3 sm:px-6 pb-3 sm:pb-6">
          <p className="text-[11px] sm:text-xs text-muted-foreground">Summary from the Rejections &amp; Wastages module for the selected date range.</p>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Kpi
              label="Rejection Qty"
              value={rwKpis.rejQty.toLocaleString()}
              sub={`${rwKpis.rejEntries} entries · Rs. ${Math.round(rwKpis.rejCost).toLocaleString()}`}
            />
            <Kpi
              label="Wastage Qty"
              value={rwKpis.wasQty.toLocaleString()}
              sub={`${rwKpis.wasEntries} entries · Rs. ${Math.round(rwKpis.wasCost).toLocaleString()}`}
            />
            <Kpi
              label="Leakage Qty"
              value={rwKpis.leakQty.toLocaleString()}
              sub={`${rwKpis.leakEntries} entries · Rs. ${Math.round(rwKpis.leakCost).toLocaleString()}`}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
            <div className="lg:col-span-2 rounded-lg border overflow-hidden">
              {/* Desktop table */}
              <div className="hidden sm:block overflow-x-auto">
                <Table className="min-w-[480px] text-xs sm:text-sm">
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="h-9">Department</TableHead>
                      <TableHead className="text-right h-9">Rejection</TableHead>
                      <TableHead className="text-right h-9">Wastage</TableHead>
                      <TableHead className="text-right h-9">Leakage</TableHead>
                      <TableHead className="text-right h-9">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rwByDept.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No data in range</TableCell></TableRow>
                    ) : rwByDept.slice(0, 8).map((r) => (
                      <TableRow key={r.deptId}>
                        <TableCell className="font-medium py-2">{r.deptName}</TableCell>
                        <TableCell className="text-right py-2">{r.rej.toLocaleString()}</TableCell>
                        <TableCell className="text-right py-2">{r.was.toLocaleString()}</TableCell>
                        <TableCell className="text-right py-2">{r.leak.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-semibold py-2">{r.total.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {/* Mobile cards */}
              <div className="sm:hidden divide-y">
                {rwByDept.length === 0 ? (
                  <div className="text-center text-muted-foreground py-6 text-sm">No data in range</div>
                ) : rwByDept.slice(0, 8).map((r) => (
                  <div key={r.deptId} className="p-3">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="font-medium text-sm truncate">{r.deptName}</span>
                      <span className="text-sm font-semibold shrink-0">{r.total.toLocaleString()}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1 text-[11px]">
                      <div className="rounded bg-red-50 dark:bg-red-950/30 px-1.5 py-1">
                        <div className="text-muted-foreground">Rej</div>
                        <div className="font-semibold">{r.rej.toLocaleString()}</div>
                      </div>
                      <div className="rounded bg-amber-50 dark:bg-amber-950/30 px-1.5 py-1">
                        <div className="text-muted-foreground">Was</div>
                        <div className="font-semibold">{r.was.toLocaleString()}</div>
                      </div>
                      <div className="rounded bg-blue-50 dark:bg-blue-950/30 px-1.5 py-1">
                        <div className="text-muted-foreground">Leak</div>
                        <div className="font-semibold">{r.leak.toLocaleString()}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border overflow-hidden">
              <div className="bg-muted/50 px-3 py-2 text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-muted-foreground">Top Reasons</div>
              <div className="divide-y">
                {topReasons.length === 0 ? (
                  <div className="text-center text-muted-foreground py-6 text-sm">No data</div>
                ) : topReasons.map((r, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 text-xs sm:text-sm gap-2">
                    <span className="truncate">{r.name}</span>
                    <span className="font-semibold shrink-0">{r.qty.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </CardContent>
      </Card>

      {/* Section 3: Quality Compliances */}
      <Card>
        <CardHeader className="pb-2 px-3 sm:px-6 pt-3 sm:pt-6">
          <CardTitle className="text-base sm:text-lg space-y-2">
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-green-600 shrink-0" />
              <span className="leading-tight">Quality Compliances — Inspection Targets by Department</span>
            </div>
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-end gap-2 font-normal">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">From</label>
                <Input
                  type="date"
                  value={complianceFromDate}
                  onChange={(e) => setComplianceFromDate(e.target.value)}
                  className="w-full sm:w-36 h-9"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">To</label>
                <Input
                  type="date"
                  value={complianceToDate}
                  onChange={(e) => setComplianceToDate(e.target.value)}
                  className="w-full sm:w-36 h-9"
                />
              </div>
              <Select
                value={compliancePeriod}
                onValueChange={(v) => {
                  setCompliancePeriod(v as any);
                  const now = new Date();
                  if (v === "today") {
                    setComplianceFromDate(today);
                    setComplianceToDate(today);
                  } else if (v === "yesterday") {
                    const yest = format(subDays(now, 1), "yyyy-MM-dd");
                    setComplianceFromDate(yest);
                    setComplianceToDate(yest);
                  } else if (v === "week") {
                    setComplianceFromDate(format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"));
                    setComplianceToDate(today);
                  } else if (v === "month") {
                    setComplianceFromDate(format(startOfMonth(now), "yyyy-MM-dd"));
                    setComplianceToDate(today);
                  }
                }}
              >
                <SelectTrigger className="col-span-2 sm:w-36 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="yesterday">Yesterday</SelectItem>
                  <SelectItem value="week">This Week</SelectItem>
                  <SelectItem value="month">This Month</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 px-3 sm:px-6 pb-3 sm:pb-6">
          <p className="text-[11px] sm:text-xs text-muted-foreground">{complianceRange.from} → {complianceRange.to}</p>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Kpi label="Total Target" value={complianceTotals.target.toLocaleString()} />
            <Kpi label="Total Actual" value={complianceTotals.actual.toLocaleString()} />
            <Kpi label="Compliance" value={`${complianceTotals.pct}%`} />
          </div>
          <div className="rounded-lg border overflow-hidden">
            <div className="hidden sm:block overflow-x-auto">
              <Table className="min-w-[420px] text-xs sm:text-sm">
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="h-9">Department</TableHead>
                    <TableHead className="text-right h-9">Target</TableHead>
                    <TableHead className="text-right h-9">Actual</TableHead>
                    <TableHead className="text-right h-9">Compliance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {complianceByDept.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No targets or inspections in range</TableCell></TableRow>
                  ) : complianceByDept.map((r) => (
                    <TableRow key={r.deptId}>
                      <TableCell className="font-medium py-2">{r.deptName}</TableCell>
                      <TableCell className="text-right py-2">{r.target.toLocaleString()}</TableCell>
                      <TableCell className="text-right py-2">{r.actual.toLocaleString()}</TableCell>
                      <TableCell className="text-right py-2">{pctBadge(r.pct)}</TableCell>
                    </TableRow>
                  ))}
                  {complianceByDept.length > 0 && (
                    <TableRow className="bg-muted/30 font-semibold">
                      <TableCell className="py-2">Total</TableCell>
                      <TableCell className="text-right py-2">{complianceTotals.target.toLocaleString()}</TableCell>
                      <TableCell className="text-right py-2">{complianceTotals.actual.toLocaleString()}</TableCell>
                      <TableCell className="text-right py-2">{pctBadge(complianceTotals.pct)}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="sm:hidden divide-y">
              {complianceByDept.length === 0 ? (
                <div className="text-center text-muted-foreground py-6 text-sm">No targets or inspections in range</div>
              ) : complianceByDept.map((r) => (
                <div key={r.deptId} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm truncate">{r.deptName}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.actual.toLocaleString()} / {r.target.toLocaleString()}
                    </div>
                  </div>
                  <div className="shrink-0">{pctBadge(r.pct)}</div>
                </div>
              ))}
              {complianceByDept.length > 0 && (
                <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/30 font-semibold">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">Total</div>
                    <div className="text-[11px] text-muted-foreground font-normal">
                      {complianceTotals.actual.toLocaleString()} / {complianceTotals.target.toLocaleString()}
                    </div>
                  </div>
                  <div className="shrink-0">{pctBadge(complianceTotals.pct)}</div>
                </div>
              )}
            </div>
          </div>

        </CardContent>
      </Card>
    </div>
  );
}

function WIPMonitorSection({ today }: { today: string }) {
  const { data: stages = [] } = useQuery({ queryKey: ["qcoord-wip-stages"], queryFn: () => fetchStages(true), refetchInterval: REFRESH_INTERVAL });
  const { data: thresholds = [] } = useQuery({ queryKey: ["qcoord-wip-thresholds"], queryFn: fetchThresholds, refetchInterval: REFRESH_INTERVAL });
  const { data: entries = [], refetch } = useQuery({ queryKey: ["qcoord-wip-entries", today], queryFn: () => fetchEntriesAsOf(today), refetchInterval: REFRESH_INTERVAL });

  const thresholdMap = useMemo(() => new Map(thresholds.map((t: any) => [t.stage_id, t])), [thresholds]);
  const latestMap = useMemo(() => latestPerStage(entries), [entries]);

  const rows = useMemo(() => stages.map((s: any) => {
    const latest = latestMap.get(s.id);
    const wip = latest ? Number(latest.quantity) : 0;
    const th: any = thresholdMap.get(s.id);
    const threshold = th ? Number(th.max_threshold) : 0;
    const unit = th?.unit || s.unit || "dozens";
    const util = threshold > 0 ? (wip / threshold) * 100 : 0;
    const st = statusFromUtil(util);
    return { s, latest, wip, threshold, unit, util, st, hasThreshold: !!th, hasEntry: !!latest };
  }), [stages, latestMap, thresholdMap]);

  const bottlenecks = rows.filter(r => r.hasThreshold && r.util > 100).length;
  const warnings = rows.filter(r => r.hasThreshold && r.util >= 75 && r.util <= 100).length;

  const latestEntryAt = useMemo(() => {
    if (!entries.length) return null;
    const e: any = entries[0];
    return new Date(`${e.entry_date}T${(e.entry_time || "00:00:00").slice(0, 8)}`);
  }, [entries]);
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const minutesSinceLast = latestEntryAt ? Math.floor((nowTick - latestEntryAt.getTime()) / 60_000) : null;
  const isStale = minutesSinceLast === null || minutesSinceLast > 120;

  return (
    <Card className="rounded-xl">
      <CardHeader className="px-3 sm:px-6 pt-3 sm:pt-4 pb-2 space-y-2">
        <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
          <Workflow className="h-4 w-4 text-amber-500 shrink-0" />
          <span className="leading-tight">WIP Monitor</span>
        </CardTitle>
        <p className="text-sm sm:text-base font-bold text-foreground">Stock Hold Status</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="text-amber-600 text-[10px] sm:text-xs">Warning: {warnings}</Badge>
          <Badge variant="outline" className="text-red-600 text-[10px] sm:text-xs">Bottleneck: {bottlenecks}</Badge>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => refetch()}><RefreshCw className="h-3 w-3 mr-1" />Refresh</Button>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" asChild><Link to="/wip/dashboard">Open</Link></Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
        <p className="text-[11px] sm:text-xs text-muted-foreground mb-2">Latest stock entries as of {today}</p>
        <div className="rounded-lg border overflow-hidden">
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <Table className="min-w-[560px] text-xs sm:text-sm">
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="h-9 w-10">#</TableHead>
                  <TableHead className="h-9">Stage</TableHead>
                  <TableHead className="text-right h-9">Current WIP</TableHead>
                  <TableHead className="text-right h-9">Threshold</TableHead>
                  <TableHead className="text-right h-9">Utilisation</TableHead>
                  <TableHead className="h-9">Status</TableHead>
                  <TableHead className="h-9">Last Entry</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No WIP stages configured</TableCell></TableRow>
                ) : rows.map(r => (
                  <TableRow key={r.s.id}>
                    <TableCell className={cn("py-2", r.st.label === "Bottleneck" && "font-bold text-red-600")}>{r.s.sequence_order}</TableCell>
                    <TableCell className={cn("font-medium py-2", r.st.label === "Bottleneck" && "font-bold text-red-600")}>{r.s.name}</TableCell>
                    <TableCell className={cn("text-right py-2", r.st.label === "Bottleneck" && "font-bold text-red-600")}>{r.hasEntry ? `${fmtNum(r.wip)} ${r.unit}` : "—"}</TableCell>
                    <TableCell className={cn("text-right py-2", r.st.label === "Bottleneck" && "font-bold text-red-600")}>{r.hasThreshold ? `${fmtNum(r.threshold)} ${r.unit}` : "—"}</TableCell>
                    <TableCell className={cn("text-right py-2", r.st.label === "Bottleneck" && "font-bold text-red-600")}>{r.hasThreshold ? `${r.util.toFixed(0)}%` : "—"}</TableCell>
                    <TableCell className={cn("py-2", r.st.label === "Bottleneck" && "font-bold text-red-600")}>
                      {r.hasThreshold ? (
                        <Badge variant="outline" className={r.st.color}>{r.st.label}</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">No threshold</Badge>
                      )}
                    </TableCell>
                    <TableCell className={cn("py-2 text-muted-foreground", r.st.label === "Bottleneck" && "font-bold text-red-600")}>
                      {r.latest ? `${r.latest.entry_date} ${r.latest.entry_time?.slice(0,5)}` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {/* Mobile cards */}
          <div className="sm:hidden divide-y">
            {rows.length === 0 ? (
              <div className="text-center text-muted-foreground py-6 text-sm">No WIP stages configured</div>
            ) : rows.map(r => (
              <div key={r.s.id} className={cn("p-3 space-y-1.5", r.st.label === "Bottleneck" && "bg-red-50")}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-sm truncate">
                    <span className={cn("mr-1", r.st.label === "Bottleneck" ? "font-bold text-red-600" : "text-muted-foreground")}>{r.s.sequence_order}.</span>
                    <span className={cn(r.st.label === "Bottleneck" && "font-bold text-red-600")}>{r.s.name}</span>
                  </div>
                  {r.hasThreshold ? (
                    <Badge variant="outline" className={cn(r.st.color, "text-[10px] shrink-0")}>{r.st.label}</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground text-[10px] shrink-0">No threshold</Badge>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                  <div className="rounded bg-muted/40 px-1.5 py-1">
                    <div className="text-muted-foreground">WIP</div>
                    <div className={cn("font-semibold truncate", r.st.label === "Bottleneck" && "font-bold text-red-600")}>{r.hasEntry ? `${fmtNum(r.wip)}` : "—"}</div>
                  </div>
                  <div className="rounded bg-muted/40 px-1.5 py-1">
                    <div className="text-muted-foreground">Threshold</div>
                    <div className={cn("font-semibold truncate", r.st.label === "Bottleneck" && "font-bold text-red-600")}>{r.hasThreshold ? `${fmtNum(r.threshold)}` : "—"}</div>
                  </div>
                  <div className="rounded bg-muted/40 px-1.5 py-1">
                    <div className="text-muted-foreground">Util.</div>
                    <div className={cn("font-semibold", r.st.label === "Bottleneck" && "font-bold text-red-600")}>{r.hasThreshold ? `${r.util.toFixed(0)}%` : "—"}</div>
                  </div>
                </div>
                <div className={cn("text-[10px] text-muted-foreground", r.st.label === "Bottleneck" && "font-bold text-red-600")}>
                  {r.unit} · {r.latest ? `${r.latest.entry_date} ${r.latest.entry_time?.slice(0,5)}` : "no entry"}
                </div>
              </div>
            ))}
          </div>
        </div>
        {isStale && (
          <div className="mt-3 flex items-center gap-2 rounded-md border-2 border-red-500 bg-red-50 px-3 py-2 animate-pulse">
            <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
            <span className="text-xs sm:text-sm font-bold text-red-600">
              ⚠ No WIP data posted in last 2 hours
              {minutesSinceLast !== null
                ? ` — last entry ${minutesSinceLast >= 60 ? `${Math.floor(minutesSinceLast / 60)}h ${minutesSinceLast % 60}m` : `${minutesSinceLast}m`} ago`
                : " — no entries today"}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
