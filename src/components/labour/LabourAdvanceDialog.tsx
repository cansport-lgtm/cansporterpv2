// One dialog for both advances and travel advances (kind prop). Records a
// new one; a super admin can adjust (edit with a reason, delete with a
// reason) and see the change history. Everything is read-only while the
// labour salary for the month is locked — unlock first, then adjust.

import { useState, useEffect } from "react";
import { format } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Pencil, Trash2, Plus, Lock, History, ChevronDown, ChevronUp } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import {
  ADVANCE_LABEL,
  ADVANCE_PAGE_QUERY_KEY,
  ADVANCE_REASON_MIN,
  ADVANCE_TABLE,
  type AdvanceKind,
  type LabourAdvance,
  deleteLabourAdvance,
  monthLabel,
  monthRange,
  reasonTooShort,
  useLabourAdvanceHistory,
} from "@/lib/labourAdvances";

export interface LabourAdvanceDialogProps {
  kind: AdvanceKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: {
    id: string;
    employee_code: string;
    full_name: string;
  } | null;
  month: string;
  /** Labour salary locked for this month: nothing can be added or adjusted until it is unlocked. */
  locked?: boolean;
}

const fmtAmount = (n: number | undefined | null) => `Rs. ${Number(n ?? 0).toLocaleString()}`;

