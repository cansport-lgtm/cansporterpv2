import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  DEFAULT_DUTY_END,
  DEFAULT_DUTY_HOURS,
  DEFAULT_DUTY_START,
  DEFAULT_LATE_GRACE_MINUTES,
  hoursBetween,
  lateAfter,
  shortTime,
} from "@/lib/officialTiming";

export interface TimingEmployee {
  id: string;
  employee_code: string;
  full_name: string;
  department_id: string | null;
  production_departments?: { id: string; name: string } | null;
  duty_start_time?: string | null;
  duty_end_time?: string | null;
  duty_hours?: number | null;
  late_grace_minutes?: number | null;
}

interface TimingRow {
  duty_start_time: string;
  duty_end_time: string;
  duty_hours: string;
  late_grace_minutes: string;
}

const rowFrom = (e: TimingEmployee): TimingRow => ({
  duty_start_time: shortTime(e.duty_start_time) || DEFAULT_DUTY_START,
  duty_end_time: shortTime(e.duty_end_time) || DEFAULT_DUTY_END,
  duty_hours: String(e.duty_hours ?? DEFAULT_DUTY_HOURS),
  late_grace_minutes: String(e.late_grace_minutes ?? DEFAULT_LATE_GRACE_MINUTES),
});

const sameRow = (a: TimingRow, b: TimingRow) =>
  a.duty_start_time === b.duty_start_time &&
  a.duty_end_time === b.duty_end_time &&
  Number(a.duty_hours) === Number(b.duty_hours) &&
  Number(a.late_grace_minutes) === Number(b.late_grace_minutes);

// Changing start/end keeps the same unpaid break (span − hours/day):
// 09:00–18:00 at 8h has a 1h break, so moving the end to 17:00 gives 7h.
const withTime = (row: TimingRow, field: "duty_start_time" | "duty_end_time", value: string): TimingRow => {
  const next = { ...row, [field]: value };
  const oldSpan = hoursBetween(row.duty_start_time, row.duty_end_time);
  const newSpan = hoursBetween(next.duty_start_time, next.duty_end_time);
  const hours = Number(row.duty_hours);
  if (oldSpan === null || newSpan === null || Number.isNaN(hours)) return next;
  const breakHours = Math.max(0, oldSpan - hours);
  next.duty_hours = String(Math.max(0.5, newSpan - breakHours));
  return next;
};

const rowError = (r: TimingRow) => {
  if (!r.duty_start_time || !r.duty_end_time) return "Start and end time are required";
  const hours = Number(r.duty_hours);
  if (!r.duty_hours || Number.isNaN(hours) || hours <= 0 || hours > 24) return "Hours/day must be between 0.5 and 24";
  const grace = Number(r.late_grace_minutes);
  if (r.late_grace_minutes === "" || !Number.isInteger(grace) || grace < 0 || grace > 240) return "Grace must be 0–240 minutes";
  return null;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: TimingEmployee[];
  departments: { id: string; name: string }[];
}

