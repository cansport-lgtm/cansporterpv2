import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Loader2, PackageCheck, PackagePlus, Pencil, Send, X } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { TimelineList } from "@/components/facilities/TimelineList";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, facilitiesCan, fmtDate, fmtDateTime, fmtQty } from "@/lib/facilities";
import {
  acknowledgeSupplyRequest, approveSupplyRequest, cancelSupplyRequest, effectiveQty, issueSupplyRequest,
  loadHeadDepartments, loadStoreItems, loadSupplyRequest, rejectSupplyRequest, sortedLines, srStatusMeta,
  submitSupplyRequest,
} from "@/lib/facilitiesSupplies";

/**
 * One supply request: its items, where it stands, the department head's
 * approval, the admin officer's issue, the requester's acknowledgement.
 * Served at /my-supply-requests/:id (requester, heads) and /facilities/supplies/:id (admin).
 */
export default function SupplyRequestPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, roles } = useAuth();
  const fromAdmin = location.pathname.startsWith("/facilities/");
  const basePath = fromAdmin ? "/facilities/supplies" : "/my-supply-requests";
  const isSuperAdmin = roles.some((r) => r.role === "super_admin");
  const canOperate = facilitiesCan(roles, "operate");
  const canManage = facilitiesCan(roles, "manage");

  const { data: req, isLoading } = useQuery({
    queryKey: ["facilities-supply-request", id], enabled: Boolean(id), queryFn: () => loadSupplyRequest(id as string),
  });
  const { data: headDepartments = [] } = useQuery({
    queryKey: ["purchase-request-my-head-departments", user?.id], enabled: Boolean(user?.id), queryFn: () => loadHeadDepartments(user!.id),
  });
  const { data: stock = [] } = useQuery({ queryKey: ["facilities-store-items"], queryFn: loadStoreItems, enabled: canOperate });
  const onHand = useMemo(() => new Map(stock.map((s) => [s.item_id, Number(s.on_hand)])), [stock]);

  const lines = req ? sortedLines(req) : [];
  const isRequester = Boolean(req && req.created_by === user?.id);
  const isHead = Boolean(req && (isSuperAdmin || headDepartments.includes(req.department_id)));
  const status = req?.status;

  const [approved, setApproved] = useState<Record<string, string>>({});
  const [issued, setIssued] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState("");
  const [reasonDialog, setReasonDialog] = useState<"reject" | "cancel" | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!req) return;
    const a: Record<string, string> = {}; const i: Record<string, string> = {};
    sortedLines(req).forEach((l) => { a[l.id] = String(effectiveQty(l)); i[l.id] = String(l.approved_qty ?? l.requested_qty); });
    setApproved(a); setIssued(i);
  }, [req]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["facilities-supply-request", id] });
    queryClient.invalidateQueries({ queryKey: ["facilities-supply-requests"] });
    queryClient.invalidateQueries({ queryKey: ["facilities-events", "supply_request", id] });
    queryClient.invalidateQueries({ queryKey: ["facilities-store-items"] });
    queryClient.invalidateQueries({ queryKey: ["facilities-store-shortage"] });
  };
  const act = (title: string) => ({
    onSuccess: () => { toast({ title }); refresh(); setReasonDialog(null); setReason(""); },
    onError: (e: unknown) => toast({ title: "Not done", description: errorMessage(e), variant: "destructive" }),
  });
  const submit = useMutation({ mutationFn: () => submitSupplyRequest(id!), ...act("Submitted to the department head") });
  const approve = useMutation({
    mutationFn: () => approveSupplyRequest(id!, lines.map((l) => ({ id: l.id, approved_qty: Number(approved[l.id] ?? effectiveQty(l)) })), remarks),
    ...act("Approved"),
  });
  const reject = useMutation({ mutationFn: () => rejectSupplyRequest(id!, reason), ...act("Rejected") });
  const cancel = useMutation({ mutationFn: () => cancelSupplyRequest(id!, reason), ...act("Cancelled") });
  const issue = useMutation({
    mutationFn: () => issueSupplyRequest(id!, lines.map((l) => ({ id: l.id, issued_qty: Number(issued[l.id] ?? 0) }))),
    ...act("Issued — the requester has been asked to acknowledge"),
  });
  const ack = useMutation({ mutationFn: () => acknowledgeSupplyRequest(id!), ...act("Receipt acknowledged") });
  const busy = submit.isPending || approve.isPending || reject.isPending || cancel.isPending || issue.isPending || ack.isPending;

  if (isLoading || !req) {
    return <ERPLayout><Card><CardContent className="pt-4 text-muted-foreground">{isLoading ? "Loading…" : "Supply request not found."}</CardContent></Card></ERPLayout>;
  }
  const s = srStatusMeta(req.status);
  const showApprovedCol = status !== "draft" && status !== "pending_hod";
  const showIssuedCol = status === "issued";
  const canCancel = (isRequester && ["draft", "pending_hod", "approved"].includes(status!)) || (canManage && ["pending_hod", "approved"].includes(status!));

  return (
    <ERPLayout>
      <div className="w-full max-w-5xl space-y-4">
        <PageHeader title={req.request_number} description={`${req.department?.name ?? ""} · raised by ${req.requester?.full_name ?? "—"} on ${fmtDate(req.request_date)}`} icon={PackagePlus}>
          <Badge variant={s.variant} className="text-sm">{s.label}</Badge>
          <Button variant="outline" asChild><Link to={basePath}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Link></Button>
        </PageHeader>

        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Items</CardTitle></CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table className="min-w-[560px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Requested</TableHead>
                      {(showApprovedCol || (status === "pending_hod" && isHead)) && <TableHead className="text-right">Approved</TableHead>}
                      {(showIssuedCol || (status === "approved" && canOperate)) && <TableHead className="text-right">Issued</TableHead>}
                      {status === "approved" && canOperate && <TableHead className="text-right">On hand</TableHead>}
                      <TableHead>Remarks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l) => {
                      const uom = l.item?.units_of_measure?.symbol ?? "";
                      const stockQty = onHand.get(l.item_id);
                      return (
                        <TableRow key={l.id}>
                          <TableCell className="text-muted-foreground">{l.line_no}</TableCell>
                          <TableCell><span className="font-mono text-xs text-muted-foreground">{l.item?.code}</span> {l.item?.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtQty(l.requested_qty)} {uom}</TableCell>
                          {status === "pending_hod" && isHead ? (
                            <TableCell className="text-right">
                              <Input type="number" min={0} max={l.requested_qty} step="any" inputMode="decimal" className="w-24 ml-auto text-right"
                                value={approved[l.id] ?? ""} onChange={(e) => setApproved((a) => ({ ...a, [l.id]: e.target.value }))} aria-label="Approved quantity" />
                            </TableCell>
                          ) : showApprovedCol ? (
                            <TableCell className="text-right tabular-nums">{fmtQty(l.approved_qty ?? 0)} {uom}</TableCell>
                          ) : null}
                          {status === "approved" && canOperate ? (
                            <>
                              <TableCell className="text-right">
                                <Input type="number" min={0} max={l.approved_qty ?? 0} step="any" inputMode="decimal" className="w-24 ml-auto text-right"
                                  value={issued[l.id] ?? ""} onChange={(e) => setIssued((a) => ({ ...a, [l.id]: e.target.value }))} aria-label="Issued quantity" />
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {stockQty === undefined ? <Badge variant="warning">not in store</Badge>
                                  : stockQty < Number(issued[l.id] ?? 0) ? <Badge variant="destructive">{fmtQty(stockQty)}</Badge>
                                  : fmtQty(stockQty)}
                              </TableCell>
                            </>
                          ) : showIssuedCol ? (
                            <TableCell className="text-right tabular-nums">{fmtQty(l.issued_qty)} {uom}</TableCell>
                          ) : null}
                          <TableCell className="text-sm text-muted-foreground">{l.remarks ?? ""}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <p className="p-3 text-sm"><span className="text-muted-foreground">Reason:</span> {req.reason}</p>
              </CardContent>
            </Card>

            {status === "pending_hod" && isHead && (
              <Card className="border-amber-300">
                <CardHeader className="pb-2"><CardTitle className="text-base">Department head approval</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">You may lower a quantity (0 drops the line) but never raise it.</p>
                  <div className="grid gap-1.5">
                    <Label htmlFor="sr-hod-remarks">Remarks</Label>
                    <Textarea id="sr-hod-remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                  </div>
                  <div className="flex flex-wrap gap-2 justify-end">
                    <Button variant="outline" onClick={() => setReasonDialog("reject")} disabled={busy}><X className="h-4 w-4 mr-1" /> Reject</Button>
                    <Button onClick={() => approve.mutate()} disabled={busy}>{approve.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />} Approve</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {status === "approved" && canOperate && (
              <Card className="border-sky-300">
                <CardHeader className="pb-2"><CardTitle className="text-base">Issue from the admin store</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">Issued quantity cannot exceed what was approved or what is on hand. Stock is reduced when you issue.</p>
                  <div className="flex justify-end">
                    <Button onClick={() => issue.mutate()} disabled={busy}>{issue.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <PackageCheck className="h-4 w-4 mr-1" />} Issue items</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {status === "issued" && isRequester && !req.acknowledged_at && (
              <Card className="border-emerald-300">
                <CardContent className="pt-4 flex flex-wrap items-center justify-between gap-2">
                  <span>Collect the items from the admin office and confirm you received them.</span>
                  <Button onClick={() => ack.mutate()} disabled={busy}><Check className="h-4 w-4 mr-1" /> I received the items</Button>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Status</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-1.5">
                <div className="flex justify-between gap-2"><span className="text-muted-foreground">Submitted</span><span>{fmtDateTime(req.submitted_at)}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted-foreground">Department head</span><span>{req.hod_at ? `${req.hod?.full_name ?? ""} · ${fmtDateTime(req.hod_at)}` : "—"}</span></div>
                {req.hod_remarks && <p className="text-muted-foreground">“{req.hod_remarks}”</p>}
                <div className="flex justify-between gap-2"><span className="text-muted-foreground">Issued</span><span>{req.issued_at ? `${req.issuer?.full_name ?? ""} · ${fmtDateTime(req.issued_at)}` : "—"}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted-foreground">Acknowledged</span><span>{fmtDateTime(req.acknowledged_at)}</span></div>
                {req.reject_reason && <p className="text-destructive">Rejected: {req.reject_reason}</p>}
                {req.cancel_reason && <p className="text-muted-foreground">Cancelled: {req.cancel_reason}</p>}
                <div className="flex flex-wrap gap-2 pt-2">
                  {status === "draft" && isRequester && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => navigate(`/my-supply-requests/${id}/edit`)}><Pencil className="h-4 w-4 mr-1" /> Edit</Button>
                      <Button size="sm" onClick={() => submit.mutate()} disabled={busy}><Send className="h-4 w-4 mr-1" /> Submit</Button>
                    </>
                  )}
                  {canCancel && <Button size="sm" variant="ghost" onClick={() => (status === "draft" ? cancel.mutate() : setReasonDialog("cancel"))} disabled={busy}>Cancel request</Button>}
                </div>
              </CardContent>
            </Card>
            <TimelineList documentType="supply_request" documentId={id} />
          </div>
        </div>
      </div>

      <Dialog open={Boolean(reasonDialog)} onOpenChange={(o) => { if (!o) setReasonDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{reasonDialog === "reject" ? "Reject the request" : "Cancel the request"}</DialogTitle>
            <DialogDescription>Give a reason; the requester is told.</DialogDescription>
          </DialogHeader>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReasonDialog(null)}>Back</Button>
            <Button variant="destructive" disabled={!reason.trim() || busy} onClick={() => (reasonDialog === "reject" ? reject.mutate() : cancel.mutate())}>
              {reasonDialog === "reject" ? "Reject" : "Cancel request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
