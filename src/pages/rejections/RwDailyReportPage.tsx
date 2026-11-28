import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { format, parseISO, subDays } from "date-fns";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CheckCircle2, FileBarChart, Lock, Printer, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { DISPATCH_PRINT_CSS, esc, printDocument } from "@/lib/printDocument";
import {
  useRwDailyReport,
  type DueKind,
  type ReportStatus,
  type RwFigures,
  type RwReport,
  type RwSettings,
} from "@/hooks/useRwDailyReport";

const STATUS_META: Record<ReportStatus, { label: string; className: string }> = {
  missing: { label: "Not written", className: "bg-muted text-muted-foreground" },
  draft: { label: "Draft", className: "bg-slate-100 text-slate-700" },
  submitted: { label: "Awaiting approval", className: "bg-amber-100 text-amber-800" },
  approved: { label: "Approved", className: "bg-green-100 text-green-800" },
  rejected: { label: "Sent back", className: "bg-red-100 text-red-800" },
};
const DUE_LABEL: Record<DueKind, string> = { reminder: "Due", overdue: "Overdue", approval: "Approval overdue" };

const COLORS = { rejection: "#ef4444", wastage: "#f59e0b", leakage: "#6366f1" };
const rs = (n: number | null | undefined) => `Rs. ${Math.round(Number(n || 0)).toLocaleString()}`;
const qty = (n: number | null | undefined) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const errMsg = (e: unknown) => (e as { message?: string })?.message || "Something went wrong";
const stamp = (iso: string | null | undefined) => (iso ? format(new Date(iso), "dd MMM HH:mm") : "");

function StatusBadge({ status, className }: { status: ReportStatus; className?: string }) {
  const m = STATUS_META[status];
  return <Badge variant="outline" className={cn("border-transparent", m.className, className)}>{m.label}</Badge>;
}

function Delta({ now, before, label }: { now: number; before: number | null; label: string }) {
  if (before === null || before === undefined || Number(before) === 0) return null;
  const pct = ((now - Number(before)) / Number(before)) * 100;
  return (
    <span className={cn("text-xs font-medium", pct > 0 ? "text-red-600" : "text-green-700")}>
      {pct > 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}% {label}
    </span>
  );
}

