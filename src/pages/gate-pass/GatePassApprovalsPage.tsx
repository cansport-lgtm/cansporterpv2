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
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  PASS_SELECT, errorMessage, expectedCount, fmtQty, gpDb, passTypeMeta, sortedItems, type GatePass,
} from "@/lib/gatePass";

export default function GatePassApprovalsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { hasModulePermission } = useAuth();
  const canApprove = hasModulePermission("gate_pass", "approve");
  const [reject, setReject] = useState<GatePass | null>(null);
  const [reason, setReason] = useState("");

  const { data: passes = [], isLoading } = useQuery<GatePass[]>({
    queryKey: ["gate-pass-approvals"],
    queryFn: async () => {
      const { data, error } = await gpDb
        .from("gate_passes")
        .select(PASS_SELECT)
        .in("status", ["pending_approval", "held"])
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const review = useMutation({
    mutationFn: async ({ id, approve, remarks }: { id: string; approve: boolean; remarks?: string }) => {
      const { error } = await gpDb.rpc("gate_pass_review", { p_id: id, p_approve: approve, p_remarks: remarks ?? null });
      if (error) throw error;
      return approve;
    },
    onSuccess: (approve) => {
      toast({ title: approve ? "Approved" : "Rejected" });
      setReject(null);
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["gate-pass-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["gate-passes"] });
      queryClient.invalidateQueries({ queryKey: ["gate-passes-live"] });
    },
    onError: (e) => toast({ title: "Could not complete", description: errorMessage(e), variant: "destructive" }),
  });

  const held = passes.filter((p) => p.status === "held");
  const pending = passes.filter((p) => p.status === "pending_approval");

  const lineSummary = (p: GatePass) =>
    sortedItems(p).map((i) => `${i.description} — ${fmtQty(i.quantity)} ${i.uom}`).join("; ");

  const shortSummary = (p: GatePass) => {
    const bad = sortedItems(p).filter((i) => i.counted !== null && Number(i.counted) !== expectedCount(i) && Number(i.quantity) > 0);
    if (!bad.length) return p.hold_note ? "" : "Vehicle number did not match";
    const over = bad.some((i) => Number(i.counted) > expectedCount(i));
    return `${bad.length} line(s) ${over ? "over the pass — cannot be released" : "short"}`;
  };

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title="Gate Pass Approvals"
          description="Passes waiting for a manager, and vehicles the guard held because the count did not match"
          icon={ClipboardCheck}
        />

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-red-700">
              <AlertTriangle className="h-4 w-4" /> Held at gate · {held.length}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {held.length === 0 && <p className="text-sm text-muted-foreground">No vehicle is held.</p>}
            {held.map((p) => (
              <Link key={p.id} to={`/gate-pass/passes/${p.id}`}
                className="block rounded-lg border border-red-200 bg-red-50/60 p-3 hover:bg-red-50">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-semibold">{p.pass_number} · {passTypeMeta(p.pass_type).label} · {p.party_name}</span>
                  <span className="text-xs text-muted-foreground">
                    Held {p.held_at ? format(new Date(p.held_at), "dd MMM HH:mm") : ""} by {p.holder?.full_name ?? "guard"}
                  </span>
                </div>
                <div className="text-sm text-red-800 font-medium mt-1">
                  {shortSummary(p)}{p.hold_note ? ` — ${p.hold_note}` : ""}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Open the pass to release or cancel it.</div>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-amber-700">Pending approval · {pending.length}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!isLoading && pending.length === 0 && <p className="text-sm text-muted-foreground">Nothing waiting for approval.</p>}
            {pending.map((p) => {
              const t = passTypeMeta(p.pass_type);
              return (
                <div key={p.id} className="rounded-lg border p-3 flex flex-col md:flex-row md:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/gate-pass/passes/${p.id}`} className="font-semibold text-primary hover:underline">{p.pass_number}</Link>
                      <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset", t.badgeClass)}>{t.label}</span>
                      <span className="text-sm">{p.party_name}</span>
                    </div>
                    <div className="text-sm text-muted-foreground mt-1 truncate" title={lineSummary(p)}>{lineSummary(p)}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {p.creator?.full_name ?? "—"} · {format(new Date(p.created_at), "dd MMM HH:mm")}
                      {p.remarks ? ` · ${p.remarks}` : ""}
                    </div>
                  </div>
                  {canApprove && (
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" variant="outline" className="text-destructive" onClick={() => { setReason(""); setReject(p); }}>
                        <XCircle className="h-4 w-4 mr-1" /> Reject
                      </Button>
                      <Button size="sm" disabled={review.isPending} onClick={() => review.mutate({ id: p.id, approve: true })}>
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

      <Dialog open={reject !== null} onOpenChange={(o) => { if (!o) setReject(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject {reject?.pass_number}</DialogTitle></DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="gp-reject-reason">Reason *</Label>
            <Textarea id="gp-reject-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReject(null)}>Back</Button>
            <Button variant="destructive" disabled={review.isPending}
              onClick={() => reject && review.mutate({ id: reject.id, approve: false, remarks: reason })}>
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
