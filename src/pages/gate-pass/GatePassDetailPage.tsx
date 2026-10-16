import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import { QRCodeSVG } from "qrcode.react";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, DoorOpen, Pencil, Printer, RefreshCw, Send, Unlock, XCircle,
  Siren,
} from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { BackfillInfo, ReturnsSection, ScrapSection } from "@/components/gate-pass/PassExtraSections";
import { FreightCard } from "@/components/gate-pass/FreightCard";
import {
  PASS_SELECT, canReviewGatePass, countUnit, isOwnPassBlocked, errorMessage, expectedCount, fmtQty, gpDb, passTypeMeta, printGatePass,
  sortedItems, statusMeta, type GatePass,
} from "@/lib/gatePass";

type EventRow = {
  id: string;
  event: string;
  message: string | null;
  created_at: string;
  actor: { full_name: string | null } | null;
};

const EVENT_LABEL: Record<string, string> = {
  created: "Created",
  edited: "Edited",
  submitted: "Sent for approval",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  held: "Held at gate",
  released: "Released by manager",
  out: "Out at gate",
  refreshed: "Refreshed from dispatches",
  dispatch_removed: "Dispatch taken off",
  received: "Goods received back",
  closed: "Closed",
  backfilled: "Entered as manual backfill",
  rescan_attempt: "Old pass scanned again at gate",
  freight_saved: "Freight recorded",
  freight_voucher: "Freight voucher made",
  freight_customer: "Freight paid by customer",
  freight_not_recorded: "No freight recorded at gate out",
  freight_paid: "Freight voucher paid",
  freight_voucher_corrected: "Freight voucher corrected",
  freight_voucher_cancelled: "Freight voucher cancelled",
};

type DialogKind = null | "approve" | "reject" | "cancel" | "release";

const fmtDT = (s: string | null) => (s ? format(new Date(s), "dd MMM yyyy, HH:mm") : "—");

