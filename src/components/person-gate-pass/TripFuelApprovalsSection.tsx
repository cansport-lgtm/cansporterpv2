import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { CheckCircle2, Fuel, XCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmployeeAvatar } from "@/components/labour/EmployeeAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, fmtDT, hasAnyRole, ppDb } from "@/lib/personGatePass";
import { FUEL_APPROVE_ROLES, FUEL_KEYS, FUEL_SELECT, fmtKm, fmtRs, invalidateTripFuelQueries, type TripFuelVoucher } from "@/lib/tripFuel";

/** Trip fuel claims waiting for the HR manager, on the staff gate pass approvals page. */
export function TripFuelApprovalsSection({ basePath }: { basePath: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { roles } = useAuth();
  const canApprove = hasAnyRole(roles, FUEL_APPROVE_ROLES);
  const [target, setTarget] = useState<TripFuelVoucher | null>(null);
  const [reason, setReason] = useState("");

  const { data: pending = [] } = useQuery<TripFuelVoucher[]>({
    queryKey: [FUEL_KEYS.pending],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await ppDb
        .from("staff_trip_fuel_vouchers")
        .select(FUEL_SELECT)
        .eq("status", "pending_approval")
        .order("created_at");
      if (error) return [];
      return data ?? [];
    },
  });

  const review = useMutation({
    mutationFn: async ({ id, approve, remarks }: { id: string; approve: boolean; remarks?: string }) => {
      const { error } = await ppDb.rpc("staff_trip_fuel_review", { p_id: id, p_approve: approve, p_remarks: remarks ?? null });
      if (error) throw error;
      return approve;
    },
    onSuccess: (approve) => { toast({ title: approve ? "Fuel claim approved" : "Fuel claim rejected" }); setTarget(null); setReason(""); invalidateTripFuelQueries(queryClient); },
    onError: (e) => toast({ title: "Could not complete", description: errorMessage(e), variant: "destructive" }),
  });

  if (pending.length === 0) return null;

  return (
    <Card className="border-amber-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Fuel className="h-4 w-4" /> Trip fuel claims waiting for HR · {pending.length}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {!canApprove && <div className="text-xs text-muted-foreground">Only an HR manager (or a super admin) approves fuel claims.</div>}
        {pending.map((v) => (
          <div key={v.id} className="rounded-lg border p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <EmployeeAvatar name={v.person?.full_name} photoUrl={v.person?.photo_url} className="h-11 w-11" />
                <div className="min-w-0">
                  <div className="font-semibold truncate">
                    <Link to={`${basePath}/${v.pass_id}`} className="hover:underline">{v.voucher_number}</Link> · {v.person?.employee_code} {v.person?.full_name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {v.pass?.pass_number} · {format(new Date(v.trip_date), "dd MMM")}{v.destination ? ` · ${v.destination}` : ""} · claimed by {v.creator?.full_name ?? "—"} · {fmtDT(v.created_at)}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold">{fmtRs(v.amount)}</div>
                <div className="text-xs text-muted-foreground">{fmtKm(v.km)} × Rs {Number(v.rate_per_km).toLocaleString(undefined, { maximumFractionDigits: 2 })}{v.start_km != null ? ` · odometer ${Number(v.start_km).toLocaleString()} → ${Number(v.end_km).toLocaleString()}` : " · km by hand"}</div>
              </div>
            </div>
            <div className="text-sm"><span className="text-muted-foreground">Route:</span> {v.route}{v.notes ? <span className="text-muted-foreground"> · {v.notes}</span> : null}</div>
            {v.odometer_photo_url && <a href={v.odometer_photo_url} target="_blank" rel="noreferrer" className="text-xs underline">Odometer photo</a>}
            {canApprove && (
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="outline" onClick={() => setTarget(v)}><XCircle className="h-4 w-4 mr-1" /> Reject</Button>
                <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800" disabled={review.isPending} onClick={() => review.mutate({ id: v.id, approve: true })}>
                  <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                </Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>

      <Dialog open={target !== null} onOpenChange={(o) => { if (!o) { setTarget(null); setReason(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject {target?.voucher_number}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="tfv-reject-reason">Reason</Label>
            <Textarea id="tfv-reject-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>Back</Button>
            <Button variant="destructive" disabled={!reason.trim() || review.isPending} onClick={() => target && review.mutate({ id: target.id, approve: false, remarks: reason })}>Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