export const LabourAdvanceDialog = ({ kind, open, onOpenChange, employee, month, locked = false }: LabourAdvanceDialogProps) => {
  const { roles } = useAuth();
  const isSuperAdmin = roles.some((r) => r.role === "super_admin");
  const canAdjust = isSuperAdmin && !locked;
  const label = ADVANCE_LABEL[kind];
  const table = ADVANCE_TABLE[kind];
  const idPrefix = kind === "travel" ? "travel-advance" : "advance";

  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  const [reason, setReason] = useState("");
  const [advanceDate, setAdvanceDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleting, setDeleting] = useState<LabourAdvance | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const queryClient = useQueryClient();

  const { data: advances = [] } = useQuery({
    queryKey: [`employee-${kind === "travel" ? "travel-" : ""}advances`, employee?.id, month],
    queryFn: async () => {
      if (!employee) return [];
      const { start, end } = monthRange(month);
      const { data, error } = await supabase
        .from(table)
        .select("id, advance_date, amount, remarks, adjustment_reason, updated_at")
        .eq("employee_id", employee.id)
        .gte("advance_date", start)
        .lte("advance_date", end)
        .order("advance_date", { ascending: false });
      if (error) throw error;
      return (data || []) as LabourAdvance[];
    },
    enabled: !!employee && open,
  });

  const history = useLabourAdvanceHistory(kind, employee?.id, month, open && isSuperAdmin && showHistory);

  const resetForm = () => {
    setAmount("");
    setRemarks("");
    setReason("");
    setAdvanceDate(format(new Date(), "yyyy-MM-dd"));
    setEditingId(null);
    setShowForm(false);
  };

  useEffect(() => {
    if (!open) {
      resetForm();
      setDeleting(null);
      setDeleteReason("");
      setShowHistory(false);
    }
  }, [open]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [ADVANCE_PAGE_QUERY_KEY[kind]] });
    queryClient.invalidateQueries({ queryKey: [`employee-${kind === "travel" ? "travel-" : ""}advances`, employee?.id, month] });
    queryClient.invalidateQueries({ queryKey: ["labour-advance-history", kind, employee?.id, month] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!employee) throw new Error("No employee selected");
      if (editingId) {
        const { error } = await supabase
          .from(table)
          .update({
            advance_date: advanceDate,
            amount: parseFloat(amount),
            remarks: remarks || null,
            adjustment_reason: reason.trim(),
          })
          .eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from(table).insert({
          employee_id: employee.id,
          advance_date: advanceDate,
          amount: parseFloat(amount),
          remarks: remarks || null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editingId ? `${label} adjusted` : `${label} recorded`);
      invalidate();
      resetForm();
    },
    onError: (error) => toast.error(`Failed to save: ${error.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!deleting) return;
      await deleteLabourAdvance(kind, deleting.id, deleteReason);
    },
    onSuccess: () => {
      toast.success(`${label} deleted`);
      invalidate();
      setDeleting(null);
      setDeleteReason("");
    },
    onError: (error) => toast.error(`Failed to delete: ${error.message}`),
  });

  const handleEdit = (adv: LabourAdvance) => {
    setEditingId(adv.id);
    setAdvanceDate(adv.advance_date);
    setAmount(adv.amount.toString());
    setRemarks(adv.remarks || "");
    setReason("");
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }
    if (editingId && reasonTooShort(reason)) {
      toast.error(`Give a reason for the adjustment (at least ${ADVANCE_REASON_MIN} characters)`);
      return;
    }
    saveMutation.mutate();
  };

  if (!employee) return null;

  const totalAdvance = advances.reduce((sum, a) => sum + Number(a.amount), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{kind === "travel" ? "Travel Advance" : "Advance Payments"}</DialogTitle>
        </DialogHeader>

        <div className="p-3 bg-muted rounded-lg mb-4">
          <p className="text-sm text-muted-foreground">Employee</p>
          <p className="font-medium">
            {employee.employee_code} - {employee.full_name}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Total {label} ({monthLabel(month)}):{" "}
            <span className="font-medium text-foreground">{fmtAmount(totalAdvance)}</span>
          </p>
        </div>

        {locked && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <Lock className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Labour salary for {monthLabel(month)} is locked. {label}s can be viewed but not added or adjusted until the
              salary is unlocked.
            </span>
          </div>
        )}

        {advances.length > 0 && (
          <div className="border rounded-lg mb-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Remarks</TableHead>
                  {canAdjust && <TableHead className="w-20">Adjust</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {advances.map((adv) => (
                  <TableRow key={adv.id}>
                    <TableCell>{format(new Date(adv.advance_date), "dd MMM")}</TableCell>
                    <TableCell>{fmtAmount(adv.amount)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {adv.remarks || "-"}
                      {adv.updated_at && (
                        <span className="block text-xs italic" title={adv.adjustment_reason || undefined}>
                          Adjusted {format(new Date(adv.updated_at), "dd MMM")}
                          {adv.adjustment_reason ? `: ${adv.adjustment_reason}` : ""}
                        </span>
                      )}
                    </TableCell>
                    {canAdjust && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Adjust" onClick={() => handleEdit(adv)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            title="Delete"
                            onClick={() => {
                              setDeleteReason("");
                              setDeleting(adv);
                            }}
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

        {!locked &&
          (showForm ? (
            <form onSubmit={handleSubmit} className="space-y-4 border rounded-lg p-4">
              <div className="flex justify-between items-center">
                <h4 className="font-medium">{editingId ? `Adjust ${label}` : `New ${label}`}</h4>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor={`${idPrefix}-date`}>Date</Label>
                  <Input
                    id={`${idPrefix}-date`}
                    type="date"
                    value={advanceDate}
                    onChange={(e) => setAdvanceDate(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`${idPrefix}-amount`}>Amount (Rs.)</Label>
                  <Input
                    id={`${idPrefix}-amount`}
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
                <Label htmlFor={`${idPrefix}-remarks`}>Remarks (Optional)</Label>
                <Textarea
                  id={`${idPrefix}-remarks`}
                  placeholder="Add any notes..."
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={2}
                />
              </div>

              {editingId && (
                <div className="space-y-2">
                  <Label htmlFor={`${idPrefix}-reason`}>Reason for adjustment</Label>
                  <Textarea
                    id={`${idPrefix}-reason`}
                    placeholder="Why is this advance being changed?"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Required, at least {ADVANCE_REASON_MIN} characters. Kept with the change in the audit trail.
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? "Saving..." : editingId ? "Save Adjustment" : "Save"}
                </Button>
              </div>
            </form>
          ) : (
            <Button onClick={() => setShowForm(true)} className="w-full">
              <Plus className="h-4 w-4 mr-2" />
              Add {label}
            </Button>
          ))}

        {isSuperAdmin && (
          <div className="mt-4 border-t pt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-between text-muted-foreground"
              onClick={() => setShowHistory((v) => !v)}
            >
              <span className="flex items-center gap-2">
                <History className="h-4 w-4" />
                Change history ({monthLabel(month)})
              </span>
              {showHistory ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            {showHistory && (
              <div className="mt-2 space-y-2 text-sm">
                {history.isLoading && <p className="text-muted-foreground">Loading…</p>}
                {history.error && <p className="text-destructive">Could not load history: {(history.error as Error).message}</p>}
                {!history.isLoading && !history.error && (history.data?.length ?? 0) === 0 && (
                  <p className="text-muted-foreground">No changes recorded.</p>
                )}
                {history.data?.map((h) => (
                  <div key={h.id} className="rounded border px-3 py-2">
                    <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                      <span className="font-medium uppercase">
                        {h.action === "create" ? "Recorded" : h.action === "update" ? "Adjusted" : "Deleted"}
                      </span>
                      <span>
                        {h.created_at ? format(new Date(h.created_at), "dd MMM yyyy HH:mm") : ""}
                        {h.user_name ? ` · ${h.user_name}` : ""}
                      </span>
                    </div>
                    <div className="mt-1">
                      {h.action === "create" && h.after && (
                        <span>
                          {fmtAmount(h.after.amount)} on {h.after.advance_date ? format(new Date(h.after.advance_date), "dd MMM") : "-"}
                          {h.after.remarks ? ` (${h.after.remarks})` : ""}
                        </span>
                      )}
                      {h.action === "update" && h.before && h.after && (
                        <span>
                          {fmtAmount(h.before.amount)} on {h.before.advance_date ? format(new Date(h.before.advance_date), "dd MMM") : "-"}
                          {" → "}
                          {fmtAmount(h.after.amount)} on {h.after.advance_date ? format(new Date(h.after.advance_date), "dd MMM") : "-"}
                        </span>
                      )}
                      {h.action === "delete" && h.before && (
                        <span>
                          {fmtAmount(h.before.amount)} on {h.before.advance_date ? format(new Date(h.before.advance_date), "dd MMM") : "-"}
                          {h.before.remarks ? ` (${h.before.remarks})` : ""}
                        </span>
                      )}
                    </div>
                    {h.reason && h.action !== "create" && (
                      <p className="mt-1 text-xs text-muted-foreground">Reason: {h.reason}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this {label.toLowerCase()}?</AlertDialogTitle>
              <AlertDialogDescription>
                {deleting && (
                  <>
                    {fmtAmount(deleting.amount)} paid on {format(new Date(deleting.advance_date), "dd MMM yyyy")} to{" "}
                    {employee.full_name} will be removed and will no longer be deducted from the salary. The deletion and
                    your reason are kept in the audit trail.
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-delete-reason`}>Reason for deletion</Label>
              <Textarea
                id={`${idPrefix}-delete-reason`}
                placeholder="Why is this advance being deleted?"
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                rows={2}
              />
              <p className="text-xs text-muted-foreground">Required, at least {ADVANCE_REASON_MIN} characters.</p>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deleteMutation.isPending || reasonTooShort(deleteReason)}
                onClick={(e) => {
                  e.preventDefault();
                  deleteMutation.mutate();
                }}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
};
