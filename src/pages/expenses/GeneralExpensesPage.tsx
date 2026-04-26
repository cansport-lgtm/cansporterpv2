import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
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
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { Plus, CalendarIcon, Search, Check, X, Eye, Upload, FileText, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

const PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "upi", label: "UPI" },
  { value: "credit_card", label: "Credit Card" },
];

export default function GeneralExpensesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [formData, setFormData] = useState({
    expense_date: new Date(),
    category_id: "",
    department_id: "",
    description: "",
    amount: "",
    tax_amount: "",
    vendor_name: "",
    vendor_gstin: "",
    invoice_number: "",
    invoice_date: null as Date | null,
    payment_mode: "",
    payment_reference: "",
  });

  // Fetch expenses
  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ["general-expenses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("general_expenses")
        .select(`
          *,
          expense_categories(*),
          production_departments(*),
          submitted_by_user:app_users!general_expenses_submitted_by_fkey(full_name),
          approved_by_user:app_users!general_expenses_approved_by_fkey(full_name)
        `)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch categories
  const { data: categories = [] } = useQuery({
    queryKey: ["expense-categories-general"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expense_categories")
        .select("*")
        .eq("category_type", "general")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch departments
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

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const amount = parseFloat(data.amount);
      const taxAmount = parseFloat(data.tax_amount || "0");
      
      const { error } = await supabase.from("general_expenses").insert({
        expense_date: format(data.expense_date, "yyyy-MM-dd"),
        category_id: data.category_id || null,
        department_id: data.department_id || null,
        description: data.description,
        amount: amount,
        tax_amount: taxAmount,
        total_amount: amount + taxAmount,
        vendor_name: data.vendor_name || null,
        vendor_gstin: data.vendor_gstin || null,
        invoice_number: data.invoice_number || null,
        invoice_date: data.invoice_date ? format(data.invoice_date, "yyyy-MM-dd") : null,
        payment_mode: data.payment_mode || null,
        payment_reference: data.payment_reference || null,
        created_by: user?.id,
        approval_status: "draft",
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Expense created successfully");
      setIsDialogOpen(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["general-expenses"] });
    },
    onError: (error) => toast.error("Failed to create expense: " + error.message),
  });

  // Submit for approval mutation
  const submitMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("general_expenses")
        .update({
          approval_status: "pending",
          submitted_by: user?.id,
          submitted_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Submitted for approval");
      queryClient.invalidateQueries({ queryKey: ["general-expenses"] });
    },
    onError: (error) => toast.error("Failed to submit: " + error.message),
  });

  // Approve/Reject mutation
  const approvalMutation = useMutation({
    mutationFn: async ({ id, status, remarks }: { id: string; status: "approved" | "rejected"; remarks?: string }) => {
      const { error } = await supabase
        .from("general_expenses")
        .update({
          approval_status: status,
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
          approval_remarks: remarks,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Approval updated");
      queryClient.invalidateQueries({ queryKey: ["general-expenses"] });
    },
    onError: (error) => toast.error("Failed to update: " + error.message),
  });

  // Mark as paid mutation
  const paymentMutation = useMutation({
    mutationFn: async ({ id, payment_mode, payment_reference }: { id: string; payment_mode: string; payment_reference?: string }) => {
      const { error } = await supabase
        .from("general_expenses")
        .update({
          payment_status: "paid",
          payment_date: format(new Date(), "yyyy-MM-dd"),
          payment_mode,
          payment_reference,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payment recorded");
      queryClient.invalidateQueries({ queryKey: ["general-expenses"] });
    },
    onError: (error) => toast.error("Failed to record payment: " + error.message),
  });

  const resetForm = () => {
    setFormData({
      expense_date: new Date(),
      category_id: "",
      department_id: "",
      description: "",
      amount: "",
      tax_amount: "",
      vendor_name: "",
      vendor_gstin: "",
      invoice_number: "",
      invoice_date: null,
      payment_mode: "",
      payment_reference: "",
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.description || !formData.amount) {
      toast.error("Please fill required fields");
      return;
    }
    createMutation.mutate(formData);
  };

  const filteredExpenses = expenses.filter((exp) => {
    const matchesSearch = exp.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      exp.expense_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      exp.vendor_name?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || exp.approval_status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "approved": return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Approved</Badge>;
      case "rejected": return <Badge variant="destructive">Rejected</Badge>;
      case "pending": return <Badge variant="secondary">Pending</Badge>;
      default: return <Badge variant="outline">Draft</Badge>;
    }
  };

  const getPaymentBadge = (status: string) => {
    switch (status) {
      case "paid": return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Paid</Badge>;
      case "partial": return <Badge variant="secondary">Partial</Badge>;
      default: return <Badge variant="outline">Pending</Badge>;
    }
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <PageHeader title="General Expenses" description="Manage operational expenses with approval workflow" />
        <Button onClick={() => setIsDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Expense
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search expenses..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Expenses Table */}
      <Card>
        <CardContent className="pt-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Expense #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Approval</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredExpenses.map((expense) => (
                  <TableRow key={expense.id}>
                    <TableCell className="font-mono text-xs">{expense.expense_number}</TableCell>
                    <TableCell>{format(parseISO(expense.expense_date), "dd MMM yy")}</TableCell>
                    <TableCell>{expense.expense_categories?.name || "-"}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{expense.description}</TableCell>
                    <TableCell>{expense.vendor_name || "-"}</TableCell>
                    <TableCell className="text-right font-medium">₹{Number(expense.total_amount).toLocaleString()}</TableCell>
                    <TableCell>{getStatusBadge(expense.approval_status)}</TableCell>
                    <TableCell>{getPaymentBadge(expense.payment_status)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => { setSelectedExpense(expense); setIsViewDialogOpen(true); }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {expense.approval_status === "draft" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => submitMutation.mutate(expense.id)}
                          >
                            Submit
                          </Button>
                        )}
                        {expense.approval_status === "pending" && (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-green-500"
                              onClick={() => approvalMutation.mutate({ id: expense.id, status: "approved" })}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive"
                              onClick={() => approvalMutation.mutate({ id: expense.id, status: "rejected" })}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredExpenses.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                      No expenses found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* New Expense Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New General Expense</DialogTitle>
            <DialogDescription>Create a new expense entry</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(formData.expense_date, "PPP")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={formData.expense_date}
                      onSelect={(date) => date && setFormData({ ...formData, expense_date: date })}
                      initialFocus
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={formData.category_id} onValueChange={(v) => setFormData({ ...formData, category_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Department</Label>
                <Select value={formData.department_id} onValueChange={(v) => setFormData({ ...formData, department_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((dept) => (
                      <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Payment Mode</Label>
                <Select value={formData.payment_mode} onValueChange={(v) => setFormData({ ...formData, payment_mode: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select mode" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_MODES.map((mode) => (
                      <SelectItem key={mode.value} value={mode.value}>{mode.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Description *</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Enter expense description"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Amount (₹) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label>Tax Amount (₹)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.tax_amount}
                  onChange={(e) => setFormData({ ...formData, tax_amount: e.target.value })}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label>Total</Label>
                <Input
                  readOnly
                  value={`₹${((parseFloat(formData.amount) || 0) + (parseFloat(formData.tax_amount) || 0)).toLocaleString()}`}
                  className="bg-muted"
                />
              </div>
            </div>

            <div className="border-t pt-4">
              <h4 className="font-medium mb-3">Vendor Details</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Vendor Name</Label>
                  <Input
                    value={formData.vendor_name}
                    onChange={(e) => setFormData({ ...formData, vendor_name: e.target.value })}
                    placeholder="Vendor/Supplier name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>GSTIN</Label>
                  <Input
                    value={formData.vendor_gstin}
                    onChange={(e) => setFormData({ ...formData, vendor_gstin: e.target.value })}
                    placeholder="GST Number"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Invoice Number</Label>
                  <Input
                    value={formData.invoice_number}
                    onChange={(e) => setFormData({ ...formData, invoice_number: e.target.value })}
                    placeholder="Invoice #"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Invoice Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start">
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {formData.invoice_date ? format(formData.invoice_date, "PPP") : "Select date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={formData.invoice_date || undefined}
                        onSelect={(date) => setFormData({ ...formData, invoice_date: date || null })}
                        initialFocus
                        className="pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setIsDialogOpen(false); resetForm(); }}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                Create Expense
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* View Expense Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Expense Details</DialogTitle>
            <DialogDescription>{selectedExpense?.expense_number}</DialogDescription>
          </DialogHeader>
          {selectedExpense && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Date:</span>
                  <p className="font-medium">{format(parseISO(selectedExpense.expense_date), "PPP")}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Category:</span>
                  <p className="font-medium">{selectedExpense.expense_categories?.name || "-"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Department:</span>
                  <p className="font-medium">{selectedExpense.production_departments?.name || "-"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Payment Mode:</span>
                  <p className="font-medium capitalize">{selectedExpense.payment_mode?.replace("_", " ") || "-"}</p>
                </div>
              </div>
              
              <div>
                <span className="text-muted-foreground text-sm">Description:</span>
                <p className="font-medium">{selectedExpense.description}</p>
              </div>

              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Amount:</span>
                  <p className="font-medium">₹{Number(selectedExpense.amount).toLocaleString()}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Tax:</span>
                  <p className="font-medium">₹{Number(selectedExpense.tax_amount || 0).toLocaleString()}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Total:</span>
                  <p className="font-bold">₹{Number(selectedExpense.total_amount).toLocaleString()}</p>
                </div>
              </div>

              {selectedExpense.vendor_name && (
                <div className="border-t pt-4">
                  <h4 className="font-medium mb-2 text-sm">Vendor Details</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <p>{selectedExpense.vendor_name}</p>
                    <p>{selectedExpense.vendor_gstin || "-"}</p>
                    <p>Invoice: {selectedExpense.invoice_number || "-"}</p>
                    <p>{selectedExpense.invoice_date ? format(parseISO(selectedExpense.invoice_date), "dd MMM yyyy") : "-"}</p>
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-4 border-t">
                <div className="flex-1">
                  <span className="text-muted-foreground text-sm">Approval:</span>
                  <div className="mt-1">{getStatusBadge(selectedExpense.approval_status)}</div>
                </div>
                <div className="flex-1">
                  <span className="text-muted-foreground text-sm">Payment:</span>
                  <div className="mt-1">{getPaymentBadge(selectedExpense.payment_status)}</div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      </div>
    </ERPLayout>
  );
}
