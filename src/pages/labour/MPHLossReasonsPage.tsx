import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { format, parseISO } from "date-fns";
import {
  Bell, Plus, Printer, Save, Send, Trash2, AlertTriangle, Unlock, Gauge, ChevronDown, ChevronUp,
  ChevronRight, ChevronLeft, Search, Calculator, ArrowRight, ExternalLink, Check, X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  type DepartmentMph,
  type DepartmentMphDetail,
  type MphLossReason,
  MPH_LOSS_TOLERANCE,
  escapeHtml,
  fetchMphDay,
  fmtMph,
  fmtQty,
  reasonsForDepartment,
  round1,
} from "@/lib/mphLoss";

interface Report {
  id: string;
  report_number: string;
  report_date: string;
  status: "draft" | "submitted";
  notified_at: string | null;
  production_changed_at: string | null;
  submitted_by_name: string | null;
  submitted_at: string | null;
  updated_at: string;
}

interface SavedLine {
  department_id: string;
  reason_id: string;
  reason_name: string;
  mph_lost: number;
  workers_affected: number | null;
  remarks: string | null;
  sort_order: number;
}

interface LineDraft {
  key: string;
  reason_id: string;
  mph_lost: string;
  workers_affected: string;
  remarks: string;
}

let lineSeq = 0;
const newLine = (): LineDraft => ({ key: `l${++lineSeq}`, reason_id: "", mph_lost: "", workers_affected: "", remarks: "" });

type DeptStatus = "complete" | "partial" | "over" | "pending";

const STATUS_BADGE: Record<DeptStatus, { label: string; className: string; dot: string }> = {
  complete: { label: "Complete", className: "bg-green-100 text-green-700 hover:bg-green-100", dot: "bg-green-600" },
  partial: { label: "Partly explained", className: "bg-amber-100 text-amber-800 hover:bg-amber-100", dot: "bg-amber-500" },
  over: { label: "More than loss", className: "bg-orange-100 text-orange-800 hover:bg-orange-100", dot: "bg-orange-500" },
  pending: { label: "Pending", className: "bg-red-100 text-red-700 hover:bg-red-100", dot: "bg-red-600" },
};

interface DeptState {
  dept: DepartmentMph;
  loss: number;
  lines: LineDraft[];
  explained: number;
  remaining: number;
  status: DeptStatus;
}

