import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { toast } from "sonner";

export interface ProjectTask {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  assigned_to: string | null;
  start_date: string | null;
  due_date: string | null;
  completed_date: string | null;
  is_milestone: boolean | null;
  milestone_name: string | null;
  estimated_hours: number | null;
  actual_hours: number | null;
}

export interface TaskUser {
  id: string;
  full_name: string;
}

export const TASK_STATUSES = [
  { key: "todo", label: "To Do" },
  { key: "in_progress", label: "In Progress" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
];

const PRIORITIES = ["low", "medium", "high", "critical"];

/** Today as yyyy-MM-dd in the user's local timezone (toISOString would give the UTC date). */
export const todayStr = () => format(new Date(), "yyyy-MM-dd");

/** Returns an error message if the completed date is not acceptable, otherwise null. */
export function validateCompletedDate(completed: string, startDate?: string | null): string | null {
  if (!completed) return "Completed date is required for a done task";
  if (completed > todayStr()) return "Completed date cannot be in the future";
  if (startDate && completed < startDate) return "Completed date cannot be before the start date";
  return null;
}

interface TaskFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Task being edited, or null to create a new one */
  task: ProjectTask | null;
  /** Status preselected when creating */
  initialStatus?: string;
  users: TaskUser[];
  /** Receives the payload for project_tasks insert/update; return true on success to close the dialog */
  onSubmit: (payload: Record<string, unknown>) => Promise<boolean>;
}

