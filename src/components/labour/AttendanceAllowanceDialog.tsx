import { useState, useEffect } from "react";
import { format } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Pencil, Trash2, Plus } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";

interface AttendanceAllowanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: {
    id: string;
    employee_code: string;
    full_name: string;
  } | null;
  month: string;
}

interface AttendanceAllowance {
  id: string;
  allowance_date: string;
  amount: number;
  remarks: string | null;
}

export const AttendanceAllowanceDialog = ({ 
  open, 
  onOpenChange, 
  employee,
  month 
}: AttendanceAllowanceDialogProps) => {
  const { roles } = useAuth();
  const isSuperAdmin = roles.some(r => r.role === 'super_admin');
  
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  const [allowanceDate, setAllowanceDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();

  const { data: allowances = [] } = useQuery({
    queryKey: ["employee-attendance-allowances", employee?.id, month],
    queryFn: async () => {
      if (!employee) return [];
      const startDate = `${month}-01`;
      const endDate = `${month}-31`;
      
      const { data, error } = await supabase
        .from("labour_attendance_allowances")
        .select("id, allowance_date, amount, remarks")
        .eq("employee_id", employee.id)
        .gte("allowance_date", startDate)
        .lte("allowance_date", endDate)
        .order("allowance_date", { ascending: false });
      
      if (error) throw error;
      return data as AttendanceAllowance[];
    },
    enabled: !!employee && open,
  });

  const resetForm = () => {
    setAmount("");
    setRemarks("");
    setAllowanceDate(format(new Date(), "yyyy-MM-dd"));
    setEditingId(null);
    setShowForm(false);
  };

  useEffect(() => {
    if (!open) resetForm();
  }, [open]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!employee) throw new Error("No employee selected");
      
      if (editingId) {
        const { error } = await supabase
          .from("labour_attendance_allowances")
          .update({
            allowance_date: allowanceDate,
            amount: parseFloat(amount),
            remarks: remarks || null,
          })
          .eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("labour_attendance_allowances")
          .insert({
            employee_id: employee.id,
            allowance_date: allowanceDate,
            amount: parseFloat(amount),
            remarks: remarks || null,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editingId ? "Attendance allowance updated" : "Attendance allowance recorded");
      queryClient.invalidateQueries({ queryKey: ["labour-attendance-allowances"] });
      queryClient.invalidateQueries({ queryKey: ["employee-attendance-allowances", employee?.id, month] });
      resetForm();
    },
    onError: (error) => {
      toast.error("Failed to save: " + error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("labour_attendance_allowances")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Attendance allowance deleted");
      queryClient.invalidateQueries({ queryKey: ["labour-attendance-allowances"] });
      queryClient.invalidateQueries({ queryKey: ["employee-attendance-allowances", employee?.id, month] });
    },
    onError: (error) => {
      toast.error("Failed to delete: " + error.message);
    },
  });

  const handleEdit = (alw: AttendanceAllowance) => {
    setEditingId(alw.id);
    setAllowanceDate(alw.allowance_date);
    setAmount(alw.amount.toString());
    setRemarks(alw.remarks || "");
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

  const totalAllowance = allowances.reduce((sum, a) => sum + Number(a.amount), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Attendance Allowance</DialogTitle>
        </DialogHeader>

        <div className="p-3 bg-muted rounded-lg mb-4">
          <p className="text-sm text-muted-foreground">Employee</p>
          <p className="font-medium">{employee.employee_code} - {employee.full_name}</p>
          <p className="text-sm text-muted-foreground mt-1">
            Total Attendance Allowance: <span className="font-medium text-foreground">Rs. {totalAllowance.toLocaleString()}</span>
          </p>
        </div>

        {allowances.length > 0 && (
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
                {allowances.map((alw) => (
                  <TableRow key={alw.id}>
                    <TableCell>{format(new Date(alw.allowance_date), "dd MMM")}</TableCell>
                    <TableCell>Rs. {alw.amount.toLocaleString()}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{alw.remarks || "-"}</TableCell>
                    {isSuperAdmin && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleEdit(alw)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => deleteMutation.mutate(alw.id)}>
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

        {showForm ? (
          <form onSubmit={handleSubmit} className="space-y-4 border rounded-lg p-4">
            <div className="flex justify-between items-center">
              <h4 className="font-medium">{editingId ? "Edit Attendance Allowance" : "New Attendance Allowance"}</h4>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="att-allowance-date">Date</Label>
                <Input id="att-allowance-date" type="date" value={allowanceDate} onChange={(e) => setAllowanceDate(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="att-amount">Amount (Rs.)</Label>
                <Input id="att-amount" type="number" placeholder="Enter amount" value={amount} onChange={(e) => setAmount(e.target.value)} min="0" step="1" required />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="att-remarks">Remarks (Optional)</Label>
              <Textarea id="att-remarks" placeholder="Add any notes..." value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={resetForm}>Cancel</Button>
              <Button type="submit" disabled={saveMutation.isPending}>{saveMutation.isPending ? "Saving..." : editingId ? "Update" : "Save"}</Button>
            </div>
          </form>
        ) : (
          <Button onClick={() => setShowForm(true)} className="w-full">
            <Plus className="h-4 w-4 mr-2" />
            Add Attendance Allowance
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
};
