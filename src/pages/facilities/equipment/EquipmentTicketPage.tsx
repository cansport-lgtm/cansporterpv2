import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, ClipboardList, Loader2, Lock, Play, RotateCcw, Send, UserCheck } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TimelineList } from "@/components/facilities/TimelineList";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { photoUrl } from "@/lib/gatePass";
import { errorMessage, facilitiesCan, fcDb, fmtDateTime, fmtMoney, fmtQty, rpc } from "@/lib/facilities";
import {
  OPEN_STATUSES, PAID_THROUGH_LABEL, SOURCE_LABEL, ageLabel, categoryLabel, loadComments, loadTicket,
  priorityMeta, ticketStatusMeta, type PaidThrough, type Ticket,
} from "@/lib/facilitiesEquipment";

type UserRow = { id: string; full_name: string | null; is_technician?: boolean };
const NONE = "__none__";

/** One equipment ticket: details, assignment, work, closing, comments and timeline. */
export default function EquipmentTicketPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, roles } = useAuth();
  const canOperate = facilitiesCan(roles, "operate");
  const canManage = facilitiesCan(roles, "manage");
  const isTechnician = facilitiesCan(roles, "technician");

  const { data: ticket, isLoading } = useQuery<Ticket | null>({
    queryKey: ["facilities-tickets", id],
    enabled: Boolean(id),
    queryFn: () => loadTicket(id as string),
  });
  const { data: comments = [] } = useQuery({
    queryKey: ["facilities-ticket-comments", id],
    enabled: Boolean(id),
    queryFn: () => loadComments(id as string),
  });
  const { data: users = [] } = useQuery<UserRow[]>({
    queryKey: ["facilities-assignable-users"],
    enabled: canOperate,
    queryFn: async () => {
      const [{ data: u, error: e1 }, { data: r, error: e2 }] = await Promise.all([
        fcDb.from("app_users").select("id, full_name").eq("is_active", true).order("full_name").limit(1000),
        fcDb.from("user_roles").select("user_id").eq("role", "facilities_technician"),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      const tech = new Set((r ?? []).map((x: { user_id: string }) => x.user_id));
      return (u ?? []).map((x: UserRow) => ({ ...x, is_technician: tech.has(x.id) }));
    },
  });
  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => Number(Boolean(b.is_technician)) - Number(Boolean(a.is_technician)) || (a.full_name ?? "").localeCompare(b.full_name ?? "")),
    [users],
  );

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["facilities-tickets"] });
    queryClient.invalidateQueries({ queryKey: ["facilities-ticket-comments", id] });
    queryClient.invalidateQueries({ queryKey: ["facilities-events", "ticket", id] });
    queryClient.invalidateQueries({ queryKey: ["facilities-equipment-due"] });
  };
  const fail = (title: string) => (e: unknown) => toast({ title, description: errorMessage(e), variant: "destructive" });

  // Assignment
  const [assignUser, setAssignUser] = useState<string>(NONE);
  const [assignVendor, setAssignVendor] = useState("");
  const assign = useMutation({
    mutationFn: () => rpc("facilities_ticket_assign", { p_id: id, p_user: assignUser === NONE ? null : assignUser, p_vendor_name: assignVendor || null }),
    onSuccess: () => { toast({ title: "Assigned" }); refresh(); },
    onError: fail("Not assigned"),
  });

  const start = useMutation({
    mutationFn: () => rpc("facilities_ticket_start", { p_id: id }),
    onSuccess: () => { toast({ title: "Work started" }); refresh(); },
    onError: fail("Not started"),
  });

  // Done
  const [doneOpen, setDoneOpen] = useState(false);
  const [done, setDone] = useState({ action_taken: "", parts_used: "", cost: "", paid_through: "" as PaidThrough | "", payment_ref: "", run_hours_at_service: "" });
  const markDone = useMutation({
    mutationFn: () => rpc("facilities_ticket_done", { p_id: id, p_data: { ...done, paid_through: done.paid_through || null } }),
    onSuccess: () => { toast({ title: "Marked done" }); setDoneOpen(false); refresh(); },
    onError: fail("Not marked done"),
  });

  const close = useMutation({
    mutationFn: () => rpc("facilities_ticket_close", { p_id: id }),
    onSuccess: () => { toast({ title: "Ticket closed" }); refresh(); },
    onError: fail("Not closed"),
  });

  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const reopen = useMutation({
    mutationFn: () => rpc("facilities_ticket_reopen", { p_id: id, p_reason: reopenReason }),
    onSuccess: () => { toast({ title: "Reopened" }); setReopenOpen(false); setReopenReason(""); refresh(); },
    onError: fail("Not reopened"),
  });

  const [comment, setComment] = useState("");
  const addComment = useMutation({
    mutationFn: () => rpc("facilities_ticket_comment", { p_id: id, p_body: comment }),
    onSuccess: () => { setComment(""); refresh(); },
    onError: fail("Comment not added"),
  });

  if (isLoading || !ticket) {
    return (
      <ERPLayout>
        <div className="py-16 text-center text-muted-foreground">
          {isLoading ? <Loader2 className="h-6 w-6 animate-spin inline" /> : "Ticket not found."}
        </div>
      </ERPLayout>
    );
  }

  const t = ticket;
  const s = ticketStatusMeta(t.status);
  const p = priorityMeta(t.priority);
  const isAssignee = Boolean(user?.id) && t.assigned_to === user?.id;
  const canWork = canOperate || (isAssignee && isTechnician);
  const isOpen = OPEN_STATUSES.includes(t.status);
  const canComment = canWork || isTechnician || t.reported_by === user?.id;
  const photo = photoUrl(t.photo_path);
  const isGenerator = (t.equipment?.type?.name ?? "").toLowerCase().includes("generator");

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title={t.ticket_number} description={t.title} icon={ClipboardList}>
          <Button variant="outline" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
        </PageHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={s.variant}>{s.label}</Badge>
          <Badge variant={p.variant}>{p.label} priority</Badge>
          <Badge variant="secondary">{categoryLabel(t.category)}</Badge>
          <span className="text-sm text-muted-foreground">{SOURCE_LABEL[t.source] ?? t.source} · open {ageLabel(t.created_at, t.done_at)}{t.reopened_count ? ` · reopened ${t.reopened_count}×` : ""}</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Details</CardTitle></CardHeader>
              <CardContent>
                <dl className="grid grid-cols-1 sm:grid-cols-[150px_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Equipment</dt>
                  <dd>
                    {t.equipment ? (
                      <Link to="/facilities/equipment" className="underline-offset-2 hover:underline">{t.equipment.code} · {t.equipment.name}</Link>
                    ) : "—"}
                    {t.equipment?.type?.name && <span className="text-muted-foreground"> · {t.equipment.type.name}</span>}
                  </dd>
                  <dt className="text-muted-foreground">Location</dt>
                  <dd>{t.location_text ?? t.equipment?.location ?? "—"}</dd>
                  <dt className="text-muted-foreground">Reported by</dt>
                  <dd>{t.reporter?.full_name ?? "System"} · {fmtDateTime(t.created_at)}</dd>
                  <dt className="text-muted-foreground">Description</dt>
                  <dd className="whitespace-pre-wrap">{t.description ?? "—"}</dd>
                  <dt className="text-muted-foreground">Assigned to</dt>
                  <dd>{t.assignee?.full_name ?? t.vendor_name ?? <span className="text-muted-foreground">nobody yet</span>}{t.assignee && t.vendor_name ? ` · ${t.vendor_name}` : ""}{t.assigned_at ? <span className="text-muted-foreground"> · {fmtDateTime(t.assigned_at)}</span> : null}</dd>
                  {t.started_at && (<><dt className="text-muted-foreground">Started</dt><dd>{fmtDateTime(t.started_at)}</dd></>)}
                  {t.done_at && (
                    <>
                      <dt className="text-muted-foreground">Done</dt>
                      <dd>{fmtDateTime(t.done_at)}</dd>
                      <dt className="text-muted-foreground">Action taken</dt>
                      <dd className="whitespace-pre-wrap">{t.action_taken}</dd>
                      <dt className="text-muted-foreground">Parts</dt>
                      <dd>{t.parts_used ?? "—"}</dd>
                      <dt className="text-muted-foreground">Cost</dt>
                      <dd>{t.cost != null ? `PKR ${fmtMoney(t.cost)}` : "—"}{t.paid_through ? ` · ${PAID_THROUGH_LABEL[t.paid_through]}` : ""}{t.payment_ref ? ` · ${t.payment_ref}` : ""}</dd>
                      {t.run_hours_at_service != null && (<><dt className="text-muted-foreground">Run hours</dt><dd>{fmtQty(t.run_hours_at_service)} h</dd></>)}
                    </>
                  )}
                  {t.closed_at && (<><dt className="text-muted-foreground">Closed</dt><dd>{fmtDateTime(t.closed_at)}</dd></>)}
                </dl>
                {photo && (
                  <a href={photo} target="_blank" rel="noreferrer" className="mt-3 inline-block">
                    <img src={photo} alt="Fault photo" className="h-40 rounded-lg border object-cover" />
                  </a>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Comments</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {comments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No comments yet.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {comments.map((c) => (
                      <li key={c.id} className="rounded-md bg-muted/50 px-3 py-2">
                        <div className="text-xs text-muted-foreground">{c.author?.full_name ?? "System"} · {fmtDateTime(c.created_at)}</div>
                        <div className="whitespace-pre-wrap">{c.body}</div>
                      </li>
                    ))}
                  </ul>
                )}
                {canComment && (
                  <div className="flex gap-2">
                    <Textarea id="tk-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment…" className="flex-1" />
                    <Button size="icon" onClick={() => addComment.mutate()} disabled={!comment.trim() || addComment.isPending} aria-label="Send comment">
                      {addComment.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            {canOperate && isOpen && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Assign</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <Label>Person</Label>
                    <Select value={assignUser} onValueChange={setAssignUser}>
                      <SelectTrigger id="tk-assign-user"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Nobody (vendor only)</SelectItem>
                        {sortedUsers.map((u) => (
                          <SelectItem key={u.id} value={u.id}>{u.full_name}{u.is_technician ? " · technician" : ""}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="tk-assign-vendor">Vendor (optional)</Label>
                    <Input id="tk-assign-vendor" value={assignVendor} onChange={(e) => setAssignVendor(e.target.value)} placeholder="PowerTech, Secure-Eye…" />
                  </div>
                  <Button className="w-full" onClick={() => assign.mutate()} disabled={assign.isPending || (assignUser === NONE && !assignVendor.trim())}>
                    <UserCheck className="h-4 w-4 mr-1" /> Assign
                  </Button>
                </CardContent>
              </Card>
            )}

            {(canWork || canManage) && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Actions</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {canWork && (t.status === "open" || t.status === "assigned") && (
                    <Button variant="outline" className="w-full" onClick={() => start.mutate()} disabled={start.isPending}>
                      <Play className="h-4 w-4 mr-1" /> Start work
                    </Button>
                  )}
                  {canWork && isOpen && (
                    <Button className="w-full" onClick={() => setDoneOpen(true)}>
                      <Check className="h-4 w-4 mr-1" /> Mark done
                    </Button>
                  )}
                  {canManage && t.status === "done" && (
                    <Button className="w-full" onClick={() => close.mutate()} disabled={close.isPending}>
                      <Lock className="h-4 w-4 mr-1" /> Close ticket
                    </Button>
                  )}
                  {canOperate && (t.status === "done" || t.status === "closed") && (
                    <Button variant="outline" className="w-full" onClick={() => setReopenOpen(true)}>
                      <RotateCcw className="h-4 w-4 mr-1" /> Reopen
                    </Button>
                  )}
                  {!isOpen && t.status !== "done" && !canOperate && (
                    <p className="text-sm text-muted-foreground">This ticket is {s.label.toLowerCase()}.</p>
                  )}
                </CardContent>
              </Card>
            )}

            <TimelineList documentType="ticket" documentId={id} />
          </div>
        </div>
      </div>

      <Dialog open={doneOpen} onOpenChange={setDoneOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Mark {t.ticket_number} done</DialogTitle>
            <DialogDescription>What was done, the parts used and what it cost.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label htmlFor="dn-action">Action taken</Label><Textarea id="dn-action" rows={3} value={done.action_taken} onChange={(e) => setDone({ ...done, action_taken: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="dn-parts">Parts used</Label><Input id="dn-parts" value={done.parts_used} onChange={(e) => setDone({ ...done, parts_used: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label htmlFor="dn-cost">Cost (PKR)</Label><Input id="dn-cost" type="number" min={0} value={done.cost} onChange={(e) => setDone({ ...done, cost: e.target.value })} /></div>
              <div className="space-y-1">
                <Label>Paid through</Label>
                <Select value={done.paid_through || NONE} onValueChange={(v) => setDone({ ...done, paid_through: v === NONE ? "" : (v as PaidThrough) })}>
                  <SelectTrigger id="dn-paid"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No cost</SelectItem>
                    <SelectItem value="petty_cash">Petty cash voucher</SelectItem>
                    <SelectItem value="supplier_invoice">Supplier invoice (AMC / vendor)</SelectItem>
                    <SelectItem value="general_expense">General expense</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label htmlFor="dn-ref">Voucher / invoice no.</Label><Input id="dn-ref" value={done.payment_ref} onChange={(e) => setDone({ ...done, payment_ref: e.target.value })} /></div>
              {(isGenerator || t.category === "preventive") && (
                <div className="space-y-1"><Label htmlFor="dn-hours">Run hours now</Label><Input id="dn-hours" type="number" min={0} step="0.1" value={done.run_hours_at_service} onChange={(e) => setDone({ ...done, run_hours_at_service: e.target.value })} /></div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDoneOpen(false)}>Cancel</Button>
            <Button onClick={() => markDone.mutate()} disabled={markDone.isPending || !done.action_taken.trim()}>
              {markDone.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Mark done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reopenOpen} onOpenChange={setReopenOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Reopen {t.ticket_number}</DialogTitle></DialogHeader>
          <div className="space-y-1"><Label htmlFor="ro-reason">Why</Label><Textarea id="ro-reason" rows={3} value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} placeholder="Same fault again the next day" /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenOpen(false)}>Cancel</Button>
            <Button onClick={() => reopen.mutate()} disabled={reopen.isPending || !reopenReason.trim()}>Reopen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
