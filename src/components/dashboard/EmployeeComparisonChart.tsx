import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from "recharts";
import { BarChart3 } from "lucide-react";

const COLORS = [
  "hsl(var(--primary))",
  "hsl(160 60% 45%)",
  "hsl(30 80% 55%)",
  "hsl(280 60% 55%)",
  "hsl(220 70% 55%)",
  "hsl(0 70% 55%)",
  "hsl(45 80% 50%)",
  "hsl(190 70% 45%)",
];

interface EmployeeComparisonChartProps {
  date: string;
}

export function EmployeeComparisonChart({ date }: EmployeeComparisonChartProps) {
  const currentMonth = new Date(date + "T00:00:00").getMonth() + 1;
  const currentYear = new Date(date + "T00:00:00").getFullYear();

  const { data: monthlyGoals } = useQuery({
    queryKey: ["emp-comparison-goals", currentMonth, currentYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_monthly_goals")
        .select("employee_id, target_value, actual_value, score, weight")
        .eq("goal_month", currentMonth)
        .eq("goal_year", currentYear)
        .limit(1000);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: employees } = useQuery({
    queryKey: ["emp-comparison-employees"],
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
    queryKey: ["emp-comparison-app-users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_users")
        .select("id, full_name");
      if (error) throw error;
      return data || [];
    },
  });

  const chartData = useMemo(() => {
    if (!monthlyGoals || !employees) return [];

    const empNameMap = new Map<string, string>();
    employees.forEach(e => {
      if (e.app_user_id) empNameMap.set(e.app_user_id, e.full_name);
      empNameMap.set(e.id, e.full_name);
    });
    (appUsers || []).forEach(u => {
      if (!empNameMap.has(u.id)) empNameMap.set(u.id, u.full_name);
    });

    const empScores = new Map<string, { totalScore: number; totalWeight: number; kpiCount: number }>();
    monthlyGoals.forEach(g => {
      if (!empScores.has(g.employee_id)) {
        empScores.set(g.employee_id, { totalScore: 0, totalWeight: 0, kpiCount: 0 });
      }
      const entry = empScores.get(g.employee_id)!;
      entry.totalScore += Number(g.score || 0);
      entry.totalWeight += Number(g.weight || 0);
      entry.kpiCount += 1;
    });

    return Array.from(empScores.entries())
      .map(([empId, data]) => ({
        name: (empNameMap.get(empId) || "Unknown").split(" ").slice(0, 2).join(" "),
        score: data.totalWeight > 0 ? Math.round((data.totalScore / data.totalWeight) * 100) : 0,
        kpis: data.kpiCount,
      }))
      .filter(d => d.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);
  }, [monthlyGoals, employees, appUsers]);

  const getBarColor = (score: number) => {
    if (score >= 80) return "hsl(160 60% 45%)";
    if (score >= 60) return "hsl(45 80% 50%)";
    return "hsl(0 70% 55%)";
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-display flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          Employee Monthly Score Comparison
          <Badge variant="outline" className="ml-auto text-xs">
            {new Date(currentYear, currentMonth - 1).toLocaleString("default", { month: "long", year: "numeric" })}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={Math.max(300, chartData.length * 36)}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" domain={[0, 120]} tickFormatter={(v) => `${v}%`} />
              <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12 }} />
              <Tooltip
                formatter={(value: number) => [`${value}%`, "Score"]}
                contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))" }}
              />
              <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={20}>
                {chartData.map((entry, index) => (
                  <Cell key={index} fill={getBarColor(entry.score)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">
            No monthly score data available
          </p>
        )}
      </CardContent>
    </Card>
  );
}
