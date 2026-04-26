import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Target, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { format, startOfMonth, endOfMonth } from "date-fns";

interface DailyEmployeeProgressProps {
  date: string; // yyyy-MM-dd
}

export function DailyEmployeeProgress({ date }: DailyEmployeeProgressProps) {
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(new Date()), "yyyy-MM-dd");

  // Fetch daily tracking entries for the selected date
  const { data: dailyEntries } = useQuery({
    queryKey: ["ceo-daily-progress", date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_daily_tracking")
        .select("id, employee_id, kpi_id, actual_value, tracking_date")
        .eq("tracking_date", date)
        .limit(1000);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch ALL daily tracking entries for the current month (for MTD avg)
  const { data: monthlyTrackingEntries } = useQuery({
    queryKey: ["ceo-mtd-tracking", monthStart, monthEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_daily_tracking")
        .select("employee_id, kpi_id, actual_value")
        .gte("tracking_date", monthStart)
        .lte("tracking_date", monthEnd)
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: employees } = useQuery({
    queryKey: ["ceo-daily-progress-employees"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, full_name, employee_code, app_user_id")
        .eq("is_active", true);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: appUsers } = useQuery({
    queryKey: ["ceo-daily-progress-app-users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_users")
        .select("id, full_name");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: kpis } = useQuery({
    queryKey: ["ceo-daily-progress-kpis"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_kpis")
        .select("id, code, name, unit, target_direction")
        .eq("is_active", true);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: monthlyGoals } = useQuery({
    queryKey: ["ceo-daily-progress-goals", currentMonth, currentYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_monthly_goals")
        .select("employee_id, kpi_id, target_value, weight")
        .eq("goal_month", currentMonth)
        .eq("goal_year", currentYear)
        .limit(1000);
      if (error) throw error;
      return data || [];
    },
  });

  const progressData = useMemo(() => {
    if (!dailyEntries || !kpis) return { rows: [], totalKPIs: 0, filledCount: 0, avgAchievement: 0, overallMtdScore: 0 };

    const kpiMap = new Map(kpis.map(k => [k.id, k]));

    // Build employee name map
    const empNameMap = new Map<string, string>();
    (employees || []).forEach(e => {
      if (e.app_user_id) empNameMap.set(e.app_user_id, e.full_name);
      empNameMap.set(e.id, e.full_name);
    });
    (appUsers || []).forEach(u => {
      if (!empNameMap.has(u.id)) empNameMap.set(u.id, u.full_name);
    });

    // Build target & weight map from monthly goals
    const goalMap = new Map<string, { target: number; weight: number }>();
    (monthlyGoals || []).forEach(g => {
      goalMap.set(`${g.employee_id}::${g.kpi_id}`, {
        target: Number(g.target_value || 0),
        weight: Number(g.weight || 0),
      });
    });

    // --- MTD Average Calculation from raw daily tracking ---
    // Group monthly tracking by (employee_id, kpi_id) → array of values
    const mtdGroup = new Map<string, number[]>();
    (monthlyTrackingEntries || []).forEach(entry => {
      const key = `${entry.employee_id}::${entry.kpi_id}`;
      if (!mtdGroup.has(key)) mtdGroup.set(key, []);
      mtdGroup.get(key)!.push(Number(entry.actual_value || 0));
    });

    // Compute per-employee MTD weighted score
    // For each employee, find all KPIs they have tracking data for,
    // compute avg actual, compare to monthly target, weight it
    const allEmployeeIds = new Set<string>();
    (monthlyTrackingEntries || []).forEach(e => allEmployeeIds.add(e.employee_id));

    const mtdScoreMap = new Map<string, { weightedScore: number; totalWeight: number }>();
    allEmployeeIds.forEach(empId => {
      let totalWeightedScore = 0;
      let totalWeight = 0;

      // Find all KPIs this employee has data for
      const empKpis = new Set<string>();
      mtdGroup.forEach((_, key) => {
        if (key.startsWith(empId + "::")) {
          empKpis.add(key.split("::")[1]);
        }
      });

      empKpis.forEach(kpiId => {
        const values = mtdGroup.get(`${empId}::${kpiId}`) || [];
        if (values.length === 0) return;
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const goal = goalMap.get(`${empId}::${kpiId}`);
        if (!goal || goal.target <= 0) return;

        const kpi = kpiMap.get(kpiId);
        const direction = kpi?.target_direction || "higher_better";
        const achievement = direction === "lower_better"
          ? (goal.target / avg) * 100
          : (avg / goal.target) * 100;
        const cappedAchievement = Math.min(achievement, 200);
        const weightedScore = (cappedAchievement / 100) * goal.weight;

        totalWeightedScore += weightedScore;
        totalWeight += goal.weight;
      });

      mtdScoreMap.set(empId, { weightedScore: totalWeightedScore, totalWeight });
    });

    // --- Daily entries for table rows ---
    const dailyTargetMap = new Map<string, number>();
    (monthlyGoals || []).forEach(g => {
      dailyTargetMap.set(`${g.employee_id}::${g.kpi_id}`, Number(g.target_value || 0) / 30);
    });

    const empMap = new Map<string, { name: string; kpis: { kpiName: string; kpiCode: string; unit: string; actual: number; target: number; direction: string }[] }>();

    dailyEntries.forEach(entry => {
      const empId = entry.employee_id;
      const kpi = kpiMap.get(entry.kpi_id);
      if (!kpi) return;

      if (!empMap.has(empId)) {
        empMap.set(empId, { name: empNameMap.get(empId) || "Unknown", kpis: [] });
      }

      empMap.get(empId)!.kpis.push({
        kpiName: kpi.name,
        kpiCode: kpi.code,
        unit: kpi.unit || "",
        actual: Number(entry.actual_value || 0),
        target: dailyTargetMap.get(`${empId}::${entry.kpi_id}`) || 0,
        direction: kpi.target_direction || "higher_better",
      });
    });

    const rows = Array.from(empMap.entries()).map(([empId, data]) => {
      const achievements = data.kpis.map(k => {
        if (k.target <= 0) return 100;
        return k.direction === "lower_better" ? (k.target / k.actual) * 100 : (k.actual / k.target) * 100;
      });
      const avgAchievement = achievements.length > 0 ? achievements.reduce((a, b) => a + b, 0) / achievements.length : 0;

      const mtdEntry = mtdScoreMap.get(empId);
      const mtdPct = mtdEntry && mtdEntry.totalWeight > 0
        ? (mtdEntry.weightedScore / mtdEntry.totalWeight) * 100
        : null;

      return {
        empId,
        name: data.name,
        kpiCount: data.kpis.length,
        kpis: data.kpis,
        avgAchievement: Math.min(avgAchievement, 200),
        mtdPct,
      };
    }).sort((a, b) => b.avgAchievement - a.avgAchievement);

    // Also include employees who have MTD data but no daily entry for the selected date
    const dailyEmpIds = new Set(rows.map(r => r.empId));
    allEmployeeIds.forEach(empId => {
      if (dailyEmpIds.has(empId)) return;
      const mtdEntry = mtdScoreMap.get(empId);
      const mtdPct = mtdEntry && mtdEntry.totalWeight > 0
        ? (mtdEntry.weightedScore / mtdEntry.totalWeight) * 100
        : null;
      if (mtdPct === null) return;
      rows.push({
        empId,
        name: empNameMap.get(empId) || "Unknown",
        kpiCount: 0,
        kpis: [],
        avgAchievement: 0,
        mtdPct,
      });
    });

    rows.sort((a, b) => (b.mtdPct || 0) - (a.mtdPct || 0));

    const overallAvg = rows.length > 0 ? rows.reduce((s, r) => s + r.avgAchievement, 0) / rows.length : 0;
    const scoredRows = rows.filter(r => r.mtdPct !== null);
    const overallMtdScore = scoredRows.length > 0 ? scoredRows.reduce((s, r) => s + (r.mtdPct || 0), 0) / scoredRows.length : 0;

    return { rows, totalKPIs: dailyEntries.length, filledCount: empMap.size, avgAchievement: overallAvg, overallMtdScore };
  }, [dailyEntries, monthlyTrackingEntries, kpis, employees, appUsers, monthlyGoals]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-display flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          Daily Employee Progress Report
          <Badge variant="outline" className="ml-auto text-xs">
            {format(new Date(date + "T00:00:00"), "dd MMM yyyy")}
          </Badge>
        </CardTitle>
        <div className="flex gap-4 text-sm mt-1 flex-wrap">
          <span className="font-semibold">{progressData.filledCount} Employees Reported</span>
          <span className="font-semibold">{progressData.totalKPIs} KPI Entries</span>
          <span className={`font-semibold ${progressData.avgAchievement >= 80 ? "text-green-600" : "text-red-600"}`}>
            Avg Achievement: {progressData.avgAchievement.toFixed(1)}%
          </span>
          {progressData.overallMtdScore > 0 && (
            <span className={`font-semibold ${progressData.overallMtdScore >= 80 ? "text-green-600" : progressData.overallMtdScore >= 60 ? "text-amber-600" : "text-red-600"}`}>
              MTD Avg Score: {progressData.overallMtdScore.toFixed(1)}%
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {progressData.rows.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead className="text-center">KPIs Filled</TableHead>
                <TableHead>Key KPIs</TableHead>
                <TableHead className="text-right">Day Avg</TableHead>
                <TableHead className="text-right">MTD Avg</TableHead>
                <TableHead className="w-32">Progress</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {progressData.rows.slice(0, 20).map((row) => (
                <TableRow key={row.empId}>
                  <TableCell className="font-medium text-sm">{row.name}</TableCell>
                  <TableCell className="text-center text-sm">{row.kpiCount || "—"}</TableCell>
                  <TableCell className="text-sm">
                    <div className="flex flex-wrap gap-1">
                      {row.kpis.slice(0, 3).map((k, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">
                          {k.kpiCode}: {k.actual}{k.unit ? ` ${k.unit}` : ""}
                        </Badge>
                      ))}
                      {row.kpis.length > 3 && (
                        <Badge variant="outline" className="text-xs">+{row.kpis.length - 3}</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {row.kpiCount > 0 ? (
                      <div className="flex items-center justify-end gap-1">
                        {row.avgAchievement >= 100 ? (
                          <TrendingUp className="h-3.5 w-3.5 text-green-600" />
                        ) : row.avgAchievement >= 80 ? (
                          <Minus className="h-3.5 w-3.5 text-amber-500" />
                        ) : (
                          <TrendingDown className="h-3.5 w-3.5 text-red-600" />
                        )}
                        <span className={
                          row.avgAchievement >= 100 ? "text-green-600 font-semibold" :
                          row.avgAchievement >= 80 ? "text-amber-600 font-semibold" :
                          "text-red-600 font-semibold"
                        }>
                          {row.avgAchievement.toFixed(1)}%
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {row.mtdPct !== null ? (
                      <span className={
                        row.mtdPct >= 80 ? "text-green-600 font-semibold" :
                        row.mtdPct >= 60 ? "text-amber-600 font-semibold" :
                        "text-red-600 font-semibold"
                      }>
                        {row.mtdPct.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Progress
                      value={Math.min(row.mtdPct || row.avgAchievement, 100)}
                      className="h-2"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">
            No daily KPI entries recorded for this date
          </p>
        )}
      </CardContent>
    </Card>
  );
}
