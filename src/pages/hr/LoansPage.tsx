import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Check, X, Pencil, Save, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";

interface Loan {
  id: string;
  employee_id: string;
  loan_amount: number;
  interest_rate: number;
  loan_date: string;
  repayment_start_date: string | null;
  monthly_installment: number;
  total_installments: number;
  paid_installments: number;
  remaining_amount: number;
  status: string;
  purpose: string | null;
  remarks: string | null;
  approved_by: string | null;
  approved_at: string | null;
  employees: { employee_code: string; full_name: string } | null;
  app_users: { full_name: string } | null;
}

interface Employee {
  id: string;
  employee_code: string;
  full_name: string;
}

const LoansPage = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, roles } = useAuth();
  const isSuperAdmin = roles.some((r) => r.role === "super_admin");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [editingEmiLoanId, setEditingEmiLoanId] = useState<string | null>(null);
  const [editEmiValue, setEditEmiValue] = useState("");
  const [editingProgressLoanId, setEditingProgressLoanId] = useState<string | null>(null);
  const [editPaidInstallments, setEditPaidInstallments] = useState("");
  const [editTotalInstallments, setEditTotalInstallments] = useState("");
  const [editRemainingAmount, setEditRemainingAmount] = useState("");

  // Form state
  const [formData, setFormData] = useState({
    employee_id: "",
    loan_amount: "",
    interest_rate: "0",
    loan_date: format(new Date(), "yyyy-MM-dd"),
    repayment_start_date: "",
    monthly_installment: "",
    total_installments: "",
    purpose: "",
    remarks: "",
  });

  // Fetch employees
  const { data: employees = [] } = useQuery({
    queryKey: ["employees-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, employee_code, full_name")
        .eq("is_active", true)
        .order("full_name", { ascending: true });
      if (error) throw error;
      return data as Employee[];
    },
  });

  // Fetch loans
  const { data: loans = [], isLoading } = useQuery({
    queryKey: ["employee-loans", statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("employee_loans")
        .select(`
          *,
          employees(employee_code, full_name),
          app_users!employee_loans_approved_by_fkey(full_name)
        `)
        .order("created_at", { ascending: false });

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Loan[];
    },
  });

  // Create loan mutation
  const createLoanMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const loanAmount = parseFloat(data.loan_amount);
      const { error } = await supabase.from("employee_loans").insert({
        employee_id: data.employee_id,
        loan_amount: loanAmount,
        interest_rate: parseFloat(data.interest_rate) || 0,
        loan_date: data.loan_date,
        repayment_start_date: data.repayment_start_date || null,
        monthly_installment: parseFloat(data.monthly_installment),
        total_installments: parseInt(data.total_installments),
        remaining_amount: loanAmount,
        purpose: data.purpose || null,
        remarks: data.remarks || null,
        status: "pending",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-loans"] });
      toast({ title: "Loan request created successfully" });
      setIsDialogOpen(false);
      resetForm();
    },
    onError: (error: Error) => {
      toast({ title: "Error creating loan", description: error.message, variant: "destructive" });
    },
  });

  // Approve loan mutation
  const approveLoanMutation = useMutation({
    mutationFn: async (loanId: string) => {
      const { error } = await supabase
        .from("employee_loans")
        .update({
          status: "approved",
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
        })
        .eq("id", loanId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-loans"] });
      toast({ title: "Loan approved successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error approving loan", description: error.message, variant: "destructive" });
    },
  });

  // Reject loan mutation
  const rejectLoanMutation = useMutation({
    mutationFn: async (loanId: string) => {
      const { error } = await supabase
        .from("employee_loans")
        .update({ status: "rejected" })
        .eq("id", loanId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-loans"] });
      toast({ title: "Loan rejected" });
    },
    onError: (error: Error) => {
      toast({ title: "Error rejecting loan", description: error.message, variant: "destructive" });
    },
  });

  // Delete loan mutation (super_admin only)
  const deleteLoanMutation = useMutation({
    mutationFn: async (loanId: string) => {
      const { error } = await supabase
        .from("employee_loans")
        .delete()
        .eq("id", loanId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-loans"] });
      toast({ title: "Loan deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error deleting loan", description: error.message, variant: "destructive" });
    },
  });


  // Update Progress mutation (super_admin only)
  const updateProgressMutation = useMutation({
    mutationFn: async ({ loanId, paidInstallments, totalInstallments, remainingAmount }: { loanId: string; paidInstallments: number; totalInstallments: number; remainingAmount: number }) => {
      const newStatus = paidInstallments >= totalInstallments ? "completed" : "active";
      const { error } = await supabase
        .from("employee_loans")
        .update({
          paid_installments: paidInstallments,
          total_installments: totalInstallments,
          remaining_amount: remainingAmount,
          status: newStatus,
        })
        .eq("id", loanId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-loans"] });
      toast({ title: "Progress updated successfully" });
      setEditingProgressLoanId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error updating progress", description: error.message, variant: "destructive" });
    },
  });

  // Update EMI mutation (super_admin only)
  const updateEmiMutation = useMutation({
    mutationFn: async ({ loanId, newEmi }: { loanId: string; newEmi: number }) => {
      const { error } = await supabase
        .from("employee_loans")
        .update({ monthly_installment: newEmi })
        .eq("id", loanId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-loans"] });
      toast({ title: "EMI updated successfully" });
      setEditingEmiLoanId(null);
      setEditEmiValue("");
    },
    onError: (error: Error) => {
      toast({ title: "Error updating EMI", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({
      employee_id: "",
      loan_amount: "",
      interest_rate: "0",
      loan_date: format(new Date(), "yyyy-MM-dd"),
      repayment_start_date: "",
      monthly_installment: "",
      total_installments: "",
      purpose: "",
      remarks: "",
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createLoanMutation.mutate(formData);
  };

  const columns = [
    {
      header: "Employee",
      key: "employees",
      render: (loan: Loan) => (
        <div>
          <div className="font-medium">{loan.employees?.full_name}</div>
          <div className="text-xs text-muted-foreground">{loan.employees?.employee_code}</div>
        </div>
      ),
    },
    {
      header: "Loan Amount",
      key: "loan_amount",
      render: (loan: Loan) => (
        <span className="font-medium">Rs. {Number(loan.loan_amount).toLocaleString()}</span>
      ),
    },
    {
      header: "Monthly EMI",
      key: "monthly_installment",
      render: (loan: Loan) => {
        if (isSuperAdmin && editingEmiLoanId === loan.id) {
          return (
            <div className="flex items-center gap-1">
              <Input
                type="number"
                className="h-7 w-24 text-sm"
                value={editEmiValue}
                onChange={(e) => setEditEmiValue(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const val = parseFloat(editEmiValue);
                    if (val > 0) updateEmiMutation.mutate({ loanId: loan.id, newEmi: val });
                  }
                  if (e.key === "Escape") { setEditingEmiLoanId(null); setEditEmiValue(""); }
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => {
                  const val = parseFloat(editEmiValue);
                  if (val > 0) updateEmiMutation.mutate({ loanId: loan.id, newEmi: val });
                }}
              >
                <Save className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => { setEditingEmiLoanId(null); setEditEmiValue(""); }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        }
        return (
          <div className="flex items-center gap-1">
            <span>Rs. {Number(loan.monthly_installment).toLocaleString()}</span>
            {isSuperAdmin && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={() => {
                  setEditingEmiLoanId(loan.id);
                  setEditEmiValue(String(loan.monthly_installment));
                }}
              >
                <Pencil className="h-3 w-3" />
              </Button>
            )}
          </div>
        );
      },
    },
    {
      header: "Progress",
      key: "paid_installments",
      render: (loan: Loan) => {
        if (isSuperAdmin && editingProgressLoanId === loan.id) {
          return (
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  className="h-7 w-16 text-sm"
                  value={editPaidInstallments}
                  onChange={(e) => setEditPaidInstallments(e.target.value)}
                  placeholder="Paid"
                  min={0}
                />
                <span className="text-sm">/</span>
                <Input
                  type="number"
                  className="h-7 w-16 text-sm"
                  value={editTotalInstallments}
                  onChange={(e) => setEditTotalInstallments(e.target.value)}
                  placeholder="Total"
                  min={1}
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">Rem:</span>
                <Input
                  type="number"
                  className="h-7 w-20 text-sm"
                  value={editRemainingAmount}
                  onChange={(e) => setEditRemainingAmount(e.target.value)}
                  placeholder="Remaining"
                  min={0}
                />
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onClick={() => {
                    const paid = parseInt(editPaidInstallments);
                    const total = parseInt(editTotalInstallments);
                    const remaining = parseFloat(editRemainingAmount);
                    if (!isNaN(paid) && !isNaN(total) && !isNaN(remaining) && total > 0) {
                      updateProgressMutation.mutate({ loanId: loan.id, paidInstallments: paid, totalInstallments: total, remainingAmount: remaining });
                    }
                  }}
                >
                  <Save className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onClick={() => setEditingProgressLoanId(null)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        }
        return (
          <div className="flex items-center gap-1">
            <div>
              <div className="text-sm">{loan.paid_installments} / {loan.total_installments}</div>
              <div className="text-xs text-muted-foreground">
                Remaining: Rs. {Number(loan.remaining_amount).toLocaleString()}
              </div>
            </div>
            {isSuperAdmin && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={() => {
                  setEditingProgressLoanId(loan.id);
                  setEditPaidInstallments(String(loan.paid_installments));
                  setEditTotalInstallments(String(loan.total_installments));
                  setEditRemainingAmount(String(loan.remaining_amount));
                }}
              >
                <Pencil className="h-3 w-3" />
              </Button>
            )}
          </div>
        );
      },
    },
    {
      header: "Loan Date",
      key: "loan_date",
      render: (loan: Loan) => format(new Date(loan.loan_date), "dd MMM yyyy"),
    },
    {
      header: "Status",
      key: "status",
      render: (loan: Loan) => <StatusBadge status={loan.status} />,
    },
    {
      header: "Actions",
      key: "actions",
      render: (loan: Loan) => (
        <div className="flex gap-2">
          {loan.status === "pending" && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="text-green-600 hover:text-green-700"
                onClick={() => approveLoanMutation.mutate(loan.id)}
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-red-600 hover:text-red-700"
                onClick={() => rejectLoanMutation.mutate(loan.id)}
              >
                <X className="h-4 w-4" />
              </Button>
            </>
          )}
          {(loan.status === "approved" || loan.status === "active") && loan.paid_installments < loan.total_installments && (
            <span className="text-xs text-muted-foreground italic">EMI auto-deducted on salary lock</span>
          )}
          {isSuperAdmin && (loan.status === "pending" || loan.status === "rejected") && (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                if (window.confirm('Are you sure you want to delete this loan record?')) {
                  deleteLoanMutation.mutate(loan.id);
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Employee Loans"
          description="Track and manage employee loan requests and repayments"
        />

        <div className="flex items-center justify-between gap-4">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>

          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                New Loan Request
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Create Loan Request</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="employee_id">Employee</Label>
                  <Select
                    value={formData.employee_id}
                    onValueChange={(value) => setFormData({ ...formData, employee_id: value })}
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

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="loan_amount">Loan Amount (Rs.)</Label>
                    <Input
                      id="loan_amount"
                      type="number"
                      value={formData.loan_amount}
                      onChange={(e) => setFormData({ ...formData, loan_amount: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="interest_rate">Interest Rate (%)</Label>
                    <Input
                      id="interest_rate"
                      type="number"
                      step="0.01"
                      value={formData.interest_rate}
                      onChange={(e) => setFormData({ ...formData, interest_rate: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="monthly_installment">Monthly EMI (Rs.)</Label>
                    <Input
                      id="monthly_installment"
                      type="number"
                      value={formData.monthly_installment}
                      onChange={(e) => setFormData({ ...formData, monthly_installment: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="total_installments">Total Installments</Label>
                    <Input
                      id="total_installments"
                      type="number"
                      value={formData.total_installments}
                      onChange={(e) => setFormData({ ...formData, total_installments: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="loan_date">Loan Date</Label>
                    <Input
                      id="loan_date"
                      type="date"
                      value={formData.loan_date}
                      onChange={(e) => setFormData({ ...formData, loan_date: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="repayment_start_date">Repayment Start Date</Label>
                    <Input
                      id="repayment_start_date"
                      type="date"
                      value={formData.repayment_start_date}
                      onChange={(e) => setFormData({ ...formData, repayment_start_date: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="purpose">Purpose</Label>
                  <Textarea
                    id="purpose"
                    value={formData.purpose}
                    onChange={(e) => setFormData({ ...formData, purpose: e.target.value })}
                    rows={2}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="remarks">Remarks</Label>
                  <Textarea
                    id="remarks"
                    value={formData.remarks}
                    onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                    rows={2}
                  />
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createLoanMutation.isPending}>
                    {createLoanMutation.isPending ? "Creating..." : "Create Loan"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <DataTable
          columns={columns}
          data={loans}
          emptyMessage={isLoading ? "Loading..." : "No loans found"}
        />
      </div>
    </ERPLayout>
  );
};

export default LoansPage;
