import { useEffect, useState, type ReactNode } from "react";
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
  approveBy, approvedBy, biggestLoss, fmtDay, fmtShortDay, fmtStamp, printedAt, sentBackBy, serverMessage,
  statusLabel, submitBy, submittedBy, t, type Lang, type TextKey,
} from "@/lib/rwReportText";
import { useRwReportLanguage } from "@/hooks/useRwReportLanguage";
import {
  useRwDailyReport,
  type DueKind,
  type ReportStatus,
  type RwFigures,
  type RwReport,
  type RwSettings,
} from "@/hooks/useRwDailyReport";

const STATUS_CLASS: Record<ReportStatus, string> = {
  missing: "bg-muted text-muted-foreground",
  draft: "bg-slate-100 text-slate-700",
  submitted: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};
const DUE_KEY: Record<DueKind, TextKey> = { reminder: "dueReminder", overdue: "dueOverdue", approval: "dueApproval" };
const KIND_KEY = { rejection: "kRejection", wastage: "kWastage", leakage: "kLeakage" } as const;
const HISTORY_KEY: Record<string, TextKey> = {
  saved: "hSaved", submitted: "hSubmitted", approved: "hApproved", rejected: "hRejected", reopened: "hReopened",
};

const COLORS = { rejection: "#ef4444", wastage: "#f59e0b", leakage: "#6366f1" };
const rs = (n: number | null | undefined) => `Rs. ${Math.round(Number(n || 0)).toLocaleString()}`;
const qty = (n: number | null | undefined) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function RwDailyReportPage() {
  const [params, setParams] = useSearchParams();
  const dateStr = params.get("date") || format(subDays(new Date(), 1), "yyyy-MM-dd");
  const setDate = (d: string) => d && setParams({ date: d }, { replace: true });

  const { lang, setLang, both, setBoth } = useRwReportLanguage();
  const T = (k: TextKey) => t(lang, k);
  /** Label with the English wording underneath when "also show English" is on. */
  const X = (k: TextKey): ReactNode => (
    <>
      {t(lang, k)}
      {both && <span className="block text-xs font-normal text-muted-foreground" dir="ltr">{t("en", k)}</span>}
    </>
  );

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

  const run = async (p: Promise<unknown>, ok: TextKey) => {
    try { await p; toast.success(T(ok)); } catch (e) { toast.error(serverMessage(lang, (e as { message?: string })?.message)); }
  };
  const input = { summary, biggest_loss_remark: bigRemark, action_plan: actionPlan };
  const canSubmit = !!summary.trim() && !!bigRemark.trim() && !noEntries;

  const biggest = figures?.departments?.[0];
  const rtl = lang === "ur";
  const dayObj = parseISO(dateStr);
  const reviewNote = report?.review_note?.startsWith("Reopened: ")
    ? `${T("reopenedPrefix")}: ${report.review_note.slice("Reopened: ".length)}`
    : report?.review_note;

  return (
    <ERPLayout>
      <div className={cn("space-y-4", rtl && "font-urdu leading-loose")} dir={rtl ? "rtl" : "ltr"} lang={rtl ? "ur" : "en"}>
        <PageHeader title={T("pageTitle")} description={T("pageDesc")} icon={FileBarChart}>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex overflow-hidden rounded-md border" role="group" aria-label="Language" dir="ltr">
                {([["en", "English"], ["ur", "اردو"], ["ro", "Roman Urdu"]] as [Lang, string][]).map(([l, label]) => (
                  <button
                    key={l} type="button" onClick={() => setLang(l)}
                    className={cn("h-9 px-3 text-sm", l === "ur" && "font-urdu", lang === l ? "bg-primary text-primary-foreground" : "bg-background text-foreground")}
                  >{label}</button>
                ))}
              </div>
              {lang !== "en" && (
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                  <input type="checkbox" checked={both} onChange={(e) => setBoth(e.target.checked)} /> {T("alsoEnglish")}
                </label>
              )}
            </div>
            <div>
              <Label className="text-xs">{T("reportDate")}</Label>
              <Input type="date" value={dateStr} max={format(new Date(), "yyyy-MM-dd")} onChange={(e) => setDate(e.target.value)} className="w-44" />
            </div>
            <Button variant="outline" disabled={!figures || noEntries} onClick={() => figures && printReport(lang, dateStr, figures, report)}>
              <Printer className="mx-2 h-4 w-4" /> {T("printA4")}
            </Button>
          </div>
        </PageHeader>

        <Tabs defaultValue="report">
          <TabsList>
            <TabsTrigger value="report">{T("tabReport")}</TabsTrigger>
            <TabsTrigger value="status">{T("tab30")}</TabsTrigger>
            {r.isSuperAdmin && <TabsTrigger value="settings">{T("tabAlerts")}</TabsTrigger>}
          </TabsList>

          {/* ---------------- REPORT ---------------- */}
          <TabsContent value="report" className="space-y-4">
            <Card>
              <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-4 text-sm">
                <span className="font-semibold">{fmtDay(lang, dayObj)}</span>
                <Badge variant="outline" className={cn("border-transparent", STATUS_CLASS[status])}>{statusLabel(lang, status)}</Badge>
                {dayRow?.due_at && status !== "approved" && (
                  <span className={cn("text-muted-foreground", (dayRow.due_kind === "overdue" || dayRow.due_kind === "approval") && "font-medium text-red-700")}>
                    {(status === "submitted" ? approveBy : submitBy)(lang, fmtStamp(lang, dayRow.due_at))}
                    {dayRow.due_kind && ` · ${T(DUE_KEY[dayRow.due_kind])}`}
                  </span>
                )}
                {report && locked && (
                  <span className="text-muted-foreground">
                    {submittedBy(lang, report.submitter?.full_name, fmtStamp(lang, report.submitted_at))}
                    {status === "approved" && ` · ${approvedBy(lang, report.reviewer?.full_name, fmtStamp(lang, report.reviewed_at))}`}
                  </span>
                )}
                {locked && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Lock className="h-3.5 w-3.5" /> {T("locked")}
                  </span>
                )}
              </CardContent>
            </Card>

            {status === "rejected" && report?.review_note && (
              <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {sentBackBy(lang, report.reviewer?.full_name, report.review_note)}
              </p>
            )}
            {status === "draft" && reviewNote?.startsWith(T("reopenedPrefix")) && (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{reviewNote}</p>
            )}

            {r.isSuperAdmin && status === "submitted" && (
              <Card className="border-primary/40 bg-primary/5">
                <CardHeader className="pb-2"><CardTitle className="text-base">{X("reviewTitle")}</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <Textarea dir="auto" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={T("reasonPh")} />
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={busy} onClick={() => run(r.review.mutateAsync({ approve: true }), "tApproved")}>
                      <CheckCircle2 className="mx-1.5 h-4 w-4" /> {T("approve")}
                    </Button>
                    <Button
                      variant="outline" className="text-destructive" disabled={busy || !note.trim()}
                      onClick={() => run(r.review.mutateAsync({ approve: false, note }), "tSentBack")}
                    >
                      <XCircle className="mx-1.5 h-4 w-4" /> {T("reject")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {!figures && <p className="text-sm text-muted-foreground">{T("loading")}</p>}
            {noEntries && (
              <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">{T("noEntries")}</p>
            )}
            {figures && !noEntries && (
              <>
                <FiguresView f={figures} lang={lang} T={T} X={X} />

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">
                      {X("remarksTitle")}
                      {editable && <span className="block text-xs font-normal text-muted-foreground">{T("remarksReq")}</span>}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <RemarkField id="rw-sum" label={X("fSummary")} value={summary} onChange={setSummary} editable={editable}
                      placeholder={T("phSummary")} empty={T("noRemark")} />
                    <RemarkField id="rw-big"
                      label={biggest
                        ? biggestLoss(lang, biggest.department, rs(biggest.total_cost), figures.total_cost ? ((biggest.total_cost / figures.total_cost) * 100).toFixed(1) : "0")
                        : X("fBigDefault")}
                      value={bigRemark} onChange={setBigRemark} editable={editable}
                      placeholder={T("phBig")} empty={T("noRemark")} />
                    <RemarkField id="rw-act" label={X("fAction")} value={actionPlan} onChange={setActionPlan} editable={editable}
                      placeholder={T("phAction")} empty={T("noRemark")} />

                    {editable && (
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" disabled={busy} onClick={() => run(r.save.mutateAsync({ ...input, submit: false }), "tDraft")}>
                          {T("saveDraft")}
                        </Button>
                        <Button disabled={busy || !canSubmit} onClick={() => run(r.save.mutateAsync({ ...input, submit: true }), "tSubmitted")}>
                          {T("submit")}
                        </Button>
                      </div>
                    )}
                    {!editable && !locked && !r.canWrite && (
                      <p className="text-xs text-muted-foreground">{T("onlyManager")}</p>
                    )}
                    {r.isSuperAdmin && status === "approved" && (
                      <div className="space-y-2 border-t pt-3">
                        <Textarea dir="auto" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={T("reopenPh")} />
                        <Button variant="outline" disabled={busy || !note.trim()} onClick={() => run(r.reopen.mutateAsync(note), "tReopened")}>
                          <RotateCcw className="mx-1.5 h-4 w-4" /> {T("reopen")}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base">{T("historyTitle")}</CardTitle></CardHeader>
                  <CardContent className="space-y-1.5 text-sm">
                    {r.history.length === 0 && <p className="text-muted-foreground">{T("noHistory")}</p>}
                    {r.history.map((h) => (
                      <div key={h.id} className="border-b pb-1.5 last:border-0 last:pb-0">
                        <span className="font-medium">{HISTORY_KEY[h.action] ? T(HISTORY_KEY[h.action]) : h.action}</span>
                        <span className="text-muted-foreground"> · {h.actor?.full_name ?? "—"} · {fmtStamp(lang, h.created_at)}</span>
                        {h.note && <p className="text-muted-foreground">{T("note")}: {h.note}</p>}
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
                      <TableHead>{T("thReportDate")}</TableHead>
                      <TableHead className="text-end">{T("thTotalLoss")}</TableHead>
                      <TableHead>{T("thStatus")}</TableHead>
                      <TableHead>{T("thSubmitted")}</TableHead>
                      <TableHead>{T("thNextDeadline")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.days.filter((d) => d.is_active).map((d) => (
                      <TableRow key={d.report_date} className="cursor-pointer" onClick={() => setDate(d.report_date)}>
                        <TableCell className="font-medium">{fmtShortDay(lang, parseISO(d.report_date))}</TableCell>
                        <TableCell className="text-end tabular-nums">{rs(d.total_cost)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("border-transparent", STATUS_CLASS[d.status])}>{statusLabel(lang, d.status)}</Badge>
                          {d.due_kind && <span className="mx-2 text-xs font-medium text-red-700">{T(DUE_KEY[d.due_kind])}</span>}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{fmtStamp(lang, d.submitted_at) || "—"}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {d.status === "approved" || !d.due_at ? "—" : (d.status === "submitted" ? approveBy : submitBy)(lang, fmtStamp(lang, d.due_at))}
                        </TableCell>
                      </TableRow>
                    ))}
                    {r.days.every((d) => !d.is_active) && (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">{T("noDays")}</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
                <p className="mt-3 text-xs text-muted-foreground">{T("skipNote")}</p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- SETTINGS ---------------- */}
          {r.isSuperAdmin && (
            <TabsContent value="settings">
              {r.settings && (
                <SettingsForm
                  initial={r.settings} T={T}
                  saving={r.saveSettings.isPending}
                  onSave={(s) => run(r.saveSettings.mutateAsync(s), "tSettings")}
                />
              )}
            </TabsContent>
          )}
        </Tabs>
      </div>
    </ERPLayout>
  );
}

function RemarkField(p: { id: string; label: ReactNode; value: string; onChange: (v: string) => void; editable: boolean; placeholder: string; empty: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={p.id}>{p.label}</Label>
      {p.editable ? (
        <Textarea id={p.id} dir="auto" value={p.value} onChange={(e) => p.onChange(e.target.value)} rows={3} placeholder={p.placeholder} />
      ) : (
        <div id={p.id} dir="auto" className="min-h-[3rem] whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">
          {p.value || <span className="text-muted-foreground">{p.empty}</span>}
        </div>
      )}
    </div>
  );
}

type TFn = (k: TextKey) => string;
type XFn = (k: TextKey) => ReactNode;

function FiguresView({ f, lang, T, X }: { f: RwFigures; lang: Lang; T: TFn; X: XFn }) {
  const parts = [
    { key: "rejection" as const, value: f.rejection.cost, color: COLORS.rejection },
    { key: "wastage" as const, value: f.wastage.cost, color: COLORS.wastage },
    { key: "leakage" as const, value: f.leakage.cost, color: COLORS.leakage },
  ];
  const total = f.total_cost;
  const trend = f.trend.map((x) => ({ ...x, label: `${parseISO(x.date).getDate()}` }));
  const delta = (now: number, before: number | null, label: string) => {
    if (before === null || before === undefined || Number(before) === 0) return null;
    const pct = ((now - Number(before)) / Number(before)) * 100;
    return (
      <span className={cn("text-xs font-medium", pct > 0 ? "text-red-600" : "text-green-700")}>
        {pct > 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}% {label}
      </span>
    );
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label={X("tileRej")} value={qty(f.rejection.qty)} sub={rs(f.rejection.cost)} />
        <Tile label={X("tileWst")} value={qty(f.wastage.qty)} sub={rs(f.wastage.cost)} />
        <Tile label={X("tileLkg")} value={qty(f.leakage.qty)} sub={rs(f.leakage.cost)} />
        <Tile label={X("tileTotal")} value={rs(total)} sub={T("allDepts")} strong />
      </div>

      <Card>
        <CardContent className="space-y-2 pt-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-2xl font-semibold tabular-nums" dir="ltr">{rs(total)}</span>
            {delta(total, f.prev_day_total, T("vsPrev"))}
            {delta(total, f.avg_prev_days, T("vsAvg"))}
          </div>
          <div className="flex h-3 overflow-hidden rounded-full bg-muted" dir="ltr">
            {parts.map((p) => <div key={p.key} style={{ width: `${total ? (p.value / total) * 100 : 0}%`, background: p.color }} />)}
          </div>
          <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
            {parts.map((p) => (
              <span key={p.key}>
                <i className="mx-1.5 inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
                {T(KIND_KEY[p.key])} {rs(p.value)} · {total ? ((p.value / total) * 100).toFixed(1) : "0.0"}%
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{X("last7")}</CardTitle></CardHeader>
          <CardContent>
            <div className="h-48" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis fontSize={11} width={48} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(v: number) => rs(v)} />
                  <Bar dataKey="total" radius={[3, 3, 0, 0]}>
                    {trend.map((x) => <Cell key={x.date} fill={x.date === f.date ? "#4f46e5" : "#cbd5e1"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{X("topReasons")}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>{T("thReason")}</TableHead><TableHead>{T("thType")}</TableHead>
                <TableHead className="text-end">{T("thQty")}</TableHead><TableHead className="text-end">{T("thCost")}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {f.reasons.slice(0, 6).map((x, i) => (
                  <TableRow key={i}>
                    <TableCell>{x.reason}</TableCell>
                    <TableCell><span className="rounded px-1.5 py-0.5 text-xs text-white" style={{ background: COLORS[x.kind] }}>{T(KIND_KEY[x.kind])}</span></TableCell>
                    <TableCell className="text-end tabular-nums">{qty(x.qty)}</TableCell>
                    <TableCell className="text-end tabular-nums">{rs(x.cost)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{X("byDept")}</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{T("thDept")}</TableHead>
                <TableHead className="text-end">{T("thRejQty")}</TableHead>
                <TableHead className="text-end">{T("kRejection")}</TableHead>
                <TableHead className="text-end">{T("kWastage")}</TableHead>
                <TableHead className="text-end">{T("kLeakage")}</TableHead>
                <TableHead className="text-end">{T("thTotalLoss")}</TableHead>
                <TableHead className="text-end">{T("thShare")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {f.departments.map((d) => (
                <TableRow key={d.department}>
                  <TableCell>{d.department}</TableCell>
                  <TableCell className="text-end tabular-nums">{qty(d.rejected_qty)}</TableCell>
                  <TableCell className="text-end tabular-nums">{rs(d.rejection_cost)}</TableCell>
                  <TableCell className="text-end tabular-nums">{rs(d.wastage_cost)}</TableCell>
                  <TableCell className="text-end tabular-nums">{rs(d.leakage_cost)}</TableCell>
                  <TableCell className="text-end font-semibold tabular-nums">{rs(d.total_cost)}</TableCell>
                  <TableCell className="text-end tabular-nums">{total ? ((d.total_cost / total) * 100).toFixed(1) : "0.0"}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

function Tile({ label, value, sub, strong }: { label: ReactNode; value: string; sub: string; strong?: boolean }) {
  return (
    <Card className={cn(strong && "border-primary/50 bg-primary/5")}>
      <CardContent className="pt-4">
        <p className="text-xs tracking-wide text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums" dir="ltr">{value}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

function SettingsForm({ initial, saving, onSave, T }: { initial: RwSettings; saving: boolean; onSave: (s: RwSettings) => void; T: TFn }) {
  const [s, setS] = useState(initial);
  useEffect(() => setS(initial), [initial]);
  const hhmm = (v: string) => v.slice(0, 5);
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{T("sTitle")}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
          {T("sEnabled")}
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><Label className="text-xs">{T("sReminder")}</Label>
            <Input type="time" value={hhmm(s.reminder_time)} onChange={(e) => setS({ ...s, reminder_time: e.target.value })} /></div>
          <div><Label className="text-xs">{T("sSubmitBy")}</Label>
            <Input type="time" value={hhmm(s.submit_by_time)} onChange={(e) => setS({ ...s, submit_by_time: e.target.value })} /></div>
          <div><Label className="text-xs">{T("sAlertTime")}</Label>
            <Input type="time" value={hhmm(s.alert_time)} onChange={(e) => setS({ ...s, alert_time: e.target.value })} /></div>
          <div><Label className="text-xs">{T("sApprove")}</Label>
            <Input type="number" min={1} max={336} value={s.approve_hours} onChange={(e) => setS({ ...s, approve_hours: Number(e.target.value) })} /></div>
          <div><Label className="text-xs">{T("sResubmit")}</Label>
            <Input type="number" min={1} max={336} value={s.resubmit_hours} onChange={(e) => setS({ ...s, resubmit_hours: Number(e.target.value) })} /></div>
          <div><Label className="text-xs">{T("sStart")}</Label>
            <Input type="date" value={s.start_date} onChange={(e) => setS({ ...s, start_date: e.target.value })} /></div>
        </div>
        <Button size="sm" disabled={saving} onClick={() => onSave(s)}>{saving ? T("sSaving") : T("sSave")}</Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// A4 print in the chosen language: figures, remarks and signature lines.
// Unapproved reports are marked. Urdu needs its font loaded in the print window.
// ---------------------------------------------------------------------------
function printReport(lang: Lang, dateStr: string, f: RwFigures, report: RwReport | null) {
  const T = (k: TextKey) => t(lang, k);
  const status: ReportStatus = report?.status ?? "missing";
  const approved = status === "approved";
  const total = f.total_cost;
  const pct = (n: number) => (total ? ((n / total) * 100).toFixed(1) : "0.0");
  const label = fmtDay(lang, parseISO(dateStr));

  const deptRows = f.departments.map((d) =>
    `<tr><td>${esc(d.department)}</td><td class="num">${qty(d.rejected_qty)}</td><td class="num">${rs(d.rejection_cost)}</td>` +
    `<td class="num">${rs(d.wastage_cost)}</td><td class="num">${rs(d.leakage_cost)}</td><td class="num bold">${rs(d.total_cost)}</td><td class="num">${pct(d.total_cost)}%</td></tr>`).join("");
  const reasonRows = f.reasons.slice(0, 8).map((x) =>
    `<tr><td>${esc(x.reason)}</td><td>${esc(T(KIND_KEY[x.kind]))}</td><td class="num">${qty(x.qty)}</td><td class="num">${rs(x.cost)}</td></tr>`).join("");
  const remark = (title: string, text: string | undefined) =>
    `<div class="section-title">${esc(title)}</div><div dir="auto" style="white-space:pre-wrap;border:1px solid #ccc;border-radius:4px;padding:8px;min-height:36px">${esc(text) || `<span class="muted">${esc(T("noRemark"))}</span>`}</div>`;
  const statusText = approved ? statusLabel(lang, "approved") : status === "submitted" ? statusLabel(lang, "submitted") : T("pNotApproved");

  const html = `
  <div class="wrap">
    <div class="head">
      <div><h1>${esc(T("pageTitle"))}</h1><div class="muted">${esc(label)}</div></div>
      <div class="right"><div class="status">${esc(statusText)}</div>
        <div class="muted xs">${esc(printedAt(lang, format(new Date(), "dd MMM yyyy, HH:mm")))}</div></div>
    </div>
    <table>
      <thead><tr><th>${esc(T("kRejection"))}</th><th>${esc(T("kWastage"))}</th><th>${esc(T("kLeakage"))}</th><th class="num">${esc(T("tileTotal"))}</th></tr></thead>
      <tbody><tr>
        <td>${qty(f.rejection.qty)} · ${rs(f.rejection.cost)} (${pct(f.rejection.cost)}%)</td>
        <td>${qty(f.wastage.qty)} · ${rs(f.wastage.cost)} (${pct(f.wastage.cost)}%)</td>
        <td>${qty(f.leakage.qty)} · ${rs(f.leakage.cost)} (${pct(f.leakage.cost)}%)</td>
        <td class="num bold">${rs(total)}</td></tr></tbody>
    </table>
    <div class="muted xs" style="margin-top:4px">${f.prev_day_total ? `${esc(T("pPrevDay"))} ${rs(f.prev_day_total)}. ` : ""}${f.avg_prev_days ? `${esc(T("pAvg"))} ${rs(f.avg_prev_days)}.` : ""}</div>
    <div class="section-title">${esc(T("byDept"))}</div>
    <table><thead><tr><th>${esc(T("thDept"))}</th><th class="num">${esc(T("thRejQty"))}</th><th class="num">${esc(T("kRejection"))}</th><th class="num">${esc(T("kWastage"))}</th><th class="num">${esc(T("kLeakage"))}</th><th class="num">${esc(T("thTotalLoss"))}</th><th class="num">${esc(T("thShare"))}</th></tr></thead>
      <tbody>${deptRows}</tbody></table>
    <div class="section-title">${esc(T("topReasons"))}</div>
    <table><thead><tr><th>${esc(T("thReason"))}</th><th>${esc(T("thType"))}</th><th class="num">${esc(T("thQty"))}</th><th class="num">${esc(T("thCost"))}</th></tr></thead><tbody>${reasonRows}</tbody></table>
    ${remark(T("pSummary"), report?.summary)}
    ${remark(T("pBigRemark"), report?.biggest_loss_remark)}
    ${remark(T("pAction"), report?.action_plan)}
    ${report?.review_note && status === "rejected" ? remark(T("pReviewNote"), report.review_note) : ""}
    <div class="sign">
      <div>${esc(T("pPrepared"))}<br><b>${esc(report?.submitter?.full_name ?? "")}</b> ${report?.submitted_at ? esc(fmtStamp(lang, report.submitted_at)) : ""}</div>
      <div>${esc(T("pApproved"))}<br><b>${approved ? esc(report?.reviewer?.full_name ?? "") : ""}</b> ${approved && report?.reviewed_at ? esc(fmtStamp(lang, report.reviewed_at)) : ""}</div>
    </div>
  </div>`;
  const urdu = lang === "ur";
  const css =
    `@page{size:A4;margin:14mm}${DISPATCH_PRINT_CSS}` +
    (urdu ? `body{font-family:'Noto Nastaliq Urdu','Jameel Noori Nastaleeq',serif;line-height:2;direction:rtl}.right{text-align:left}th{text-align:right}th.num,td.num{text-align:left}` : "");
  printDocument(`${T("pageTitle")} ${dateStr}`, `<style>${css}</style>${html}`, urdu ? { fontCssUrl: "https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;700&display=swap" } : undefined);
}
