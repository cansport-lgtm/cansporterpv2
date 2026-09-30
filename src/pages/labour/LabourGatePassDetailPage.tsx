import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { format } from "date-fns";
import { QRCodeSVG } from "qrcode.react";
import { AlertTriangle, ArrowLeft, CheckCircle2, Printer, Siren, UserMinus, XCircle } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmployeeAvatar } from "@/components/labour/EmployeeAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  APPLY_ROLES, APPROVE_ROLES, PASS_SELECT, errorMessage, fmtDT, hasAnyRole, lgpDb, overdueMinutes, passKindMeta,
  printLabourGatePass, statusMeta, type LabourGatePass,
} from "@/lib/labourGatePass";

type EventRow = {
  id: string;
  event: string;
  message: string | null;
  created_at: string;
  actor: { full_name: string | null } | null;
};

const EVENT_LABEL: Record<string, string> = {
  applied: "Applied",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  out: "Out at gate",
  in: "Back at gate",
  half_day_marked: "Half day marked",
  overdue: "Late back",
  not_returned: "Not returned",
  expired: "Expired",
  rescan_attempt: "Old pass scanned again at gate",
};

type DialogKind = null | "approve" | "reject" | "cancel" | "convert";

export default function LabourGatePassDetailPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, roles } = useAuth();
  const canApprove = hasAnyRole(roles, APPROVE_ROLES);
  const canApply = hasAnyRole(roles, APPLY_ROLES);
  const qrRef = useRef<HTMLDivElement>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [remarks, setRemarks] = useState("");

  const { data: pass, isLoading } = useQuery<LabourGatePass | null>({
    queryKey: ["labour-gate-pass", id],
    queryFn: async () => {
      const { data, error } = await lgpDb.from("labour_gate_passes").select(PASS_SELECT).eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: events = [] } = useQuery<EventRow[]>({
    queryKey: ["labour-gate-pass-events", id],
    queryFn: async () => {
      const { data, error } = await lgpDb
        .from("labour_gate_pass_events")
        .select("id, event, message, created_at, actor:app_users!labour_gate_pass_events_created_by_fkey(full_name)")
        .eq("pass_id", id)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["labour-gate-pass", id] });
    queryClient.invalidateQueries({ queryKey: ["labour-gate-pass-events", id] });
    queryClient.invalidateQueries({ queryKey: ["labour-gate-passes"] });
    queryClient.invalidateQueries({ queryKey: ["labour-gate-passes-live"] });
    queryClient.invalidateQueries({ queryKey: ["labour-gate-pass-approvals"] });
    queryClient.invalidateQueries({ queryKey: ["labour-gate-pass-half-days"] });
  };

  const action = useMutation({
    mutationFn: async ({ fn, args }: { fn: string; args: Record<string, unknown>; done: string }) => {
      const { data, error } = await lgpDb.rpc(fn, args);
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => {
      toast({ title: v.done });
      setDialog(null);
      setRemarks("");
      refresh();
    },
    onError: (e) => toast({ title: "Could not complete", description: errorMessage(e), variant: "destructive" }),
  });

  if (isLoading) return <ERPLayout><div className="p-8 text-center text-muted-foreground">Loading…</div></ERPLayout>;
  if (!pass) return <ERPLayout><div className="p-8 text-center text-muted-foreground">Worker gate pass not found.</div></ERPLayout>;

  const kind = passKindMeta(pass.pass_kind);
  const status = statusMeta(pass.status);
  const e = pass.labour_employees;
  const isMaker = pass.created_by === user?.id;
  const late = overdueMinutes(pass);
  const rescans = events.filter((ev) => ev.event === "rescan_attempt").length;
  const canCancel = ["pending_approval", "approved"].includes(pass.status) && (canApprove || (canApply && isMaker));
  const canConvert = canApprove && pass.status === "out" && pass.pass_kind === "short_leave";
  const halfDayMarked = (pass.pass_kind === "half_day" && pass.status === "out") || pass.status === "not_returned";

  const print = () => printLabourGatePass(pass, qrRef.current?.querySelector("svg")?.outerHTML ?? "");

  const dialogMeta: Record<Exclude<DialogKind, null>, { title: string; description: string; needReason: boolean; fn: string; args: Record<string, unknown>; done: string; destructive?: boolean }> = {
    approve: { title: "Approve this pass?", description: "The guard can then scan the worker out on the pass date.", needReason: false, fn: "labour_gate_pass_review", args: { p_id: pass.id, p_approve: true, p_remarks: remarks || null }, done: "Approved" },
    reject: { title: "Reject this pass", description: "The supervisor will be told, with your reason.", needReason: true, fn: "labour_gate_pass_review", args: { p_id: pass.id, p_approve: false, p_remarks: remarks }, done: "Rejected", destructive: true },
    cancel: { title: "Cancel this pass", description: "It can no longer be used at the gate.", needReason: true, fn: "labour_gate_pass_cancel", args: { p_id: pass.id, p_reason: remarks }, done: "Cancelled", destructive: true },
    convert: { title: "Convert to half day", description: "The worker did not come back. The pass becomes Not returned and the date is marked Half day.", needReason: true, fn: "labour_gate_pass_convert_half_day", args: { p_id: pass.id, p_reason: remarks }, done: "Marked half day", destructive: true },
  };

  return (
    <ERPLayout>
      <div className="w-full max-w-4xl space-y-4">
        <PageHeader title={pass.pass_number} description={`${kind.label} · ${format(new Date(pass.pass_date), "dd MMM yyyy")}`} icon={UserMinus} iconColor="bg-emerald-600 text-white">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild><Link to="/labour/gate-pass"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Link></Button>
            <Button variant="outline" size="sm" onClick={print}><Printer className="h-4 w-4 mr-1" /> Print slip</Button>
            {canApprove && pass.status === "pending_approval" && (
              <>
                <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800" onClick={() => setDialog("approve")}><CheckCircle2 className="h-4 w-4 mr-1" /> Approve</Button>
                <Button size="sm" variant="destructive" onClick={() => setDialog("reject")}><XCircle className="h-4 w-4 mr-1" /> Reject</Button>
              </>
            )}
            {canConvert && <Button size="sm" variant="destructive" onClick={() => setDialog("convert")}><UserMinus className="h-4 w-4 mr-1" /> Did not return · mark half day</Button>}
            {canCancel && <Button size="sm" variant="outline" onClick={() => setDialog("cancel")}><XCircle className="h-4 w-4 mr-1" /> Cancel pass</Button>}
          </div>
        </PageHeader>

        {rescans > 0 && (
          <div className="rounded-xl border-2 border-red-500 bg-red-50 p-3 text-sm text-red-900 flex gap-2">
            <Siren className="h-5 w-5 shrink-0 text-red-700" />
            <div><b>This pass was scanned again at the gate {rescans} time{rescans > 1 ? "s" : ""} after it was used.</b> See the history below.</div>
          </div>
        )}
        {late > 0 && (
          <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900 flex gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0 text-red-700" />
            <div>The worker is <b>{late} min</b> past the expected return ({fmtDT(pass.expected_back_at)}). {canApprove ? "If they will not be back, convert the pass to a half day." : "The approver has been told."}</div>
          </div>
        )}
        {halfDayMarked && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <b>{format(new Date(pass.pass_date), "dd MMM")} is marked Half day</b> for this worker
            {pass.half_day_marked_at ? ` (${fmtDT(pass.half_day_marked_at)})` : ""}: {pass.half_day_rows ?? 0} productivity entr{pass.half_day_rows === 1 ? "y" : "ies"} set to half day. Any entry added later for that date stays a half day.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="md:col-span-2">
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center gap-4">
                <EmployeeAvatar name={e?.full_name} photoUrl={e?.photo_url} className="h-20 w-20 text-lg" />
                <div>
                  <div className="text-xl font-bold">{e?.full_name}</div>
                  <div className="text-sm text-muted-foreground">{e?.employee_code}{e?.production_departments?.name ? ` · ${e.production_departments.name}` : ""}{e?.category ? ` · ${e.category}` : ""}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className={cn("text-xs font-semibold rounded-full px-2 py-0.5 ring-1 ring-inset", kind.badgeClass)}>{kind.label}</span>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </div>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Reason</dt><dd className="font-medium">{pass.reason}</dd>
                {pass.pass_kind === "short_leave" && <><dt className="text-muted-foreground">Expected outside</dt><dd>{pass.expected_minutes} min</dd></>}
                {pass.leave_time && <><dt className="text-muted-foreground">Leaving at</dt><dd>{pass.leave_time.slice(0, 5)}</dd></>}
                <dt className="text-muted-foreground">Applied by</dt><dd>{pass.creator?.full_name ?? "—"} · {fmtDT(pass.created_at)}</dd>
                <dt className="text-muted-foreground">{pass.status === "rejected" ? "Rejected by" : "Approved by"}</dt>
                <dd>{pass.approver?.full_name ?? "—"}{pass.approved_at ? ` · ${fmtDT(pass.approved_at)}` : ""}{pass.approval_remarks ? ` — ${pass.approval_remarks}` : ""}</dd>
                <dt className="text-muted-foreground">Out at gate</dt><dd>{pass.gate_out_at ? `${fmtDT(pass.gate_out_at)} · ${pass.out_guard?.full_name ?? "guard"}` : "—"}</dd>
                {pass.pass_kind === "short_leave" && (
                  <>
                    <dt className="text-muted-foreground">Due back</dt><dd>{fmtDT(pass.expected_back_at)}</dd>
                    <dt className="text-muted-foreground">Back at gate</dt>
                    <dd>{pass.gate_in_at ? `${fmtDT(pass.gate_in_at)} · ${pass.in_guard?.full_name ?? "guard"} · ${pass.minutes_outside} min outside` : "—"}</dd>
                  </>
                )}
                {pass.cancelled_at && <><dt className="text-muted-foreground">Cancelled</dt><dd>{fmtDT(pass.cancelled_at)} — {pass.cancel_reason}</dd></>}
                {pass.closed_at && <><dt className="text-muted-foreground">Closed</dt><dd>{fmtDT(pass.closed_at)} — {pass.close_note}</dd></>}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 flex flex-col items-center gap-2">
              <div ref={qrRef}><QRCodeSVG value={pass.pass_number} size={144} level="M" /></div>
              <div className="font-mono font-bold">{pass.pass_number}</div>
              <div className="text-xs text-muted-foreground text-center">
                {["approved", "out"].includes(pass.status) ? "Show or print this for the guard to scan." : "Not valid at the gate in this status."}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">History</CardTitle></CardHeader>
          <CardContent>
            <ol className="space-y-2 text-sm">
              {events.map((ev) => (
                <li key={ev.id} className={cn("flex flex-wrap gap-x-3 gap-y-0.5", ev.event === "rescan_attempt" && "text-red-800")}>
                  <span className="text-xs text-muted-foreground whitespace-nowrap w-28">{format(new Date(ev.created_at), "dd MMM HH:mm")}</span>
                  <span className="font-semibold">{EVENT_LABEL[ev.event] ?? ev.event}</span>
                  {ev.message && <span className="text-muted-foreground">{ev.message}</span>}
                  {ev.actor?.full_name && <span className="text-xs text-muted-foreground">by {ev.actor.full_name}</span>}
                </li>
              ))}
              {events.length === 0 && <li className="text-muted-foreground">No events yet.</li>}
            </ol>
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialog !== null} onOpenChange={(o) => { if (!o) { setDialog(null); setRemarks(""); } }}>
        {dialog && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{dialogMeta[dialog].title}</DialogTitle>
              <DialogDescription>{dialogMeta[dialog].description}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="lgp-remarks">{dialogMeta[dialog].needReason ? "Reason" : "Remarks (optional)"}</Label>
              <Textarea id="lgp-remarks" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialog(null)}>Back</Button>
              <Button
                variant={dialogMeta[dialog].destructive ? "destructive" : "default"}
                disabled={action.isPending || (dialogMeta[dialog].needReason && !remarks.trim())}
                onClick={() => action.mutate({ fn: dialogMeta[dialog].fn, args: dialogMeta[dialog].args, done: dialogMeta[dialog].done })}
              >
                {dialogMeta[dialog].title.replace("?", "")}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </ERPLayout>
  );
}
