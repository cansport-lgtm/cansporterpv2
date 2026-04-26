import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Filter, Award, Target, TrendingUp, User } from "lucide-react";

interface EmployeeScore {
  employee_id: string;
  employee_code: string;
  full_name: string;
  goals: {
    id: string;
    kpi_name: string;
    kpi_code: string;
    target_value: number;
    actual_value: number | null;
    weight: number;
    score: number;
    achievement_percent: number;
    status: string;
  }[];
  total_weight: number;
  total_score: number;
  overall_percentage: number;
}

// Calculate score for a single goal: (actual/target) × weight, capped at weight
const calculateGoalScore = (
  target: number,
  actual: number | null,
  weight: number
): { score: number; achievementPercent: number } => {
  if (actual === null || target === 0) {
    return { score: 0, achievementPercent: 0 };
  }
  const achievementPercent = Math.min((actual / target) * 100, 100);
  const score = Math.min((actual / target) * weight, weight);
  return { score: Math.round(score * 100) / 100, achievementPercent: Math.round(achievementPercent * 10) / 10 };
};

// Get score color based on percentage
const getScoreColor = (percentage: number): string => {
  if (percentage >= 90) return "text-green-600";
  if (percentage >= 70) return "text-blue-600";
  if (percentage >= 50) return "text-amber-600";
  return "text-red-600";
};

const getScoreBadgeVariant = (percentage: number): "default" | "secondary" | "destructive" | "outline" => {
  if (percentage >= 90) return "default";
  if (percentage >= 70) return "secondary";
  return "destructive";
};

export default function EmployeeScoreCardsPage() {
  const [filterCycle, setFilterCycle] = useState<string>("all");

  // Fetch review cycles
  const { data: reviewCycles = [] } = useQuery({
    queryKey: ["performance-review-cycles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_review_cycles")
        .select("*")
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Fetch goals with employee and KPI details
  const { data: employeeScores = [], isLoading } = useQuery({
    queryKey: ["employee-scores", filterCycle],
    queryFn: async () => {
      let query = supabase
        .from("performance_goals")
        .select(`
          id,
          target_value,
          actual_value,
          weight,
          status,
          employee_id,
          employees(id, employee_code, full_name),
          performance_kpis(code, name)
        `);

      if (filterCycle !== "all") {
        query = query.eq("review_cycle_id", filterCycle);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Group by employee and calculate scores
      const employeeMap = new Map<string, EmployeeScore>();

      data.forEach((goal: any) => {
        if (!goal.employees) return;

        const employeeId = goal.employee_id;
        const { score, achievementPercent } = calculateGoalScore(
          goal.target_value,
          goal.actual_value,
          goal.weight || 1
        );

        if (!employeeMap.has(employeeId)) {
          employeeMap.set(employeeId, {
            employee_id: employeeId,
            employee_code: goal.employees.employee_code,
            full_name: goal.employees.full_name,
            goals: [],
            total_weight: 0,
            total_score: 0,
            overall_percentage: 0,
          });
        }

        const employee = employeeMap.get(employeeId)!;
        employee.goals.push({
          id: goal.id,
          kpi_name: goal.performance_kpis?.name || "Unknown KPI",
          kpi_code: goal.performance_kpis?.code || "",
          target_value: goal.target_value,
          actual_value: goal.actual_value,
          weight: goal.weight || 1,
          score,
          achievement_percent: achievementPercent,
          status: goal.status,
        });
        employee.total_weight += goal.weight || 1;
        employee.total_score += score;
      });

      // Calculate overall percentage for each employee
      employeeMap.forEach((employee) => {
        if (employee.total_weight > 0) {
          employee.overall_percentage =
            Math.round((employee.total_score / employee.total_weight) * 1000) / 10;
        }
      });

      // Sort by overall percentage descending
      return Array.from(employeeMap.values()).sort(
        (a, b) => b.overall_percentage - a.overall_percentage
      );
    },
  });

  // Get active cycle name for display
  const selectedCycleName =
    filterCycle === "all"
      ? "All Cycles"
      : reviewCycles.find((c) => c.id === filterCycle)?.name || "Selected Cycle";

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Employee Score Cards"
          description="View individual employee performance scores based on KPI achievement"
        />

        {/* Filters */}
        <div className="flex gap-4 items-center">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={filterCycle} onValueChange={setFilterCycle}>
            <SelectTrigger className="w-[250px]">
              <SelectValue placeholder="Select Review Cycle" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Cycles</SelectItem>
              {reviewCycles.map((cycle) => (
                <SelectItem key={cycle.id} value={cycle.id}>
                  {cycle.name} ({cycle.status})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Employees Scored</p>
                  <p className="text-2xl font-bold">{employeeScores.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-500/10 rounded-lg">
                  <Award className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Avg Score</p>
                  <p className="text-2xl font-bold">
                    {employeeScores.length > 0
                      ? Math.round(
                          employeeScores.reduce((sum, e) => sum + e.overall_percentage, 0) /
                            employeeScores.length
                        )
                      : 0}
                    %
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/10 rounded-lg">
                  <TrendingUp className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Top Performer</p>
                  <p className="text-lg font-bold truncate">
                    {employeeScores[0]?.full_name || "N/A"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Employee Score Cards Grid */}
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">
            Loading scores...
          </div>
        ) : employeeScores.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Target className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No goals assigned yet. Assign KPIs to employees to see their scores.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {employeeScores.map((employee) => (
              <Card key={employee.employee_id} className="overflow-hidden">
                <CardHeader className="pb-3 bg-muted/30">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">{employee.full_name}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {employee.employee_code}
                      </p>
                    </div>
                    <Badge variant={getScoreBadgeVariant(employee.overall_percentage)}>
                      {employee.overall_percentage}%
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-4 space-y-4">
                  {/* Overall Score Progress */}
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-muted-foreground">Overall Score</span>
                      <span className={`font-medium ${getScoreColor(employee.overall_percentage)}`}>
                        {employee.total_score.toFixed(1)} / {employee.total_weight} pts
                      </span>
                    </div>
                    <Progress value={employee.overall_percentage} className="h-2" />
                  </div>

                  {/* Individual KPI Scores */}
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-muted-foreground">KPI Breakdown</p>
                    {employee.goals.map((goal) => (
                      <div key={goal.id} className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="truncate flex-1" title={goal.kpi_name}>
                            {goal.kpi_name}
                          </span>
                          <span className={`ml-2 font-medium ${getScoreColor(goal.achievement_percent)}`}>
                            {goal.score.toFixed(1)}/{goal.weight}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Progress
                            value={goal.achievement_percent}
                            className="h-1.5 flex-1"
                          />
                          <span className="text-xs text-muted-foreground w-12 text-right">
                            {goal.achievement_percent}%
                          </span>
                        </div>
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Target: {goal.target_value}</span>
                          <span>Actual: {goal.actual_value ?? "-"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </ERPLayout>
  );
}
