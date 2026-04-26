import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Save, User, Trash2, CheckCircle, Lock } from "lucide-react";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary",
  pending_review: "outline",
  approved: "default",
  closed: "destructive",
};

export default function MonthlyScoreEntryPage() {
  const queryClient = useQueryClient();
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(String(now.getMonth() + 1));
  const [selectedYear, setSelectedYear] = useState(String(now.getFullYear()));
  const [selectedEmployee, setSelectedEmployee] = useState<string>("all");
  const [actuals, setActuals] = useState<Record<string, { actual: string; remarks: string }>>({});

  const { data: employees = [] } = useQuery({
    queryKey: ["employees-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees").select("id, employee_code, full_name").eq("is_active", true).order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const { data: goals = [] } = useQuery({
    queryKey: ["monthly-goals-for-entry", selectedMonth, selectedYear, selectedEmployee],
    queryFn: async () => {
      let query = supabase
        .from("performance_monthly_goals")
        .select("*, employees(employee_code, full_name), performance_monthly_kpis(code, name, weight, max_score)")
        .eq("goal_month", parseInt(selectedMonth))
        .eq("goal_year", parseInt(selectedYear))
        .in("status", ["pending_review", "approved", "closed"]);
      if (selectedEmployee !== "all") {
        query = query.eq("employee_id", selectedEmployee);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const goalsByEmployee = (goals as any[]).reduce((acc: Record<string, any[]>, g: any) => {
    const key = g.employee_id;
    if (!acc[key]) acc[key] = [];
    acc[key].push(g);
    return acc;
  }, {});

  const getActualValue = (goal: any, field: "actual" | "remarks") => {
    if (actuals[goal.id]?.[field] !== undefined) return actuals[goal.id][field];
    if (field === "actual") return goal.actual_value != null ? String(goal.actual_value) : "";
    return goal.remarks || "";
  };

  const updateActual = (goalId: string, field: "actual" | "remarks", value: string) => {
    setActuals((prev) => ({
      ...prev,
      [goalId]: {
        actual: prev[goalId]?.actual ?? "",
        remarks: prev[goalId]?.remarks ?? "",
        [field]: value,
      },
    }));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const updates: { id: string; actual_value: number; score: number; remarks: string | null }[] = [];
      for (const [, empGoals] of Object.entries(goalsByEmployee)) {
        for (const goal of empGoals as any[]) {
          if (goal.status === "closed") continue;
          const actualStr = actuals[goal.id]?.actual ?? (goal.actual_value != null ? String(goal.actual_value) : "");
          const remarksStr = actuals[goal.id]?.remarks ?? goal.remarks ?? "";
          const actualVal = parseFloat(actualStr) || 0;
          const targetVal = goal.target_value || 0;
          const weight = goal.weight ?? goal.performance_monthly_kpis?.weight ?? 1;
          const calcScore = targetVal > 0 ? Math.min((actualVal / targetVal) * weight, weight) : 0;
          updates.push({
            id: goal.id,
            actual_value: actualVal,
            score: Math.round(calcScore * 100) / 100,
            remarks: remarksStr || null,
          });
        }
      }
      for (const u of updates) {
        const { error } = await supabase
          .from("performance_monthly_goals")
          .update({ actual_value: u.actual_value, score: u.score, remarks: u.remarks, updated_at: new Date().toISOString() })
          .eq("id", u.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monthly-goals-for-entry"] });
      setActuals({});
      toast({ title: "Scores saved successfully" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (goalId: string) => {
      const { error } = await supabase.from("performance_monthly_goals").delete().eq("id", goalId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monthly-goals-for-entry"] });
      toast({ title: "Score entry removed" });
    },
  });

  const resetScoreMutation = useMutation({
    mutationFn: async (goalId: string) => {
      const { error } = await supabase.from("performance_monthly_goals")
        .update({ actual_value: null, score: null, remarks: null, updated_at: new Date().toISOString() })
        .eq("id", goalId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monthly-goals-for-entry"] });
      setActuals({});
      toast({ title: "Score reset" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ employeeId, newStatus }: { employeeId: string; newStatus: string }) => {
      const ids = (goalsByEmployee[employeeId] || []).map((g: any) => g.id);
      if (!ids.length) return;
      const updateData: any = { status: newStatus, updated_at: new Date().toISOString() };
      if (newStatus === "approved") updateData.approved_at = new Date().toISOString();
      const { error } = await supabase
        .from("performance_monthly_goals")
        .update(updateData)
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monthly-goals-for-entry"] });
      toast({ title: "Status updated successfully" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const displayEmployees = selectedEmployee === "all"
    ? employees.filter((e) => goalsByEmployee[e.id]?.length > 0)
    : employees.filter((e) => e.id === selectedEmployee && goalsByEmployee[e.id]?.length > 0);

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Monthly Score Entry"
          description={`Enter actual values for assigned goals - ${MONTHS[parseInt(selectedMonth) - 1]} ${selectedYear}`}
          action={{
            label: "Save Scores",
            onClick: () => saveMutation.mutate(),
            icon: Save,
          }}
        />

        <div className="flex flex-wrap gap-4">
          <div>
            <Label className="text-xs">Month</Label>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => (
                  <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Year</Label>
            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Employee</Label>
            <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
              <SelectTrigger className="w-[220px]"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Employees</SelectItem>
                {employees.map((emp) => (
                  <SelectItem key={emp.id} value={emp.id}>{emp.employee_code} - {emp.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {displayEmployees.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No goals assigned for this period. Assign goals first in the Goal Assignment page.
            </CardContent>
          </Card>
        ) : (
          displayEmployees.map((emp) => {
            const empGoals = goalsByEmployee[emp.id] || [];
            const empStatus = empGoals[0]?.status;
            const isClosed = empStatus === "closed";
            const totalScore = empGoals.reduce((s: number, g: any) => {
              const actualStr = actuals[g.id]?.actual ?? (g.actual_value != null ? String(g.actual_value) : "0");
              const actual = parseFloat(actualStr) || 0;
              const target = g.target_value || 0;
              const weight = g.weight ?? g.performance_monthly_kpis?.weight ?? 1;
              return s + (target > 0 ? Math.min((actual / target) * weight, weight) : 0);
            }, 0);
            const maxWeight = empGoals.reduce((s: number, g: any) => s + (g.weight ?? g.performance_monthly_kpis?.weight ?? 0), 0);

            return (
              <Card key={emp.id}>
                <CardHeader className="pb-3 bg-muted/30">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-primary" />
                      <CardTitle className="text-base">{emp.employee_code} - {emp.full_name}</CardTitle>
                      <Badge variant={STATUS_COLORS[empStatus]}>{empStatus?.replace("_", " ")}</Badge>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-sm font-medium">
                        Total: <span className="text-primary">{totalScore.toFixed(1)}</span> / {maxWeight}
                      </div>
                      {empStatus === "pending_review" && (
                        <Button size="sm" variant="default" className="h-7 gap-1" onClick={() => {
                          if (confirm(`Approve all goals for ${emp.full_name}?`))
                            statusMutation.mutate({ employeeId: emp.id, newStatus: "approved" });
                        }}>
                          <CheckCircle className="h-3 w-3" /> Approve
                        </Button>
                      )}
                      {empStatus === "approved" && (
                        <Button size="sm" variant="secondary" className="h-7 gap-1" onClick={() => {
                          if (confirm(`Close and lock scores for ${emp.full_name}?`))
                            statusMutation.mutate({ employeeId: emp.id, newStatus: "closed" });
                        }}>
                          <Lock className="h-3 w-3" /> Close
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[60px]">Code</TableHead>
                        <TableHead>KPI</TableHead>
                        <TableHead className="w-[80px]">Weight</TableHead>
                        <TableHead className="w-[110px]">Target</TableHead>
                        <TableHead className="w-[110px]">Actual</TableHead>
                        <TableHead className="w-[80px]">Score</TableHead>
                        <TableHead className="w-[150px]">Remarks</TableHead>
                        <TableHead className="w-[80px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {empGoals.map((goal: any) => {
                        const target = goal.target_value || 0;
                        const actualStr = getActualValue(goal, "actual");
                        const actual = parseFloat(actualStr) || 0;
                        const weight = goal.weight ?? goal.performance_monthly_kpis?.weight ?? 1;
                        const calcScore = target > 0 ? Math.min((actual / target) * weight, weight) : 0;
                        const pct = target > 0 ? Math.min((actual / target) * 100, 100) : 0;

                        return (
                          <TableRow key={goal.id}>
                            <TableCell className="font-mono text-xs">{goal.performance_monthly_kpis?.code}</TableCell>
                            <TableCell className="text-sm">{goal.performance_monthly_kpis?.name}</TableCell>
                            <TableCell>{weight}</TableCell>
                            <TableCell className="font-medium">{target}</TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                className="h-8"
                                value={actualStr}
                                onChange={(e) => updateActual(goal.id, "actual", e.target.value)}
                                disabled={isClosed}
                              />
                            </TableCell>
                            <TableCell>
                              <Badge variant={pct >= 80 ? "default" : pct >= 50 ? "secondary" : "destructive"}>
                                {calcScore.toFixed(1)}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Input
                                className="h-8"
                                value={getActualValue(goal, "remarks")}
                                onChange={(e) => updateActual(goal.id, "remarks", e.target.value)}
                                disabled={isClosed}
                                placeholder="..."
                              />
                            </TableCell>
                            <TableCell>
                              {!isClosed && (
                                <div className="flex gap-1">
                                  <Button size="icon" variant="ghost" className="h-7 w-7" title="Reset score" onClick={() => resetScoreMutation.mutate(goal.id)}>
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                                  </Button>
                                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                                    if (confirm("Delete this score entry?")) deleteMutation.mutate(goal.id);
                                  }}>
                                    <Trash2 className="h-3 w-3 text-destructive" />
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </ERPLayout>
  );
}