export function OfficialTimingsDialog({ open, onOpenChange, employees, departments }: Props) {
  const queryClient = useQueryClient();
  // Mounted only while open (see EmployeesPage), so this is a fresh copy of the saved timings each time.
  const [rows, setRows] = useState<Record<string, TimingRow>>(() => Object.fromEntries(employees.map((e) => [e.id, rowFrom(e)])));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [bulk, setBulk] = useState<TimingRow>({
    duty_start_time: DEFAULT_DUTY_START,
    duty_end_time: DEFAULT_DUTY_END,
    duty_hours: String(DEFAULT_DUTY_HOURS),
    late_grace_minutes: String(DEFAULT_LATE_GRACE_MINUTES),
  });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter(
      (e) =>
        (departmentFilter === "all" || e.department_id === departmentFilter) &&
        (!q || e.full_name.toLowerCase().includes(q) || e.employee_code.toLowerCase().includes(q))
    );
  }, [employees, search, departmentFilter]);

  const changedIds = useMemo(
    () => employees.filter((e) => rows[e.id] && !sameRow(rows[e.id], rowFrom(e))).map((e) => e.id),
    [employees, rows]
  );

  const allVisibleSelected = visible.length > 0 && visible.every((e) => selected.has(e.id));

  const toggleAllVisible = (checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      visible.forEach((e) => (checked ? next.add(e.id) : next.delete(e.id)));
      return next;
    });

  const toggleOne = (id: string, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const updateRow = (id: string, row: TimingRow) => setRows((prev) => ({ ...prev, [id]: row }));

  const applyBulk = () => {
    const err = rowError(bulk);
    if (err) return toast.error(err);
    if (selected.size === 0) return toast.error("Tick the employees to apply this timing to");
    setRows((prev) => {
      const next = { ...prev };
      selected.forEach((id) => (next[id] = { ...bulk }));
      return next;
    });
    toast.success(`Timing applied to ${selected.size} employee(s) — click Save to keep it`);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      // One update per distinct timing, so a bulk change is a single request.
      const groups = new Map<string, { values: TimingRow; ids: string[] }>();
      changedIds.forEach((id) => {
        const r = rows[id];
        const key = [r.duty_start_time, r.duty_end_time, Number(r.duty_hours), Number(r.late_grace_minutes)].join("|");
        const g = groups.get(key) ?? { values: r, ids: [] };
        g.ids.push(id);
        groups.set(key, g);
      });
      for (const { values, ids } of groups.values()) {
        const { error } = await supabase
          .from("employees")
          .update({
            duty_start_time: values.duty_start_time,
            duty_end_time: values.duty_end_time,
            duty_hours: Number(values.duty_hours),
            late_grace_minutes: Number(values.late_grace_minutes),
          })
          .in("id", ids);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr-employees-list"] });
      queryClient.invalidateQueries({ queryKey: ["employees-active"] });
      queryClient.invalidateQueries({ queryKey: ["hr-employees-time-sheet"] });
      toast.success(`Official timing updated for ${changedIds.length} employee(s)`);
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message || "Failed to save official timings"),
  });

  const handleSave = () => {
    const bad = changedIds.find((id) => rowError(rows[id]));
    if (bad) {
      const emp = employees.find((e) => e.id === bad);
      return toast.error(`${emp?.full_name}: ${rowError(rows[bad])}`);
    }
    saveMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Official Timings</DialogTitle>
          <DialogDescription>
            Each staff member's duty start, end, hours per day and late grace. Check-ins after start + grace count as late.
          </DialogDescription>
        </DialogHeader>

        {/* Bulk apply */}
        <div className="rounded-lg border bg-muted/30 p-3">
          <Label className="text-sm font-semibold text-muted-foreground">Apply to ticked employees</Label>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5 sm:items-end">
            <div>
              <Label className="text-xs">Start</Label>
              <Input type="time" value={bulk.duty_start_time} onChange={(e) => setBulk(withTime(bulk, "duty_start_time", e.target.value))} />
            </div>
            <div>
              <Label className="text-xs">End</Label>
              <Input type="time" value={bulk.duty_end_time} onChange={(e) => setBulk(withTime(bulk, "duty_end_time", e.target.value))} />
            </div>
            <div>
              <Label className="text-xs">Hours/Day</Label>
              <Input type="number" min="0.5" max="24" step="0.5" value={bulk.duty_hours} onChange={(e) => setBulk({ ...bulk, duty_hours: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Grace (min)</Label>
              <Input type="number" min="0" max="240" step="1" value={bulk.late_grace_minutes} onChange={(e) => setBulk({ ...bulk, late_grace_minutes: e.target.value })} />
            </div>
            <Button type="button" variant="secondary" onClick={applyBulk} className="col-span-2 sm:col-span-1">
              Apply to {selected.size} ticked
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search employee..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-[220px] pl-9" />
          </div>
          <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Department" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {changedIds.length > 0 && <Badge variant="secondary" className="self-center">{changedIds.length} unsaved change(s)</Badge>}
        </div>

        {/* Per-employee editor */}
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted">
              <tr className="text-left">
                <th className="w-10 px-3 py-2">
                  <Checkbox checked={allVisibleSelected} onCheckedChange={(c) => toggleAllVisible(c === true)} aria-label="Tick all shown" />
                </th>
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2">Department</th>
                <th className="px-3 py-2">Start</th>
                <th className="px-3 py-2">End</th>
                <th className="px-3 py-2">Hours/Day</th>
                <th className="px-3 py-2">Grace (min)</th>
                <th className="px-3 py-2">Late after</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((emp) => {
                const row = rows[emp.id];
                if (!row) return null;
                const changed = changedIds.includes(emp.id);
                return (
                  <tr key={emp.id} className={changed ? "border-t bg-amber-500/10" : "border-t"}>
                    <td className="px-3 py-1.5">
                      <Checkbox checked={selected.has(emp.id)} onCheckedChange={(c) => toggleOne(emp.id, c === true)} aria-label={`Tick ${emp.full_name}`} />
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="font-medium">{emp.full_name}</div>
                      <div className="text-xs text-muted-foreground">{emp.employee_code}</div>
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">{emp.production_departments?.name || "-"}</td>
                    <td className="px-3 py-1.5">
                      <Input type="time" className="h-8 w-[110px]" value={row.duty_start_time} onChange={(e) => updateRow(emp.id, withTime(row, "duty_start_time", e.target.value))} />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input type="time" className="h-8 w-[110px]" value={row.duty_end_time} onChange={(e) => updateRow(emp.id, withTime(row, "duty_end_time", e.target.value))} />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input type="number" className="h-8 w-[80px]" min="0.5" max="24" step="0.5" value={row.duty_hours} onChange={(e) => updateRow(emp.id, { ...row, duty_hours: e.target.value })} />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input type="number" className="h-8 w-[80px]" min="0" max="240" step="1" value={row.late_grace_minutes} onChange={(e) => updateRow(emp.id, { ...row, late_grace_minutes: e.target.value })} />
                    </td>
                    <td className="px-3 py-1.5 font-mono text-xs">
                      {row.duty_start_time ? lateAfter({ duty_start_time: row.duty_start_time, late_grace_minutes: Number(row.late_grace_minutes) || 0 }) : "-"}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No employees found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={handleSave} disabled={changedIds.length === 0 || saveMutation.isPending}>
            {saveMutation.isPending ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Saving...</> : `Save ${changedIds.length || ""} change(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
