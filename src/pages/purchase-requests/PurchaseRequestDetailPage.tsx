import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import { AlertTriangle, ArrowLeft, Check, ClipboardList, Loader2, Pencil, Printer, Send, X } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { purchaseCategoryLabel, purchaseRequestRoleCategories } from "@/lib/purchase/categories";
import {
  EVENT_LABEL, PR_SELECT, effectiveQty, errorMessage, fmtMoney, fmtQty, prDb, prStatusMeta,
  printPurchaseRequest, sortedItems, type PurchaseRequest,
} from "@/lib/purchaseRequest";

type EventRow = { id: string; event: string; message: string | null; created_at: string; actor: { full_name: string | null } | null };
type Stage = "hod" | "purchase" | "final";
type LineDraft = { approved_qty: string; est_rate: string };

const fmtDT = (s: string | null) => (s ? format(new Date(s), "dd MMM yyyy, HH:mm") : "—");
const fmtD = (s: string | null) => (s ? format(new Date(s), "dd MMM yyyy") : "—");

const REVIEW_RPC: Record<Stage, string> = {
  hod: "purchase_request_hod_review",
  purchase: "purchase_request_purchase_review",
  final: "purchase_request_final_review",
};
const STAGE_TITLE: Record<Stage, string> = {
  hod: "Department head approval",
  purchase: "Purchase approval",
  final: "Final approval (above the value limit)",
};

/**
 * One purchase request: its items, where it stands, the timeline, and the
 * approval panel for whoever's turn it is. Served at /my-purchase-requests/:id
 * (requesters, department heads) and /purchase/requests/:id (Purchase).
 */
