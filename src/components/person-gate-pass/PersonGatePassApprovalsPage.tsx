import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, ClipboardCheck, XCircle } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmployeeAvatar } from "@/components/labour/EmployeeAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  errorMessage, fmtDT, hasAnyRole, invalidatePassQueries, overdueMinutes, passKeys, passKindMeta, passSelect, ppDb,
  type PersonGatePass, type PersonPassVariant,
} from "@/lib/personGatePass";

/** The approver's queue: passes waiting, and short leaves overdue at the gate. */
export function PersonGatePassApprovalsPage({ variant }: { variant: PersonPassVariant }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { roles } = useAuth();
  const canApprove = hasAnyRole(roles, variant.approveRoles);
  const [target, setTarget] = useState<{ pass: PersonGatePass; kind: "reject" | "convert" } | null>(null);
  const [reason, setReason] = useState("");
  const keys = passKeys(variant);

  const { data: passes = [], isLoading } = useQuery<PersonGatePass[]>({
    queryKey: [keys.approvals],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await ppDb
        .from(variant.table)
        .select(passSelect(variant))
        .in("status", ["pending_approval", "out"])
        .order("pass_date")
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const refresh = () => invalidatePassQueries(queryClient, variant);

  const review = useMutation({
    mutationFn: async ({ id, approve, remarks }: { id: string; approve: boolean; remarks?: string }) => {
      const { error } = await ppDb.rpc(`${variant.fnPrefix}_review`, { p_id: id, p_approve: approve, p_remarks: remarks ?? null });
      if (error) throw error;
      return approve;
    },
    onSuccess: (approve) => {
      toast({ title: approve ? "Approved" : "Rejected" });
      setTarget(null);
      setReason("");
      refresh();
    },
    onError: (e) => toast({ title: "Could not complete", description: errorMessage(e), variant: "destructive" }),
  });

  const convert = useMutation({
    mutationFn: async ({ id, remarks }: { id: string; remarks: string }) => {
      const { error } = await ppDb.rpc(`${variant.fnPrefix}_convert_half_day`, { p_id: id, p_reason: remarks });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Marked half day" });
      setTarget(null);
      setReason("");
      refresh();
    },
    onError: (e) => toast({ title: "Could not complete", description: errorMessage(e), variant: "destructive" }),
  });

  const pending = passes.filter((p) => p.status === "pending_approval");
  const overdue = passes.filter((p) => p.status === "out" && overdueMinutes(p) > 0);

  const PersonLine = ({ p }: { p: PersonGatePass }) => (
    <div className="flex items-center gap-3 min-w-0">
      <EmployeeAvatar name={p.person?.full_name} photoUrl={p.person?.photo_url} className="h-11 w-11" />
      <div className="min-w-0">
        <div className="font-semibold truncate">
          <Link to={`${variant.basePath}/${p.id}`} className="hover:underline">{p.pass_number}</Link> · {p.person?.employee_code} {p.person?.full_name}
        </div>
        <div className="text-xs text-muted-foreground">
          {p.person?.production_departments?.name ? `${p.person.production_departments.name} · ` : ""}
          applied by {p.creator?.full_name ?? "—"} · {fmtDT(p.created_at)}
        </div>
      </div>
    </div>
  );

  return (
    <ERPLayout>
      <div className="w-full max-w-4xl space-y-4">
        <PageHeader title={variant.approvalsTitle} description={variant.approvalsDescription} icon={ClipboardCheck} iconColor={variant.iconColor} />

        {!canApprove && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            You can see the queue, but only {variant.approverText} (or a super admin) can approve, reject or convert a pass.
          </div>
        )}

        {overdue.length > 0 && (
          <Card className="border-red-300">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-red-700"><AlertTriangle className="h-4 w-4" /> Late back from short leave · {overdue.length}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {overdue.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50/60 p-3">
                  <PersonLine p={p} />
                  <div className="text-sm text-red-800 font-semibold">{overdueMinutes(p)} min overdue · out {fmtDT(p.gate_out_at)} · due {fmtDT(p.expected_back_at)}</div>
                  {canApprove && (
                    <Button size="sm" variant="destructive" onClick={() => setTarget({ pass: p, kind: "convert" })}>Did not return · mark half day</Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><ClipboardCheck className="h-4 w-4" /> Waiting for approval · {pending.length}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <div className="text-muted-foreground text-sm py-6 text-center">Loading…</div>
            ) : pending.length === 0 ? (
              <div className="text-muted-foreground text-sm py-6 text-center">Nothing waiting.</div>
            ) : pending.map((p) => {
              const kind = passKindMeta(p.pass_kind);
              return (
                <div key={p.id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <PersonLine p={p} />
                    <div className="flex items-center gap-2">
                      <span className={cn("text-xs font-semibold rounded-full px-2 py-0.5 ring-1 ring-inset whitespace-nowrap", kind.badgeClass)}>
                        {kind.label}{p.pass_kind === "short_leave" ? ` · ${p.expected_minutes} min` : ""}
                      </span>
                      <span className="text-sm font-medium whitespace-nowrap">{format(new Date(p.pass_date), "dd MMM")}{p.leave_time ? ` · ${p.leave_time.slice(0, 5)}` : ""}</span>
                    </div>
                  </div>
                  <div className="text-sm"><span className="text-muted-foreground">Reason:</span> {p.reason}</div>
                  {canApprove && (
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" variant="outline" onClick={() => setTarget({ pass: p, kind: "reject" })}><XCircle className="h-4 w-4 mr-1" /> Reject</Button>
                      <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800" disabled={review.isPending} onClick={() => review.mutate({ id: p.id, approve: true })}>
                        <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Dialog open={target !== null} onOpenChange={(o) => { if (!o) { setTarget(null); setReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{target?.kind === "convert" ? `Mark ${target?.pass.pass_number} as not returned` : `Reject ${target?.pass.pass_number}`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="pgp-appr-reason">Reason</Label>
            <Textarea id="pgp-appr-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            {target?.kind === "convert" && <p className="text-xs text-muted-foreground">The pass becomes Not returned and {format(new Date(target.pass.pass_date), "dd MMM")} is marked Half day for the {variant.noun}.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>Back</Button>
            <Button variant="destructive" disabled={!reason.trim() || review.isPending || convert.isPending}
              onClick={() => target && (target.kind === "convert"
                ? convert.mutate({ id: target.pass.id, remarks: reason })
                : review.mutate({ id: target.pass.id, approve: false, remarks: reason }))}>
              {target?.kind === "convert" ? "Mark half day" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
