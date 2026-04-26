import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Plus, Pencil, Filter } from "lucide-react";
import { toast } from "sonner";

const GOAL_STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "achieved", label: "Achieved" },
  { value: "not_achieved", label: "Not Achieved" },
  { value: "partially_achieved", label: "Partially Achieved" },
];

interface GoalFormData {
  review_cycle_id: string;
  employee_id: string;
  kpi_id: string;
  target_value: string;
  weight: string;
  actual_value: string;
  status: string;
  remarks: string;
}

export default function GoalAssignmentsPage() {
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<any>(null);
  const [filterCycle, setFilterCycle] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [formData, setFormData] = useState<GoalFormData>({
    review_cycle_id: "",
    employee_id: "",
    kpi_id: "",
    target_value: "",
    weight: "1.0",
    actual_value: "",
    status: "pending",
    remarks: "",
  });

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

  // Fetch employees
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

  // Fetch KPIs
  const { data: kpis = [] } = useQuery({
    queryKey: ["performance-kpis-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_kpis")
        .select("id, code, name, unit")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch goals
  const { data: goals = [], isLoading } = useQuery({
    queryKey: ["performance-goals", filterCycle, filterStatus],
    queryFn: async () => {
      let query = supabase
        .from("performance_goals")
        .select(`
          *,
          performance_review_cycles(name),
          employees(employee_code, full_name),
          performance_kpis(code, name, unit)
        `)
        .order("created_at", { ascending: false });

      if (filterCycle !== "all") {
        query = query.eq("review_cycle_id", filterCycle);
      }
      if (filterStatus !== "all") {
        query = query.eq("status", filterStatus);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  // Create/Update goal mutation
  const goalMutation = useMutation({
    mutationFn: async (data: GoalFormData & { id?: string }) => {
      const payload = {
        review_cycle_id: data.review_cycle_id,
        employee_id: data.employee_id,
        kpi_id: data.kpi_id,
        target_value: parseFloat(data.target_value),
        weight: parseFloat(data.weight) || 1.0,
        actual_value: data.actual_value ? parseFloat(data.actual_value) : null,
        status: data.status,
        remarks: data.remarks || null,
      };

      if (data.id) {
        const { error } = await supabase
          .from("performance_goals")
          .update(payload)
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("performance_goals").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["performance-goals"] });
      toast.success(selectedGoal ? "Goal updated!" : "Goal assigned!");
      setShowDialog(false);
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  const resetForm = () => {
    setFormData({
      review_cycle_id: "",
      employee_id: "",
      kpi_id: "",
      target_value: "",
      weight: "1.0",
      actual_value: "",
      status: "pending",
      remarks: "",
    });
    setSelectedGoal(null);
  };

  const handleAdd = () => {
    resetForm();
    // Pre-select active cycle if available
    const activeCycle = reviewCycles.find((c) => c.status === "active");
    if (activeCycle) {
      setFormData((prev) => ({ ...prev, review_cycle_id: activeCycle.id }));
    }
    setShowDialog(true);
  };

  const handleEdit = (goal: any) => {
    setSelectedGoal(goal);
    setFormData({
      review_cycle_id: goal.review_cycle_id,
      employee_id: goal.employee_id,
      kpi_id: goal.kpi_id,
      target_value: goal.target_value?.toString() || "",
      weight: goal.weight?.toString() || "1.0",
      actual_value: goal.actual_value?.toString() || "",
      status: goal.status,
      remarks: goal.remarks || "",
    });
    setShowDialog(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    goalMutation.mutate({ ...formData, id: selectedGoal?.id });
  };

  const getStatusVariant = (status: string) => {
    switch (status) {
      case "achieved":
        return "success";
      case "not_achieved":
        return "error";
      case "in_progress":
        return "warning";
      case "partially_achieved":
        return "warning";
      default:
        return "neutral";
    }
  };

  // Calculate score for display
  const calculateScore = (target: number, actual: number | null, weight: number) => {
    if (actual === null || target === 0) return null;
    const score = Math.min((actual / target) * weight, weight);
    return Math.round(score * 100) / 100;
  };

  const columns = [
    {
      key: "cycle",
      header: "Review Cycle",
      render: (row: any) => row.performance_review_cycles?.name || "-",
    },
    {
      key: "employee",
      header: "Employee",
      render: (row: any) => (
        <div>
          <div className="font-medium">{row.employees?.full_name}</div>
          <div className="text-xs text-muted-foreground">{row.employees?.employee_code}</div>
        </div>
      ),
    },
    {
      key: "kpi",
      header: "KPI",
      render: (row: any) => (
        <div>
          <div className="font-medium">{row.performance_kpis?.name}</div>
          <div className="text-xs text-muted-foreground">{row.performance_kpis?.code}</div>
        </div>
      ),
    },
    {
      key: "weight",
      header: "Weight",
      render: (row: any) => `${row.weight || 1}`,
    },
    {
      key: "target",
      header: "Target",
      render: (row: any) => `${row.target_value} ${row.performance_kpis?.unit || ""}`.trim(),
    },
    {
      key: "actual",
      header: "Actual",
      render: (row: any) =>
        row.actual_value !== null
          ? `${row.actual_value} ${row.performance_kpis?.unit || ""}`.trim()
          : "-",
    },
    {
      key: "score",
      header: "Score",
      render: (row: any) => {
        const score = calculateScore(row.target_value, row.actual_value, row.weight || 1);
        if (score === null) return "-";
        const percentage = Math.min((row.actual_value / row.target_value) * 100, 100);
        const colorClass = percentage >= 90 ? "text-green-600" : percentage >= 70 ? "text-blue-600" : percentage >= 50 ? "text-amber-600" : "text-red-600";
        return <span className={`font-medium ${colorClass}`}>{score}/{row.weight || 1}</span>;
      },
    },
    {
      key: "status",
      header: "Status",
      render: (row: any) => (
        <StatusBadge status={row.status.replace(/_/g, " ")} />
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row: any) => (
        <Button variant="ghost" size="icon" onClick={() => handleEdit(row)}>
          <Pencil className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Goal Assignments"
          description="Assign and track employee KPI goals"
        >
          <Button onClick={handleAdd}>
            <Plus className="h-4 w-4 mr-2" />
            Assign Goal
          </Button>
        </PageHeader>

        {/* Filters */}
        <div className="flex gap-4 items-center">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={filterCycle} onValueChange={setFilterCycle}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All Cycles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Cycles</SelectItem>
              {reviewCycles.map((cycle) => (
                <SelectItem key={cycle.id} value={cycle.id}>
                  {cycle.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {GOAL_STATUSES.map((status) => (
                <SelectItem key={status.value} value={status.value}>
                  {status.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DataTable
          columns={columns}
          data={goals}
          emptyMessage="No goals assigned. Start by assigning KPIs to employees."
        />

        {/* Goal Dialog */}
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {selectedGoal ? "Edit Goal" : "Assign Goal"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Review Cycle *</Label>
                <Select
                  value={formData.review_cycle_id}
                  onValueChange={(v) => setFormData({ ...formData, review_cycle_id: v })}
                  disabled={!!selectedGoal}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select cycle" />
                  </SelectTrigger>
                  <SelectContent>
                    {reviewCycles.map((cycle) => (
                      <SelectItem key={cycle.id} value={cycle.id}>
                        {cycle.name} ({cycle.status})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Employee *</Label>
                <Select
                  value={formData.employee_id}
                  onValueChange={(v) => setFormData({ ...formData, employee_id: v })}
                  disabled={!!selectedGoal}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select employee" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.full_name} ({emp.employee_code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>KPI *</Label>
                <Select
                  value={formData.kpi_id}
                  onValueChange={(v) => setFormData({ ...formData, kpi_id: v })}
                  disabled={!!selectedGoal}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select KPI" />
                  </SelectTrigger>
                  <SelectContent>
                    {kpis.map((kpi) => (
                      <SelectItem key={kpi.id} value={kpi.id}>
                        {kpi.name} ({kpi.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Target Value *</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.target_value}
                    onChange={(e) => setFormData({ ...formData, target_value: e.target.value })}
                    placeholder="100"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Weight</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={formData.weight}
                    onChange={(e) => setFormData({ ...formData, weight: e.target.value })}
                    placeholder="1.0"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Actual Value</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.actual_value}
                    onChange={(e) => setFormData({ ...formData, actual_value: e.target.value })}
                    placeholder="Enter when available"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(v) => setFormData({ ...formData, status: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GOAL_STATUSES.map((status) => (
                        <SelectItem key={status.value} value={status.value}>
                          {status.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Remarks</Label>
                <Textarea
                  value={formData.remarks}
                  onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                  placeholder="Any comments or notes..."
                  rows={2}
                />
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={goalMutation.isPending}>
                  {goalMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
