import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { CheckCircle2, History, MessageSquareText, RotateCcw, Settings2, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useKeyRmRemarks, type DueKind, type KeyRmSettings, type RemarkStatus } from "@/hooks/useKeyRmRemarks";

const STATUS_META: Record<RemarkStatus, { label: string; className: string }> = {
  missing: { label: "Not written", className: "bg-muted text-muted-foreground" },
  draft: { label: "Draft", className: "bg-slate-100 text-slate-700" },
  submitted: { label: "Awaiting approval", className: "bg-amber-100 text-amber-800" },
  approved: { label: "Approved", className: "bg-green-100 text-green-800" },
  rejected: { label: "Rejected", className: "bg-red-100 text-red-800" },
};

const DUE_LABEL: Record<DueKind, string> = {
  reminder: "Due",
  overdue: "Overdue",
  approval: "Approval overdue",
};

const errMsg = (e: unknown) => (e as { message?: string })?.message || "Something went wrong";

export function StatusBadge({ status, className }: { status: RemarkStatus; className?: string }) {
  const m = STATUS_META[status];
  return <Badge variant="outline" className={cn("border-transparent", m.className, className)}>{m.label}</Badge>;
}

/**
 * Daily remarks on the key raw materials: the store manager writes and submits,
 * a super admin approves, rejects or reopens. Also shows the last 30 days at a
 * glance and (super admin) the alert settings.
 */
