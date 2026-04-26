import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import {
  CalendarIcon,
  Users,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronDown,
  ChevronRight,
  Printer,
  Factory,
  ClipboardList,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface TargetEntry {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  department_name: string;
  department_id: string;
  process_name: string;
  shift: string;
  target_quantity: number;
  todays_target: number | null;
  actual_quantity: number;
  mph: number;
}

interface DaySnapshot {
  entries: TargetEntry[];
  prodData: Record<string, { targetProd: number; produced: number }>;
  targetMPHByDept: Record<string, number>;
  actualMPHByDept: Record<string, number>;
}

interface DeptStats {
  workers: number;
  mph: number;
  targetProd: number;
  production: number;
  targetMPH: number;
  actualMPH: number;
  plannedLG: number;
  actualLG: number;
  stdTgt: number;
  todaysTgt: number;
  actual: number;
  eff: number;
  hasTarget: boolean;
}

const fetchDayData = async (dateStr: string): Promise<DaySnapshot> => {
  const [targetsRes, employeesRes, deptsRes, processesRes, prodRes, mphRes] =
    await Promise.all([
      (supabase.from("labour_productivity_targets") as any)
        .select(
          "id, employee_id, department_id, process_id, shift, target_quantity, todays_target, actual_quantity, mph"
        )
        .eq("target_date", dateStr)
        .limit(5000),
      supabase
        .from("labour_employees")
        .select("id, full_name, employee_code")
        .eq("is_active", true),
      supabase.from("production_departments").select("id, name"),
      supabase.from("qa_processes").select("id, name"),
      supabase
        .from("production_entries")
        .select("department_id, sub_department_id, target_production, quantity_produced")
        .eq("entry_date", dateStr),
      supabase
        .from("mph_calculating_numbers")
        .select("department_id, sub_department_id, mph_number")
        .eq("is_active", true),
    ]);

  const empMap = new Map((employeesRes.data || []).map((e: any) => [e.id, e]));
  const deptMap = new Map((deptsRes.data || []).map((d: any) => [d.id, d.name]));
  const procMap = new Map((processesRes.data || []).map((p: any) => [p.id, p.name]));

  const entries: TargetEntry[] = (targetsRes.data || []).map((t: any) => {
    const emp: any = empMap.get(t.employee_id);
    const deptId = t.department_id || "";
    return {
      id: t.id,
      employee_id: t.employee_id,
      employee_name: emp?.full_name || "Unknown",
      employee_code: emp?.employee_code || "",
      department_name: deptMap.get(deptId) || "Unassigned",
      department_id: deptId,
      process_name: procMap.get(t.process_id) || "-",
      shift: t.shift || "-",
      target_quantity: t.target_quantity || 0,
      todays_target: t.todays_target,
      actual_quantity: t.actual_quantity || 0,
      mph: t.mph || 0,
    };
  });

  const prodData: Record<string, { targetProd: number; produced: number }> = {};
  (prodRes.data || []).forEach((r: any) => {
    const deptId = r.department_id || "";
    if (!prodData[deptId]) prodData[deptId] = { targetProd: 0, produced: 0 };
    prodData[deptId].targetProd += r.target_production || 0;
    prodData[deptId].produced += r.quantity_produced || 0;
  });

  const mphMap = new Map<string, number>();
  (mphRes.data || []).forEach((m: any) => {
    const key = `${m.department_id || ""}-${m.sub_department_id || ""}`;
    mphMap.set(key, m.mph_number || 0);
  });
  const targetMPHByDept: Record<string, number> = {};
  const actualMPHByDept: Record<string, number> = {};
  (prodRes.data || []).forEach((e: any) => {
    const deptId = e.department_id || "";
    const key = `${deptId}-${e.sub_department_id || ""}`;
    const mphNum = mphMap.get(key) || 0;
    targetMPHByDept[deptId] = (targetMPHByDept[deptId] || 0) + (e.target_production || 0) * mphNum;
    actualMPHByDept[deptId] = (actualMPHByDept[deptId] || 0) + (e.quantity_produced || 0) * mphNum;
  });

  return { entries, prodData, targetMPHByDept, actualMPHByDept };
};

const computeDeptStats = (snapshot: DaySnapshot, deptName: string): DeptStats | null => {
  const items = snapshot.entries.filter((e) => e.department_name === deptName);
  if (items.length === 0) return null;
  let workers = new Set(items.map((i) => i.employee_id)).size;
  let mph = 0,
    stdTgt = 0,
    todaysTgt = 0,
    actual = 0;
  for (const e of items) {
    mph += e.mph;
    stdTgt += e.target_quantity;
    todaysTgt += e.todays_target || 0;
    actual += e.actual_quantity;
  }
  const deptId = items[0]?.department_id || "";
  const targetProd = snapshot.prodData[deptId]?.targetProd || 0;
  const production = snapshot.prodData[deptId]?.produced || 0;
  const targetMPH = Math.round(snapshot.targetMPHByDept[deptId] || 0);
  const actualMPH = Math.round(snapshot.actualMPHByDept[deptId] || 0);
  const plannedLG = mph - targetMPH;
  const actualLG = mph - actualMPH;
  const denom = todaysTgt || stdTgt;
  const eff = denom > 0 ? Math.round((actual / denom) * 100) : 0;
  return {
    workers,
    mph,
    targetProd,
    production,
    targetMPH,
    actualMPH,
    plannedLG,
    actualLG,
    stdTgt,
    todaysTgt,
    actual,
    eff,
    hasTarget: denom > 0,
  };
};

const computeOverall = (snapshot: DaySnapshot) => {
  const workers = new Set(snapshot.entries.map((e) => e.employee_id).filter(Boolean)).size;
  const stdTgt = snapshot.entries.reduce((s, e) => s + e.target_quantity, 0);
  const todaysTgt = snapshot.entries.reduce((s, e) => s + (e.todays_target || 0), 0);
  const actual = snapshot.entries.reduce((s, e) => s + e.actual_quantity, 0);
  const mph = snapshot.entries.reduce((s, e) => s + e.mph, 0);
  const targetProd = Object.values(snapshot.prodData).reduce((s, d) => s + d.targetProd, 0);
  const production = Object.values(snapshot.prodData).reduce((s, d) => s + d.produced, 0);
  const targetMPH = Math.round(
    Object.values(snapshot.targetMPHByDept).reduce((s, v) => s + v, 0)
  );
  const actualMPH = Math.round(
    Object.values(snapshot.actualMPHByDept).reduce((s, v) => s + v, 0)
  );
  const plannedLG = mph - targetMPH;
  const actualLG = mph - actualMPH;
  const denom = todaysTgt || stdTgt;
  const eff = denom > 0 ? Math.round((actual / denom) * 100) : 0;
  return { workers, stdTgt, todaysTgt, actual, mph, targetProd, production, targetMPH, actualMPH, plannedLG, actualLG, eff };
};

const Delta = ({ value, suffix = "" }: { value: number; suffix?: string }) => {
  if (value === 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" />0{suffix}
      </span>
    );
  const positive = value > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium",
        positive ? "text-green-600" : "text-red-600"
      )}
    >
      {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {positive ? "+" : ""}
      {value}
      {suffix}
    </span>
  );
};

