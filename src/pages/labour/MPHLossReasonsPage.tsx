import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { Bell, Plus, Printer, Save, Send, Trash2, AlertTriangle, Unlock, Gauge } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  type DepartmentMph,
  type MphLossReason,
  MPH_LOSS_TOLERANCE,
  escapeHtml,
  fetchDepartmentMph,
  fmtMph,
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

const STATUS_BADGE: Record<DeptStatus, { label: string; className: string }> = {
  complete: { label: "Complete", className: "bg-green-100 text-green-700 hover:bg-green-100" },
  partial: { label: "Partly explained", className: "bg-amber-100 text-amber-800 hover:bg-amber-100" },
  over: { label: "More than loss", className: "bg-orange-100 text-orange-800 hover:bg-orange-100" },
  pending: { label: "Pending", className: "bg-red-100 text-red-700 hover:bg-red-100" },
};

export default function MPHLossReasonsPage() {
  const qc = useQueryClient();
  const { hasRole } = useAuth();
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

  const { data: liveDepts = [], isLoading: loadingMph } = useQuery({
    queryKey: ["mph-loss-live", date],
    queryFn: () => fetchDepartmentMph(date),
  });

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
        (supabase as any).from("mph_loss_report_departments").select("*").eq("report_id", report.id),
        (supabase as any).from("mph_loss_report_lines").select("*").eq("report_id", report.id).order("sort_order"),
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

  const deptState = useMemo(() => {
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

  const updateLine = (deptId: string, key: string, patch: Partial<LineDraft>) =>
    setLines((prev) => ({
      ...prev,
      [deptId]: (prev[deptId] ?? []).map((l) => (l.key === key ? { ...l, ...patch } : l)),
    }));
  const addLine = (deptId: string) =>
    setLines((prev) => ({ ...prev, [deptId]: [...(prev[deptId] ?? []), newLine()] }));
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

        {/* Status banner */}
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
            <Bell className="h-4 w-4" />
            <span className="flex-1 min-w-[260px]">
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
            <AlertTriangle className="h-4 w-4" />
            More production was posted for this date on {format(new Date(report.production_changed_at), "dd MMM yyyy HH:mm")},
            after the reasons were submitted. The figures below are the submitted ones and may no longer match MPH Analysis.
          </div>
        )}
        {!canEditRole && (
          <p className="text-sm text-muted-foreground">View only — the Production Coordinator enters these reasons.</p>
        )}

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
            return (
              <Card key={d.dept.department_id} className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b bg-muted/40 px-4 py-3">
                  <h2 className="flex-1 min-w-[160px] text-base font-semibold">{d.dept.department_name}</h2>
                  <div className="flex gap-4 text-sm text-muted-foreground">
                    <span>Authorized <b className="text-foreground">{fmtMph(d.dept.authorized_mph)}</b></span>
                    <span>Used <b className="text-foreground">{fmtMph(d.dept.used_mph)}</b></span>
                    <span>Net <b className="text-red-600">{fmtMph(d.dept.net_mph)}</b></span>
                  </div>
                  <div className="w-[190px]">
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
                        <span
                          className={`text-sm font-semibold ${
                            d.status === "complete" ? "text-green-700" : "text-amber-700"
                          }`}
                        >
                          {d.status === "complete"
                            ? "Fully explained"
                            : d.status === "over"
                            ? `${fmtMph(-d.remaining)} MPH more than the loss`
                            : `${fmtMph(d.remaining)} MPH still to explain`}
                        </span>
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