export default function GatePassDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, roles, hasModulePermission } = useAuth();
  const canCreate = hasModulePermission("gate_pass", "create");
  const canApprove = hasModulePermission("gate_pass", "approve");
  const qrRef = useRef<HTMLDivElement>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [remarks, setRemarks] = useState("");

  const { data: pass, isLoading } = useQuery<GatePass | null>({
    queryKey: ["gate-pass", id],
    queryFn: async () => {
      const { data, error } = await gpDb.from("gate_passes").select(PASS_SELECT).eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: events = [] } = useQuery<EventRow[]>({
    queryKey: ["gate-pass-events", id],
    queryFn: async () => {
      const { data, error } = await gpDb
        .from("gate_pass_events")
        .select("id, event, message, created_at, actor:app_users!gate_pass_events_created_by_fkey(full_name)")
        .eq("gate_pass_id", id)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["gate-pass", id] });
    queryClient.invalidateQueries({ queryKey: ["gate-pass-events", id] });
    queryClient.invalidateQueries({ queryKey: ["gate-passes"] });
    queryClient.invalidateQueries({ queryKey: ["gate-passes-live"] });
    queryClient.invalidateQueries({ queryKey: ["gate-pass-approvals"] });
    queryClient.invalidateQueries({ queryKey: ["dispatch-gate-pass"] });
  };

  const action = useMutation({
    mutationFn: async ({ fn, args }: { fn: string; args: Record<string, unknown>; done: string }) => {
      const { data, error } = await gpDb.rpc(fn, args);
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

  if (isLoading) {
    return <ERPLayout><div className="p-8 text-center text-muted-foreground">Loading…</div></ERPLayout>;
  }
  if (!pass) {
    return <ERPLayout><div className="p-8 text-center text-muted-foreground">Gate pass not found.</div></ERPLayout>;
  }

  const items = sortedItems(pass);
  const type = passTypeMeta(pass.pass_type);
  const status = statusMeta(pass.status);
  const isMaker = pass.created_by === user?.id;
  const dispatches = pass.gate_pass_dispatches ?? [];
  const counted = items.some((i) => i.counted !== null);
  const overCount = items.some((i) => i.counted !== null && Number(i.counted) > expectedCount(i) && Number(i.quantity) > 0);
  const printable = ["approved", "held", "out", "partially_returned", "returned", "closed"].includes(pass.status);

  const canCancel =
    ["draft", "pending_approval", "approved", "held"].includes(pass.status) &&
    (canApprove || (canCreate && isMaker && ["draft", "pending_approval"].includes(pass.status)));

  const print = () => {
    const svg = qrRef.current?.querySelector("svg")?.outerHTML ?? "";
    printGatePass(pass, svg);
  };

  const run = (fn: string, args: Record<string, unknown>, done: string) => action.mutate({ fn, args, done });

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <Link to="/gate-pass/passes" className="text-sm text-primary inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Gate Passes
        </Link>
        <PageHeader title={pass.pass_number} description={`${type.label} · ${pass.party_name}`} icon={DoorOpen}>
          <div className="flex flex-wrap gap-2">
            {pass.status === "draft" && canCreate && (isMaker || canApprove) && (
              <>
                <Button variant="outline" onClick={() => navigate(`/gate-pass/edit/${pass.id}`)}>
                  <Pencil className="h-4 w-4 mr-1" /> Edit
                </Button>
                <Button disabled={action.isPending} onClick={() => run("gate_pass_submit", { p_id: pass.id }, "Submitted")}>
                  <Send className="h-4 w-4 mr-1" /> Submit
                </Button>
              </>
            )}
            {pass.status === "pending_approval" && canReviewGatePass(roles, pass, user?.id) && (
              <>
                <Button variant="outline" className="text-destructive" onClick={() => setDialog("reject")}>
                  <XCircle className="h-4 w-4 mr-1" /> Reject
                </Button>
                <Button onClick={() => setDialog("approve")}>
                  <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                </Button>
              </>
            )}
            {pass.status === "held" && canApprove && pass.pass_type !== "scrap" && (
              <Button onClick={() => setDialog("release")}>
                <Unlock className="h-4 w-4 mr-1" /> Release with counted quantity
              </Button>
            )}
            {pass.pass_type === "sales" && canCreate && ["draft", "approved", "held"].includes(pass.status) && (
              <Button variant="outline" disabled={action.isPending}
                onClick={() => run("gate_pass_refresh", { p_id: pass.id }, "Pass refreshed from its dispatches")}>
                <RefreshCw className="h-4 w-4 mr-1" /> Refresh from dispatches
              </Button>
            )}
            {printable && (
              <Button variant="outline" onClick={print}>
                <Printer className="h-4 w-4 mr-1" /> Print
              </Button>
            )}
            {canCancel && (
              <Button variant="ghost" className="text-destructive" onClick={() => setDialog("cancel")}>Cancel pass</Button>
            )}
          </div>
        </PageHeader>

        {pass.status === "pending_approval" && isOwnPassBlocked(roles, pass, user?.id) && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            You raised this {type.label.toLowerCase()} pass, so another {type.label.toLowerCase()} manager must approve or reject it.
          </div>
        )}

        {events.some((e) => e.event === "rescan_attempt") && (
          <div role="alert" className="rounded-xl border-2 border-red-400 bg-red-50 p-3 text-sm text-red-900 flex items-start gap-2">
            <Siren className="h-5 w-5 text-red-700 shrink-0" />
            <div>
              <b>This pass was scanned again at the gate {events.filter((e) => e.event === "rescan_attempt").length} time(s) after it could no longer be used.</b>{" "}
              Last: {fmtDT(events.filter((e) => e.event === "rescan_attempt").map((e) => e.created_at).sort().at(-1) ?? null)}. See History below.
            </div>
          </div>
        )}

        {pass.status === "held" && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex gap-3">
            <AlertTriangle className="h-5 w-5 text-red-700 shrink-0" />
            <div className="text-sm space-y-1">
              <div className="font-semibold text-red-800">
                Held at the gate by {pass.holder?.full_name ?? "the guard"} · {fmtDT(pass.held_at)}
              </div>
              {pass.hold_note && <div className="text-red-900">Guard's note: {pass.hold_note}</div>}
              {pass.gate_vehicle_number && pass.vehicle_number &&
                pass.gate_vehicle_number.replace(/[^A-Za-z0-9]/g, "").toUpperCase() !== pass.vehicle_number.replace(/[^A-Za-z0-9]/g, "").toUpperCase() && (
                <div className="text-red-900">Vehicle at the gate: <b>{pass.gate_vehicle_number}</b> — pass says <b>{pass.vehicle_number}</b>.</div>
              )}
              <div className="text-red-900">
                {pass.pass_type === "scrap"
                  ? "A held scrap vehicle is never released: unload to the approved weight and have the guard weigh again, or cancel the pass."
                  : pass.pass_type === "sales"
                  ? "Short count: correct the dispatch to what was counted (or take that dispatch off), then release. Extra goods can never be released."
                  : "Short count: a manager can release with the counted quantity. Extra goods can never be released — unload and recount, or cancel."}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4">
          <div className="space-y-4 min-w-0">
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-base">Lines</CardTitle>
                <Badge variant={status.variant}>{status.label}</Badge>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table className="min-w-[720px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Cartons</TableHead>
                      {counted && <TableHead className="text-right">Guard counted</TableHead>}
                      {counted && <TableHead>Check</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((i) => {
                      const exp = expectedCount(i);
                      const diff = i.counted === null ? null : Number(i.counted) - exp;
                      return (
                        <TableRow key={i.id} className={cn(Number(i.quantity) === 0 && "opacity-50")}>
                          <TableCell className="text-muted-foreground">{i.line_no}</TableCell>
                          <TableCell>
                            <div className="font-medium">{i.description}</div>
                            {i.original_quantity !== null && (
                              <div className="text-xs text-amber-700">
                                First printed: {fmtQty(i.original_quantity)} {i.uom}
                                {i.original_packages !== null ? ` / ${i.original_packages} ctn` : ""}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-semibold whitespace-nowrap">{fmtQty(i.quantity)} {i.uom}</TableCell>
                          <TableCell className="text-right tabular-nums">{i.packages ?? "—"}</TableCell>
                          {counted && (
                            <TableCell className="text-right tabular-nums whitespace-nowrap">
                              {i.counted === null ? "—" : `${fmtQty(i.counted)} ${countUnit(i)}`}
                            </TableCell>
                          )}
                          {counted && (
                            <TableCell className={cn("text-sm font-semibold whitespace-nowrap",
                              diff === 0 ? "text-emerald-700" : diff === null ? "" : "text-red-700")}>
                              {diff === null ? "" : diff === 0 ? "Matches" : diff < 0 ? `${fmtQty(-diff)} short` : `${fmtQty(diff)} over`}
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {pass.is_backfill && <BackfillInfo pass={pass} />}
            {(pass.pass_type === "returnable" || pass.pass_type === "job_work") && (
              <ReturnsSection pass={pass} canReceive={canCreate} canClose={canApprove} />
            )}
            {pass.pass_type === "scrap" && <ScrapSection pass={pass} />}

            {pass.pass_type === "sales" && <FreightCard pass={pass} />}

            {pass.pass_type === "sales" && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Dispatches on this vehicle</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Dispatch</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Delivery status</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dispatches.map((d) => (
                        <TableRow key={d.dispatch_id}>
                          <TableCell className="font-mono font-semibold">{d.sales_dispatches?.dispatch_number}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {d.sales_dispatches ? format(new Date(d.sales_dispatches.dispatch_date), "dd MMM yyyy") : ""}
                          </TableCell>
                          <TableCell className="text-sm">{d.sales_dispatches?.delivery_status.replace(/_/g, " ")}</TableCell>
                          <TableCell className="text-right">
                            {canApprove && dispatches.length > 1 && ["draft", "approved", "held"].includes(pass.status) && (
                              <Button size="sm" variant="ghost" className="text-destructive" disabled={action.isPending}
                                onClick={() => {
                                  if (window.confirm(`Take ${d.sales_dispatches?.dispatch_number} off ${pass.pass_number}? It will not leave on this vehicle.`)) {
                                    run("gate_pass_remove_dispatch", { p_id: pass.id, p_dispatch_id: d.dispatch_id }, "Dispatch taken off the pass");
                                  }
                                }}>
                                Take off
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Details</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {[
                  ["Type", type.label],
                  ["Date", format(new Date(pass.pass_date), "dd MMM yyyy")],
                  ["Party", pass.party_name],
                  ["Handled by", pass.handled_by === "company" ? "Company official" : "Outsider"],
                  ["Vehicle", pass.vehicle_number || (pass.handled_by === "company" ? "Not needed" : "Hand carry / courier")],
                  [pass.handled_by === "company" ? "Official" : "Driver", [pass.driver_name, pass.driver_contact].filter(Boolean).join(" · ") || "—"],
                  ["Transporter", pass.transporter_name || "—"],
                  ...(pass.process_name ? [["Process", pass.process_name]] : []),
                  ...(pass.expected_return_date ? [["Due back", format(new Date(pass.expected_return_date), "dd MMM yyyy")]] : []),
                  ...(pass.purchase_returns ? [["Purchase return", `${pass.purchase_returns.return_number ?? ""} (${pass.purchase_returns.status})`]] : []),
                  ["Made by", `${pass.creator?.full_name ?? "—"} · ${fmtDT(pass.created_at)}`],
                  ["Approval", pass.approved_at ? `${pass.approver?.full_name ?? "Automatic"} · ${fmtDT(pass.approved_at)}` : "—"],
                  ...(pass.gate_out_at ? [["Out at gate", `${pass.gate_out_user?.full_name ?? ""} · ${fmtDT(pass.gate_out_at)}`]] : []),
                  ...(pass.released_at ? [["Released", `${pass.releaser?.full_name ?? ""} · ${pass.release_reason ?? ""}`]] : []),
                  ...(pass.closed_at ? [["Closed", `${fmtDT(pass.closed_at)}${pass.close_reason ? ` · ${pass.close_reason}` : ""}`]] : []),
                  ...(pass.cancelled_at ? [["Cancelled", `${fmtDT(pass.cancelled_at)}${pass.cancel_reason ? ` · ${pass.cancel_reason}` : ""}`]] : []),
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4">
                    <span className="text-muted-foreground shrink-0">{k}</span>
                    <span className="font-medium text-right break-words">{v}</span>
                  </div>
                ))}
                {pass.approval_remarks && <p className="text-xs text-muted-foreground pt-1">{pass.approval_remarks}</p>}
                {pass.remarks && (
                  <div className="pt-2 border-t">
                    <div className="text-muted-foreground text-xs">Remarks</div>
                    <div>{pass.remarks}</div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">History</CardTitle></CardHeader>
              <CardContent>
                <ol className="space-y-3">
                  {events.map((e) => (
                    <li key={e.id} className={cn("text-sm", e.event === "rescan_attempt" && "rounded-md bg-red-50 border border-red-200 p-2 text-red-900")}>
                      <div className={cn("font-medium", e.event === "rescan_attempt" && "font-bold text-red-700")}>{EVENT_LABEL[e.event] ?? e.event}</div>
                      <div className="text-xs text-muted-foreground">{e.actor?.full_name ?? "System"} · {fmtDT(e.created_at)}</div>
                      {e.message && <div className="text-xs mt-0.5">{e.message}</div>}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>

            <div ref={qrRef} className="hidden" aria-hidden="true">
              <QRCodeSVG value={pass.pass_number} size={96} level="M" />
            </div>
          </div>
        </div>
      </div>

      <Dialog open={dialog !== null} onOpenChange={(o) => { if (!o) { setDialog(null); setRemarks(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === "approve" ? `Approve ${pass.pass_number}`
                : dialog === "reject" ? `Reject ${pass.pass_number}`
                : dialog === "cancel" ? `Cancel ${pass.pass_number}`
                : `Release ${pass.pass_number}`}
            </DialogTitle>
            <DialogDescription>
              {dialog === "release"
                ? pass.pass_type === "sales"
                  ? "The pass is re-read from its dispatches, which must now match what the guard counted. The vehicle then goes out."
                  : "Each short line is cut down to what the guard counted; stock moves only for that. The first figures stay in the history. The vehicle then goes out."
                : dialog === "approve" ? "The guard can let it out once approved."
                : dialog === "cancel" ? "A cancelled pass cannot be used at the gate. Its dispatches or purchase return become free for a new pass."
                : "The maker is told why."}
            </DialogDescription>
          </DialogHeader>
          {dialog === "release" && overCount && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">
              The guard counted more than the pass on at least one line. This cannot be released — unload the extra and have the guard count again, or cancel the pass.
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="gp-dialog-remarks">
              {dialog === "approve" ? "Remarks (optional)" : dialog === "cancel" && pass.status === "draft" ? "Reason (optional)" : "Reason *"}
            </Label>
            <Textarea id="gp-dialog-remarks" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Back</Button>
            <Button
              variant={dialog === "reject" || dialog === "cancel" ? "destructive" : "default"}
              disabled={action.isPending || (dialog === "release" && overCount)}
              onClick={() => {
                if (dialog === "approve") run("gate_pass_review", { p_id: pass.id, p_approve: true, p_remarks: remarks }, "Approved");
                if (dialog === "reject") run("gate_pass_review", { p_id: pass.id, p_approve: false, p_remarks: remarks }, "Rejected");
                if (dialog === "cancel") run("gate_pass_cancel", { p_id: pass.id, p_reason: remarks }, "Pass cancelled");
                if (dialog === "release") run("gate_pass_release", { p_id: pass.id, p_reason: remarks }, "Released — the vehicle can go");
              }}
            >
              {dialog === "approve" ? "Approve" : dialog === "reject" ? "Reject" : dialog === "cancel" ? "Cancel pass" : "Release"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