export default function PurchaseRequestDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, roles, purchaseCategoryPermissions, canViewPrices } = useAuth();
  const showPrices = canViewPrices();
  const fromPurchase = location.pathname.startsWith("/purchase/");
  const backHref = fromPurchase ? "/purchase/requests" : "/my-purchase-requests";
  const isSuperAdmin = roles.some((r) => r.role === "super_admin");
  const isPurchaseManager = isSuperAdmin || roles.some((r) => r.role === "purchase_manager");

  const [remarks, setRemarks] = useState("");
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});
  const [rejectOpen, setRejectOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");

  const { data: pr, isLoading } = useQuery<PurchaseRequest | null>({
    queryKey: ["purchase-request", id],
    queryFn: async () => {
      const { data, error } = await prDb.from("purchase_requests").select(PR_SELECT).eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const { data: events = [] } = useQuery<EventRow[]>({
    queryKey: ["purchase-request-events", id],
    queryFn: async () => {
      const { data, error } = await prDb
        .from("purchase_request_events")
        .select("id, event, message, created_at, actor:app_users!purchase_request_events_created_by_fkey(full_name)")
        .eq("request_id", id)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: myHeadDepartments = [] } = useQuery<string[]>({
    queryKey: ["purchase-request-my-head-departments", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await prDb.from("purchase_request_department_heads").select("department_id").eq("user_id", user?.id);
      if (error) throw error;
      return (data ?? []).map((r: { department_id: string }) => r.department_id);
    },
  });
  const { data: limit } = useQuery<number>({
    queryKey: ["purchase-request-settings"],
    queryFn: async () => {
      const { data, error } = await prDb.from("purchase_request_settings").select("approval_limit").maybeSingle();
      if (error) throw error;
      return Number(data?.approval_limit ?? 0);
    },
  });

  const items = useMemo(() => (pr ? sortedItems(pr) : []), [pr]);
  const mine = Boolean(pr && user && pr.created_by === user.id);

  // Whose turn is it, and is it the caller's? (The database checks again.)
  const stage: Stage | null = !pr ? null
    : pr.status === "pending_hod" && (isSuperAdmin || myHeadDepartments.includes(pr.department_id)) ? "hod"
    : pr.status === "pending_purchase" && (!mine || isSuperAdmin)
      && (isPurchaseManager
        || purchaseRequestRoleCategories(roles.map((r) => r.role), "approver").includes(pr.category)
        || purchaseCategoryPermissions.some((p) => p.category === pr.category && p.can_approve)) ? "purchase"
    : pr.status === "pending_final" && isSuperAdmin ? "final"
    : null;
  const editQty = stage === "hod" || stage === "purchase";
  const editRate = stage === "purchase" && showPrices;

  useEffect(() => {
    setDrafts(Object.fromEntries(items.map((i) => [i.id, {
      approved_qty: String(effectiveQty(i)), est_rate: String(i.est_rate),
    }])));
  }, [items]);

  const draftTotal = items.reduce((s, i) => {
    const d = drafts[i.id];
    const q = editQty && d ? Number(d.approved_qty || 0) : effectiveQty(i);
    const r = editRate && d ? Number(d.est_rate || 0) : Number(i.est_rate);
    return s + q * r;
  }, 0);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["purchase-request", id] });
    queryClient.invalidateQueries({ queryKey: ["purchase-request-events", id] });
    queryClient.invalidateQueries({ queryKey: ["purchase-requests"] });
  };

  const review = useMutation({
    mutationFn: async ({ approve, text }: { approve: boolean; text: string }) => {
      if (!stage) throw new Error("It is not your turn to approve this request.");
      const args: Record<string, unknown> = { p_id: id, p_approve: approve, p_remarks: text || null };
      if (stage !== "final") {
        args.p_lines = approve
          ? items.map((i) => ({
              id: i.id,
              approved_qty: drafts[i.id]?.approved_qty ?? "",
              ...(editRate ? { est_rate: drafts[i.id]?.est_rate ?? "" } : {}),
            }))
          : null;
      }
      const { data, error } = await prDb.rpc(REVIEW_RPC[stage], args);
      if (error) throw error;
      return data as string;
    },
    onSuccess: (status) => {
      refresh();
      setRemarks(""); setReason(""); setRejectOpen(false);
      toast({ title: `Purchase request ${prStatusMeta(status).label.toLowerCase()}` });
    },
    onError: (e) => toast({ title: "Could not save", description: errorMessage(e), variant: "destructive" }),
  });

  const submit = useMutation({
    mutationFn: async () => {
      const { error } = await prDb.rpc("purchase_request_submit", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => { refresh(); toast({ title: "Purchase request submitted" }); },
    onError: (e) => toast({ title: "Could not submit", description: errorMessage(e), variant: "destructive" }),
  });

  const cancel = useMutation({
    mutationFn: async () => {
      const { error } = await prDb.rpc("purchase_request_cancel", { p_id: id, p_reason: reason || null });
      if (error) throw error;
    },
    onSuccess: () => { refresh(); setCancelOpen(false); setReason(""); toast({ title: "Purchase request cancelled" }); },
    onError: (e) => toast({ title: "Could not cancel", description: errorMessage(e), variant: "destructive" }),
  });

  if (isLoading) {
    return <ERPLayout><div className="flex items-center gap-2 p-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div></ERPLayout>;
  }
  if (!pr) {
    return <ERPLayout><div className="p-8 text-muted-foreground">Purchase request not found.</div></ERPLayout>;
  }

  const s = prStatusMeta(pr.status);
  const canCancel = !["ordered", "partially_ordered", "rejected", "cancelled"].includes(pr.status)
    && (isPurchaseManager || (mine && pr.status !== "approved"));
  const overLimit = limit !== undefined && draftTotal > limit;

  return (
    <ERPLayout>
      <div className="w-full max-w-5xl space-y-4">
        <PageHeader
          title={pr.pr_number}
          description={`${purchaseCategoryLabel(pr.category)} · ${pr.department?.name ?? ""}`}
          icon={ClipboardList}
        >
          <Button variant="outline" asChild>
            <Link to={backHref}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Link>
          </Button>
          <Button variant="outline" onClick={() => printPurchaseRequest(pr, showPrices)}>
            <Printer className="h-4 w-4 mr-1" /> Print
          </Button>
          {mine && pr.status === "draft" && (
            <>
              <Button variant="outline" onClick={() => navigate(`/my-purchase-requests/${pr.id}/edit`)}>
                <Pencil className="h-4 w-4 mr-1" /> Edit
              </Button>
              <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
                <Send className="h-4 w-4 mr-1" /> Submit
              </Button>
            </>
          )}
          {canCancel && (
            <Button variant="outline" className="text-destructive" onClick={() => setCancelOpen(true)}>
              <X className="h-4 w-4 mr-1" /> Cancel request
            </Button>
          )}
        </PageHeader>

        <Card>
          <CardContent className="p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
            <div><div className="text-xs text-muted-foreground">Status</div><Badge variant={s.variant}>{s.label}</Badge></div>
            <div>
              <div className="text-xs text-muted-foreground">Priority</div>
              {pr.priority === "urgent"
                ? <span className="font-semibold text-red-700 inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Urgent{pr.is_breakdown ? " — breakdown" : ""}</span>
                : "Normal"}
            </div>
            <div><div className="text-xs text-muted-foreground">Requested by</div>{pr.requester?.full_name ?? "—"}</div>
            <div><div className="text-xs text-muted-foreground">Request date</div>{fmtD(pr.request_date)}</div>
            <div><div className="text-xs text-muted-foreground">Required by</div>{fmtD(pr.required_by)}</div>
            {pr.machine && <div><div className="text-xs text-muted-foreground">Machine</div>{pr.machine.code} · {pr.machine.name}</div>}
            {pr.job_order_ref && <div><div className="text-xs text-muted-foreground">Job order</div>{pr.job_order_ref}</div>}
            {showPrices && <div><div className="text-xs text-muted-foreground">Estimated value</div><span className="font-semibold tabular-nums">{fmtMoney(pr.estimated_total)}</span></div>}
            <div className="sm:col-span-2 lg:col-span-3"><div className="text-xs text-muted-foreground">Purpose</div>{pr.purpose}</div>
            {pr.status === "rejected" && pr.reject_reason && (
              <div className="sm:col-span-2 lg:col-span-3 text-red-700"><span className="font-medium">Rejected:</span> {pr.reject_reason}</div>
            )}
            {pr.status === "cancelled" && pr.cancel_reason && (
              <div className="sm:col-span-2 lg:col-span-3 text-muted-foreground"><span className="font-medium">Cancelled:</span> {pr.cancel_reason}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Items</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Requested</TableHead>
                  <TableHead className="text-right w-32">Approved</TableHead>
                  {showPrices && <TableHead className="text-right w-32">Est. rate</TableHead>}
                  {showPrices && <TableHead className="text-right">Est. value</TableHead>}
                  <TableHead>Remark</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((i, n) => {
                  const d = drafts[i.id];
                  const q = editQty && d ? Number(d.approved_qty || 0) : effectiveQty(i);
                  const r = editRate && d ? Number(d.est_rate || 0) : Number(i.est_rate);
                  const unit = i.items?.units_of_measure?.symbol ?? "";
                  return (
                    <TableRow key={i.id}>
                      <TableCell className="text-muted-foreground">{n + 1}</TableCell>
                      <TableCell>
                        <div className="font-medium">{i.items?.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{i.items?.code}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap">{fmtQty(i.requested_qty)} {unit}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {editQty ? (
                          <Input type="number" min="0" max={i.requested_qty} step="any" className="h-8 text-right"
                            value={d?.approved_qty ?? ""} aria-label={`Approved quantity, line ${n + 1}`}
                            onChange={(e) => setDrafts((x) => ({ ...x, [i.id]: { ...x[i.id], approved_qty: e.target.value } }))} />
                        ) : i.approved_qty == null ? <span className="text-muted-foreground">—</span> : fmtQty(i.approved_qty)}
                      </TableCell>
                      {showPrices && (
                        <TableCell className="text-right tabular-nums">
                          {editRate ? (
                            <Input type="number" min="0" step="any" className="h-8 text-right"
                              value={d?.est_rate ?? ""} aria-label={`Estimated rate, line ${n + 1}`}
                              onChange={(e) => setDrafts((x) => ({ ...x, [i.id]: { ...x[i.id], est_rate: e.target.value } }))} />
                          ) : fmtMoney(i.est_rate)}
                        </TableCell>
                      )}
                      {showPrices && <TableCell className="text-right tabular-nums">{fmtMoney(q * r)}</TableCell>}
                      <TableCell className="text-sm">{i.remarks ?? ""}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {stage && (
          <Card className="border-primary/40">
            <CardHeader className="pb-3"><CardTitle className="text-base">{STAGE_TITLE[stage]}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {editQty && (
                <p className="text-sm text-muted-foreground">
                  You can lower a quantity (0 drops the line) but not raise it above what was requested.
                  {editRate && " Set the estimated rate if you know a better one than the item master."}
                </p>
              )}
              {showPrices && stage !== "final" && (
                <div className="text-sm flex flex-wrap gap-x-6 gap-y-1">
                  <span>Estimated value <b className="tabular-nums">{fmtMoney(draftTotal)}</b></span>
                  {limit !== undefined && <span className="text-muted-foreground">Approval limit {fmtMoney(limit)}</span>}
                  {stage === "purchase" && overLimit && (
                    <span className="text-amber-700 font-medium">Above the limit — a super admin gives the final approval after you.</span>
                  )}
                </div>
              )}
              {stage === "final" && showPrices && (
                <p className="text-sm">Estimated value <b className="tabular-nums">{fmtMoney(pr.estimated_total)}</b> is above the approval limit{limit !== undefined ? ` of ${fmtMoney(limit)}` : ""}.</p>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="pr-remarks">Remarks (optional)</Label>
                <Textarea id="pr-remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" className="text-destructive" onClick={() => { setReason(remarks); setRejectOpen(true); }} disabled={review.isPending}>
                  <X className="h-4 w-4 mr-1" /> Reject
                </Button>
                <Button onClick={() => review.mutate({ approve: true, text: remarks })} disabled={review.isPending}>
                  {review.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />} Approve
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Timeline</CardTitle></CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              <ol className="space-y-2">
                {events.map((e) => (
                  <li key={e.id} className="text-sm flex flex-wrap gap-x-2">
                    <span className="text-muted-foreground whitespace-nowrap w-40">{fmtDT(e.created_at)}</span>
                    <span className="font-medium">{EVENT_LABEL[e.event] ?? e.event}</span>
                    {e.actor?.full_name && <span className="text-muted-foreground">· {e.actor.full_name}</span>}
                    {e.message && <span className="text-muted-foreground">— {e.message}</span>}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject {pr.pr_number}?</DialogTitle>
            <DialogDescription>The requester is told the reason. A rejected request cannot be reopened; they raise a new one.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="pr-reject-reason">Reason</Label>
            <Textarea id="pr-reject-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Back</Button>
            <Button variant="destructive" disabled={review.isPending || !reason.trim()}
              onClick={() => review.mutate({ approve: false, text: reason })}>Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {pr.pr_number}?</DialogTitle>
            <DialogDescription>A cancelled request stays on record but goes no further.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="pr-cancel-reason">Reason{pr.status === "draft" ? " (optional)" : ""}</Label>
            <Textarea id="pr-cancel-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Back</Button>
            <Button variant="destructive" disabled={cancel.isPending || (pr.status !== "draft" && !reason.trim())}
              onClick={() => cancel.mutate()}>Cancel request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