export function KeyRmRemarksPanel({ date, onPickDate }: { date: Date; onPickDate: (d: Date) => void }) {
  const r = useKeyRmRemarks(date);
  const { remark } = r;
  const status: RemarkStatus = remark?.status ?? "missing";

  const [text, setText] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Reload the box whenever the day (or the saved remark) changes.
  useEffect(() => { setText(remark?.remarks ?? ""); }, [r.dateStr, remark?.remarks, remark?.status]);

  const editable = r.canWrite && (status === "missing" || status === "draft" || status === "rejected");
  const busy = r.save.isPending || r.review.isPending || r.reopen.isPending;

  const run = async (p: Promise<unknown>, ok: string) => {
    try { await p; toast.success(ok); } catch (e) { toast.error(errMsg(e)); }
  };

  const reject = async () => {
    const note = window.prompt("Reason for rejecting these remarks:");
    if (note === null) return;
    await run(r.review.mutateAsync({ approve: false, note }), "Remarks rejected — the store manager has been notified");
  };
  const reopen = async () => {
    const note = window.prompt("Reason for reopening these approved remarks:");
    if (note === null) return;
    await run(r.reopen.mutateAsync(note), "Remarks reopened");
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <MessageSquareText className="h-5 w-5 text-sky-600" />
          Daily Remarks · {format(date, "dd MMM yyyy")}
          <StatusBadge status={status} />
        </CardTitle>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowHistory((v) => !v)}>
            <History className="mr-1.5 h-4 w-4" /> History
          </Button>
          {r.isSuperAdmin && (
            <Button variant="ghost" size="sm" onClick={() => setShowSettings((v) => !v)}>
              <Settings2 className="mr-1.5 h-4 w-4" /> Alerts
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === "rejected" && remark?.review_note && (
          <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
            Rejected{remark.reviewer?.full_name ? ` by ${remark.reviewer.full_name}` : ""}: {remark.review_note}
          </p>
        )}
        {status === "draft" && remark?.review_note?.startsWith("Reopened") && (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">{remark.review_note}</p>
        )}

        {editable ? (
          <>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              placeholder="Summary of the day's key raw material usage — anything unusual, shortages, wastage, variance against standard…"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy || !text.trim()}
                onClick={() => run(r.save.mutateAsync({ remarks: text, submit: false }), "Draft saved")}
              >
                Save Draft
              </Button>
              <Button
                disabled={busy || !text.trim()}
                onClick={() => run(r.save.mutateAsync({ remarks: text, submit: true }), "Submitted for approval")}
              >
                Submit for Approval
              </Button>
            </div>
          </>
        ) : (
          <div className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm min-h-[3.5rem]">
            {remark?.remarks || (
              <span className="text-muted-foreground">
                {r.canWrite ? "No remarks for this day." : "No remarks have been written for this day yet."}
              </span>
            )}
          </div>
        )}

        {remark && (status === "submitted" || status === "approved") && (
          <p className="text-xs text-muted-foreground">
            {remark.submitter?.full_name ? `Submitted by ${remark.submitter.full_name}` : "Submitted"}
            {remark.submitted_at && ` on ${format(new Date(remark.submitted_at), "dd MMM HH:mm")}`}
            {status === "approved" && remark.reviewed_at &&
              ` · Approved${remark.reviewer?.full_name ? ` by ${remark.reviewer.full_name}` : ""} on ${format(new Date(remark.reviewed_at), "dd MMM HH:mm")}`}
          </p>
        )}

        {r.isSuperAdmin && status === "submitted" && (
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => run(r.review.mutateAsync({ approve: true }), "Remarks approved")}>
              <CheckCircle2 className="mr-1.5 h-4 w-4" /> Approve
            </Button>
            <Button variant="outline" className="text-destructive" disabled={busy} onClick={reject}>
              <XCircle className="mr-1.5 h-4 w-4" /> Reject
            </Button>
          </div>
        )}
        {r.isSuperAdmin && status === "approved" && (
          <Button variant="outline" disabled={busy} onClick={reopen}>
            <RotateCcw className="mr-1.5 h-4 w-4" /> Reopen
          </Button>
        )}

        {showHistory && (
          <div className="space-y-1.5 rounded-md border p-3 text-sm">
            {r.history.length === 0 && <p className="text-muted-foreground">No history for this day.</p>}
            {r.history.map((h) => (
              <div key={h.id} className="border-b pb-1.5 last:border-0 last:pb-0">
                <span className="font-medium capitalize">{h.action}</span>
                <span className="text-muted-foreground">
                  {" "}· {h.actor?.full_name ?? "—"} · {format(new Date(h.created_at), "dd MMM HH:mm")}
                </span>
                {h.note && <p className="text-muted-foreground">Note: {h.note}</p>}
                {h.remarks && h.action !== "approved" && <p className="whitespace-pre-wrap text-xs text-muted-foreground">{h.remarks}</p>}
              </div>
            ))}
          </div>
        )}

        {showSettings && r.isSuperAdmin && r.settings && (
          <SettingsForm
            initial={r.settings}
            saving={r.saveSettings.isPending}
            onSave={(s) => run(r.saveSettings.mutateAsync(s), "Alert settings saved")}
          />
        )}

        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Last 30 days (days with production or stock closing)</p>
          <div className="flex flex-wrap gap-1.5">
            {r.days.filter((d) => d.is_active).map((d) => {
              const m = STATUS_META[d.status];
              return (
                <button
                  key={d.report_date}
                  type="button"
                  title={`${format(parseISO(d.report_date), "dd MMM")} · ${m.label}${d.due_kind ? ` · ${DUE_LABEL[d.due_kind]}` : ""}`}
                  onClick={() => onPickDate(parseISO(d.report_date))}
                  className={cn(
                    "rounded border px-2 py-1 text-xs",
                    m.className,
                    d.due_kind === "overdue" || d.due_kind === "approval" ? "border-red-400 ring-1 ring-red-300" : "border-transparent",
                    d.report_date === r.dateStr && "outline outline-2 outline-primary",
                  )}
                >
                  {format(parseISO(d.report_date), "dd MMM")}
                </button>
              );
            })}
            {r.days.every((d) => !d.is_active) && <span className="text-xs text-muted-foreground">No active days yet.</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SettingsForm({ initial, saving, onSave }: { initial: KeyRmSettings; saving: boolean; onSave: (s: KeyRmSettings) => void }) {
  const [s, setS] = useState(initial);
  useEffect(() => setS(initial), [initial]);
  const num = (k: "reminder_hours" | "submit_hours" | "approve_hours") => (
    <Input type="number" min={1} max={336} value={s[k]} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} />
  );
  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-sm font-medium">Alert settings (super admin)</p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
        Send reminders and alerts
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><Label className="text-xs">Remind store manager after (hrs from day end)</Label>{num("reminder_hours")}</div>
        <div><Label className="text-xs">Alert super admins if not submitted after (hrs)</Label>{num("submit_hours")}</div>
        <div><Label className="text-xs">Alert if not approved after (hrs from submission)</Label>{num("approve_hours")}</div>
        <div>
          <Label className="text-xs">Daily alert time (Pakistan)</Label>
          <Input type="time" value={s.alert_time.slice(0, 5)} onChange={(e) => setS({ ...s, alert_time: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Track from date</Label>
          <Input type="date" value={s.start_date} onChange={(e) => setS({ ...s, start_date: e.target.value })} />
        </div>
      </div>
      <Button size="sm" disabled={saving} onClick={() => onSave(s)}>{saving ? "Saving…" : "Save Settings"}</Button>
    </div>
  );
}
