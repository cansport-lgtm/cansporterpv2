import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Plus, Save, Trash2, Send, CheckCircle, Lock, Pencil, Printer } from "lucide-react";

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

export default function MonthlyGoalAssignmentPage() {
  const queryClient = useQueryClient();
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(String(now.getMonth() + 1));
  const [selectedYear, setSelectedYear] = useState(String(now.getFullYear()));
  const [selectedEmployee, setSelectedEmployee] = useState<string>("all");
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignEmpId, setAssignEmpId] = useState("");
  const [selectedKpis, setSelectedKpis] = useState<Record<string, { checked: boolean; target: string; weight: string }>>({});
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [editTargetValue, setEditTargetValue] = useState("");
  const [editWeightValue, setEditWeightValue] = useState("");

  const { data: employees = [] } = useQuery({
    queryKey: ["employees-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees").select("id, employee_code, full_name").eq("is_active", true).order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const { data: kpis = [] } = useQuery({
    queryKey: ["monthly-kpis-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("performance_monthly_kpis").select("*").eq("is_active", true).order("code");
      if (error) throw error;
      return data;
    },
  });

  const { data: goals = [] } = useQuery({
    queryKey: ["monthly-goals", selectedMonth, selectedYear, selectedEmployee],
    queryFn: async () => {
      let query = supabase
        .from("performance_monthly_goals")
        .select("*, employees(employee_code, full_name), performance_monthly_kpis(code, name, weight, max_score)")
        .eq("goal_month", parseInt(selectedMonth))
        .eq("goal_year", parseInt(selectedYear))
        .order("created_at");
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

  const assignMutation = useMutation({
    mutationFn: async () => {
      const inserts = Object.entries(selectedKpis)
        .filter(([, v]) => v.checked && parseFloat(v.target) > 0)
        .map(([kpiId, v]) => ({
          employee_id: assignEmpId,
          kpi_id: kpiId,
          goal_month: parseInt(selectedMonth),
          goal_year: parseInt(selectedYear),
          target_value: parseFloat(v.target),
          weight: parseFloat(v.weight) || 0,
          status: "draft",
        }));
      if (inserts.length === 0) throw new Error("Select at least one KPI with a target");
      const { error } = await supabase.from("performance_monthly_goals").upsert(inserts, {
        onConflict: "employee_id,kpi_id,goal_month,goal_year",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monthly-goals"] });
      setAssignDialogOpen(false);
      setSelectedKpis({});
      toast({ title: "Goals assigned successfully" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ empId, newStatus }: { empId: string; newStatus: string }) => {
      const empGoals = goalsByEmployee[empId] || [];
      const ids = empGoals.map((g: any) => g.id);
      const updateData: any = { status: newStatus, updated_at: new Date().toISOString() };
      if (newStatus === "pending_review") updateData.reviewed_by = null;
      if (newStatus === "approved") updateData.approved_at = new Date().toISOString();
      if (newStatus === "closed") updateData.approved_at = new Date().toISOString();
      const { error } = await supabase.from("performance_monthly_goals").update(updateData).in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monthly-goals"] });
      toast({ title: "Status updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (goalId: string) => {
      const { error } = await supabase.from("performance_monthly_goals").delete().eq("id", goalId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monthly-goals"] });
      toast({ title: "Goal removed" });
    },
  });

  const deleteAllMutation = useMutation({
    mutationFn: async (empId: string) => {
      const empGoals = goalsByEmployee[empId] || [];
      const ids = empGoals.map((g: any) => g.id);
      const { error } = await supabase.from("performance_monthly_goals").delete().in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monthly-goals"] });
      toast({ title: "All goals removed for employee" });
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({ goalId, targetValue, weightValue }: { goalId: string; targetValue: number; weightValue: number }) => {
      const { error } = await supabase.from("performance_monthly_goals")
        .update({ target_value: targetValue, weight: weightValue, updated_at: new Date().toISOString() })
        .eq("id", goalId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monthly-goals"] });
      setEditingGoalId(null);
      toast({ title: "Goal updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const openAssignDialog = (empId: string) => {
    setAssignEmpId(empId);
    const existing = (goals as any[]).filter((g: any) => g.employee_id === empId);
    const init: Record<string, { checked: boolean; target: string; weight: string }> = {};
    kpis.forEach((k) => {
      const ex = existing.find((e: any) => e.kpi_id === k.id);
      init[k.id] = {
        checked: !!ex,
        target: ex ? String(ex.target_value) : String(k.max_score || 100),
        weight: ex ? String(ex.weight ?? k.weight) : String(k.weight || 0),
      };
    });
    setSelectedKpis(init);
    setAssignDialogOpen(true);
  };

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);

  const getEmployeeStatus = (empGoals: any[]) => {
    if (empGoals.length === 0) return null;
    const statuses = empGoals.map((g: any) => g.status);
    if (statuses.every((s: string) => s === "closed")) return "closed";
    if (statuses.every((s: string) => s === "approved")) return "approved";
    if (statuses.some((s: string) => s === "pending_review")) return "pending_review";
    return "draft";
  };

  const canEdit = (status: string | null) => status !== "closed";
  const canDelete = (status: string | null) => status !== "closed";

  const handlePrint = () => {
    const printContent = document.getElementById("goal-assignment-print-area");
    if (!printContent) return;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html><head><title>Monthly Goal Assignment - ${MONTHS[parseInt(selectedMonth) - 1]} ${selectedYear}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; font-size: 12px; }
        h2 { margin-bottom: 4px; }
        .subtitle { color: #666; margin-bottom: 16px; font-size: 11px; }
        .emp-card { margin-bottom: 18px; border: 1px solid #ddd; border-radius: 6px; page-break-inside: avoid; }
        .emp-header { background: #f5f5f5; padding: 8px 12px; font-weight: bold; font-size: 13px; border-bottom: 1px solid #ddd; display: flex; justify-content: space-between; }
        .emp-header .badge { background: #e0e0e0; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: normal; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ddd; padding: 5px 8px; text-align: left; }
        th { background: #f9f9f9; font-size: 11px; }
        td { font-size: 11px; }
        .mono { font-family: monospace; }
        .center { text-align: center; }
        @media print { .emp-card { page-break-inside: avoid; } }
      </style></head><body>
      <h2>Monthly Goal Assignment</h2>
      <div class="subtitle">${MONTHS[parseInt(selectedMonth) - 1]} ${selectedYear}</div>
      ${printContent.innerHTML}
      </body></html>
    `);
    win.document.close();
    win.print();
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Monthly Goal Assignment"
          description={`Assign KPIs to employees for ${MONTHS[parseInt(selectedMonth) - 1]} ${selectedYear}`}
        >
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-1" /> Print
          </Button>
        </PageHeader>

        <div className="flex flex-wrap gap-4 items-end">
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
              <SelectTrigger className="w-[220px]"><SelectValue placeholder="All Employees" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Employees</SelectItem>
                {employees.map((emp) => (
                  <SelectItem key={emp.id} value={emp.id}>{emp.employee_code} - {emp.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div id="goal-assignment-print-area">
        {(selectedEmployee === "all" ? employees : employees.filter((e) => e.id === selectedEmployee)).map((emp) => {
          const empGoals = goalsByEmployee[emp.id] || [];
          const empStatus = getEmployeeStatus(empGoals);
          const totalWeight = empGoals.reduce((sum: number, g: any) => sum + (g.weight ?? g.performance_monthly_kpis?.weight ?? 0), 0);

          return (
            <Card key={emp.id}>
              <CardHeader className="pb-3 bg-muted/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CardTitle className="text-base">{emp.employee_code} - {emp.full_name}</CardTitle>
                    {empStatus && <Badge variant={STATUS_COLORS[empStatus]}>{empStatus.replace("_", " ")}</Badge>}
                    <span className="text-xs text-muted-foreground">Weight: {totalWeight}</span>
                  </div>
                  <div className="flex gap-2">
                    {canEdit(empStatus) && (
                      <Button size="sm" variant="outline" onClick={() => openAssignDialog(emp.id)}>
                        <Plus className="h-3 w-3 mr-1" /> Assign KPIs
                      </Button>
                    )}
                    {canDelete(empStatus) && empGoals.length > 0 && (
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => {
                        if (confirm("Delete all goals for this employee?")) deleteAllMutation.mutate(emp.id);
                      }}>
                        <Trash2 className="h-3 w-3 mr-1" /> Delete All
                      </Button>
                    )}
                    {(!empStatus || empStatus === "draft") && empGoals.length > 0 && (
                      <Button size="sm" variant="secondary" onClick={() => statusMutation.mutate({ empId: emp.id, newStatus: "pending_review" })}>
                        <Send className="h-3 w-3 mr-1" /> Submit
                      </Button>
                    )}
                    {empStatus === "pending_review" && (
                      <Button size="sm" onClick={() => statusMutation.mutate({ empId: emp.id, newStatus: "approved" })}>
                        <CheckCircle className="h-3 w-3 mr-1" /> Approve
                      </Button>
                    )}
                    {empStatus === "approved" && (
                      <Button size="sm" variant="destructive" onClick={() => statusMutation.mutate({ empId: emp.id, newStatus: "closed" })}>
                        <Lock className="h-3 w-3 mr-1" /> Close Month
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              {empGoals.length > 0 ? (
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[60px]">Code</TableHead>
                        <TableHead>KPI</TableHead>
                        <TableHead className="w-[80px]">Weight</TableHead>
                        <TableHead className="w-[100px]">Target</TableHead>
                        <TableHead className="w-[100px]">Actual</TableHead>
                        <TableHead className="w-[80px]">Score</TableHead>
                        <TableHead className="w-[100px]">Status</TableHead>
                        <TableHead className="w-[80px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {empGoals.map((goal: any) => (
                        <TableRow key={goal.id}>
                          <TableCell className="font-mono text-xs">{goal.performance_monthly_kpis?.code}</TableCell>
                          <TableCell className="text-sm">{goal.performance_monthly_kpis?.name}</TableCell>
                          <TableCell>
                            {editingGoalId === goal.id ? (
                              <Input type="number" className="h-7 w-16" value={editWeightValue} onChange={(e) => setEditWeightValue(e.target.value)} />
                            ) : (
                              goal.weight ?? goal.performance_monthly_kpis?.weight
                            )}
                          </TableCell>
                          <TableCell>
                            {editingGoalId === goal.id ? (
                              <div className="flex gap-1">
                                <Input
                                  type="number"
                                  className="h-7 w-16"
                                  value={editTargetValue}
                                  onChange={(e) => setEditTargetValue(e.target.value)}
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") editMutation.mutate({ goalId: goal.id, targetValue: parseFloat(editTargetValue) || 0, weightValue: parseFloat(editWeightValue) || 0 });
                                    if (e.key === "Escape") setEditingGoalId(null);
                                  }}
                                />
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => editMutation.mutate({ goalId: goal.id, targetValue: parseFloat(editTargetValue) || 0, weightValue: parseFloat(editWeightValue) || 0 })}>
                                  <Save className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              goal.target_value
                            )}
                          </TableCell>
                          <TableCell>{goal.actual_value ?? "—"}</TableCell>
                          <TableCell>
                            {goal.score != null ? (
                              <Badge variant={goal.score >= ((goal.weight ?? goal.performance_monthly_kpis?.weight) * 0.8) ? "default" : goal.score >= ((goal.weight ?? goal.performance_monthly_kpis?.weight) * 0.5) ? "secondary" : "destructive"}>
                                {Number(goal.score).toFixed(1)}
                              </Badge>
                            ) : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={STATUS_COLORS[goal.status]}>{goal.status.replace("_", " ")}</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {canEdit(goal.status) && (
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingGoalId(goal.id); setEditTargetValue(String(goal.target_value)); setEditWeightValue(String(goal.weight ?? goal.performance_monthly_kpis?.weight ?? 0)); }}>
                                  <Pencil className="h-3 w-3" />
                                </Button>
                              )}
                              {canDelete(goal.status) && (
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => deleteMutation.mutate(goal.id)}>
                                  <Trash2 className="h-3 w-3 text-destructive" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              ) : (
                <CardContent className="py-6 text-center text-muted-foreground text-sm">
                  No KPIs assigned. Click "Assign KPIs" to add goals.
                </CardContent>
              )}
            </Card>
          );
        })}
        </div>

        <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Assign KPIs - {employees.find((e) => e.id === assignEmpId)?.full_name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {kpis.map((kpi) => (
                <div key={kpi.id} className="flex items-center gap-3 p-2 border rounded">
                  <Checkbox
                    checked={selectedKpis[kpi.id]?.checked || false}
                    onCheckedChange={(c) => setSelectedKpis((p) => ({ ...p, [kpi.id]: { ...p[kpi.id], checked: !!c, target: p[kpi.id]?.target || String(kpi.max_score || 100), weight: p[kpi.id]?.weight || String(kpi.weight || 0) } }))}
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{kpi.code} - {kpi.name}</div>
                    <div className="text-xs text-muted-foreground">Default Weight: {kpi.weight}</div>
                  </div>
                  <div className="w-20">
                    <Label className="text-[10px] text-muted-foreground">Weight</Label>
                    <Input
                      type="number"
                      className="h-8"
                      placeholder="Weight"
                      value={selectedKpis[kpi.id]?.weight || ""}
                      onChange={(e) => setSelectedKpis((p) => ({ ...p, [kpi.id]: { ...p[kpi.id], weight: e.target.value } }))}
                      disabled={!selectedKpis[kpi.id]?.checked}
                    />
                  </div>
                  <div className="w-24">
                    <Label className="text-[10px] text-muted-foreground">Target</Label>
                    <Input
                      type="number"
                      className="h-8"
                      placeholder="Target"
                      value={selectedKpis[kpi.id]?.target || ""}
                      onChange={(e) => setSelectedKpis((p) => ({ ...p, [kpi.id]: { ...p[kpi.id], target: e.target.value } }))}
                      disabled={!selectedKpis[kpi.id]?.checked}
                    />
                  </div>
                </div>
              ))}
            </div>
            <Button onClick={() => assignMutation.mutate()} disabled={assignMutation.isPending}>
              <Save className="h-4 w-4 mr-2" /> Save Assignments
            </Button>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}