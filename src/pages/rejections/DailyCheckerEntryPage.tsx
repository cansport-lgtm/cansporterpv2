import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ClipboardCheck, Boxes, Loader2, Save, Plus, X, ChevronRight, ChevronDown,
  AlertTriangle, Info,
} from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Rejection % above this is flagged for review before the balls are handed over.
const DEFECT_BAND_PCT = 2;

type Checkpoint = {
  defect_grade_id: string;
  location_id: string;
  sort_order: number;
  grade_code: string;
  grade_name: string;
  grade_name_urdu: string | null;
  onward_route: string;
  location_code: string;
  location_name: string;
};

type BallGrade = { id: string; code: string; name: string };

/** One editable row: a ball grade, its per-defect counts, and its interval tally. */
type Row = {
  gradeId: string;
  qty: Record<string, string>;                 // defect_grade_id -> typed quantity
  intervals: Record<string, string[]>;         // defect_grade_id -> per-interval quantities
  openGrade: string | null;                    // which grade's tally is expanded
};

const num = (v: string | number | null | undefined) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function DailyCheckerEntryPage() {
  const today = format(new Date(), "yyyy-MM-dd");
  const { user } = useAuth();
  const qc = useQueryClient();

  const [entryDate, setEntryDate] = useState(today);
  const [departmentId, setDepartmentId] = useState("");
  const [shift, setShift] = useState("Day");
  const [checkedBy, setCheckedBy] = useState("none");
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);

  // Departments that actually have a checker — the mapping decides, not a guess.
  const { data: departments = [] } = useQuery({
    queryKey: ["rw-checker-departments"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("rw_department_defect_grades")
        .select("department_id, production_departments(id, name)")
        .eq("is_active", true);
      const seen = new Map<string, { id: string; name: string }>();
      for (const r of (data || []) as any[]) {
        const d = r.production_departments;
        if (d && !seen.has(d.id)) seen.set(d.id, { id: d.id, name: d.name });
      }
      return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  useEffect(() => {
    if (!departmentId && departments.length) setDepartmentId(departments[0].id);
  }, [departments, departmentId]);

  // The grid's columns, and the bin each one posts to.
  const { data: checkpoints = [] } = useQuery<Checkpoint[]>({
    queryKey: ["rw-checkpoints", departmentId],
    enabled: !!departmentId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("rw_department_defect_grades")
        .select(
          "defect_grade_id, location_id, sort_order," +
          "rw_defect_grades(code, name, name_urdu, onward_route)," +
          "rw_locations(code, name)"
        )
        .eq("department_id", departmentId)
        .eq("is_active", true)
        .order("sort_order");
      return ((data || []) as any[]).map((r) => ({
        defect_grade_id: r.defect_grade_id,
        location_id: r.location_id,
        sort_order: r.sort_order,
        grade_code: r.rw_defect_grades?.code ?? "",
        grade_name: r.rw_defect_grades?.name ?? "",
        grade_name_urdu: r.rw_defect_grades?.name_urdu ?? null,
        onward_route: r.rw_defect_grades?.onward_route ?? "to_store",
        location_code: r.rw_locations?.code ?? "",
        location_name: r.rw_locations?.name ?? "",
      }));
    },
  });

  // The ball grades the checker can count against — the production module's own
  // master, minus the grades that ARE defect output (Leak ball / Rejection) and
  // the non-ball grades. Output grades are what defective balls become, never
  // what they are counted as.
  const { data: ballGrades = [] } = useQuery<BallGrade[]>({
    queryKey: ["rw-checker-grades"],
    queryFn: async () => {
      const [{ data: grades }, { data: dg }] = await Promise.all([
        supabase.from("grades").select("id, code, name").eq("is_active", true).order("code"),
        (supabase as any).from("rw_defect_grades").select("output_grade_id"),
      ]);
      const outputIds = new Set(
        ((dg || []) as any[]).map((r) => r.output_grade_id).filter(Boolean),
      );
      return ((grades || []) as BallGrade[]).filter((g) => !outputIds.has(g.id));
    },
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["rw-checker-employees"],
    queryFn: async () => {
      const { data } = await supabase
        .from("employees")
        .select("id, employee_code, full_name")
        .eq("is_active", true)
        .order("full_name");
      return (data || []) as { id: string; employee_code: string; full_name: string }[];
    },
  });

  // What the department actually produced — the denominator for the defect rate,
  // and what decides which models the grid opens with.
  const { data: produced = [] } = useQuery({
    queryKey: ["rw-produced", entryDate, shift, departmentId],
    enabled: !!departmentId && !!entryDate,
    queryFn: async () => {
      const { data } = await supabase
        .from("production_entries")
        .select("grade_id, quantity_produced")
        .eq("entry_date", entryDate)
        .eq("shift", shift)
        .eq("department_id", departmentId);
      return (data || []) as { grade_id: string; quantity_produced: number }[];
    },
  });

  const producedByGrade = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of produced) m[p.grade_id] = (m[p.grade_id] || 0) + num(p.quantity_produced);
    return m;
  }, [produced]);

  // Anything already saved for this day, so the screen reopens where it was left.
  const { data: existing = [], refetch } = useQuery({
    queryKey: ["rw-checker-entries", entryDate, shift, departmentId],
    enabled: !!departmentId && !!entryDate,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("rw_checker_entries")
        .select("*, rw_checker_entry_intervals(interval_no, quantity)")
        .eq("entry_date", entryDate)
        .eq("shift", shift)
        .eq("department_id", departmentId);
      return (data || []) as any[];
    },
  });

  const gradeMap = useMemo(
    () => Object.fromEntries(ballGrades.map((g) => [g.id, g])),
    [ballGrades],
  );

  // Rebuild the grid whenever the day, shift or department changes: saved rows
  // first, then the models that were in production and have nothing yet.
  useEffect(() => {
    if (!departmentId || !checkpoints.length) return;

    const byGrade = new Map<string, Row>();
    const blank = (): Row => ({ gradeId: "", qty: {}, intervals: {}, openGrade: null });

    for (const e of existing) {
      const row = byGrade.get(e.grade_id) ?? { ...blank(), gradeId: e.grade_id };
      row.qty[e.defect_grade_id] = String(num(e.quantity) || "");
      const lines = (e.rw_checker_entry_intervals || []) as { interval_no: number; quantity: number }[];
      if (lines.length) {
        const arr: string[] = [];
        for (const l of [...lines].sort((a, b) => a.interval_no - b.interval_no)) {
          arr[l.interval_no - 1] = String(num(l.quantity));
        }
        row.intervals[e.defect_grade_id] = Array.from(arr, (v) => v ?? "0");
      }
      byGrade.set(e.grade_id, row);
    }

    if (!byGrade.size) {
      for (const gradeId of Object.keys(producedByGrade)) {
        if (gradeMap[gradeId]) byGrade.set(gradeId, { ...blank(), gradeId });
      }
    }

    setRows(byGrade.size ? [...byGrade.values()] : [{ gradeId: "", qty: {}, intervals: {}, openGrade: null }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryDate, shift, departmentId, checkpoints.length, existing, ballGrades.length]);

  const usedGradeIds = useMemo(
    () => new Set(rows.map((r) => r.gradeId).filter(Boolean)),
    [rows],
  );

  const setQty = (i: number, gradeId: string, v: string) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, qty: { ...r.qty, [gradeId]: v } } : r)));

  const setGrade = (i: number, gradeId: string) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, gradeId } : r)));

  const toggleTally = (i: number, gradeId: string) =>
    setRows((rs) =>
      rs.map((r, idx) => {
        if (idx !== i) return r;
        const open = r.openGrade === gradeId ? null : gradeId;
        if (open && !r.intervals[open]) {
          return { ...r, openGrade: open, intervals: { ...r.intervals, [open]: ["", "", "", ""] } };
        }
        return { ...r, openGrade: open };
      }),
    );

  const setInterval = (i: number, gradeId: string, n: number, v: string) =>
    setRows((rs) =>
      rs.map((r, idx) => {
        if (idx !== i) return r;
        const arr = [...(r.intervals[gradeId] || [])];
        arr[n] = v;
        return { ...r, intervals: { ...r.intervals, [gradeId]: arr } };
      }),
    );

  const addInterval = (i: number, gradeId: string) =>
    setRows((rs) =>
      rs.map((r, idx) =>
        idx === i ? { ...r, intervals: { ...r.intervals, [gradeId]: [...(r.intervals[gradeId] || []), ""] } } : r,
      ),
    );

  const clearTally = (i: number, gradeId: string) =>
    setRows((rs) =>
      rs.map((r, idx) => {
        if (idx !== i) return r;
        const next = { ...r.intervals };
        delete next[gradeId];
        return { ...r, intervals: next, openGrade: null };
      }),
    );

  const rowTotal = (r: Row) =>
    checkpoints.reduce((s, c) => s + num(r.qty[c.defect_grade_id]), 0);

  const rowProduced = (r: Row) => (r.gradeId ? producedByGrade[r.gradeId] || 0 : 0);

  const rowPct = (r: Row) => {
    const p = rowProduced(r);
    return p > 0 ? (rowTotal(r) / p) * 100 : null;
  };

  const grandTotal = rows.reduce((s, r) => s + rowTotal(r), 0);

  // A tally that is present but does not add up blocks the save — the same rule
  // the database enforces, surfaced before the round trip.
  const tallyErrors = useMemo(() => {
    const out: string[] = [];
    rows.forEach((r) => {
      const model = gradeMap[r.gradeId]?.code ?? "—";
      for (const [gradeId, lines] of Object.entries(r.intervals)) {
        if (!lines.length) continue;
        const sum = lines.reduce((s, v) => s + num(v), 0);
        const total = num(r.qty[gradeId]);
        if (sum !== total) {
          const label = checkpoints.find((c) => c.defect_grade_id === gradeId)?.grade_name ?? "";
          out.push(`${model} · ${label}: intervals add to ${fmt(sum)}, day total is ${fmt(total)}`);
        }
      }
    });
    return out;
  }, [rows, checkpoints, gradeMap]);

  const bins = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of checkpoints) if (!seen.has(c.location_code)) seen.set(c.location_code, c.location_name);
    return [...seen.entries()];
  }, [checkpoints]);

  const save = async () => {
    if (!departmentId) return toast.error("Pick a department");
    if (tallyErrors.length) return toast.error("An interval breakdown does not add up");

    const filled = rows.filter((r) => r.gradeId && rowTotal(r) > 0);
    if (!filled.length) return toast.error("Nothing counted yet");

    setSaving(true);
    try {
      for (const r of filled) {
        for (const c of checkpoints) {
          const qty = num(r.qty[c.defect_grade_id]);
          const prior = existing.find(
            (e: any) => e.grade_id === r.gradeId && e.defect_grade_id === c.defect_grade_id,
          );

          if (qty <= 0) {
            if (prior) {
              const { error } = await (supabase as any)
                .from("rw_checker_entries").delete().eq("id", prior.id);
              if (error) throw error;
            }
            continue;
          }

          const payload = {
            entry_date: entryDate,
            shift,
            department_id: departmentId,
            grade_id: r.gradeId,
            defect_grade_id: c.defect_grade_id,
            quantity: qty,
            unit: "pcs",
            location_id: c.location_id,
            checked_by: checkedBy !== "none" ? checkedBy : null,
            entered_by: user?.id ?? null,
          };

          let entryId = prior?.id as string | undefined;
          if (entryId) {
            const { error } = await (supabase as any)
              .from("rw_checker_entries").update(payload).eq("id", entryId);
            if (error) throw error;
          } else {
            const { data, error } = await (supabase as any)
              .from("rw_checker_entries").insert(payload).select("id").single();
            if (error) throw error;
            entryId = data.id;
          }

          // Replace the tally wholesale: the DB checks it adds up at commit.
          const { error: delErr } = await (supabase as any)
            .from("rw_checker_entry_intervals").delete().eq("entry_id", entryId);
          if (delErr) throw delErr;

          const lines = (r.intervals[c.defect_grade_id] || [])
            .map((v, i) => ({ entry_id: entryId, interval_no: i + 1, quantity: num(v) }))
            .filter((l) => l.quantity > 0);
          if (lines.length) {
            const { error: insErr } = await (supabase as any)
              .from("rw_checker_entry_intervals").insert(lines);
            if (insErr) throw insErr;
          }
        }
      }

      toast.success("Day's count saved");
      await refetch();
      qc.invalidateQueries({ queryKey: ["rw-ball-stock"] });
      qc.invalidateQueries({ queryKey: ["rw-ball-ledger"] });
    } catch (e: any) {
      toast.error("Save failed", { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title="Daily Checker Entry"
          description="Leak and reject balls counted on the floor — one entry per day"
          icon={ClipboardCheck}
          iconColor="bg-amber-500 text-white"
        />

        {/* Filters, and the bin the count lands in */}
        <Card>
          <CardContent className="p-3 md:p-4 flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                className="w-40"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Department</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Department" /></SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Shift</Label>
              <Select value={shift} onValueChange={setShift}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Day">Day</SelectItem>
                  <SelectItem value="Night">Night</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Checker</Label>
              <Select value={checkedBy} onValueChange={setCheckedBy}>
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not recorded</SelectItem>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {bins.length > 0 && (
              <div className="ml-auto flex items-center gap-2 rounded-lg bg-primary/5 ring-1 ring-inset ring-primary/15 px-3 py-2">
                <Boxes className="h-4 w-4 text-primary shrink-0" />
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Destination bin
                  </div>
                  <div className="text-[13px] font-semibold truncate">
                    {bins.map(([code, name]) => `${code} · ${name}`).join("  |  ")}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* The grid */}
        <Card>
          <CardContent className="p-3 md:p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-display text-base font-semibold">Balls counted today</div>
                <div className="text-xs text-muted-foreground">
                  One row per grade in production · one saved entry for the day
                </div>
              </div>
              <Badge variant="soft">{rows.filter((r) => r.gradeId).length} grades</Badge>
            </div>

            {checkpoints.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg bg-sky-500/[0.06] ring-1 ring-inset ring-sky-500/20 px-3 py-2 text-[12.5px] text-sky-900 dark:text-sky-200">
                <Info className="h-4 w-4 text-sky-500 shrink-0 mt-0.5" />
                <span>
                  Columns come from this department's checkpoints. Jorr counts leaker cores only;
                  Packing counts the two reject grades.
                </span>
              </div>
            )}

            {!checkpoints.length ? (
              <div className="text-sm text-muted-foreground py-6 text-center">
                This department has no checkpoints yet. Add them under Department Checkpoints.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table min-w-[900px]">
                  <thead>
                    <tr>
                      <th className="w-[28%]">Grade</th>
                      {checkpoints.map((c) => (
                        <th key={c.defect_grade_id} className="text-right">
                          {c.grade_name}
                          {c.onward_route === "cover_then_store" && (
                            <span className="block font-normal normal-case tracking-normal text-[10px] text-muted-foreground">
                              held as WIP until covered
                            </span>
                          )}
                        </th>
                      ))}
                      <th className="text-right">Day total</th>
                      <th>Defect %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const pct = rowPct(r);
                      const high = pct !== null && pct > DEFECT_BAND_PCT;
                      const openGrade = r.openGrade;
                      const lines = openGrade ? r.intervals[openGrade] || [] : [];
                      const lineSum = lines.reduce((s, v) => s + num(v), 0);
                      const lineTarget = openGrade ? num(r.qty[openGrade]) : 0;
                      const lineOk = lineSum === lineTarget;
                      return (
                        <>
                          <tr key={r.gradeId || `new-${i}`}>
                            <td>
                              <div className="flex items-center gap-2">
                                <Select
                                  value={r.gradeId || undefined}
                                  onValueChange={(v) => setGrade(i, v)}
                                >
                                  <SelectTrigger className="w-full max-w-[240px] h-9">
                                    <SelectValue placeholder="Pick a grade" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ballGrades
                                      .filter((g) => g.id === r.gradeId || !usedGradeIds.has(g.id))
                                      .map((g) => (
                                        <SelectItem key={g.id} value={g.id}>
                                          {g.name}
                                        </SelectItem>
                                      ))}
                                  </SelectContent>
                                </Select>
                                {rows.length > 1 && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground"
                                    onClick={() => setRows((rs) => rs.filter((_, x) => x !== i))}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                              <div className="text-[11px] text-muted-foreground mt-1">
                                produced {fmt(rowProduced(r))} pcs
                              </div>
                            </td>

                            {checkpoints.map((c) => (
                              <td key={c.defect_grade_id} className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground"
                                    title="Interval tally (optional)"
                                    onClick={() => toggleTally(i, c.defect_grade_id)}
                                  >
                                    {openGrade === c.defect_grade_id
                                      ? <ChevronDown className="h-3.5 w-3.5" />
                                      : <ChevronRight className="h-3.5 w-3.5" />}
                                  </Button>
                                  <Input
                                    inputMode="numeric"
                                    className={cn(
                                      "h-10 w-24 text-right font-semibold tabular-nums",
                                      r.intervals[c.defect_grade_id]?.length && "ring-1 ring-inset ring-primary/25",
                                    )}
                                    value={r.qty[c.defect_grade_id] ?? ""}
                                    onChange={(e) => setQty(i, c.defect_grade_id, e.target.value)}
                                    placeholder="0"
                                  />
                                </div>
                              </td>
                            ))}

                            <td className="text-right font-bold tabular-nums">{fmt(rowTotal(r))}</td>
                            <td>
                              {pct === null ? (
                                <span className="text-xs text-muted-foreground">no production</span>
                              ) : (
                                <Badge variant={high ? "warning" : "secondary"}>
                                  {pct.toFixed(2)}%{high ? " · above band" : ""}
                                </Badge>
                              )}
                            </td>
                          </tr>

                          {openGrade && (
                            <tr key={`${r.gradeId}-tally`}>
                              <td colSpan={checkpoints.length + 3} className="bg-muted/40">
                                <div className="pl-10 pr-2 py-3 space-y-2">
                                  <div className="flex items-center justify-between gap-3">
                                    <div>
                                      <div className="text-[13px] font-semibold">
                                        Interval tally — {gradeMap[r.gradeId]?.name ?? "grade"} ·{" "}
                                        {checkpoints.find((c) => c.defect_grade_id === openGrade)?.grade_name}
                                      </div>
                                      <div className="text-[11.5px] text-muted-foreground">
                                        Optional. Leave it empty and the day total saves on its own.
                                      </div>
                                    </div>
                                    <Button variant="outline" size="sm" onClick={() => clearTally(i, openGrade)}>
                                      Clear breakdown
                                    </Button>
                                  </div>
                                  <div className="flex flex-wrap items-end gap-3">
                                    {lines.map((v, n) => (
                                      <div key={n}>
                                        <Label className="text-[11px] text-muted-foreground">
                                          Interval {n + 1}
                                        </Label>
                                        <Input
                                          inputMode="numeric"
                                          className="h-9 w-20 text-right tabular-nums"
                                          value={v}
                                          onChange={(e) => setInterval(i, openGrade, n, e.target.value)}
                                          placeholder="0"
                                        />
                                      </div>
                                    ))}
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => addInterval(i, openGrade)}
                                    >
                                      <Plus className="h-4 w-4 mr-1" /> Interval
                                    </Button>
                                    <div className="ml-2 flex items-center gap-2">
                                      <span className="text-[11px] text-muted-foreground">Sum</span>
                                      <span
                                        className={cn(
                                          "font-display text-lg font-bold tabular-nums",
                                          lineOk ? "text-emerald-600" : "text-destructive",
                                        )}
                                      >
                                        {fmt(lineSum)}
                                      </span>
                                      <span className="text-[12px] text-muted-foreground">
                                        of {fmt(lineTarget)}
                                      </span>
                                      {!lineOk && (
                                        <Badge variant="destructive">must match the day total</Badge>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t">
              <div className="flex items-center gap-4">
                <div>
                  <div className="metric-label">Total counted</div>
                  <div className="font-display text-xl font-bold tabular-nums">
                    {fmt(grandTotal)} <span className="text-xs font-medium text-muted-foreground">pcs</span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setRows((rs) => [...rs, { gradeId: "", qty: {}, intervals: {}, openGrade: null }])
                  }
                >
                  <Plus className="h-4 w-4 mr-1" /> Add another grade
                </Button>
              </div>

              <div className="flex items-center gap-3">
                {tallyErrors.length > 0 && (
                  <div className="flex items-center gap-2 text-[12.5px] text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    {tallyErrors.length} breakdown{tallyErrors.length > 1 ? "s do" : " does"} not add up
                  </div>
                )}
                <Button onClick={save} disabled={saving || tallyErrors.length > 0}>
                  {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                  Save day's count
                </Button>
              </div>
            </div>

            {tallyErrors.length > 0 && (
              <div className="text-[12px] text-destructive space-y-0.5">
                {tallyErrors.map((e) => <div key={e}>· {e}</div>)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