// Multi-day KPI card: shows up to 4 daily values stacked vertically
const KPI = ({
  label,
  values,
  fmt = (n: number) => n.toLocaleString(),
  suffix = "",
}: {
  label: string;
  values: { dateLabel: string; value: number }[];
  fmt?: (n: number) => string;
  suffix?: string;
}) => (
  <Card className="p-3">
    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </div>
    <div className="mt-1 space-y-1">
      {values.map((v, i) => {
        const prev = i > 0 ? values[i - 1].value : null;
        const delta = prev !== null ? v.value - prev : null;
        return (
          <div key={i} className="flex items-baseline justify-between gap-2">
            <div className="flex flex-col leading-tight">
              <span className="text-[9px] text-muted-foreground">{v.dateLabel}</span>
              <span
                className={cn(
                  "tabular-nums",
                  i === 0 ? "text-sm font-bold" : "text-xs font-semibold text-muted-foreground"
                )}
              >
                {fmt(v.value)}
              </span>
            </div>
            {delta !== null && (
              <Delta value={delta} suffix={suffix} />
            )}
          </div>
        );
      })}
    </div>
  </Card>
);

export default function LabourDeploymentAnalysisPage() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [openDepts, setOpenDepts] = useState<Record<string, boolean>>({});
  const [showWorkers, setShowWorkers] = useState(false);

  // Build 4-day window: D0 (today), D-1, D-2, D-3
  const days = [0, 1, 2, 3].map((offset) => {
    const date = subDays(selectedDate, offset);
    return {
      offset,
      date,
      str: format(date, "yyyy-MM-dd"),
      label:
        offset === 0
          ? `Today (${format(date, "dd MMM")})`
          : format(date, "dd MMM"),
      shortLabel: format(date, "dd MMM"),
    };
  });

  const queries = days.map((d) =>
    useQuery({
      queryKey: ["labour-deployment-analysis", d.str],
      queryFn: () => fetchDayData(d.str),
    })
  );

  const isLoading = queries.some((q) => q.isLoading);

  const emptySnap: DaySnapshot = {
    entries: [],
    prodData: {},
    targetMPHByDept: {},
    actualMPHByDept: {},
  };

  const snapshots = queries.map((q) => q.data || emptySnap);
  const overalls = snapshots.map((s) => computeOverall(s));

  const allDepts = Array.from(
    new Set(snapshots.flatMap((s) => s.entries.map((e) => e.department_name)))
  ).sort();

  const toggleDept = (d: string) => setOpenDepts((p) => ({ ...p, [d]: !p[d] }));

  // Helper: build vertical KPI values for multi-day card
  const kpiVals = (key: keyof ReturnType<typeof computeOverall>) =>
    days.map((d, i) => ({
      dateLabel: d.label,
      value: overalls[i][key] as number,
    }));

  const handlePrint = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.open();
    w.document.write(
      `<!doctype html><html><head><title>Preparing print…</title></head><body>Preparing print…</body></html>`
    );
    w.document.close();

    setTimeout(() => {
      const renderRow = (label: string, s: DeptStats | null, prev: DeptStats | null) => {
        if (!s)
          return `<tr><td>${label}</td><td colspan="13" style="text-align:center;color:#999">No data</td></tr>`;
        const lgColor = s.plannedLG > 0 ? "#dc2626" : s.plannedLG < 0 ? "#16a34a" : "#6b7280";
        const aLgColor = s.actualLG > 0 ? "#dc2626" : s.actualLG < 0 ? "#16a34a" : "#6b7280";
        const effColor = !s.hasTarget
          ? "#6b7280"
          : s.eff >= 100
            ? "#16a34a"
            : s.eff >= 80
              ? "#ca8a04"
              : "#dc2626";
        const dCell = prev
          ? (() => {
              const d = s.actual - prev.actual;
              const c = d > 0 ? "#16a34a" : d < 0 ? "#dc2626" : "#6b7280";
              return `<td style="text-align:right;color:${c};font-weight:600">${d > 0 ? "+" : ""}${d}</td>`;
            })()
          : `<td style="text-align:right;color:#9ca3af">—</td>`;
        return `<tr><td><strong>${label}</strong></td><td style="text-align:right">${s.workers}</td><td style="text-align:right">${s.mph}</td><td style="text-align:right">${s.targetProd.toLocaleString()}</td><td style="text-align:right;font-weight:600">${s.production.toLocaleString()}</td><td style="text-align:right">${s.targetMPH.toLocaleString()}</td><td style="text-align:right">${s.actualMPH.toLocaleString()}</td><td style="text-align:right;color:${lgColor};font-weight:600">${s.plannedLG}</td><td style="text-align:right;color:${aLgColor};font-weight:600">${s.actualLG}</td><td style="text-align:right">${s.stdTgt}</td><td style="text-align:right">${s.todaysTgt}</td><td style="text-align:right">${s.actual}</td><td style="text-align:center;color:${effColor};font-weight:600">${s.hasTarget ? s.eff + "%" : "-"}</td>${dCell}</tr>`;
      };

      const sections = allDepts
        .map((dept) => {
          const dayStats = snapshots.map((s) => computeDeptStats(s, dept));
          const rows = days
            .map((d, i) => renderRow(d.label, dayStats[i], i > 0 ? dayStats[i - 1] : null))
            .join("");
          return `<div class="dept"><div class="dept-title">${dept}</div><table><thead><tr><th>Day</th><th>Workers</th><th>MPH</th><th>Target Prod</th><th>Production</th><th>Target MPH</th><th>Actual MPH</th><th>P. L/G</th><th>A. L/G</th><th>Std Tgt</th><th>Today's Tgt</th><th>Actual</th><th>Eff%</th><th>Δ Actual</th></tr></thead><tbody>${rows}</tbody></table></div>`;
        })
        .join("");

      const kpiBlock = (label: string, key: keyof ReturnType<typeof computeOverall>, suffix = "") => {
        const rows = days
          .map((d, i) => {
            const v = overalls[i][key] as number;
            const prev = i > 0 ? (overalls[i - 1][key] as number) : null;
            const delta = prev !== null ? v - prev : null;
            const dColor = delta === null ? "#9ca3af" : delta > 0 ? "#16a34a" : delta < 0 ? "#dc2626" : "#6b7280";
            const dStr = delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta}${suffix}`;
            return `<div style="display:flex;justify-content:space-between;gap:6px;font-size:9px;line-height:1.3"><span style="color:#6b7280">${d.label}</span><span style="font-weight:${i === 0 ? 700 : 600};${i === 0 ? "" : "color:#6b7280"}">${v.toLocaleString()}${suffix}</span><span style="color:${dColor};font-weight:600;min-width:30px;text-align:right">${dStr}</span></div>`;
          })
          .join("");
        return `<div class="kpi"><div class="lbl">${label}</div>${rows}</div>`;
      };

      const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Labour Deployment & Target Analysis - ${days[0].shortLabel}</title><style>@page{size:A4 landscape;margin:8mm}body{font-family:Arial,sans-serif;font-size:10px;color:#111;margin:0;padding:10px}h1{font-size:16px;margin:0 0 4px}.meta{font-size:10px;color:#555;margin-bottom:8px}.summary{display:grid;grid-template-columns:repeat(6,1fr);gap:5px;margin-bottom:10px}.kpi{border:1px solid #d1d5db;border-radius:4px;padding:5px 6px}.kpi .lbl{font-size:9px;color:#374151;text-transform:uppercase;font-weight:700;margin-bottom:3px;border-bottom:1px solid #e5e7eb;padding-bottom:2px}.dept{margin-bottom:8px;page-break-inside:avoid}.dept-title{font-size:11px;font-weight:700;background:#f3f4f6;padding:4px 6px;border:1px solid #d1d5db;border-bottom:0}table{width:100%;border-collapse:collapse;font-size:9px}th,td{border:1px solid #d1d5db;padding:3px 4px}th{background:#f9fafb;font-weight:600;text-align:left}@media print{body{padding:0}}</style></head><body><h1>Labour Deployment & Target Analysis</h1><div class="meta">Window: <strong>${days[3].shortLabel} → ${days[0].shortLabel}</strong> &nbsp;|&nbsp; Printed: ${format(new Date(), "dd MMM yyyy HH:mm")}</div><div class="summary">${kpiBlock("Workers", "workers")}${kpiBlock("Std Tgt", "stdTgt")}${kpiBlock("Today's Tgt", "todaysTgt")}${kpiBlock("Actual", "actual")}${kpiBlock("MPH Deployed", "mph")}${kpiBlock("Target Prod", "targetProd")}${kpiBlock("Production", "production")}${kpiBlock("Target MPH", "targetMPH")}${kpiBlock("Actual MPH", "actualMPH")}${kpiBlock("Planned L/G", "plannedLG")}${kpiBlock("Actual L/G", "actualLG")}${kpiBlock("Efficiency", "eff", "%")}</div>${allDepts.length === 0 ? `<div style="text-align:center;padding:40px;color:#6b7280">No entries found</div>` : sections}</body></html>`;

      try {
        w.document.open();
        w.document.write(html);
        w.document.close();
        const trigger = () => {
          try {
            w.focus();
            w.print();
          } catch {}
        };
        if (w.document.readyState === "complete") trigger();
        else w.onload = trigger;
        w.addEventListener("afterprint", () => {
          try {
            w.close();
          } catch {}
        });
      } catch {}
    }, 0);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Labour Deployment & Target Analysis"
        description="4-day execution trend per department: today vs the previous 3 days"
        icon={ClipboardList}
        iconColor="bg-emerald-500 text-white"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="justify-start gap-2 font-normal">
                <CalendarIcon className="h-4 w-4" />
                {format(selectedDate, "dd MMM yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(d) => d && setSelectedDate(d)}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
          <Button variant="outline" size="sm" onClick={() => setShowWorkers((s) => !s)}>
            <Users className="h-4 w-4 mr-2" />
            {showWorkers ? "Hide" : "Show"} workers
          </Button>
          <Button onClick={handlePrint} size="sm">
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
        </div>
      </PageHeader>

      <div className="flex flex-wrap gap-2 text-sm">
        {days.map((d, i) => (
          <Badge
            key={d.str}
            variant={i === 0 ? "outline" : "secondary"}
            className="gap-1"
          >
            <span className="font-medium">
              {i === 0 ? "Today:" : `D−${i}:`}
            </span>{" "}
            {d.shortLabel}
          </Badge>
        ))}
      </div>

      {/* Top KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        <KPI label="Workers" values={kpiVals("workers")} />
        <KPI label="Std Target" values={kpiVals("stdTgt")} />
        <KPI label="Today's Target" values={kpiVals("todaysTgt")} />
        <KPI label="Actual" values={kpiVals("actual")} />
        <KPI label="MPH Deployed" values={kpiVals("mph")} />
        <KPI label="Target Prod" values={kpiVals("targetProd")} />
        <KPI label="Production" values={kpiVals("production")} />
        <KPI label="Target MPH" values={kpiVals("targetMPH")} />
        <KPI label="Actual MPH" values={kpiVals("actualMPH")} />
        <KPI label="Planned L/G" values={kpiVals("plannedLG")} />
        <KPI label="Actual L/G" values={kpiVals("actualLG")} />
        <KPI
          label="Efficiency"
          values={kpiVals("eff")}
          fmt={(n) => `${n}%`}
          suffix="%"
        />
      </div>

      {/* Per-department comparison */}
      {isLoading ? (
        <Card className="p-12 text-center text-muted-foreground">Loading…</Card>
      ) : allDepts.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <Factory className="h-10 w-10 mx-auto mb-2 opacity-40" />
          No labour entries found for the selected date window
        </Card>
      ) : (
        <div className="space-y-3">
          {allDepts.map((dept) => {
            const dayStats = snapshots.map((s) => computeDeptStats(s, dept));
            const isOpen = openDepts[dept] ?? true;
            const todayStats = dayStats[0];
            const prevStats = dayStats[1];
            const actualDelta = (todayStats?.actual || 0) - (prevStats?.actual || 0);
            const effDelta = (todayStats?.eff || 0) - (prevStats?.eff || 0);

            return (
              <Card key={dept} className="overflow-hidden">
                <Collapsible open={isOpen} onOpenChange={() => toggleDept(dept)}>
                  <CollapsibleTrigger className="w-full">
                    <div className="flex items-center justify-between gap-3 px-4 py-3 bg-muted/40 hover:bg-muted/60 transition">
                      <div className="flex items-center gap-2">
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                        <span className="font-semibold">{dept}</span>
                        <Badge variant="outline" className="text-xs">
                          {todayStats?.workers || 0} today
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <span>
                          Actual vs D−1 <Delta value={actualDelta} />
                        </span>
                        <span>
                          Eff vs D−1 <Delta value={effDelta} suffix="%" />
                        </span>
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[140px]">Day</TableHead>
                            <TableHead className="text-right">Workers</TableHead>
                            <TableHead className="text-right">MPH</TableHead>
                            <TableHead className="text-right">Target Prod</TableHead>
                            <TableHead className="text-right">Production</TableHead>
                            <TableHead className="text-right">Target MPH</TableHead>
                            <TableHead className="text-right">Actual MPH</TableHead>
                            <TableHead className="text-right">P. L/G</TableHead>
                            <TableHead className="text-right">A. L/G</TableHead>
                            <TableHead className="text-right">Std Tgt</TableHead>
                            <TableHead className="text-right">Today's Tgt</TableHead>
                            <TableHead className="text-right">Actual</TableHead>
                            <TableHead className="text-center">Eff%</TableHead>
                            <TableHead className="text-right">Δ Actual</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {days.map((d, i) => (
                            <DeptRow
                              key={d.str}
                              label={d.label}
                              stats={dayStats[i]}
                              prevStats={i > 0 ? dayStats[i - 1] : null}
                              highlight={i === 0}
                            />
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {showWorkers && (
                      <div className="border-t">
                        <WorkerBreakdown
                          days={days.map((d, i) => ({
                            label: d.label,
                            items: snapshots[i].entries.filter(
                              (e) => e.department_name === dept
                            ),
                          }))}
                        />
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DeptRow({
  label,
  stats,
  prevStats,
  highlight,
}: {
  label: string;
  stats: DeptStats | null;
  prevStats: DeptStats | null;
  highlight?: boolean;
}) {
  if (!stats) {
    return (
      <TableRow className={highlight ? "bg-primary/5" : ""}>
        <TableCell className="font-medium">{label}</TableCell>
        <TableCell colSpan={13} className="text-center text-muted-foreground text-xs">
          No data
        </TableCell>
      </TableRow>
    );
  }
  const lgClass =
    stats.plannedLG > 0
      ? "text-red-600 font-semibold"
      : stats.plannedLG < 0
        ? "text-green-600 font-semibold"
        : "text-muted-foreground";
  const aLgClass =
    stats.actualLG > 0
      ? "text-red-600 font-semibold"
      : stats.actualLG < 0
        ? "text-green-600 font-semibold"
        : "text-muted-foreground";
  const effClass = !stats.hasTarget
    ? "text-muted-foreground"
    : stats.eff >= 100
      ? "text-green-600 font-semibold"
      : stats.eff >= 80
        ? "text-yellow-600 font-semibold"
        : "text-red-600 font-semibold";
  const deltaActual = prevStats ? stats.actual - prevStats.actual : null;
  return (
    <TableRow className={highlight ? "bg-primary/5" : ""}>
      <TableCell className="font-medium">{label}</TableCell>
      <TableCell className="text-right tabular-nums">{stats.workers}</TableCell>
      <TableCell className="text-right tabular-nums">{stats.mph}</TableCell>
      <TableCell className="text-right tabular-nums">
        {stats.targetProd.toLocaleString()}
      </TableCell>
      <TableCell className="text-right tabular-nums font-medium">
        {stats.production.toLocaleString()}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {stats.targetMPH.toLocaleString()}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {stats.actualMPH.toLocaleString()}
      </TableCell>
      <TableCell className={cn("text-right tabular-nums", lgClass)}>{stats.plannedLG}</TableCell>
      <TableCell className={cn("text-right tabular-nums", aLgClass)}>{stats.actualLG}</TableCell>
      <TableCell className="text-right tabular-nums">{stats.stdTgt}</TableCell>
      <TableCell className="text-right tabular-nums">{stats.todaysTgt}</TableCell>
      <TableCell className="text-right tabular-nums">{stats.actual}</TableCell>
      <TableCell className={cn("text-center tabular-nums", effClass)}>
        {stats.hasTarget ? `${stats.eff}%` : "-"}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {deltaActual === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <Delta value={deltaActual} />
        )}
      </TableCell>
    </TableRow>
  );
}

function WorkerBreakdown({
  days,
}: {
  days: { label: string; items: TargetEntry[] }[];
}) {
  return (
    <div className="divide-y">
      {days.map((d, idx) => (
        <div key={idx} className="p-3">
          <div className="text-xs font-semibold text-muted-foreground mb-2">{d.label}</div>
          {d.items.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">No entries</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Process</TableHead>
                  <TableHead>Shift</TableHead>
                  <TableHead className="text-right">MPH</TableHead>
                  <TableHead className="text-right">Std</TableHead>
                  <TableHead className="text-right">Today</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.items.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs">{e.employee_name}</TableCell>
                    <TableCell className="text-xs">{e.employee_code}</TableCell>
                    <TableCell className="text-xs">{e.process_name}</TableCell>
                    <TableCell className="text-xs">{e.shift}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{e.mph}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {e.target_quantity}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {e.todays_target ?? "-"}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {e.actual_quantity}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      ))}
    </div>
  );
}
