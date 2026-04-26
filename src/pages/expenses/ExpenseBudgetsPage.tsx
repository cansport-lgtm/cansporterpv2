import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Plus, Edit, Trash2, AlertTriangle, TrendingUp, Target } from "lucide-react";
import { cn } from "@/lib/utils";

export default function ExpenseBudgetsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const currentDate = new Date();
  const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<any>(null);

  const [formData, setFormData] = useState({
    category_id: "",
    utility_type_id: "",
    department_id: "",
    budget_amount: "",
  });

  const monthStart = startOfMonth(new Date(selectedYear, selectedMonth - 1));
  const monthEnd = endOfMonth(new Date(selectedYear, selectedMonth - 1));

  // Fetch budgets
  const { data: budgets = [], isLoading } = useQuery({
    queryKey: ["expense-budgets", selectedYear, selectedMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expense_budgets")
        .select(`
          *,
          expense_categories(*),
          utility_types(*),
          production_departments(*)
        `)
        .eq("budget_year", selectedYear)
        .eq("budget_month", selectedMonth)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch actual expenses for budget comparison
  const { data: pettyCashEntries = [] } = useQuery({
    queryKey: ["petty-cash-entries-budget", selectedYear, selectedMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("petty_cash_entries")
        .select("*")
        .eq("entry_type", "expense")
        .gte("entry_date", format(monthStart, "yyyy-MM-dd"))
        .lte("entry_date", format(monthEnd, "yyyy-MM-dd"));
      if (error) throw error;
      return data || [];
    },
  });

  const { data: generalExpenses = [] } = useQuery({
    queryKey: ["general-expenses-budget", selectedYear, selectedMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("general_expenses")
        .select("*")
        .gte("expense_date", format(monthStart, "yyyy-MM-dd"))
        .lte("expense_date", format(monthEnd, "yyyy-MM-dd"));
      if (error) throw error;
      return data || [];
    },
  });

  const { data: utilityBills = [] } = useQuery({
    queryKey: ["utility-bills-budget", selectedYear, selectedMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("utility_bills")
        .select("*")
        .gte("bill_date", format(monthStart, "yyyy-MM-dd"))
        .lte("bill_date", format(monthEnd, "yyyy-MM-dd"));
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch categories, utility types, departments
  const { data: categories = [] } = useQuery({
    queryKey: ["expense-categories-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expense_categories")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: utilityTypes = [] } = useQuery({
    queryKey: ["utility-types"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("utility_types")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["production-departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  // Calculate actual spend for each budget
  const budgetsWithActual = useMemo(() => {
    return budgets.map(budget => {
      let actual = 0;

      if (budget.category_id) {
        const categoryPetty = pettyCashEntries
          .filter(e => e.category_id === budget.category_id)
          .reduce((sum, e) => sum + Number(e.amount), 0);
        const categoryGeneral = generalExpenses
          .filter(e => e.category_id === budget.category_id)
          .reduce((sum, e) => sum + Number(e.total_amount), 0);
        actual = categoryPetty + categoryGeneral;
      }

      if (budget.utility_type_id) {
        actual = utilityBills
          .filter(u => u.utility_type_id === budget.utility_type_id)
          .reduce((sum, u) => sum + Number(u.total_amount), 0);
      }

      const percentage = Number(budget.budget_amount) > 0 
        ? (actual / Number(budget.budget_amount)) * 100 
        : 0;

      return {
        ...budget,
        actual,
        percentage: Math.round(percentage * 10) / 10,
        remaining: Number(budget.budget_amount) - actual,
      };
    });
  }, [budgets, pettyCashEntries, generalExpenses, utilityBills]);

  // Summary stats
  const summary = useMemo(() => {
    const totalBudget = budgets.reduce((sum, b) => sum + Number(b.budget_amount), 0);
    const totalActual = budgetsWithActual.reduce((sum, b) => sum + b.actual, 0);
    const overBudgetCount = budgetsWithActual.filter(b => b.percentage > 100).length;
    const warningCount = budgetsWithActual.filter(b => b.percentage >= 80 && b.percentage <= 100).length;

    return { totalBudget, totalActual, overBudgetCount, warningCount };
  }, [budgets, budgetsWithActual]);

  // Create/Update mutation
  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const budgetData = {
        budget_year: selectedYear,
        budget_month: selectedMonth,
        category_id: data.category_id || null,
        utility_type_id: data.utility_type_id || null,
        department_id: data.department_id || null,
        budget_amount: parseFloat(data.budget_amount),
        created_by: user?.id,
      };

      if (editingBudget) {
        const { error } = await supabase
          .from("expense_budgets")
          .update(budgetData)
          .eq("id", editingBudget.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("expense_budgets")
          .insert(budgetData);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editingBudget ? "Budget updated" : "Budget created");
      setIsDialogOpen(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["expense-budgets"] });
    },
    onError: (error) => toast.error("Failed to save budget: " + error.message),
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("expense_budgets").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Budget deleted");
      queryClient.invalidateQueries({ queryKey: ["expense-budgets"] });
    },
    onError: (error) => toast.error("Failed to delete budget: " + error.message),
  });

  const resetForm = () => {
    setFormData({ category_id: "", utility_type_id: "", department_id: "", budget_amount: "" });
    setEditingBudget(null);
  };

  const handleEdit = (budget: any) => {
    setEditingBudget(budget);
    setFormData({
      category_id: budget.category_id || "",
      utility_type_id: budget.utility_type_id || "",
      department_id: budget.department_id || "",
      budget_amount: budget.budget_amount?.toString() || "",
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.budget_amount || (!formData.category_id && !formData.utility_type_id)) {
      toast.error("Please select a category/utility and enter budget amount");
      return;
    }
    saveMutation.mutate(formData);
  };

  const months = [
    { value: 1, label: "January" }, { value: 2, label: "February" }, { value: 3, label: "March" },
    { value: 4, label: "April" }, { value: 5, label: "May" }, { value: 6, label: "June" },
    { value: 7, label: "July" }, { value: 8, label: "August" }, { value: 9, label: "September" },
    { value: 10, label: "October" }, { value: 11, label: "November" }, { value: 12, label: "December" },
  ];

  const years = Array.from({ length: 5 }, (_, i) => currentDate.getFullYear() - 2 + i);

  const getStatusBadge = (percentage: number) => {
    if (percentage > 100) return <Badge variant="destructive">Over Budget</Badge>;
    if (percentage >= 80) return <Badge variant="secondary">Warning</Badge>;
    return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">On Track</Badge>;
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <PageHeader title="Expense Budgets" description="Set and track monthly expense budgets" />
          <div className="flex items-center gap-2">
            <Select value={selectedMonth.toString()} onValueChange={(v) => setSelectedMonth(parseInt(v))}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m.value} value={m.value.toString()}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(parseInt(v))}>
              <SelectTrigger className="w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => { resetForm(); setIsDialogOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" />
              Add Budget
            </Button>
          </div>
        </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <Target className="h-4 w-4" />
              Total Budget
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">₹{summary.totalBudget.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Actual Spend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">₹{summary.totalActual.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">
              {summary.totalBudget > 0 ? ((summary.totalActual / summary.totalBudget) * 100).toFixed(1) : 0}% of budget
            </p>
          </CardContent>
        </Card>
        <Card className={summary.overBudgetCount > 0 ? "border-destructive" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Over Budget
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.overBudgetCount}</p>
          </CardContent>
        </Card>
        <Card className={summary.warningCount > 0 ? "border-warning" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">80%+ Used</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.warningCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Budgets Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Budget Allocations for {months.find(m => m.value === selectedMonth)?.label} {selectedYear}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category/Utility</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead className="text-right">Budget</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="w-[200px]">Utilization</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {budgetsWithActual.map((budget) => (
                  <TableRow key={budget.id}>
                    <TableCell className="font-medium">
                      {budget.expense_categories?.name || budget.utility_types?.name || "-"}
                    </TableCell>
                    <TableCell>{budget.production_departments?.name || "All"}</TableCell>
                    <TableCell className="text-right">₹{Number(budget.budget_amount).toLocaleString()}</TableCell>
                    <TableCell className="text-right">₹{budget.actual.toLocaleString()}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress 
                          value={Math.min(budget.percentage, 100)} 
                          className={cn(
                            "h-2 flex-1",
                            budget.percentage > 100 ? "[&>div]:bg-destructive" : 
                            budget.percentage >= 80 ? "[&>div]:bg-warning" : ""
                          )}
                        />
                        <span className="text-xs w-12 text-right">{budget.percentage}%</span>
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(budget.percentage)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => handleEdit(budget)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive"
                          onClick={() => deleteMutation.mutate(budget.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {budgetsWithActual.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No budgets configured for this period
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

        {/* Add/Edit Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingBudget ? "Edit Budget" : "Add Budget"}</DialogTitle>
              <DialogDescription>
                {months.find(m => m.value === selectedMonth)?.label} {selectedYear}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Expense Category</Label>
                <Select
                  value={formData.category_id}
                  onValueChange={(v) => setFormData({ ...formData, category_id: v, utility_type_id: "" })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name} ({cat.category_type})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

            <div className="text-center text-muted-foreground text-sm">OR</div>

            <div className="space-y-2">
              <Label>Utility Type</Label>
              <Select
                value={formData.utility_type_id}
                onValueChange={(v) => setFormData({ ...formData, utility_type_id: v, category_id: "" })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select utility" />
                </SelectTrigger>
                <SelectContent>
                  {utilityTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Department (Optional)</Label>
              <Select
                value={formData.department_id || "all"}
                onValueChange={(v) => setFormData({ ...formData, department_id: v === "all" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All departments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {departments.map((dept) => (
                    <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Budget Amount (₹) *</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.budget_amount}
                onChange={(e) => setFormData({ ...formData, budget_amount: e.target.value })}
                placeholder="0.00"
              />
            </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setIsDialogOpen(false); resetForm(); }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saveMutation.isPending}>
                  {editingBudget ? "Update" : "Create"} Budget
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