export default function MPHLossReasonsPage() {
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const isMobile = useIsMobile();
  const [params, setParams] = useSearchParams();
  const date = params.get("date") || format(new Date(), "yyyy-MM-dd");
  const setDate = (d: string) => d && setParams({ date: d }, { replace: true });

  const isSuperAdmin = hasRole("super_admin");
  const canEditRole = isSuperAdmin || hasRole("production_coordinator");

  const { data: reasons = [] } = useQuery({
    queryKey: ["mph-loss-reasons"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("mph_loss_reasons")
        .select("*")
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return (data || []) as MphLossReason[];
    },
  });

  const { data: mapping = [] } = useQuery({
    queryKey: ["mph-loss-reason-departments"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("mph_loss_reason_departments").select("*");
      if (error) throw error;
      return (data || []) as { reason_id: string; department_id: string }[];
    },
  });

  const { data: live, isLoading: loadingMph } = useQuery({
    queryKey: ["mph-loss-live", date],
    queryFn: () => fetchMphDay(date),
  });
  const liveDepts = live?.departments ?? [];
  const detail = live?.detail ?? {};

  const { data: saved, isLoading: loadingReport } = useQuery({
    queryKey: ["mph-loss-report", date],
    queryFn: async () => {
      const { data: report, error } = await (supabase as any)
        .from("mph_loss_reports")
        .select("*")
        .eq("report_date", date)
        .maybeSingle();
      if (error) throw error;
      if (!report) return { report: null, departments: [] as DepartmentMph[], lines: [] as SavedLine[] };
      const [deptRes, lineRes] = await Promise.all([
        (supabase as any).from("mph_loss_report_departments").select("*").eq("report_id", report.id).is("superseded_at", null),
        (supabase as any).from("mph_loss_report_lines").select("*").eq("report_id", report.id).is("superseded_at", null).order("sort_order"),
      ]);
      if (deptRes.error) throw deptRes.error;
      if (lineRes.error) throw lineRes.error;
      const departments: DepartmentMph[] = (deptRes.data || []).map((d: any) => ({
        department_id: d.department_id,
        department_name: d.department_name,
        output: Number(d.output),
        authorized_mph: Number(d.authorized_mph),
        used_mph: Number(d.used_mph),
        net_mph: Number(d.net_mph),
      }));
      return { report: report as Report, departments, lines: (lineRes.data || []) as SavedLine[] };
    },
  });

  // Dates still waiting for reasons (production posted, report not submitted).
  const { data: pendingDates = [] } = useQuery({
    queryKey: ["mph-loss-pending-dates"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("mph_loss_reports")
        .select("report_date")
        .eq("status", "draft")
        .order("report_date", { ascending: false })
        .limit(14);
      if (error) throw error;
      return (data || []).map((r: any) => r.report_date as string);
    },
  });

  const report = saved?.report ?? null;
  const isSubmitted = report?.status === "submitted";
  const canEdit = canEditRole && !isSubmitted;

  // A submitted report shows the figures it was submitted with; a draft shows live figures.
  const allDepts = isSubmitted ? saved!.departments : liveDepts;
  const lossDepts = useMemo(() => allDepts.filter((d) => d.net_mph < 0), [allDepts]);
  const noLossCount = allDepts.length - lossDepts.length;

  // Editable lines, keyed by department. Reloaded whenever the saved report changes.
  const [lines, setLines] = useState<Record<string, LineDraft[]>>({});
  const loadKey = `${date}|${report?.id ?? "none"}|${report?.updated_at ?? ""}`;
  useEffect(() => {
    const next: Record<string, LineDraft[]> = {};
    (saved?.lines ?? []).forEach((l) => {
      (next[l.department_id] ??= []).push({
        key: `l${++lineSeq}`,
        reason_id: l.reason_id,
        mph_lost: String(l.mph_lost),
        workers_affected: l.workers_affected == null ? "" : String(l.workers_affected),
        remarks: l.remarks ?? "",
      });
    });
    setLines(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey]);

  const reasonById = useMemo(() => Object.fromEntries(reasons.map((r) => [r.id, r])), [reasons]);

  const deptState: DeptState[] = useMemo(() => {
    return lossDepts.map((d) => {
      const loss = round1(-d.net_mph);
      const deptLines = lines[d.department_id] ?? [];
      const explained = round1(deptLines.reduce((s, l) => s + (Number(l.mph_lost) || 0), 0));
      const remaining = round1(loss - explained);
      let status: DeptStatus = "pending";
      if (Math.abs(remaining) <= MPH_LOSS_TOLERANCE) status = "complete";
      else if (remaining < 0) status = "over";
      else if (explained > 0) status = "partial";
      return { dept: d, loss, lines: deptLines, explained, remaining, status };
    });
  }, [lossDepts, lines]);

  const totals = useMemo(() => {
    const loss = round1(deptState.reduce((s, d) => s + d.loss, 0));
    const explained = round1(deptState.reduce((s, d) => s + Math.min(d.explained, d.loss), 0));
    return {
      loss,
      explained,
      remaining: round1(Math.max(loss - explained, 0)),
      done: deptState.filter((d) => d.status === "complete").length,
      partial: deptState.filter((d) => d.status === "partial" || d.status === "over").length,
      authorized: round1(allDepts.reduce((s, d) => s + d.authorized_mph, 0)),
      used: round1(allDepts.reduce((s, d) => s + d.used_mph, 0)),
    };
  }, [deptState, allDepts]);

  const invalidLine = deptState.some((d) =>
    d.lines.some((l) => !l.reason_id || !(Number(l.mph_lost) > 0))
  );
  const allExplained = deptState.length > 0 && deptState.every((d) => d.status === "complete");

  // Reasons already used for this date, shown first in the phone picker.
  const usedReasonIds = useMemo(() => {
    const ids = new Set<string>();
    Object.values(lines).forEach((ls) => ls.forEach((l) => l.reason_id && ids.add(l.reason_id)));
    return ids;
  }, [lines]);

  const updateLine = (deptId: string, key: string, patch: Partial<LineDraft>) =>
    setLines((prev) => ({
      ...prev,
      [deptId]: (prev[deptId] ?? []).map((l) => (l.key === key ? { ...l, ...patch } : l)),
    }));
  const addLine = (deptId: string) => {
    const line = newLine();
    setLines((prev) => ({ ...prev, [deptId]: [...(prev[deptId] ?? []), line] }));
    return line.key;
  };
  const removeLine = (deptId: string, key: string) =>
    setLines((prev) => ({ ...prev, [deptId]: (prev[deptId] ?? []).filter((l) => l.key !== key) }));

  const saveMutation = useMutation({
    mutationFn: async (submit: boolean) => {
      const payloadLines = deptState.flatMap((d) =>
        d.lines.map((l) => ({
          department_id: d.dept.department_id,
          reason_id: l.reason_id,
          mph_lost: l.mph_lost,
          workers_affected: l.workers_affected,
          remarks: l.remarks,
        }))
      );
      const { data, error } = await (supabase as any).rpc("mph_loss_report_save", {
        p_date: date,
        p_departments: allDepts,
        p_lines: payloadLines,
        p_submit: submit,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, submit) => {
      toast.success(submit ? "Reasons submitted" : "Draft saved");
      qc.invalidateQueries({ queryKey: ["mph-loss-report", date] });
      qc.invalidateQueries({ queryKey: ["mph-loss-pending-dates"] });
    },
    onError: (e: any) => toast.error(e.message || "Failed to save"),
  });

  const reopenMutation = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("mph_loss_report_reopen", { p_report_id: report!.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Report reopened");
      qc.invalidateQueries({ queryKey: ["mph-loss-report", date] });
      qc.invalidateQueries({ queryKey: ["mph-loss-pending-dates"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleSave = (submit: boolean) => {
    if (invalidLine) {
      toast.error("Every reason line needs a reason and the MPH lost");
      return;
    }
    if (submit && !allExplained) {
      toast.error("Each department's reasons must add up to its loss before submitting");
      return;
    }
    saveMutation.mutate(submit);
  };

  const handlePrint = () => {
    const w = window.open("", "_blank");
    if (!w) {
      toast.error("Allow pop-ups to print");
      return;
    }
    const rows = deptState
      .map((d) => {
        const ls = d.lines.length ? d.lines : [null];
        return ls
          .map(
            (l, i) => `<tr>
              <td class="b">${i === 0 ? escapeHtml(d.dept.department_name) : ""}</td>
              <td class="n">${i === 0 ? "−" + fmtMph(d.loss) : ""}</td>
              <td>${l ? escapeHtml(reasonById[l.reason_id]?.name ?? "—") : '<span class="muted">No reason given</span>'}</td>
              <td class="n">${l && Number(l.mph_lost) > 0 ? fmtMph(Number(l.mph_lost)) : ""}</td>
              <td class="n">${l ? escapeHtml(l.workers_affected) : ""}</td>
              <td class="muted">${l ? escapeHtml(l.remarks) : ""}</td>
            </tr>`
          )
          .join("");
      })
      .join("");

    const byReason: Record<string, number> = {};
    deptState.forEach((d) =>
      d.lines.forEach((l) => {
        const name = reasonById[l.reason_id]?.name;
        if (name) byReason[name] = (byReason[name] ?? 0) + (Number(l.mph_lost) || 0);
      })
    );
    const summaryTotal = Object.values(byReason).reduce((s, v) => s + v, 0);
    const summary = Object.entries(byReason)
      .sort((a, b) => b[1] - a[1])
      .map(
        ([name, mph]) =>
          `<tr><td>${escapeHtml(name)}</td><td class="n">${fmtMph(mph)}</td><td class="n">${
            summaryTotal > 0 ? ((mph / summaryTotal) * 100).toFixed(1) : "0.0"
          }%</td></tr>`
      )
      .join("");

    const statusText = isSubmitted
      ? `Submitted${report?.submitted_by_name ? " by " + escapeHtml(report.submitted_by_name) : ""}${
          report?.submitted_at ? ", " + format(new Date(report.submitted_at), "dd MMM yyyy HH:mm") : ""
        }`
      : "Draft — not submitted";

    w.document.write(`<!doctype html><html><head><meta charset="utf-8">
      <title>MPH Loss Reason Report ${escapeHtml(date)}</title>
      <style>
        @page { size: A4; margin: 14mm; }
        body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; font-size: 12px; }
        .head { display: flex; justify-content: space-between; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 14px; }
        h1 { font-size: 20px; margin: 2px 0 4px; }
        .strip { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #111; margin-bottom: 16px; }
        .strip div { padding: 7px 9px; border-right: 1px solid #111; } .strip div:last-child { border-right: 0; }
        .strip b { display: block; font-size: 15px; margin-top: 2px; }
        h2 { font-size: 13px; margin: 14px 0 6px; }
        table { width: 100%; border-collapse: collapse; }
        th { font-size: 10.5px; text-transform: uppercase; text-align: left; padding: 5px 7px; border-bottom: 1.5px solid #111; }
        td { padding: 5px 7px; border-bottom: 1px solid #ccc; vertical-align: top; }
        .n { text-align: right; white-space: nowrap; } .b { font-weight: bold; } .muted { color: #555; }
        .summary { width: 60%; }
        .sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; margin-top: 60px; }
        .sign div { border-top: 1px solid #111; padding-top: 6px; }
      </style></head><body>
      <div class="head">
        <div><div class="muted">Production</div><h1>MPH Loss Reason Report</h1>
          <div>Production date: <b>${format(parseISO(date), "dd MMM yyyy")}</b></div></div>
        <div style="text-align:right">
          <div>Report no. <b>${escapeHtml(report?.report_number ?? "—")}</b></div>
          <div>Status: <b>${statusText}</b></div>
          <div>Printed ${format(new Date(), "dd MMM yyyy, HH:mm")}</div>
        </div>
      </div>
      <div class="strip">
        <div>Authorized MPH<b>${fmtMph(totals.authorized)}</b></div>
        <div>Used MPH<b>${fmtMph(totals.used)}</b></div>
        <div>Net MPH loss<b>−${fmtMph(totals.loss)}</b></div>
        <div>Explained<b>${fmtMph(totals.explained)} (${totals.loss > 0 ? Math.round((totals.explained / totals.loss) * 100) : 100}%)</b></div>
      </div>
      <h2>Department-wise reasons</h2>
      <table><thead><tr><th>Department</th><th class="n">Net loss</th><th>Reason</th><th class="n">MPH</th><th class="n">Workers</th><th>Remarks</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="muted">No department in MPH loss</td></tr>'}</tbody></table>
      ${summary ? `<h2>Summary by reason</h2><table class="summary"><thead><tr><th>Reason</th><th class="n">MPH lost</th><th class="n">Share</th></tr></thead>
        <tbody>${summary}<tr><td class="b">Total</td><td class="n b">${fmtMph(summaryTotal)}</td><td class="n b">100%</td></tr></tbody></table>` : ""}
      <div class="sign"><div>Production Coordinator</div><div>Production Manager</div><div>Plant Head</div></div>
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  const isLoading = loadingMph || loadingReport;

  // ---- Phone state -------------------------------------------------------
  const [mobileDeptId, setMobileDeptId] = useState<string | null>(null);
  const [mobileFilter, setMobileFilter] = useState<"pending" | "all">("pending");
  const [picker, setPicker] = useState<{ deptId: string; lineKey: string } | null>(null);
  const [calcDeptId, setCalcDeptId] = useState<string | null>(null);
  // Desktop: departments with the calculation panel open.
  const [openCalc, setOpenCalc] = useState<Set<string>>(new Set());
  const toggleCalc = (id: string) =>
    setOpenCalc((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useEffect(() => {
    setMobileDeptId(null);
  }, [date]);

  const mobileDept = deptState.find((d) => d.dept.department_id === mobileDeptId) ?? null;
  const pickerDept = deptState.find((d) => d.dept.department_id === picker?.deptId) ?? null;
  const calcDept = deptState.find((d) => d.dept.department_id === calcDeptId) ?? null;

  const commonProps = {
    date, setDate, pendingDates, report, isSubmitted, isSuperAdmin, canEdit, canEditRole, isLoading,
    deptState, totals, allDepts, lossDepts, noLossCount, reasons, mapping, reasonById, detail,
    updateLine, addLine, removeLine, handleSave, handlePrint, saveMutation, reopenMutation, allExplained,
  };

  if (isMobile) {
    return (
      <ERPLayout>
        {mobileDept ? (
          <MobileDepartment
            {...commonProps}
            d={mobileDept}
            onBack={() => setMobileDeptId(null)}
            onNext={() => {
              const idx = deptState.findIndex((x) => x.dept.department_id === mobileDept.dept.department_id);
              const next = deptState.slice(idx + 1).find((x) => x.status !== "complete") ?? deptState[idx + 1];
              setMobileDeptId(next ? next.dept.department_id : null);
            }}
            onPickReason={(lineKey) => setPicker({ deptId: mobileDept.dept.department_id, lineKey })}
            onShowCalc={() => setCalcDeptId(mobileDept.dept.department_id)}
          />
        ) : (
          <MobileOverview
            {...commonProps}
            filter={mobileFilter}
            setFilter={setMobileFilter}
            onOpen={(id) => setMobileDeptId(id)}
          />
        )}

        <Drawer open={!!picker} onOpenChange={(o) => !o && setPicker(null)}>
          <DrawerContent className="max-h-[88vh]">
            {pickerDept && picker && (
              <ReasonPicker
                dept={pickerDept}
                options={reasonsForDepartment(reasons, mapping, pickerDept.dept.department_id)}
                usedIds={usedReasonIds}
                current={pickerDept.lines.find((l) => l.key === picker.lineKey)?.reason_id ?? ""}
                onPick={(id) => {
                  updateLine(picker.deptId, picker.lineKey, { reason_id: id });
                  setPicker(null);
                }}
                onClose={() => setPicker(null)}
              />
            )}
          </DrawerContent>
        </Drawer>

        <Drawer open={!!calcDept} onOpenChange={(o) => !o && setCalcDeptId(null)}>
          <DrawerContent className="max-h-[92vh]">
            {calcDept && (
              <>
                <DrawerHeader className="text-left pb-2">
                  <DrawerTitle>How {calcDept.dept.department_name} got −{fmtMph(calcDept.loss)}</DrawerTitle>
                  <DrawerDescription>{format(parseISO(date), "dd MMM yyyy")} · item by item</DrawerDescription>
                </DrawerHeader>
                <div className="overflow-y-auto px-4 pb-6">
                  <CalcPanel d={calcDept.dept} detail={detail[calcDept.dept.department_id]} compact showLinks={isSuperAdmin} />
                </div>
              </>
            )}
          </DrawerContent>
        </Drawer>
      </ERPLayout>
    );
  }

  // ---- Desktop -------------------------------------------------------------
  return (
    <ERPLayout>
      <div className="space-y-5 p-4 md:p-6">
        <PageHeader
          title={`MPH Loss Reasons — ${format(parseISO(date), "dd MMM yyyy")}`}
          description="Give a reason for every department that used more MPH than it earned"
          icon={Gauge}
          iconColor="bg-red-600 text-white"
        />

        <div className="flex flex-wrap items-end gap-3 justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="mph-date" className="text-xs text-muted-foreground">Production date</Label>
              <Input id="mph-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-[170px]" />
            </div>
            {pendingDates.filter((d) => d !== date).length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">Pending:</span>
                {pendingDates
                  .filter((d) => d !== date)
                  .map((d) => (
                    <Button key={d} variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setDate(d)}>
                      {format(parseISO(d), "dd MMM")}
                    </Button>
                  ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={handlePrint} disabled={isLoading}>
              <Printer className="h-4 w-4 mr-2" /> Print
            </Button>
            {canEdit && (
              <>
                <Button variant="outline" onClick={() => handleSave(false)} disabled={saveMutation.isPending || isLoading}>
                  <Save className="h-4 w-4 mr-2" /> Save Draft
                </Button>
                <Button
                  onClick={() => handleSave(true)}
                  disabled={saveMutation.isPending || isLoading || !allExplained}
                  title={allExplained ? undefined : "Explain every department's loss fully to submit"}
                >
                  <Send className="h-4 w-4 mr-2" /> Submit Reasons
                </Button>
              </>
            )}
            {isSubmitted && isSuperAdmin && (
              <Button variant="outline" onClick={() => reopenMutation.mutate()} disabled={reopenMutation.isPending}>
                <Unlock className="h-4 w-4 mr-2" /> Reopen
              </Button>
            )}
          </div>
        </div>

        <StatusBanners {...commonProps} />

        {/* KPI strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi label="Total MPH loss" value={`−${fmtMph(totals.loss)}`} sub={`${lossDepts.length} departments`} className="text-red-700" />
          <Kpi
            label="Explained"
            value={fmtMph(totals.explained)}
            sub={`${totals.loss > 0 ? Math.round((totals.explained / totals.loss) * 100) : 100}% of the loss`}
            className="text-green-700"
          />
          <Kpi label="Still to explain" value={fmtMph(totals.remaining)} sub="must be 0 to submit" className="text-amber-700" />
          <Kpi
            label="Departments done"
            value={`${totals.done} / ${deptState.length}`}
            sub={`${totals.partial} partly · ${deptState.length - totals.done - totals.partial} pending`}
          />
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground py-10 text-center">Loading...</p>
        ) : deptState.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              {allDepts.length === 0
                ? "No production or labour MPH recorded for this date."
                : "No department is in MPH loss on this date — nothing to explain."}
            </CardContent>
          </Card>
        ) : (
          deptState.map((d) => {
            const options = reasonsForDepartment(reasons, mapping, d.dept.department_id);
            const badge = STATUS_BADGE[d.status];
            const pct = d.loss > 0 ? Math.min((d.explained / d.loss) * 100, 100) : 0;
            const calcOpen = openCalc.has(d.dept.department_id);
            return (
              <Card key={d.dept.department_id} className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b bg-muted/40 px-4 py-3">
                  <h2 className="flex-1 min-w-[140px] text-base font-semibold">{d.dept.department_name}</h2>
                  <div className="flex flex-wrap gap-4 text-sm text-muted-foreground tabular-nums">
                    <span>Output <b className="text-foreground">{fmtQty(d.dept.output)}</b></span>
                    <span>
                      Authorized <b className="text-foreground">{fmtMph(d.dept.authorized_mph)}</b>
                      {(detail[d.dept.department_id]?.fixed_daily_mph ?? 0) > 0 && (
                        <span className="ml-1 text-xs">(incl. {fmtMph(detail[d.dept.department_id].fixed_daily_mph)} fixed daily)</span>
                      )}
                    </span>
                    <span>Used <b className="text-foreground">{fmtMph(d.dept.used_mph)}</b></span>
                    <span>Net <b className="text-red-600">{fmtMph(d.dept.net_mph)}</b></span>
                    <span>MPH/unit <b className="text-foreground">{d.dept.output > 0 ? (d.dept.used_mph / d.dept.output).toFixed(3) : "—"}</b></span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className={`h-8 ${calcOpen ? "bg-blue-50 border-blue-200 text-blue-700" : "text-blue-700"}`}
                    onClick={() => toggleCalc(d.dept.department_id)}
                    aria-expanded={calcOpen}
                  >
                    {calcOpen ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
                    {calcOpen ? "Hide calculation" : "Show calculation"}
                  </Button>
                  <div className="w-[170px]">
                    <div className="text-xs text-muted-foreground mb-1">
                      Explained {fmtMph(d.explained)} of {fmtMph(d.loss)}
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-2 rounded-full ${d.status === "complete" ? "bg-green-600" : "bg-amber-500"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <Badge className={badge.className}>{badge.label}</Badge>
                </div>

                {calcOpen && (
                  <div className="border-b bg-muted/20 px-4 py-4">
                    <CalcPanel d={d.dept} detail={detail[d.dept.department_id]} showLinks={isSuperAdmin} />
                  </div>
                )}

                <CardContent className="p-4 space-y-3">
                  {d.lines.length === 0 ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="text-sm text-muted-foreground">No reason entered yet.</span>
                      {canEdit && (
                        <Button variant="outline" size="sm" onClick={() => addLine(d.dept.department_id)}>
                          <Plus className="h-4 w-4 mr-1" /> Add reasons
                        </Button>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <div className="min-w-[760px] space-y-2">
                          <div className="grid grid-cols-[2.2fr_0.8fr_0.8fr_2.2fr_40px] gap-2 text-xs font-semibold text-muted-foreground">
                            <div>Reason</div>
                            <div>MPH lost</div>
                            <div>Workers</div>
                            <div>Remarks / what happened</div>
                            <div />
                          </div>
                          {d.lines.map((l) => (
                            <div key={l.key} className="grid grid-cols-[2.2fr_0.8fr_0.8fr_2.2fr_40px] gap-2 items-center">
                              <Select
                                value={l.reason_id}
                                onValueChange={(v) => updateLine(d.dept.department_id, l.key, { reason_id: v })}
                                disabled={!canEdit}
                              >
                                <SelectTrigger aria-label="Reason" className={!l.reason_id ? "border-primary" : ""}>
                                  <SelectValue placeholder="Select reason…">
                                    {reasonById[l.reason_id]?.name}
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectGroup>
                                    <SelectLabel>Reasons for {d.dept.department_name}</SelectLabel>
                                    {options.map((r) => (
                                      <SelectItem key={r.id} value={r.id}>
                                        {r.name}
                                        {r.category ? <span className="ml-2 text-xs text-muted-foreground">{r.category}</span> : null}
                                      </SelectItem>
                                    ))}
                                    {options.length === 0 && (
                                      <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                        No reasons set up for this department
                                      </div>
                                    )}
                                  </SelectGroup>
                                </SelectContent>
                              </Select>
                              <Input
                                aria-label="MPH lost"
                                type="number"
                                inputMode="decimal"
                                min="0"
                                step="0.1"
                                placeholder="0.0"
                                className="text-right"
                                value={l.mph_lost}
                                disabled={!canEdit}
                                onChange={(e) => updateLine(d.dept.department_id, l.key, { mph_lost: e.target.value })}
                              />
                              <Input
                                aria-label="Workers affected"
                                type="number"
                                inputMode="numeric"
                                min="0"
                                step="1"
                                placeholder="0"
                                className="text-right"
                                value={l.workers_affected}
                                disabled={!canEdit}
                                onChange={(e) =>
                                  updateLine(d.dept.department_id, l.key, { workers_affected: e.target.value })
                                }
                              />
                              <Input
                                aria-label="Remarks"
                                placeholder="What happened?"
                                value={l.remarks}
                                disabled={!canEdit}
                                onChange={(e) => updateLine(d.dept.department_id, l.key, { remarks: e.target.value })}
                              />
                              {canEdit ? (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label="Remove reason"
                                  onClick={() => removeLine(d.dept.department_id, l.key)}
                                >
                                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                                </Button>
                              ) : (
                                <div />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        {canEdit ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-dashed border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                            onClick={() => addLine(d.dept.department_id)}
                          >
                            <Plus className="h-4 w-4 mr-1" /> Add another reason
                          </Button>
                        ) : (
                          <span />
                        )}
                        <RemainingText d={d} />
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}

        {noLossCount > 0 && (
          <p className="text-sm text-muted-foreground">
            Hidden: {noLossCount} department{noLossCount === 1 ? "" : "s"} with no loss (
            {allDepts
              .filter((d) => d.net_mph >= 0)
              .map((d) => d.department_name)
              .join(", ")}
            ).
          </p>
        )}
      </div>
    </ERPLayout>
  );
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

type Common = {
  date: string;
  setDate: (d: string) => void;
  pendingDates: string[];
  report: Report | null;
  isSubmitted: boolean;
  isSuperAdmin: boolean;
  canEdit: boolean;
  canEditRole: boolean;
  isLoading: boolean;
  deptState: DeptState[];
  totals: { loss: number; explained: number; remaining: number; done: number; partial: number; authorized: number; used: number };
  allDepts: DepartmentMph[];
  lossDepts: DepartmentMph[];
  noLossCount: number;
  reasons: MphLossReason[];
  mapping: { reason_id: string; department_id: string }[];
  reasonById: Record<string, MphLossReason>;
  detail: Record<string, DepartmentMphDetail>;
  updateLine: (deptId: string, key: string, patch: Partial<LineDraft>) => void;
  addLine: (deptId: string) => string;
  removeLine: (deptId: string, key: string) => void;
  handleSave: (submit: boolean) => void;
  handlePrint: () => void;
  saveMutation: { isPending: boolean };
  reopenMutation: { isPending: boolean; mutate: () => void };
  allExplained: boolean;
};

function RemainingText({ d, className = "" }: { d: DeptState; className?: string }) {
  return (
    <span className={`text-sm font-semibold ${d.status === "complete" ? "text-green-700" : "text-amber-700"} ${className}`}>
      {d.status === "complete"
        ? "Fully explained"
        : d.status === "over"
        ? `${fmtMph(-d.remaining)} MPH more than the loss`
        : `${fmtMph(d.remaining)} MPH still to explain`}
    </span>
  );
}

function StatusBanners({ date, report, isSubmitted, isSuperAdmin, canEditRole, lossDepts, allDepts }: Common) {
  return (
    <>
      {isSubmitted ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          <Badge className="bg-green-600 hover:bg-green-600">Submitted</Badge>
          <span>
            {report?.report_number} — submitted
            {report?.submitted_by_name ? ` by ${report.submitted_by_name}` : ""}
            {report?.submitted_at ? `, ${format(new Date(report.submitted_at), "dd MMM yyyy HH:mm")}` : ""}. Locked
            {isSuperAdmin ? " — reopen to change it." : "; ask a super admin to reopen it for changes."}
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <Bell className="h-4 w-4 shrink-0" />
          <span className="flex-1 min-w-[200px]">
            {report?.notified_at ? (
              <>
                <b>Production posted</b> for {format(parseISO(date), "dd MMM yyyy")} at{" "}
                {format(new Date(report.notified_at), "HH:mm")} —{" "}
              </>
            ) : null}
            {lossDepts.length} of {allDepts.length} departments are in loss.
          </span>
          <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Draft · not submitted</Badge>
        </div>
      )}
      {isSubmitted && report?.production_changed_at && (
        <div className="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          More production was posted for this date on {format(new Date(report.production_changed_at), "dd MMM yyyy HH:mm")},
          after the reasons were submitted. The figures below are the submitted ones and may no longer match MPH Analysis.
        </div>
      )}
      {!canEditRole && (
        <p className="text-sm text-muted-foreground">View only — the Production Coordinator enters these reasons.</p>
      )}
    </>
  );
}

function Kpi({ label, value, sub, className = "" }: { label: string; value: string; sub: string; className?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-semibold text-muted-foreground">{label}</div>
        <div className={`text-2xl font-bold tabular-nums ${className}`}>{value}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}

// The calculation behind a department's numbers: every item and every worker.
// Source-page links are for super admin only: the coordinator's role cannot open those pages.
function CalcPanel({ d, detail, compact = false, showLinks = false }: { d: DepartmentMph; detail?: DepartmentMphDetail; compact?: boolean; showLinks?: boolean }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [lang, setLangState] = useState<ResultLang>(readResultLang);
  const setLang = (l: ResultLang) => {
    setLangState(l);
    try {
      localStorage.setItem(RESULT_LANG_KEY, l);
    } catch {
      // Private mode / storage blocked: the choice just doesn't persist.
    }
  };
  const items = detail?.items ?? [];
  const workers = detail?.workers ?? [];
  const fixedDaily = detail?.fixed_daily_mph ?? 0;
  const itemsAuthorized = round1(items.reduce((s, i) => s + i.authorized, 0));
  const authorized = round1(itemsAuthorized + fixedDaily);
  const used = round1(workers.reduce((s, w) => s + w.mph, 0));
  // A submitted report keeps its own figures; the live detail may differ if production was posted later.
  const stale = Math.abs(authorized - d.authorized_mph) > 0.05 || Math.abs(used - d.used_mph) > 0.05;
  const net = round1(d.authorized_mph - d.used_mph);
  const perUnit = d.output > 0 ? d.used_mph / d.output : 0;
  const standard = d.output > 0 ? d.authorized_mph / d.output : 0;
  const efficiency = d.used_mph > 0 ? (d.authorized_mph / d.used_mph) * 100 : 0;

  const itemGroups = groupBy(items, (i) => i.sub_department);
  const workerGroups = groupBy(workers, (w) => w.process);
  const LIMIT = 3;
  const toggle = (k: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const th = "text-[11px] font-semibold text-muted-foreground text-left px-2 py-1.5 border-b whitespace-nowrap";
  const td = `${compact ? "text-[13px]" : "text-sm"} px-2 py-1.5 border-b border-muted align-top`;
  const num = "text-right tabular-nums";

  return (
    <div className={`space-y-4 ${compact ? "" : ""}`}>
      {/* Formula strip */}
      <div className="rounded-lg bg-slate-900 text-white px-4 py-3">
        <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 text-center">
          <div><div className="text-[11px] opacity-70">Authorized</div><div className="text-xl font-semibold tabular-nums">{fmtMph(d.authorized_mph)}</div></div>
          <div className="text-lg opacity-60">−</div>
          <div><div className="text-[11px] opacity-70">Used</div><div className="text-xl font-semibold tabular-nums">{fmtMph(d.used_mph)}</div></div>
          <div className="text-lg opacity-60">=</div>
          <div><div className="text-[11px] opacity-70">Net</div><div className={`text-xl font-semibold tabular-nums ${net < 0 ? "text-red-300" : "text-green-300"}`}>{fmtMph(net)}</div></div>
        </div>
        <div className="mt-2 pt-2 border-t border-white/15 flex flex-wrap justify-between gap-x-4 text-xs opacity-85">
          <span>Efficiency <b className="tabular-nums">{efficiency.toFixed(1)}%</b></span>
          <span>Used / unit <b className="tabular-nums">{d.output > 0 ? perUnit.toFixed(3) : "—"}</b></span>
          <span>Workers <b className="tabular-nums">{workers.length}</b></span>
        </div>
      </div>

      {stale && (
        <p className="text-xs text-orange-800 bg-orange-50 border border-orange-200 rounded-md px-3 py-2">
          The item and worker rows below are today's entries ({fmtMph(authorized)} / {fmtMph(used)}); the totals above are the ones this report was saved with.
        </p>
      )}

      <div className={compact ? "space-y-4" : "grid grid-cols-1 xl:grid-cols-[1.3fr_1fr] gap-5 items-start"}>
        {/* Items */}
        <section>
          <div className="flex items-start gap-2 mb-1.5">
            <Step n={1} />
            <div>
              <div className="text-sm font-semibold">Authorized MPH, item by item</div>
              <div className="text-xs text-muted-foreground">Each posted item: output × MPH number = MPH earned. The MPH number is set per sub-department in MPH Master.</div>
            </div>
          </div>
          {fixedDaily > 0 && (
            <div className="rounded-md border border-blue-200 bg-blue-50 text-blue-900 px-3 py-2 mb-2 text-sm flex justify-between gap-3">
              <span>Fixed daily allowance — set in MPH Master for departments with no countable output. Earned once per day the department has anyone deployed.</span>
              <b className="tabular-nums whitespace-nowrap">{fmtMph(fixedDaily)}</b>
            </div>
          )}
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3">{fixedDaily > 0 ? "No production posted for this department; only the fixed daily allowance counts." : "No production posted for this department."}</p>
          ) : (
            <div className="rounded-md border bg-background overflow-x-auto">
              <table className="w-full border-collapse">
                <thead><tr><th className={th}>Item</th>{!compact && <th className={th}>Shift</th>}<th className={`${th} text-right`}>Output</th><th className={`${th} text-right`}>× MPH</th><th className={`${th} text-right`}>= MPH</th>{!compact && <th className={`${th} text-right`}>Share</th>}</tr></thead>
                <tbody>
                  {itemGroups.map(([sub, rows]) => {
                    const subTotal = round1(rows.reduce((s, r) => s + r.authorized, 0));
                    return [
                      <tr key={`g-${sub}`} className="bg-indigo-50 text-indigo-900">
                        <td className={`${td} font-semibold text-xs`} colSpan={compact ? 3 : 4}>{sub} · MPH number {rows[0].mph_number.toFixed(3)}</td>
                        <td className={`${td} ${num} font-semibold text-xs`}>{fmtMph(subTotal)}</td>
                        {!compact && <td className={`${td} ${num} text-xs`}>{itemsAuthorized > 0 ? Math.round((subTotal / itemsAuthorized) * 100) : 0}%</td>}
                      </tr>,
                      ...rows.map((r, i) => (
                        <tr key={`${sub}-${i}`}>
                          <td className={td}><b>{r.item_name}</b>{(r.item_code || (compact && r.shift)) && <div className="text-[11px] text-muted-foreground">{[r.item_code, compact ? r.shift : null].filter(Boolean).join(" · ")}</div>}</td>
                          {!compact && <td className={td}>{r.shift}</td>}
                          <td className={`${td} ${num}`}>{fmtQty(r.output)}</td>
                          <td className={`${td} ${num} text-muted-foreground`}>× {r.mph_number.toFixed(3)}</td>
                          <td className={`${td} ${num} font-semibold`}>{fmtMph(r.authorized)}</td>
                          {!compact && <td className={`${td} ${num} text-muted-foreground`}>{itemsAuthorized > 0 ? Math.round((r.authorized / itemsAuthorized) * 100) : 0}%</td>}
                        </tr>
                      )),
                    ];
                  })}
                  <tr className="font-semibold bg-muted/40">
                    <td className={`${td} border-t-2 border-t-foreground`} colSpan={compact ? 1 : 2}>Total · {items.length} item{items.length === 1 ? "" : "s"}</td>
                    <td className={`${td} ${num} border-t-2 border-t-foreground`}>{fmtQty(d.output)}</td>
                    <td className={`${td} border-t-2 border-t-foreground`} />
                    <td className={`${td} ${num} border-t-2 border-t-foreground`}>{fmtMph(itemsAuthorized)}</td>
                    {!compact && <td className={`${td} ${num} border-t-2 border-t-foreground`}>100%</td>}
                  </tr>
                  {fixedDaily > 0 && (
                    <tr className="font-semibold bg-muted/40">
                      <td className={td} colSpan={compact ? 3 : 4}>+ Fixed daily allowance</td>
                      <td className={`${td} ${num}`}>{fmtMph(fixedDaily)}</td>
                      {!compact && <td className={td} />}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {showLinks && (
            <Link to="/production/daily-entry" className="inline-flex items-center gap-1 text-xs font-medium text-primary mt-1.5 min-h-[36px]">
              Open Daily Entry <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </section>

        {/* Workers */}
        <section>
          <div className="flex items-start gap-2 mb-1.5">
            <Step n={2} />
            <div>
              <div className="text-sm font-semibold">Used MPH, worker by worker</div>
              <div className="text-xs text-muted-foreground">From Today's Deployment: each worker's MPH for the day, grouped by process.</div>
            </div>
          </div>
          {workers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3">No labour deployed to this department.</p>
          ) : (
            <div className="rounded-md border bg-background overflow-x-auto">
              <table className="w-full border-collapse">
                <thead><tr><th className={th}>Worker</th><th className={th}>Shift</th><th className={`${th} text-right`}>Hours</th><th className={`${th} text-right`}>MPH</th></tr></thead>
                <tbody>
                  {workerGroups.map(([proc, rows]) => {
                    const open = expanded.has(proc);
                    const shown = open ? rows : rows.slice(0, LIMIT);
                    const hidden = rows.length - shown.length;
                    const hiddenMph = round1(rows.slice(LIMIT).reduce((s, r) => s + r.mph, 0));
                    return [
                      <tr key={`g-${proc}`} className="bg-indigo-50 text-indigo-900">
                        <td className={`${td} font-semibold text-xs`} colSpan={3}>{proc} · {rows.length} worker{rows.length === 1 ? "" : "s"}</td>
                        <td className={`${td} ${num} font-semibold text-xs`}>{fmtMph(round1(rows.reduce((s, r) => s + r.mph, 0)))}</td>
                      </tr>,
                      ...shown.map((w, i) => (
                        <tr key={`${proc}-${i}`}>
                          <td className={td}><b>{w.employee_code}</b> {w.employee_name}</td>
                          <td className={`${td} text-muted-foreground whitespace-nowrap`}>{w.shift}</td>
                          <td className={`${td} ${num} text-muted-foreground`}>{w.hours ?? "—"}</td>
                          <td className={`${td} ${num} font-semibold`}>{fmtMph(w.mph)}</td>
                        </tr>
                      )),
                      hidden > 0 || open ? (
                        <tr key={`m-${proc}`}>
                          <td className={td} colSpan={3}>
                            <button type="button" className="text-primary font-medium text-sm min-h-[36px]" onClick={() => toggle(proc)}>
                              {open ? "Show fewer" : `+ ${hidden} more worker${hidden === 1 ? "" : "s"}`}
                            </button>
                          </td>
                          <td className={`${td} ${num}`}>{open ? "" : fmtMph(hiddenMph)}</td>
                        </tr>
                      ) : null,
                    ];
                  })}
                  <tr className="font-semibold bg-muted/40">
                    <td className={`${td} border-t-2 border-t-foreground`} colSpan={3}>Total · {workers.length} worker{workers.length === 1 ? "" : "s"}</td>
                    <td className={`${td} ${num} border-t-2 border-t-foreground`}>{fmtMph(used)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {showLinks && (
            <Link to="/labour/todays-target" className="inline-flex items-center gap-1 text-xs font-medium text-primary mt-1.5 min-h-[36px]">
              Open deployment sheet <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </section>
      </div>

      {/* Result — Urdu by default, English on the toggle; the choice is kept per device. */}
      <div className={`rounded-lg border px-3 py-2.5 text-sm leading-relaxed ${net < 0 ? "border-red-200 bg-red-50 text-red-900" : "border-green-200 bg-green-50 text-green-900"}`}>
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <div className="flex items-center gap-2 font-semibold">
            <Step n={3} red={net < 0} green={net >= 0} />
            {lang === "ur" ? <span className="font-urdu text-base leading-7">نتیجہ</span> : "Result"}
            {lang === "ur" && <span className="text-xs font-normal opacity-70">Result</span>}
          </div>
          <div className="inline-flex rounded-full border bg-background overflow-hidden" role="group" aria-label="Result language">
            <button type="button" onClick={() => setLang("ur")} className={`h-8 px-3 text-xs font-semibold font-urdu ${lang === "ur" ? "bg-primary text-primary-foreground" : "text-foreground"}`}>اردو</button>
            <button type="button" onClick={() => setLang("en")} className={`h-8 px-3 text-xs font-semibold ${lang === "en" ? "bg-primary text-primary-foreground" : "text-foreground"}`}>English</button>
          </div>
        </div>
        {lang === "ur" ? (
          <p dir="rtl" lang="ur" className="font-urdu text-right text-[16px] leading-[2.1] m-0">
            <bdi className="font-sans font-semibold">{d.department_name}</bdi> نے{" "}
            <N>{fmtQty(d.output)}</N> یونٹس{items.length > 0 ? <> (<N>{items.length}</N> آئٹمز)</> : null} کی <bdi className="font-sans font-semibold">Production</bdi> سے{" "}
            <N>{fmtMph(d.authorized_mph)}</N> MPH کمائے{fixedDaily > 0 ? <> (جس میں <N>{fmtMph(fixedDaily)}</N> MPH روزانہ کا مقررہ الاؤنس شامل ہے)</> : null}، {net < 0 ? "لیکن" : "اور"}{" "}
            {workers.length > 0 ? <><N>{workers.length}</N> {workers.length === 1 ? "ورکر" : "ورکرز"} کی مزدوری میں </> : "مزدوری میں "}
            <N>{fmtMph(d.used_mph)}</N> MPH استعمال ہوئے۔{" "}
            {net < 0 ? (
              <>اس لیے <N>{fmtMph(-net)}</N> MPH کا <bdi className="font-sans font-semibold">Loss</bdi> ہوا۔</>
            ) : (
              <>اس لیے کوئی <bdi className="font-sans font-semibold">Loss</bdi> نہیں ہوا — <N>{fmtMph(net)}</N> MPH <bdi className="font-sans font-semibold">Save</bdi> ہوئے۔</>
            )}
            {d.output > 0 ? (
              <> فی یونٹ استعمال شدہ MPH <N>{perUnit.toFixed(3)}</N> ہے، جبکہ معیار <N>{standard.toFixed(3)}</N> ہے۔</>
            ) : (
              <> آج اس ڈیپارٹمنٹ کی کوئی <bdi className="font-sans font-semibold">Production</bdi> <bdi className="font-sans font-semibold">Post</bdi> نہیں ہوئی۔</>
            )}
          </p>
        ) : (
          <p className="m-0">
            {d.department_name} earned <b className="tabular-nums">{fmtMph(d.authorized_mph)}</b> MPH
            {fixedDaily > 0 && items.length === 0
              ? " as its fixed daily allowance"
              : <> from {fmtQty(d.output)} units{items.length > 0 ? ` across ${items.length} item${items.length === 1 ? "" : "s"}` : ""}{fixedDaily > 0 ? ` (incl. ${fmtMph(fixedDaily)} fixed daily)` : ""}</>}, but used{" "}
            <b className="tabular-nums">{fmtMph(d.used_mph)}</b> MPH of labour{workers.length > 0 ? ` from ${workers.length} workers` : ""}.
            {net < 0 ? (
              <> So <b className="tabular-nums">{fmtMph(-net)}</b> MPH is lost.</>
            ) : (
              <> So <b className="tabular-nums">{fmtMph(net)}</b> MPH is saved.</>
            )}
            {d.output > 0 ? (
              <> Used MPH per unit = <b className="tabular-nums">{perUnit.toFixed(3)}</b> against a standard of <b className="tabular-nums">{standard.toFixed(3)}</b>.</>
            ) : (
              <> No production was posted for this department today.</>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

type ResultLang = "ur" | "en";
const RESULT_LANG_KEY = "mph_result_lang";
const readResultLang = (): ResultLang => {
  try {
    return localStorage.getItem(RESULT_LANG_KEY) === "en" ? "en" : "ur";
  } catch {
    return "ur";
  }
};

// A number or English word inside the Urdu sentence: isolated so it never flips.
function N({ children }: { children: React.ReactNode }) {
  return <bdi className="font-mono font-semibold tabular-nums">{children}</bdi>;
}

function Step({ n, red = false, green = false }: { n: number; red?: boolean; green?: boolean }) {
  return (
    <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${red ? "bg-red-700" : green ? "bg-green-700" : "bg-primary"}`}>
      {n}
    </span>
  );
}

function groupBy<T>(rows: T[], key: (r: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  rows.forEach((r) => {
    const k = key(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  });
  return Array.from(map.entries());
}

// ---------------------------------------------------------------------------
// Phone
// ---------------------------------------------------------------------------

function MobileOverview(
  props: Common & { filter: "pending" | "all"; setFilter: (f: "pending" | "all") => void; onOpen: (id: string) => void }
) {
  const { date, setDate, pendingDates, report, isSubmitted, isSuperAdmin, canEdit, isLoading, deptState, totals, allDepts, lossDepts, noLossCount,
    handleSave, handlePrint, saveMutation, reopenMutation, allExplained, filter, setFilter, onOpen } = props;
  const pct = totals.loss > 0 ? Math.round((totals.explained / totals.loss) * 100) : 100;
  const shown = filter === "pending" ? deptState.filter((d) => d.status !== "complete") : deptState;

  return (
    <div className="pb-28">
      {/* App bar */}
      <div className="sticky top-0 z-20 bg-background border-b">
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold leading-tight">MPH Loss Reasons</div>
            <div className="text-xs text-muted-foreground">{format(parseISO(date), "dd MMM yyyy")}</div>
          </div>
          <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Print report" onClick={handlePrint} disabled={isLoading}>
            <Printer className="h-5 w-5" />
          </Button>
        </div>
        <div className="flex gap-2 px-3 pb-2 overflow-x-auto">
          <label className="shrink-0 inline-flex items-center h-10 px-3 rounded-full border bg-background text-sm font-semibold gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Production date"
              className="bg-transparent text-base outline-none w-[130px]"
            />
          </label>
          {pendingDates.filter((d) => d !== date).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDate(d)}
              className="shrink-0 inline-flex items-center gap-1.5 h-10 px-3 rounded-full border border-red-200 bg-background text-sm font-semibold text-red-800"
            >
              <span className="h-2 w-2 rounded-full bg-red-600" /> {format(parseISO(d), "dd MMM")}
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 pt-3 space-y-3">
        {/* Progress */}
        <Card>
          <CardContent className="p-4 space-y-2.5">
            <div className="flex justify-between items-end gap-2">
              <div>
                <div className="text-xs text-muted-foreground">Still to explain</div>
                <div className={`text-3xl font-semibold tabular-nums leading-tight ${totals.remaining > 0 ? "text-amber-700" : "text-green-700"}`}>
                  {fmtMph(totals.remaining)} <span className="text-sm font-medium text-muted-foreground">MPH</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Total loss</div>
                <div className="text-lg font-semibold tabular-nums text-red-700">−{fmtMph(totals.loss)}</div>
              </div>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-2 rounded-full bg-green-600" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span><b className="text-green-700">{fmtMph(totals.explained)}</b> explained · {pct}%</span>
              <span><b className="text-foreground">{totals.done}</b> of {deptState.length} departments done</span>
            </div>
            {isSubmitted ? (
              <div className="flex items-center gap-2 text-xs text-green-900 bg-green-50 rounded-md px-2.5 py-2">
                <Check className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">Submitted {report?.submitted_at ? format(new Date(report.submitted_at), "dd MMM HH:mm") : ""}{report?.submitted_by_name ? ` by ${report.submitted_by_name}` : ""} · locked</span>
                {isSuperAdmin && (
                  <button type="button" className="font-semibold underline min-h-[32px]" onClick={() => reopenMutation.mutate()} disabled={reopenMutation.isPending}>Reopen</button>
                )}
              </div>
            ) : report?.notified_at ? (
              <div className="flex items-center gap-2 text-xs text-blue-900 bg-blue-50 rounded-md px-2.5 py-2">
                <Bell className="h-3.5 w-3.5 shrink-0" />
                Production posted {format(new Date(report.notified_at), "HH:mm")} · {lossDepts.length} of {allDepts.length} departments in loss
              </div>
            ) : null}
            {isSubmitted && report?.production_changed_at && (
              <div className="flex items-center gap-2 text-xs text-orange-900 bg-orange-50 rounded-md px-2.5 py-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Production changed after submission — figures may differ from MPH Analysis.
              </div>
            )}
          </CardContent>
        </Card>

        {/* List header */}
        <div className="flex items-center justify-between px-0.5">
          <div className="text-sm font-bold">Departments in loss</div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setFilter("pending")}
              className={`h-8 px-3 rounded-full border text-xs font-semibold ${filter === "pending" ? "border-primary bg-blue-50 text-primary" : "bg-background"}`}
            >
              Pending {deptState.length - totals.done}
            </button>
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`h-8 px-3 rounded-full border text-xs font-semibold ${filter === "all" ? "border-primary bg-blue-50 text-primary" : "bg-background"}`}
            >
              All {deptState.length}
            </button>
          </div>
        </div>

        <Card className="overflow-hidden">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
          ) : shown.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center px-4">
              {deptState.length === 0
                ? allDepts.length === 0
                  ? "No production or labour MPH recorded for this date."
                  : "No department is in MPH loss — nothing to explain."
                : "Every department is explained. Submit when ready."}
            </p>
          ) : (
            shown.map((d) => {
              const s = STATUS_BADGE[d.status];
              return (
                <button
                  key={d.dept.department_id}
                  type="button"
                  onClick={() => onOpen(d.dept.department_id)}
                  className="flex w-full items-center gap-3 px-4 min-h-[64px] text-left border-b last:border-b-0 active:bg-muted/60"
                >
                  <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${s.dot}`} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[15px] font-semibold truncate">{d.dept.department_name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {d.lines.length === 0
                        ? "No reason yet"
                        : d.status === "complete"
                        ? `Fully explained · ${d.lines.length} reason${d.lines.length === 1 ? "" : "s"}`
                        : `${fmtMph(d.explained)} of ${fmtMph(d.loss)} explained · ${d.lines.length} reason${d.lines.length === 1 ? "" : "s"}`}
                    </span>
                  </span>
                  <span className={`text-base font-semibold tabular-nums ${d.status === "complete" ? "text-muted-foreground" : "text-red-700"}`}>
                    −{fmtMph(d.loss)}
                  </span>
                  <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
                </button>
              );
            })
          )}
        </Card>

        {noLossCount > 0 && (
          <p className="text-xs text-muted-foreground px-0.5">
            {noLossCount} department{noLossCount === 1 ? "" : "s"} with no loss hidden.
          </p>
        )}
      </div>

      {/* Sticky actions */}
      {canEdit && (
        <div className="fixed inset-x-0 bottom-0 z-30 bg-background border-t px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] grid grid-cols-[1fr_1.5fr] gap-2.5 shadow-[0_-8px_24px_rgba(0,0,0,.06)]">
          <Button variant="outline" className="h-12 text-[15px] rounded-xl" onClick={() => handleSave(false)} disabled={saveMutation.isPending || isLoading}>
            Save draft
          </Button>
          <Button className="h-12 text-[15px] rounded-xl" onClick={() => handleSave(true)} disabled={saveMutation.isPending || isLoading || !allExplained}>
            {allExplained ? "Submit reasons" : `Submit · ${fmtMph(totals.remaining)} left`}
          </Button>
        </div>
      )}
    </div>
  );
}

function MobileDepartment(
  props: Common & {
    d: DeptState;
    onBack: () => void;
    onNext: () => void;
    onPickReason: (lineKey: string) => void;
    onShowCalc: () => void;
  }
) {
  const { d, date, deptState, canEdit, reasonById, updateLine, addLine, removeLine, handleSave, saveMutation, isLoading,
    onBack, onNext, onPickReason, onShowCalc } = props;
  const idx = deptState.findIndex((x) => x.dept.department_id === d.dept.department_id);
  const pct = d.loss > 0 ? Math.min((d.explained / d.loss) * 100, 100) : 0;
  const deptId = d.dept.department_id;
  const input = "h-12 text-base rounded-[10px]";

  return (
    <div className="pb-28">
      <div className="sticky top-0 z-20 bg-background border-b flex items-center gap-1 px-2 py-2">
        <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Back to departments" onClick={onBack}>
          <ChevronLeft className="h-6 w-6" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="text-base font-bold leading-tight truncate">{d.dept.department_name}</div>
          <div className="text-xs text-muted-foreground">{format(parseISO(date), "dd MMM yyyy")} · {idx + 1} of {deptState.length}</div>
        </div>
        <Button variant="outline" size="sm" className="h-10 rounded-full border-blue-200 bg-blue-50 text-primary mr-1" onClick={onShowCalc}>
          <Calculator className="h-4 w-4 mr-1.5" /> Calculation
        </Button>
      </div>

      <div className="px-3 pt-3 space-y-3">
        <Card>
          <CardContent className="p-3 space-y-2.5">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-muted/50 py-2"><div className="text-[11px] text-muted-foreground">Authorized</div><div className="text-[17px] font-semibold tabular-nums">{fmtMph(d.dept.authorized_mph)}</div></div>
              <div className="rounded-lg bg-muted/50 py-2"><div className="text-[11px] text-muted-foreground">Used</div><div className="text-[17px] font-semibold tabular-nums">{fmtMph(d.dept.used_mph)}</div></div>
              <div className="rounded-lg bg-red-50 py-2"><div className="text-[11px] text-red-800">Net loss</div><div className="text-[17px] font-semibold tabular-nums text-red-700">{fmtMph(d.loss)}</div></div>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className={`h-2 rounded-full ${d.status === "complete" ? "bg-green-600" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
            </div>
            <div className="flex justify-between text-[13px]">
              <span className="text-muted-foreground"><b className="text-foreground">{fmtMph(d.explained)}</b> of {fmtMph(d.loss)} explained</span>
              <RemainingText d={d} className="text-[13px]" />
            </div>
          </CardContent>
        </Card>

        {d.lines.map((l, i) => {
          const reason = reasonById[l.reason_id];
          const gap = round1(d.remaining + (Number(l.mph_lost) || 0));
          const showFill = canEdit && d.remaining > MPH_LOSS_TOLERANCE;
          return (
            <Card key={l.key}>
              <CardContent className="p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">Reason {i + 1}</span>
                  {canEdit && (
                    <Button variant="ghost" size="icon" className="h-10 w-10 -my-2 -mr-2 text-muted-foreground" aria-label={`Remove reason ${i + 1}`} onClick={() => removeLine(deptId, l.key)}>
                      <Trash2 className="h-[18px] w-[18px]" />
                    </Button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => canEdit && onPickReason(l.key)}
                  disabled={!canEdit}
                  className={`flex w-full items-center justify-between gap-2 ${input} border px-3 text-left bg-background ${!l.reason_id ? "border-primary" : ""}`}
                >
                  <span className="flex flex-col min-w-0">
                    <span className={`text-[15px] font-semibold truncate ${!reason ? "text-muted-foreground font-normal" : ""}`}>{reason?.name ?? "Select reason…"}</span>
                    {reason?.category && <span className="text-[11px] text-muted-foreground">{reason.category}</span>}
                  </span>
                  <ChevronDown className="h-[18px] w-[18px] text-muted-foreground shrink-0" />
                </button>
                <div className="grid grid-cols-[1.2fr_1fr] gap-2.5">
                  <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
                    MPH lost
                    <Input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.1"
                      placeholder="0.0"
                      className={`${input} text-right font-semibold tabular-nums`}
                      value={l.mph_lost}
                      disabled={!canEdit}
                      onChange={(e) => updateLine(deptId, l.key, { mph_lost: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
                    Workers
                    <Input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      step="1"
                      placeholder="0"
                      className={`${input} text-right tabular-nums`}
                      value={l.workers_affected}
                      disabled={!canEdit}
                      onChange={(e) => updateLine(deptId, l.key, { workers_affected: e.target.value })}
                    />
                  </label>
                </div>
                {showFill && (
                  <button
                    type="button"
                    onClick={() => updateLine(deptId, l.key, { mph_lost: String(gap) })}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-amber-300 bg-amber-50 text-amber-900 text-[13px] font-semibold"
                  >
                    <ArrowRight className="h-3.5 w-3.5" /> Use remaining {fmtMph(d.remaining)} → {fmtMph(gap)}
                  </button>
                )}
                <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
                  Remarks
                  <Input
                    placeholder="What happened?"
                    className={`${input} font-normal`}
                    value={l.remarks}
                    disabled={!canEdit}
                    onChange={(e) => updateLine(deptId, l.key, { remarks: e.target.value })}
                  />
                </label>
              </CardContent>
            </Card>
          );
        })}

        {canEdit && (
          <button
            type="button"
            onClick={() => {
              const key = addLine(deptId);
              onPickReason(key);
            }}
            className="flex w-full items-center justify-center gap-2 h-12 rounded-xl border-[1.5px] border-dashed border-blue-300 bg-blue-50 text-primary text-[15px] font-semibold"
          >
            <Plus className="h-[18px] w-[18px]" /> {d.lines.length === 0 ? "Add a reason" : "Add another reason"}
          </button>
        )}
        {!canEdit && d.lines.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">No reason entered.</p>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 bg-background border-t px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] grid grid-cols-[1fr_1.5fr] gap-2.5 shadow-[0_-8px_24px_rgba(0,0,0,.06)]">
        {canEdit ? (
          <Button variant="outline" className="h-12 text-[15px] rounded-xl" onClick={() => handleSave(false)} disabled={saveMutation.isPending || isLoading}>
            Save draft
          </Button>
        ) : (
          <Button variant="outline" className="h-12 text-[15px] rounded-xl" onClick={onBack}>Back</Button>
        )}
        <Button className="h-12 text-[15px] rounded-xl" onClick={onNext}>
          {idx + 1 < deptState.length ? "Next department" : "Back to list"} <ChevronRight className="h-[18px] w-[18px] ml-1" />
        </Button>
      </div>
    </div>
  );
}

function ReasonPicker({
  dept, options, usedIds, current, onPick, onClose,
}: {
  dept: DeptState;
  options: MphLossReason[];
  usedIds: Set<string>;
  current: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const categories = Array.from(new Set(options.map((o) => o.category).filter(Boolean))) as string[];
  const filtered = options.filter(
    (o) =>
      (cat === "all" || o.category === cat) &&
      (!q || `${o.name} ${o.description ?? ""} ${o.category ?? ""}`.toLowerCase().includes(q.toLowerCase()))
  );
  const used = filtered.filter((o) => usedIds.has(o.id));
  const rest = filtered.filter((o) => !usedIds.has(o.id));

  const Row = ({ r }: { r: MphLossReason }) => {
    const selected = r.id === current;
    return (
      <button
        type="button"
        onClick={() => onPick(r.id)}
        className={`flex w-full items-center gap-3 px-4 min-h-[56px] py-2.5 text-left border-b last:border-b-0 active:bg-muted/60 ${selected ? "bg-blue-50" : ""}`}
      >
        <span className="w-5 shrink-0">{selected && <Check className="h-5 w-5 text-primary" />}</span>
        <span className="flex-1 min-w-0">
          <span className={`block text-[15px] font-semibold ${selected ? "text-blue-900" : ""}`}>{r.name}</span>
          {r.description && <span className="block text-xs text-muted-foreground">{r.description}</span>}
        </span>
        {r.category && <span className="text-[11px] font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-md shrink-0">{r.category}</span>}
      </button>
    );
  };

  return (
    <div className="flex flex-col max-h-[88vh]">
      <DrawerHeader className="text-left pb-2 pr-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <DrawerTitle>Reason for {dept.dept.department_name}</DrawerTitle>
            <DrawerDescription>{options.length} reason{options.length === 1 ? "" : "s"} apply to this department</DrawerDescription>
          </div>
          <Button variant="ghost" size="icon" className="h-11 w-11 -mt-1" aria-label="Close" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>
      </DrawerHeader>
      <div className="px-4 pb-2.5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-[18px] w-[18px] text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search reasons"
            aria-label="Search reasons"
            className="h-12 text-base rounded-xl pl-10 bg-muted/40"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
        </div>
      </div>
      {categories.length > 1 && (
        <div className="flex gap-2 px-4 pb-2.5 overflow-x-auto">
          {["all", ...categories].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCat(c)}
              className={`shrink-0 h-8 px-3 rounded-full border text-xs font-semibold ${cat === c ? "border-primary bg-primary text-primary-foreground" : "bg-background"}`}
            >
              {c === "all" ? "All" : c}
            </button>
          ))}
        </div>
      )}
      <div className="overflow-y-auto border-t pb-[env(safe-area-inset-bottom)]">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10 px-4">
            {options.length === 0 ? "No reasons set up for this department. Ask a super admin to add them in Master Data → MPH Loss Reasons." : "No reason matches."}
          </p>
        ) : (
          <>
            {used.length > 0 && (
              <>
                <div className="text-[11px] font-semibold text-muted-foreground px-4 pt-2.5 pb-1 bg-muted/40">USED TODAY</div>
                {used.map((r) => <Row key={r.id} r={r} />)}
                <div className="text-[11px] font-semibold text-muted-foreground px-4 pt-2.5 pb-1 bg-muted/40">ALL REASONS</div>
              </>
            )}
            {rest.map((r) => <Row key={r.id} r={r} />)}
          </>
        )}
      </div>
    </div>
  );
}
