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

interface AdvancePaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: {
    id: string;
    employee_code: string;
    full_name: string;
  } | null;
  month: string;
}

interface Advance {
  id: string;
  advance_date: string;
  amount: number;
  remarks: string | null;
}

export const AdvancePaymentDialog = ({ 
  open, 
  onOpenChange, 
  employee,
  month 
}: AdvancePaymentDialogProps) => {
  const { roles } = useAuth();
  const isSuperAdmin = roles.some(r => r.role === 'super_admin');
  
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  const [advanceDate, setAdvanceDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();

  // Fetch advances for this employee in the selected month
  const { data: advances = [] } = useQuery({
    queryKey: ["employee-advances", employee?.id, month],
    queryFn: async () => {
      if (!employee) return [];
      const startDate = `${month}-01`;
      const endDate = `${month}-31`;
      
      const { data, error } = await supabase
        .from("labour_advances")
        .select("id, advance_date, amount, remarks")
        .eq("employee_id", employee.id)
        .gte("advance_date", startDate)
        .lte("advance_date", endDate)
        .order("advance_date", { ascending: false });
      
      if (error) throw error;
      return data as Advance[];
    },
    enabled: !!employee && open,
  });

  const resetForm = () => {
    setAmount("");
    setRemarks("");
    setAdvanceDate(format(new Date(), "yyyy-MM-dd"));
    setEditingId(null);
    setShowForm(false);
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
        // Update existing
        const { error } = await supabase
          .from("labour_advances")
          .update({
            advance_date: advanceDate,
            amount: parseFloat(amount),
            remarks: remarks || null,
          })
          .eq("id", editingId);
        if (error) throw error;
      } else {
        // Insert new
        const { error } = await supabase
          .from("labour_advances")
          .insert({
            employee_id: employee.id,
            advance_date: advanceDate,
            amount: parseFloat(amount),
            remarks: remarks || null,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editingId ? "Advance updated successfully" : "Advance recorded successfully");
      queryClient.invalidateQueries({ queryKey: ["labour-advances", month] });
      queryClient.invalidateQueries({ queryKey: ["employee-advances", employee?.id, month] });
      resetForm();
    },
    onError: (error) => {
      toast.error("Failed to save advance: " + error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("labour_advances")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Advance deleted successfully");
      queryClient.invalidateQueries({ queryKey: ["labour-advances", month] });
      queryClient.invalidateQueries({ queryKey: ["employee-advances", employee?.id, month] });
    },
    onError: (error) => {
      toast.error("Failed to delete advance: " + error.message);
    },
  });

  const handleEdit = (advance: Advance) => {
    setEditingId(advance.id);
    setAdvanceDate(advance.advance_date);
    setAmount(advance.amount.toString());
    setRemarks(advance.remarks || "");
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

  const totalAdvance = advances.reduce((sum, a) => sum + Number(a.amount), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Advance Payments</DialogTitle>
        </DialogHeader>

        <div className="p-3 bg-muted rounded-lg mb-4">
          <p className="text-sm text-muted-foreground">Employee</p>
          <p className="font-medium">{employee.employee_code} - {employee.full_name}</p>
          <p className="text-sm text-muted-foreground mt-1">
            Total Advance: <span className="font-medium text-foreground">Rs. {totalAdvance.toLocaleString()}</span>
          </p>
        </div>

        {/* Advances List */}
        {advances.length > 0 && (
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
                {advances.map((adv) => (
                  <TableRow key={adv.id}>
                    <TableCell>{format(new Date(adv.advance_date), "dd MMM")}</TableCell>
                    <TableCell>Rs. {adv.amount.toLocaleString()}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{adv.remarks || "-"}</TableCell>
                    {isSuperAdmin && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => handleEdit(adv)}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => deleteMutation.mutate(adv.id)}
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
              <h4 className="font-medium">{editingId ? "Edit Advance" : "New Advance"}</h4>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="advance-date">Date</Label>
                <Input
                  id="advance-date"
                  type="date"
                  value={advanceDate}
                  onChange={(e) => setAdvanceDate(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="amount">Amount (Rs.)</Label>
                <Input
                  id="amount"
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

            <div className="space-y-2">
              <Label htmlFor="remarks">Remarks (Optional)</Label>
              <Textarea
                id="remarks"
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
            Add Advance
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
};