export function TaskFormDialog({ open, onOpenChange, task, initialStatus = "todo", users, onSubmit }: TaskFormDialogProps) {
  const [form, setForm] = useState({
    title: "", description: "", priority: "medium", assigned_to: "", status: "todo",
    start_date: "", due_date: "", completed_date: "", is_milestone: false, milestone_name: "",
    estimated_hours: "", actual_hours: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      title: task?.title ?? "",
      description: task?.description ?? "",
      priority: task?.priority ?? "medium",
      assigned_to: task?.assigned_to ?? "",
      status: task?.status ?? initialStatus,
      start_date: task?.start_date ?? "",
      due_date: task?.due_date ?? "",
      completed_date: task?.completed_date ?? "",
      is_milestone: task?.is_milestone ?? false,
      milestone_name: task?.milestone_name ?? "",
      estimated_hours: task?.estimated_hours?.toString() ?? "",
      actual_hours: task?.actual_hours ? task.actual_hours.toString() : "",
    });
  }, [open, task, initialStatus]);

  const isDone = form.status === "done";

  const handleStatusChange = (status: string) => {
    setForm((f) => ({
      ...f,
      status,
      // Default the completion date when a task is marked done; clear it otherwise
      completed_date: status === "done" ? f.completed_date || todayStr() : "",
    }));
  };

  const handleSave = async () => {
    if (!form.title.trim()) { toast.error("Title is required"); return; }
    if (form.start_date && form.due_date && form.due_date < form.start_date) {
      toast.error("Due date cannot be before the start date"); return;
    }
    if (isDone) {
      const err = validateCompletedDate(form.completed_date, form.start_date);
      if (err) { toast.error(err); return; }
    }
    const estimated = form.estimated_hours ? parseFloat(form.estimated_hours) : 0;
    const actual = form.actual_hours ? parseFloat(form.actual_hours) : 0;
    if (estimated < 0 || actual < 0 || Number.isNaN(estimated) || Number.isNaN(actual)) {
      toast.error("Hours must be zero or more"); return;
    }

    const payload: Record<string, unknown> = {
      title: form.title.trim(),
      description: form.description || null,
      priority: form.priority,
      assigned_to: form.assigned_to || null,
      status: form.status,
      start_date: form.start_date || null,
      due_date: form.due_date || null,
      completed_date: isDone ? form.completed_date : null,
      is_milestone: form.is_milestone,
      milestone_name: form.is_milestone ? form.milestone_name : null,
      estimated_hours: estimated,
      actual_hours: actual,
    };

    setSaving(true);
    const ok = await onSubmit(payload);
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{task ? "Edit Task" : "New Task"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div><Label>Title *</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={handleStatusChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TASK_STATUSES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Assigned To</Label>
            <Select value={form.assigned_to} onValueChange={(v) => setForm({ ...form, assigned_to: v })}>
              <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
              <SelectContent>{users.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Start Date</Label><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
            <div><Label>Due Date</Label><Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
          </div>
          {isDone && (
            <div>
              <Label>Completed Date *</Label>
              <Input
                type="date"
                value={form.completed_date}
                max={todayStr()}
                min={form.start_date || undefined}
                onChange={(e) => setForm({ ...form, completed_date: e.target.value })}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Estimated Hours</Label><Input type="number" min={0} value={form.estimated_hours} onChange={(e) => setForm({ ...form, estimated_hours: e.target.value })} /></div>
            <div><Label>Actual Hours</Label><Input type="number" min={0} value={form.actual_hours} onChange={(e) => setForm({ ...form, actual_hours: e.target.value })} /></div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox checked={form.is_milestone} onCheckedChange={(v) => setForm({ ...form, is_milestone: !!v })} />
            <Label>Mark as Milestone</Label>
          </div>
          {form.is_milestone && (
            <div><Label>Milestone Name</Label><Input value={form.milestone_name} onChange={(e) => setForm({ ...form, milestone_name: e.target.value })} /></div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{task ? "Update" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface MoveTaskDialogProps {
  /** Task being moved and the column it was dropped on; null when closed */
  move: { task: ProjectTask; toStatus: string } | null;
  onCancel: () => void;
  /** Receives the update payload for the move; return true on success */
  onConfirm: (task: ProjectTask, payload: Record<string, unknown>) => Promise<boolean>;
}

/**
 * Confirmation shown when a card is dropped into or out of Done.
 * Into Done: asks for the completion date and actual hours.
 * Out of Done: asks the user to confirm reopening.
 */
export function MoveTaskDialog({ move, onCancel, onConfirm }: MoveTaskDialogProps) {
  const [completed, setCompleted] = useState(todayStr());
  const [actual, setActual] = useState("");
  const [saving, setSaving] = useState(false);

  const task = move?.task;
  useEffect(() => {
    if (!task) return;
    setCompleted(todayStr());
    setActual(task.actual_hours ? task.actual_hours.toString() : "");
  }, [task]);

  if (!move) return null;
  const completing = move.toStatus === "done";
  const toLabel = TASK_STATUSES.find((s) => s.key === move.toStatus)?.label ?? move.toStatus;

  const handleConfirm = async () => {
    const payload: Record<string, unknown> = { status: move.toStatus };
    if (completing) {
      const err = validateCompletedDate(completed, move.task.start_date);
      if (err) { toast.error(err); return; }
      const hours = actual ? parseFloat(actual) : 0;
      if (Number.isNaN(hours) || hours < 0) { toast.error("Actual hours must be zero or more"); return; }
      payload.completed_date = completed;
      payload.actual_hours = hours;
    } else {
      payload.completed_date = null;
    }
    setSaving(true);
    await onConfirm(move.task, payload);
    setSaving(false);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{completing ? "Mark task as done" : `Move out of Done`}</DialogTitle>
          <DialogDescription>
            {completing
              ? `“${move.task.title}” — confirm when it was completed.`
              : `Reopen “${move.task.title}” and move it to ${toLabel}? Its completed date will be cleared.`}
          </DialogDescription>
        </DialogHeader>
        {completing && (
          <div className="space-y-3">
            <div>
              <Label>Completed Date *</Label>
              <Input
                type="date"
                value={completed}
                max={todayStr()}
                min={move.task.start_date || undefined}
                onChange={(e) => setCompleted(e.target.value)}
              />
            </div>
            <div>
              <Label>Actual Hours{move.task.estimated_hours ? ` (est. ${move.task.estimated_hours})` : ""}</Label>
              <Input type="number" min={0} value={actual} onChange={(e) => setActual(e.target.value)} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={saving}>{completing ? "Mark Done" : "Reopen"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
