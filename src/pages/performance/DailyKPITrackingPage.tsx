import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { ClipboardList, Printer, Upload } from "lucide-react";

const CELL_KEY_SEPARATOR = "::";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function getDaysInMonth(month: number, year: number) {
  return new Date(year, month, 0).getDate();
}

function buildCellKey(kpiId: string, day: number) {
  return `${kpiId}${CELL_KEY_SEPARATOR}${day}`;
}

function parseCellKey(key: string) {
  const separatorIndex = key.lastIndexOf(CELL_KEY_SEPARATOR);
  if (separatorIndex === -1) {
    return null;
  }

  const kpiId = key.slice(0, separatorIndex);
  const day = Number.parseInt(key.slice(separatorIndex + CELL_KEY_SEPARATOR.length), 10);

  if (!kpiId || Number.isNaN(day)) {
    return null;
  }

  return { kpiId, day };
}

export default function DailyKPITrackingPage() {
  const queryClient = useQueryClient();
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(String(now.getMonth() + 1));
  const [selectedYear, setSelectedYear] = useState(String(now.getFullYear()));
  const [selectedEmployee, setSelectedEmployee] = useState<string>("");
  const [editedCells, setEditedCells] = useState<Record<string, string>>({});

  const month = parseInt(selectedMonth);
  const year = parseInt(selectedYear);
  const daysInMonth = getDaysInMonth(month, year);

  const { data: employees = [] } = useQuery({
    queryKey: ["employees-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, employee_code, full_name")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  // Get KPIs assigned to this employee for this month
  const { data: goals = [] } = useQuery({
    queryKey: ["daily-tracking-goals", selectedEmployee, selectedMonth, selectedYear],
    queryFn: async () => {
      if (!selectedEmployee) return [];
      const { data, error } = await supabase
        .from("performance_monthly_goals")
        .select("id, kpi_id, target_value, weight, actual_value, status, performance_monthly_kpis(id, code, name)")
        .eq("employee_id", selectedEmployee)
        .eq("goal_month", month)
        .eq("goal_year", year);
      if (error) throw error;
      return data;
    },
    enabled: !!selectedEmployee,
  });

  // Get existing daily tracking entries
  const { data: dailyEntries = [] } = useQuery({
    queryKey: ["daily-tracking-entries", selectedEmployee, selectedMonth, selectedYear],
    queryFn: async () => {
      if (!selectedEmployee) return [];
      const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
      const endDate = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
      const { data, error } = await supabase
        .from("performance_daily_tracking")
        .select("*")
        .eq("employee_id", selectedEmployee)
        .gte("tracking_date", startDate)
        .lte("tracking_date", endDate);
      if (error) throw error;
      return data;
    },
    enabled: !!selectedEmployee,
  });

  // Build lookup: kpi_id-day → value
  const entryLookup: Record<string, { id: string; actual_value: number | null }> = {};
  dailyEntries.forEach((e: any) => {
    const day = new Date(e.tracking_date).getDate();
    entryLookup[buildCellKey(e.kpi_id, day)] = { id: e.id, actual_value: e.actual_value };
  });

  const getCellValue = (kpiId: string, day: number): string => {
    const key = buildCellKey(kpiId, day);
    if (editedCells[key] !== undefined) return editedCells[key];
    const existing = entryLookup[key];
    if (existing?.actual_value != null) return String(existing.actual_value);
    return "";
  };

  const handleCellChange = (kpiId: string, day: number, value: string) => {
    setEditedCells((prev) => ({ ...prev, [buildCellKey(kpiId, day)]: value }));
  };

  // Save all edited cells
  const saveMutation = useMutation({
    mutationFn: async () => {
      const upserts: any[] = [];
      for (const [key, value] of Object.entries(editedCells)) {
        const parsedKey = parseCellKey(key);
        if (!parsedKey) continue;

        const { kpiId, day } = parsedKey;
        const trackingDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const numValue = value === "" ? null : parseFloat(value);
        
        if (value === "" && entryLookup[key]?.id) {
          // Delete entry if cleared
          await supabase.from("performance_daily_tracking").delete().eq("id", entryLookup[key].id);
        } else if (value !== "") {
          upserts.push({
            employee_id: selectedEmployee,
            kpi_id: kpiId,
            tracking_date: trackingDate,
            actual_value: numValue,
          });
        }
      }
      if (upserts.length > 0) {
        const { error } = await supabase
          .from("performance_daily_tracking")
          .upsert(upserts, { onConflict: "employee_id,kpi_id,tracking_date" });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      setEditedCells({});
      queryClient.invalidateQueries({ queryKey: ["daily-tracking-entries"] });
      toast({ title: "Saved", description: "Daily tracking values saved successfully." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Calculate average for a KPI
  const getKpiAverage = (kpiId: string): number | null => {
    const values: number[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const val = getCellValue(kpiId, d);
      if (val !== "") values.push(parseFloat(val));
    }
    if (values.length === 0) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  };

  // Post averages to monthly goals
  const postAveragesMutation = useMutation({
    mutationFn: async () => {
      for (const goal of goals) {
        const kpi = goal.performance_monthly_kpis as any;
        if (!kpi) continue;
        const avg = getKpiAverage(kpi.id);
        if (avg === null) continue;
        const { error } = await supabase
          .from("performance_monthly_goals")
          .update({ actual_value: Math.round(avg * 100) / 100 })
          .eq("id", goal.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["daily-tracking-goals"] });
      toast({ title: "Posted", description: "Averages posted to Monthly Scores successfully." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handlePrint = useCallback(() => {
    const emp = employees.find((e) => e.id === selectedEmployee);
    const empName = emp ? `${emp.employee_code} - ${emp.full_name}` : "Employee";

    const rows = goals.map((g: any) => {
      const kpi = g.performance_monthly_kpis;
      return `<tr>
        <td style="border:1px solid #333;padding:4px 6px;font-size:11px;white-space:nowrap;">${kpi?.code || ""}</td>
        <td style="border:1px solid #333;padding:4px 6px;font-size:11px;">${kpi?.name || ""}</td>
        <td style="border:1px solid #333;padding:4px 6px;font-size:11px;text-align:center;">${g.target_value ?? ""}</td>
        <td style="border:1px solid #333;padding:4px 6px;font-size:11px;text-align:center;">${g.weight ?? ""}</td>
        ${Array.from({ length: daysInMonth }, (_, i) => {
          const val = getCellValue(kpi?.id, i + 1);
          return `<td style="border:1px solid #333;padding:2px;font-size:10px;text-align:center;min-width:24px;">${val}</td>`;
        }).join("")}
        <td style="border:1px solid #333;padding:4px 6px;font-size:11px;text-align:center;font-weight:bold;">${(() => {
          const avg = getKpiAverage(kpi?.id);
          return avg !== null ? avg.toFixed(2) : "";
        })()}</td>
      </tr>`;
    }).join("");

    const dayHeaders = Array.from({ length: daysInMonth }, (_, i) =>
      `<th style="border:1px solid #333;padding:2px;font-size:10px;text-align:center;min-width:24px;">${i + 1}</th>`
    ).join("");

    const html = `
      <html><head><title>Daily KPI Tracking - ${empName}</title>
      <style>@media print { body { margin: 0; } } body { font-family: Arial, sans-serif; } table { border-collapse: collapse; width: 100%; }</style>
      </head><body>
      <h2 style="margin-bottom:4px;">Daily KPI Tracking Sheet</h2>
      <p style="margin:2px 0;"><strong>Employee:</strong> ${empName} | <strong>Month:</strong> ${MONTHS[month - 1]} ${year}</p>
      <table>
        <thead>
          <tr>
            <th style="border:1px solid #333;padding:4px;font-size:10px;">Code</th>
            <th style="border:1px solid #333;padding:4px;font-size:10px;">KPI Name</th>
            <th style="border:1px solid #333;padding:4px;font-size:10px;">Target</th>
            <th style="border:1px solid #333;padding:4px;font-size:10px;">Weight</th>
            ${dayHeaders}
            <th style="border:1px solid #333;padding:4px;font-size:10px;">Avg</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      </body></html>
    `;
    const win = window.open("", "_blank");
    if (win) {
      win.document.write(html);
      win.document.close();
      win.print();
    }
  }, [employees, selectedEmployee, goals, month, year, daysInMonth, editedCells, entryLookup]);

  const hasEdits = Object.keys(editedCells).length > 0;

  return (
    <ERPLayout>
      <div className="space-y-4">
        <PageHeader
          title="Daily KPI Tracking"
          description="Record daily KPI values and post averages to monthly scores"
          icon={ClipboardList}
          iconColor="bg-violet-100 text-violet-700"
        />

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-1">
                <label className="text-sm font-medium">Month</label>
                <Select value={selectedMonth} onValueChange={(v) => { setSelectedMonth(v); setEditedCells({}); }}>
                  <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Year</label>
                <Select value={selectedYear} onValueChange={(v) => { setSelectedYear(v); setEditedCells({}); }}>
                  <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{[2024, 2025, 2026].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Employee</label>
                <Select value={selectedEmployee} onValueChange={(v) => { setSelectedEmployee(v); setEditedCells({}); }}>
                  <SelectTrigger className="w-[250px]"><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.employee_code} - {e.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handlePrint} disabled={!selectedEmployee || goals.length === 0}>
                  <Printer className="h-4 w-4 mr-1" /> Print
                </Button>
                <Button size="sm" onClick={() => saveMutation.mutate()} disabled={!hasEdits || saveMutation.isPending}>
                  Save
                </Button>
                <Button size="sm" variant="secondary" onClick={() => postAveragesMutation.mutate()} disabled={!selectedEmployee || goals.length === 0 || postAveragesMutation.isPending}>
                  <Upload className="h-4 w-4 mr-1" /> Post Averages
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Grid */}
        {selectedEmployee && goals.length > 0 ? (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-auto max-h-[calc(100vh-280px)]">
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-muted z-10">
                    <tr>
                      <th className="border border-border px-2 py-1.5 text-left whitespace-nowrap sticky left-0 bg-muted z-20 min-w-[60px]">Code</th>
                      <th className="border border-border px-2 py-1.5 text-left whitespace-nowrap sticky left-[60px] bg-muted z-20 min-w-[150px]">KPI Name</th>
                      <th className="border border-border px-2 py-1.5 text-center whitespace-nowrap min-w-[50px]">Target</th>
                      <th className="border border-border px-2 py-1.5 text-center whitespace-nowrap min-w-[40px]">Wt</th>
                      {Array.from({ length: daysInMonth }, (_, i) => (
                        <th key={i} className="border border-border px-1 py-1.5 text-center min-w-[42px]">{i + 1}</th>
                      ))}
                      <th className="border border-border px-2 py-1.5 text-center whitespace-nowrap min-w-[55px] bg-muted font-bold">Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {goals.map((goal: any) => {
                      const kpi = goal.performance_monthly_kpis;
                      if (!kpi) return null;
                      const avg = getKpiAverage(kpi.id);
                      return (
                        <tr key={goal.id} className="hover:bg-muted/30">
                          <td className="border border-border px-2 py-1 whitespace-nowrap sticky left-0 bg-background font-medium">{kpi.code}</td>
                          <td className="border border-border px-2 py-1 whitespace-nowrap sticky left-[60px] bg-background">{kpi.name}</td>
                          <td className="border border-border px-2 py-1 text-center">{goal.target_value ?? "-"}</td>
                          <td className="border border-border px-2 py-1 text-center">{goal.weight ?? "-"}</td>
                          {Array.from({ length: daysInMonth }, (_, i) => {
                            const day = i + 1;
                            return (
                              <td key={day} className="border border-border p-0">
                                <Input
                                  type="number"
                                  className="h-7 w-full border-0 rounded-none text-center text-xs p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  value={getCellValue(kpi.id, day)}
                                  onChange={(e) => handleCellChange(kpi.id, day, e.target.value)}
                                />
                              </td>
                            );
                          })}
                          <td className="border border-border px-2 py-1 text-center font-bold bg-muted/50">
                            {avg !== null ? avg.toFixed(2) : "-"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ) : selectedEmployee ? (
          <Card><CardContent className="p-8 text-center text-muted-foreground">No KPIs assigned for this employee in {MONTHS[month - 1]} {year}. Assign goals first.</CardContent></Card>
        ) : (
          <Card><CardContent className="p-8 text-center text-muted-foreground">Select an employee to view their daily KPI tracking grid.</CardContent></Card>
        )}
      </div>
    </ERPLayout>
  );
}