export default function RwDailyReportPage() {
  const [params, setParams] = useSearchParams();
  const dateStr = params.get("date") || format(subDays(new Date(), 1), "yyyy-MM-dd");
  const setDate = (d: string) => d && setParams({ date: d }, { replace: true });

  const r = useRwDailyReport(dateStr);
  const { report, figures } = r;
  const status: ReportStatus = report?.status ?? "missing";
  const editable = r.canWrite && (status === "missing" || status === "draft" || status === "rejected");
  const locked = status === "submitted" || status === "approved";
  const busy = r.save.isPending || r.review.isPending || r.reopen.isPending;
  const dayRow = r.days.find((d) => d.report_date === dateStr);
  const noEntries = !!figures && figures.total_cost === 0 && figures.rejection.entries + figures.wastage.entries + figures.leakage.entries === 0;

  const [summary, setSummary] = useState("");
  const [bigRemark, setBigRemark] = useState("");
  const [actionPlan, setActionPlan] = useState("");
  const [note, setNote] = useState("");

  // Reload the boxes whenever the day or the saved report changes.
  useEffect(() => {
    setSummary(report?.summary ?? "");
    setBigRemark(report?.biggest_loss_remark ?? "");
    setActionPlan(report?.action_plan ?? "");
    setNote("");
  }, [dateStr, report?.summary, report?.biggest_loss_remark, report?.action_plan, report?.status]);

  const run = async (p: Promise<unknown>, ok: string) => {
    try { await p; toast.success(ok); } catch (e) { toast.error(errMsg(e)); }
  };
  const input = { summary, biggest_loss_remark: bigRemark, action_plan: actionPlan };
  const canSubmit = !!summary.trim() && !!bigRemark.trim() && !noEntries;

  const biggest = figures?.departments?.[0];

  return (
    <ERPLayout>
      <div className="space-y-4">
        <PageHeader
          title="R&W Daily Report"
          description="Daily loss figures with the manager's remarks, submitted next morning and approved by a super admin"
          icon={FileBarChart}
        >
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs">Report date</Label>
              <Input type="date" value={dateStr} max={format(new Date(), "yyyy-MM-dd")} onChange={(e) => setDate(e.target.value)} className="w-44" />
            </div>
            <Button variant="outline" disabled={!figures || noEntries} onClick={() => figures && printReport(dateStr, figures, report)}>
              <Printer className="mr-2 h-4 w-4" /> Print A4
            </Button>
          </div>
        </PageHeader>

        <Tabs defaultValue="report">
          <TabsList>
            <TabsTrigger value="report">Report</TabsTrigger>
            <TabsTrigger value="status">Last 30 days</TabsTrigger>
            {r.isSuperAdmin && <TabsTrigger value="settings">Alert settings</TabsTrigger>}
          </TabsList>

          {/* ---------------- REPORT ---------------- */}
          <TabsContent value="report" className="space-y-4">
            <Card>
              <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-4 text-sm">
                <span className="font-semibold">{format(parseISO(dateStr), "EEEE, dd MMM yyyy")}</span>
                <StatusBadge status={status} />
                {dayRow?.due_at && status !== "approved" && (
                  <span className={cn("text-muted-foreground", dayRow.due_kind === "overdue" || dayRow.due_kind === "approval" ? "font-medium text-red-700" : "")}>
                    {status === "submitted" ? "Approve by" : "Submit by"} {stamp(dayRow.due_at)}
                    {dayRow.due_kind && ` · ${DUE_LABEL[dayRow.due_kind]}`}
                  </span>
                )}
                {report && locked && (
                  <span className="text-muted-foreground">
                    {report.submitter?.full_name ? `Submitted by ${report.submitter.full_name}` : "Submitted"} {stamp(report.submitted_at)}
                    {status === "approved" && ` · Approved${report.reviewer?.full_name ? ` by ${report.reviewer.full_name}` : ""} ${stamp(report.reviewed_at)}`}
                  </span>
                )}
                {locked && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Lock className="h-3.5 w-3.5" /> Entries for this day are locked
                  </span>
                )}
              </CardContent>
            </Card>

            {status === "rejected" && report?.review_note && (
              <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                Sent back{report.reviewer?.full_name ? ` by ${report.reviewer.full_name}` : ""}: {report.review_note}
              </p>
            )}
            {status === "draft" && report?.review_note?.startsWith("Reopened") && (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{report.review_note}</p>
            )}

            {r.isSuperAdmin && status === "submitted" && (
              <Card className="border-primary/40 bg-primary/5">
                <CardHeader className="pb-2"><CardTitle className="text-base">Review this report</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Reason (required when sending back)" />
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={busy} onClick={() => run(r.review.mutateAsync({ approve: true }), "Report approved")}>
                      <CheckCircle2 className="mr-1.5 h-4 w-4" /> Approve
                    </Button>
                    <Button
                      variant="outline" className="text-destructive" disabled={busy || !note.trim()}
                      onClick={() => run(r.review.mutateAsync({ approve: false, note }), "Report sent back to the manager")}
                    >
                      <XCircle className="mr-1.5 h-4 w-4" /> Reject and send back
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {!figures && <p className="text-sm text-muted-foreground">Loading figures…</p>}
            {noEntries && (
              <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                There are no rejection, wastage or leakage entries for this day, so no report is needed.
              </p>
            )}
            {figures && !noEntries && (
              <>
                <FiguresView f={figures} />

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">
                      Manager remarks {editable && <span className="text-xs font-normal text-muted-foreground">Summary and biggest-loss remark are required</span>}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <RemarkField id="rw-sum" label="Summary of the day" value={summary} onChange={setSummary} editable={editable}
                      placeholder="What drove today's loss, compared with normal days." />
                    <RemarkField id="rw-big"
                      label={biggest ? `Biggest loss: ${biggest.department} (${rs(biggest.total_cost)}, ${figures.total_cost ? ((biggest.total_cost / figures.total_cost) * 100).toFixed(1) : 0}%)` : "Biggest loss"}
                      value={bigRemark} onChange={setBigRemark} editable={editable}
                      placeholder="What happened there and what was found." />
                    <RemarkField id="rw-act" label="Corrective action and owner (optional)" value={actionPlan} onChange={setActionPlan} editable={editable}
                      placeholder="What is being done, who owns it, by when." />

                    {editable && (
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" disabled={busy} onClick={() => run(r.save.mutateAsync({ ...input, submit: false }), "Draft saved")}>
                          Save Draft
                        </Button>
                        <Button disabled={busy || !canSubmit} onClick={() => run(r.save.mutateAsync({ ...input, submit: true }), "Submitted for approval")}>
                          Submit for Approval
                        </Button>
                      </div>
                    )}
                    {!editable && !locked && !r.canWrite && (
                      <p className="text-xs text-muted-foreground">Only the rejections manager can write this report.</p>
                    )}
                    {r.isSuperAdmin && status === "approved" && (
                      <div className="space-y-2 border-t pt-3">
                        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Reason for reopening (required)" />
                        <Button variant="outline" disabled={busy || !note.trim()} onClick={() => run(r.reopen.mutateAsync(note), "Report reopened")}>
                          <RotateCcw className="mr-1.5 h-4 w-4" /> Reopen report
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base">History</CardTitle></CardHeader>
                  <CardContent className="space-y-1.5 text-sm">
                    {r.history.length === 0 && <p className="text-muted-foreground">Nothing recorded for this day yet.</p>}
                    {r.history.map((h) => (
                      <div key={h.id} className="border-b pb-1.5 last:border-0 last:pb-0">
                        <span className="font-medium capitalize">{h.action}</span>
                        <span className="text-muted-foreground"> · {h.actor?.full_name ?? "—"} · {stamp(h.created_at)}</span>
                        {h.note && <p className="text-muted-foreground">Note: {h.note}</p>}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* ---------------- STATUS LIST ---------------- */}
          <TabsContent value="status">
            <Card>
              <CardContent className="pt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Report date</TableHead>
                      <TableHead className="text-right">Total loss</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead>Next deadline</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.days.filter((d) => d.is_active).map((d) => (
                      <TableRow key={d.report_date} className="cursor-pointer" onClick={() => setDate(d.report_date)}>
                        <TableCell className="font-medium">{format(parseISO(d.report_date), "EEE dd MMM")}</TableCell>
                        <TableCell className="text-right tabular-nums">{rs(d.total_cost)}</TableCell>
                        <TableCell>
                          <StatusBadge status={d.status} />
                          {d.due_kind && <span className="ml-2 text-xs font-medium text-red-700">{DUE_LABEL[d.due_kind]}</span>}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{stamp(d.submitted_at) || "—"}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {d.status === "approved" ? "—" : d.due_at ? `${d.status === "submitted" ? "Approve by" : "Submit by"} ${stamp(d.due_at)}` : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                    {r.days.every((d) => !d.is_active) && (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No days with entries yet.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
                <p className="mt-3 text-xs text-muted-foreground">Days with no rejection, wastage or leakage entries are skipped.</p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- SETTINGS ---------------- */}
          {r.isSuperAdmin && (
            <TabsContent value="settings">
              {r.settings && (
                <SettingsForm
                  initial={r.settings}
                  saving={r.saveSettings.isPending}
                  onSave={(s) => run(r.saveSettings.mutateAsync(s), "Alert settings saved")}
                />
              )}
            </TabsContent>
          )}
        </Tabs>
      </div>
    </ERPLayout>
  );
}

function RemarkField(p: { id: string; label: string; value: string; onChange: (v: string) => void; editable: boolean; placeholder: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={p.id}>{p.label}</Label>
      {p.editable ? (
        <Textarea id={p.id} value={p.value} onChange={(e) => p.onChange(e.target.value)} rows={3} placeholder={p.placeholder} />
      ) : (
        <div id={p.id} className="min-h-[3rem] whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">
          {p.value || <span className="text-muted-foreground">No remark.</span>}
        </div>
      )}
    </div>
  );
}

function FiguresView({ f }: { f: RwFigures }) {
  const parts = [
    { key: "rejection", label: "Rejection", value: f.rejection.cost, color: COLORS.rejection },
    { key: "wastage", label: "Wastage", value: f.wastage.cost, color: COLORS.wastage },
    { key: "leakage", label: "Leakage", value: f.leakage.cost, color: COLORS.leakage },
  ];
  const total = f.total_cost;
  const trend = f.trend.map((t) => ({ ...t, label: format(parseISO(t.date), "dd MMM") }));

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Rejected qty" value={qty(f.rejection.qty)} sub={rs(f.rejection.cost)} />
        <Tile label="Wastage qty" value={qty(f.wastage.qty)} sub={rs(f.wastage.cost)} />
        <Tile label="Leakage qty" value={qty(f.leakage.qty)} sub={rs(f.leakage.cost)} />
        <Tile label="Total loss" value={rs(total)} sub="All departments" strong />
      </div>

      <Card>
        <CardContent className="space-y-2 pt-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-2xl font-semibold tabular-nums">{rs(total)}</span>
            <Delta now={total} before={f.prev_day_total} label="vs previous day" />
            <Delta now={total} before={f.avg_prev_days} label="vs average of earlier days this week" />
          </div>
          <div className="flex h-3 overflow-hidden rounded-full bg-muted">
            {parts.map((p) => <div key={p.key} style={{ width: `${total ? (p.value / total) * 100 : 0}%`, background: p.color }} />)}
          </div>
          <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
            {parts.map((p) => (
              <span key={p.key}>
                <i className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
                {p.label} {rs(p.value)} · {total ? ((p.value / total) * 100).toFixed(1) : "0.0"}%
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Last 7 days · total loss</CardTitle></CardHeader>
          <CardContent>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis fontSize={11} width={48} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(v: number) => rs(v)} />
                  <Bar dataKey="total" radius={[3, 3, 0, 0]}>
                    {trend.map((t) => <Cell key={t.date} fill={t.date === f.date ? "#4f46e5" : "#cbd5e1"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Top reasons</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Reason</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Cost</TableHead></TableRow></TableHeader>
              <TableBody>
                {f.reasons.slice(0, 6).map((x, i) => (
                  <TableRow key={i}>
                    <TableCell>{x.reason}</TableCell>
                    <TableCell><span className="rounded px-1.5 py-0.5 text-xs capitalize text-white" style={{ background: COLORS[x.kind] }}>{x.kind}</span></TableCell>
                    <TableCell className="text-right tabular-nums">{qty(x.qty)}</TableCell>
                    <TableCell className="text-right tabular-nums">{rs(x.cost)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">By department</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Department</TableHead>
                <TableHead className="text-right">Rejected qty</TableHead>
                <TableHead className="text-right">Rejection</TableHead>
                <TableHead className="text-right">Wastage</TableHead>
                <TableHead className="text-right">Leakage</TableHead>
                <TableHead className="text-right">Total loss</TableHead>
                <TableHead className="text-right">Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {f.departments.map((d) => (
                <TableRow key={d.department}>
                  <TableCell>{d.department}</TableCell>
                  <TableCell className="text-right tabular-nums">{qty(d.rejected_qty)}</TableCell>
                  <TableCell className="text-right tabular-nums">{rs(d.rejection_cost)}</TableCell>
                  <TableCell className="text-right tabular-nums">{rs(d.wastage_cost)}</TableCell>
                  <TableCell className="text-right tabular-nums">{rs(d.leakage_cost)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{rs(d.total_cost)}</TableCell>
                  <TableCell className="text-right tabular-nums">{total ? ((d.total_cost / total) * 100).toFixed(1) : "0.0"}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

function Tile({ label, value, sub, strong }: { label: string; value: string; sub: string; strong?: boolean }) {
  return (
    <Card className={cn(strong && "border-primary/50 bg-primary/5")}>
      <CardContent className="pt-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

function SettingsForm({ initial, saving, onSave }: { initial: RwSettings; saving: boolean; onSave: (s: RwSettings) => void }) {
  const [s, setS] = useState(initial);
  useEffect(() => setS(initial), [initial]);
  const hhmm = (t: string) => t.slice(0, 5);
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Alert settings (super admin)</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
          Send reminders and alerts
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><Label className="text-xs">Remind the manager next morning at</Label>
            <Input type="time" value={hhmm(s.reminder_time)} onChange={(e) => setS({ ...s, reminder_time: e.target.value })} /></div>
          <div><Label className="text-xs">Submit deadline next morning (Pakistan time)</Label>
            <Input type="time" value={hhmm(s.submit_by_time)} onChange={(e) => setS({ ...s, submit_by_time: e.target.value })} /></div>
          <div><Label className="text-xs">Daily repeat alert time</Label>
            <Input type="time" value={hhmm(s.alert_time)} onChange={(e) => setS({ ...s, alert_time: e.target.value })} /></div>
          <div><Label className="text-xs">Approve within (hours of submission)</Label>
            <Input type="number" min={1} max={336} value={s.approve_hours} onChange={(e) => setS({ ...s, approve_hours: Number(e.target.value) })} /></div>
          <div><Label className="text-xs">Re-submit within (hours of a send-back or reopen)</Label>
            <Input type="number" min={1} max={336} value={s.resubmit_hours} onChange={(e) => setS({ ...s, resubmit_hours: Number(e.target.value) })} /></div>
          <div><Label className="text-xs">Track from date</Label>
            <Input type="date" value={s.start_date} onChange={(e) => setS({ ...s, start_date: e.target.value })} /></div>
        </div>
        <Button size="sm" disabled={saving} onClick={() => onSave(s)}>{saving ? "Saving…" : "Save Settings"}</Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// A4 print: figures, remarks and signature lines. Unapproved reports are marked.
// ---------------------------------------------------------------------------
function printReport(dateStr: string, f: RwFigures, report: RwReport | null) {
  const status: ReportStatus = report?.status ?? "missing";
  const approved = status === "approved";
  const total = f.total_cost;
  const pct = (n: number) => (total ? ((n / total) * 100).toFixed(1) : "0.0");
  const label = format(parseISO(dateStr), "EEEE, dd MMM yyyy");

  const deptRows = f.departments.map((d) =>
    `<tr><td>${esc(d.department)}</td><td class="num">${qty(d.rejected_qty)}</td><td class="num">${rs(d.rejection_cost)}</td>` +
    `<td class="num">${rs(d.wastage_cost)}</td><td class="num">${rs(d.leakage_cost)}</td><td class="num bold">${rs(d.total_cost)}</td><td class="num">${pct(d.total_cost)}%</td></tr>`).join("");
  const reasonRows = f.reasons.slice(0, 8).map((x) =>
    `<tr><td>${esc(x.reason)}</td><td>${esc(x.kind)}</td><td class="num">${qty(x.qty)}</td><td class="num">${rs(x.cost)}</td></tr>`).join("");
  const remark = (title: string, text: string | undefined) =>
    `<div class="section-title">${esc(title)}</div><div style="white-space:pre-wrap;border:1px solid #ccc;border-radius:4px;padding:8px;min-height:36px">${esc(text) || '<span class="muted">No remark.</span>'}</div>`;

  const html = `
  <div class="wrap">
    <div class="head">
      <div><h1>Rejections &amp; Wastages · Daily Report</h1><div class="muted">${esc(label)}</div></div>
      <div class="right"><div class="status">${approved ? "Approved" : status === "submitted" ? "Awaiting approval" : "Not approved"}</div>
        <div class="muted xs">Printed ${esc(format(new Date(), "dd MMM yyyy, HH:mm"))}</div></div>
    </div>
    <table>
      <thead><tr><th>Rejected</th><th>Wastage</th><th>Leakage</th><th class="num">Total loss</th></tr></thead>
      <tbody><tr>
        <td>${qty(f.rejection.qty)} · ${rs(f.rejection.cost)} (${pct(f.rejection.cost)}%)</td>
        <td>${qty(f.wastage.qty)} · ${rs(f.wastage.cost)} (${pct(f.wastage.cost)}%)</td>
        <td>${qty(f.leakage.qty)} · ${rs(f.leakage.cost)} (${pct(f.leakage.cost)}%)</td>
        <td class="num bold">${rs(total)}</td></tr></tbody>
    </table>
    <div class="muted xs" style="margin-top:4px">${f.prev_day_total ? `Previous day ${rs(f.prev_day_total)}. ` : ""}${f.avg_prev_days ? `Average of earlier days this week ${rs(f.avg_prev_days)}.` : ""}</div>
    <div class="section-title">By department</div>
    <table><thead><tr><th>Department</th><th class="num">Rejected qty</th><th class="num">Rejection</th><th class="num">Wastage</th><th class="num">Leakage</th><th class="num">Total</th><th class="num">Share</th></tr></thead>
      <tbody>${deptRows}</tbody></table>
    <div class="section-title">Top reasons</div>
    <table><thead><tr><th>Reason</th><th>Type</th><th class="num">Qty</th><th class="num">Cost</th></tr></thead><tbody>${reasonRows}</tbody></table>
    ${remark("Summary of the day", report?.summary)}
    ${remark("Remark on the biggest-loss department", report?.biggest_loss_remark)}
    ${remark("Corrective action and owner", report?.action_plan)}
    ${report?.review_note && status === "rejected" ? remark("Review note", report.review_note) : ""}
    <div class="sign">
      <div>Prepared by (Rejections Manager)<br><b>${esc(report?.submitter?.full_name ?? "")}</b> ${report?.submitted_at ? esc(stamp(report.submitted_at)) : ""}</div>
      <div>Approved by (Super Admin)<br><b>${approved ? esc(report?.reviewer?.full_name ?? "") : ""}</b> ${approved && report?.reviewed_at ? esc(stamp(report.reviewed_at)) : ""}</div>
    </div>
  </div>`;
  printDocument(`R&W Daily Report ${dateStr}`, `<style>@page{size:A4;margin:14mm}${DISPATCH_PRINT_CSS}</style>${html}`);
}
