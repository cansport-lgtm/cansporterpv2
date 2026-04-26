import { useState, useEffect } from "react";
import { format } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Pencil, Trash2, Plus } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";

interface OvertimeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: {
    id: string;
    employee_code: string;
    full_name: string;
  } | null;
  month: string;
}

interface OvertimeEntry {
  id: string;
  target_date: string;
  overtime_amount: number;
  remarks: string | null;
}

export const OvertimeDialog = ({ 
  open, 
  onOpenChange, 
  employee,
  month 
}: OvertimeDialogProps) => {
  const { roles, user } = useAuth();
  const isSuperAdmin = roles.some(r => r.role === 'super_admin');
  
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  const [overtimeDate, setOvertimeDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [selectedDepartment, setSelectedDepartment] = useState<string>("");
  const queryClient = useQueryClient();

  // Fetch overtime entries for this employee in the selected month
  const { data: overtimeEntries = [] } = useQuery({
    queryKey: ["employee-overtime", employee?.id, month],
    queryFn: async () => {
      if (!employee) return [];
      const startDate = `${month}-01`;
      const endDate = `${month}-31`;
      
      const { data, error } = await supabase
        .from("labour_productivity_targets")
        .select("id, target_date, overtime_amount, remarks")
        .eq("employee_id", employee.id)
        .gte("target_date", startDate)
        .lte("target_date", endDate)
        .gt("overtime_amount", 0)
        .order("target_date", { ascending: false });
      
      if (error) throw error;
      return data as OvertimeEntry[];
    },
    enabled: !!employee && open,
  });

  // Fetch productivity entries for this employee (to update overtime)
  const { data: productivityEntries = [] } = useQuery({
    queryKey: ["employee-productivity-entries", employee?.id, month],
    queryFn: async () => {
      if (!employee) return [];
      const startDate = `${month}-01`;
      const endDate = `${month}-31`;
      
      const { data, error } = await supabase
        .from("labour_productivity_targets")
        .select("id, target_date")
        .eq("employee_id", employee.id)
        .gte("target_date", startDate)
        .lte("target_date", endDate)
        .order("target_date", { ascending: false });
      
      if (error) throw error;
      return data;
    },
    enabled: !!employee && open,
  });

  // Fetch employee's department
  const { data: employeeDepartment } = useQuery({
    queryKey: ["employee-department", employee?.id],
    queryFn: async () => {
      if (!employee) return null;
      const { data, error } = await supabase
        .from("labour_employees")
        .select("department_id")
        .eq("id", employee.id)
        .maybeSingle();
      if (error) throw error;
      return data?.department_id || null;
    },
    enabled: !!employee && open,
  });

  // Fetch departments for selection
  const { data: departments = [] } = useQuery({
    queryKey: ["production-departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: open && !employeeDepartment,
  });

  const resetForm = () => {
    setAmount("");
    setRemarks("");
    setOvertimeDate(format(new Date(), "yyyy-MM-dd"));
    setEditingId(null);
    setShowForm(false);
    setSelectedDepartment("");
  };

  useEffect(() => {
    if (!open) {
      resetForm();
    }
  }, [open]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!employee) throw new Error("No employee selected");
      
      if (editingId) {
        // Update existing overtime on productivity entry
        const { error } = await supabase
          .from("labour_productivity_targets")
          .update({
            overtime_amount: parseFloat(amount),
            remarks: remarks || null,
          })
          .eq("id", editingId);
        if (error) throw error;
      } else {
        // Check if there's an existing entry for this date
        const existingEntry = productivityEntries.find(e => e.target_date === overtimeDate);
        
        if (existingEntry) {
          // Update existing entry with overtime
          const { error } = await supabase
            .from("labour_productivity_targets")
            .update({
              overtime_amount: parseFloat(amount),
              remarks: remarks || null,
            })
            .eq("id", existingEntry.id);
          if (error) throw error;
        } else {
          // Need to create a new productivity entry for overtime only
          const departmentId = employeeDepartment || selectedDepartment;
          
          if (!departmentId) {
            throw new Error("Please select a department for this overtime entry");
          }

          const { error } = await supabase
            .from("labour_productivity_targets")
            .insert({
              employee_id: employee.id,
              department_id: departmentId,
              target_date: overtimeDate,
              target_quantity: 0,
              actual_quantity: 0,
              work_type: "full_day",
              overtime_amount: parseFloat(amount),
              remarks: remarks ? `OT: ${remarks}` : "Overtime only entry",
              created_by: user?.id || null,
            });
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      toast.success(editingId ? "Overtime updated successfully" : "Overtime recorded successfully");
      queryClient.invalidateQueries({ queryKey: ["labour-productivity-month"] });
      queryClient.invalidateQueries({ queryKey: ["employee-overtime", employee?.id, month] });
      queryClient.invalidateQueries({ queryKey: ["employee-productivity-entries", employee?.id, month] });
      resetForm();
    },
    onError: (error) => {
      toast.error("Failed to save overtime: " + error.message);
    },
  });

  const clearOvertimeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("labour_productivity_targets")
        .update({ overtime_amount: 0 })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Overtime cleared successfully");
      queryClient.invalidateQueries({ queryKey: ["labour-productivity-month"] });
      queryClient.invalidateQueries({ queryKey: ["employee-overtime", employee?.id, month] });
    },
    onError: (error) => {
      toast.error("Failed to clear overtime: " + error.message);
    },
  });

  const handleEdit = (entry: OvertimeEntry) => {
    setEditingId(entry.id);
    setOvertimeDate(entry.target_date);
    setAmount(entry.overtime_amount.toString());
    setRemarks(entry.remarks || "");
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }
    saveMutation.mutate();
  };

  if (!employee) return null;

  const totalOvertime = overtimeEntries.reduce((sum, e) => sum + Number(e.overtime_amount), 0);

  // Check if we need department selection for new entries
  const needsDepartmentSelection = !employeeDepartment && !editingId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Overtime Payments</DialogTitle>
          <DialogDescription>Manage overtime entries for this employee</DialogDescription>
        </DialogHeader>

        <div className="p-3 bg-muted rounded-lg mb-4">
          <p className="text-sm text-muted-foreground">Employee</p>
          <p className="font-medium">{employee.employee_code} - {employee.full_name}</p>
          <p className="text-sm text-muted-foreground mt-1">
            Total Overtime: <span className="font-medium text-primary">Rs. {totalOvertime.toLocaleString()}</span>
          </p>
        </div>

        {/* Overtime List */}
        {overtimeEntries.length > 0 && (
          <div className="border rounded-lg mb-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Remarks</TableHead>
                  {isSuperAdmin && <TableHead className="w-20">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {overtimeEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{format(new Date(entry.target_date), "dd MMM")}</TableCell>
                    <TableCell>Rs. {entry.overtime_amount.toLocaleString()}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{entry.remarks || "-"}</TableCell>
                    {isSuperAdmin && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => handleEdit(entry)}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => clearOvertimeMutation.mutate(entry.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Add/Edit Form */}
        {showForm ? (
          <form onSubmit={handleSubmit} className="space-y-4 border rounded-lg p-4">
            <div className="flex justify-between items-center">
              <h4 className="font-medium">{editingId ? "Edit Overtime" : "New Overtime"}</h4>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="overtime-date">Date</Label>
                <Input
                  id="overtime-date"
                  type="date"
                  value={overtimeDate}
                  onChange={(e) => setOvertimeDate(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ot-amount">Amount (Rs.)</Label>
                <Input
                  id="ot-amount"
                  type="number"
                  placeholder="Enter amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  min="0"
                  step="1"
                  required
                />
              </div>
            </div>

            {needsDepartmentSelection && (
              <div className="space-y-2">
                <Label htmlFor="ot-department">Department *</Label>
                <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((dept) => (
                      <SelectItem key={dept.id} value={dept.id}>
                        {dept.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Employee has no department assigned. Select one for this entry.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="ot-remarks">Remarks (Optional)</Label>
              <Textarea
                id="ot-remarks"
                placeholder="Add any notes..."
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={2}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={resetForm}>
                Cancel
              </Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving..." : editingId ? "Update" : "Save"}
              </Button>
            </div>
          </form>
        ) : (
          <Button onClick={() => setShowForm(true)} className="w-full">
            <Plus className="h-4 w-4 mr-2" />
            Add Overtime
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
};
