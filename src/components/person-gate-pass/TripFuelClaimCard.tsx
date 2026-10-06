import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fuel, Loader2, Printer, Upload, X, CheckCircle2, XCircle, Banknote } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { errorMessage, fmtDT, hasAnyRole, ppDb, type PersonGatePass, type PersonPassVariant } from "@/lib/personGatePass";
import {
  FUEL_APPROVE_ROLES, FUEL_KEYS, FUEL_PAY_ROLES, fmtKm, fmtRs, fuelStatusMeta, invalidateTripFuelQueries, printTripFuelVoucher,
  useLastEndKm, useTripFuelSettings, useTripFuelVoucher, type TripFuelVoucher,
} from "@/lib/tripFuel";

type EventRow = { id: string; event: string; message: string | null; created_at: string; actor: { full_name: string | null } | null };

const EVENT_LABEL: Record<string, string> = {
  claimed: "Claimed", approved: "Approved by HR", rejected: "Rejected", paid: "Paid by cashier", cancelled: "Cancelled",
};

type DialogKind = null | "approve" | "reject" | "pay" | "cancel";

/**
 * Trip fuel on an official duty staff pass: the claim form (route, odometer or
 * kilometres, optional photo) and, once claimed, the voucher with HR approval,
 * cashier payment, cancel and print. Shown on the pass page once the trip is over.
 */
export function TripFuelClaimCard({ variant, pass }: { variant: PersonPassVariant; pass: PersonGatePass }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, roles } = useAuth();
  const self = Boolean(variant.selfService);
  const canClaim = self || hasAnyRole(roles, variant.applyRoles);
  const canApprove = hasAnyRole(roles, FUEL_APPROVE_ROLES);
  const canPay = hasAnyRole(roles, FUEL_PAY_ROLES);
  const { data: voucher, isLoading } = useTripFuelVoucher(pass.id);
  const { data: settings } = useTripFuelSettings();
  const { data: lastEndKm } = useLastEndKm(voucher ? undefined : pass.employee_id);

  const [mode, setMode] = useState<"odometer" | "manual">("odometer");
  const [route, setRoute] = useState(pass.destination ?? "");
  const [startKm, setStartKm] = useState("");
  const [endKm, setEndKm] = useState("");
  const [manualKm, setManualKm] = useState("");
  const [notes, setNotes] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [remarks, setRemarks] = useState("");

  const { data: events = [] } = useQuery<EventRow[]>({
    queryKey: [FUEL_KEYS.events, voucher?.id],
    enabled: Boolean(voucher?.id),
    queryFn: async () => {
      const { data, error } = await ppDb
        .from("staff_trip_fuel_events")
        .select("id, event, message, created_at, actor:app_users!staff_trip_fuel_events_created_by_fkey(full_name)")
        .eq("voucher_id", voucher!.id)
        .order("created_at");
      if (error) return [];
      return data ?? [];
    },
  });

  const rate = Number(settings?.fuel_rate_per_km ?? 0);
  const maxKm = Number(settings?.fuel_max_km_per_trip ?? 300);
  const km = useMemo(() => {
    if (mode === "odometer") {
      const s = Number(startKm), e = Number(endKm);
      return startKm && endKm && e > s ? Math.round((e - s) * 10) / 10 : 0;
    }
    const m = Number(manualKm);
    return manualKm && m > 0 ? Math.round(m * 10) / 10 : 0;
  }, [mode, startKm, endKm, manualKm]);
  const amount = Math.round(km * rate);
  const startBelowLast = mode === "odometer" && lastEndKm != null && startKm !== "" && Number(startKm) < lastEndKm;

  const tripOver = pass.pass_kind === "official_duty" && ["returned", "not_returned"].includes(pass.status) && Boolean(pass.gate_out_at);

  const uploadPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast({ title: "Please choose an image", variant: "destructive" }); return; }
    if (file.size > 4 * 1024 * 1024) { toast({ title: "Image must be smaller than 4 MB", variant: "destructive" }); return; }
    try {
      setUploading(true);
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${pass.pass_number}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("trip-odometer-photos").upload(path, file, { cacheControl: "3600", upsert: true });
      if (error) throw error;
      setPhotoUrl(supabase.storage.from("trip-odometer-photos").getPublicUrl(path).data.publicUrl);
    } catch (err) {
      toast({ title: "Photo upload failed", description: errorMessage(err), variant: "destructive" });
    } finally {
      setUploading(false);
      if (photoRef.current) photoRef.current.value = "";
    }
  };

  const claim = useMutation({
    mutationFn: async () => {
      const { data, error } = await ppDb.rpc("staff_trip_fuel_claim", {
        p_pass_id: pass.id,
        p_route: route,
        p_start_km: mode === "odometer" ? Number(startKm) : null,
        p_end_km: mode === "odometer" ? Number(endKm) : null,
        p_manual_km: mode === "manual" ? Number(manualKm) : null,
        p_photo_url: photoUrl || null,
        p_notes: notes || null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast({ title: "Fuel claim sent to HR", description: "The HR manager has been notified. Once approved, collect the cash from the cashier with the voucher." });
      invalidateTripFuelQueries(queryClient);
    },
    onError: (e) => toast({ title: "Could not claim", description: errorMessage(e), variant: "destructive" }),
  });

  const action = useMutation({
    mutationFn: async ({ fn, args }: { fn: string; args: Record<string, unknown>; done: string }) => {
      const { error } = await ppDb.rpc(fn, args);
      if (error) throw error;
    },
    onSuccess: (_d, v) => { toast({ title: v.done }); setDialog(null); setRemarks(""); invalidateTripFuelQueries(queryClient); },
    onError: (e) => toast({ title: "Could not complete", description: errorMessage(e), variant: "destructive" }),
  });

  const title = (
    <CardTitle className="text-base flex items-center gap-2"><Fuel className="h-4 w-4" /> Trip fuel</CardTitle>
  );

  if (pass.pass_kind !== "official_duty" || isLoading) return null;

  // ---- Existing voucher ---------------------------------------------------------
  if (voucher) {
    const v: TripFuelVoucher = voucher;
    const status = fuelStatusMeta(v.status);
    const isMaker = v.created_by === user?.id;
    const canCancel = ["pending_approval", "approved"].includes(v.status) && (canApprove || isMaker);
    const dialogMeta: Record<Exclude<DialogKind, null>, { title: string; description: string; needReason: boolean; fn: string; args: Record<string, unknown>; done: string; destructive?: boolean }> = {
      approve: { title: "Approve this fuel claim?", description: `${fmtRs(v.amount)} for ${fmtKm(v.km)}. The staff member collects the cash from the cashier with the voucher.`, needReason: false, fn: "staff_trip_fuel_review", args: { p_id: v.id, p_approve: true, p_remarks: remarks || null }, done: "Approved" },
      reject: { title: "Reject this fuel claim", description: "The claimant will be told, with your reason.", needReason: true, fn: "staff_trip_fuel_review", args: { p_id: v.id, p_approve: false, p_remarks: remarks }, done: "Rejected", destructive: true },
      pay: { title: "Mark paid", description: `Confirm that ${fmtRs(v.amount)} was handed over in cash against ${v.voucher_number}.`, needReason: false, fn: "staff_trip_fuel_pay", args: { p_id: v.id, p_remarks: remarks || null }, done: "Marked paid" },
      cancel: { title: "Cancel this voucher", description: "It can no longer be approved or paid. The pass can be claimed again.", needReason: true, fn: "staff_trip_fuel_cancel", args: { p_id: v.id, p_reason: remarks }, done: "Cancelled", destructive: true },
    };
    return (
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 space-y-0">
          {title}
          <div className="flex flex-wrap gap-2 items-center">
            <Badge variant={status.variant}>{status.label}</Badge>
            <Button variant="outline" size="sm" onClick={() => printTripFuelVoucher(v, pass)}><Printer className="h-4 w-4 mr-1" /> Print voucher</Button>
            {canApprove && v.status === "pending_approval" && (
              <>
                <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800" onClick={() => setDialog("approve")}><CheckCircle2 className="h-4 w-4 mr-1" /> Approve</Button>
                <Button size="sm" variant="destructive" onClick={() => setDialog("reject")}><XCircle className="h-4 w-4 mr-1" /> Reject</Button>
              </>
            )}
            {canPay && v.status === "approved" && (
              <Button size="sm" onClick={() => setDialog("pay")}><Banknote className="h-4 w-4 mr-1" /> Mark paid</Button>
            )}
            {canCancel && <Button size="sm" variant="outline" onClick={() => setDialog("cancel")}><XCircle className="h-4 w-4 mr-1" /> Cancel</Button>}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <div className="font-mono font-bold text-lg">{v.voucher_number}</div>
            <div className="text-2xl font-bold">{fmtRs(v.amount)}</div>
            <div className="text-sm text-muted-foreground">{fmtKm(v.km)} × Rs {Number(v.rate_per_km).toLocaleString(undefined, { maximumFractionDigits: 2 })} / km</div>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Route / areas</dt><dd className="font-medium">{v.route}</dd>
            <dt className="text-muted-foreground">Kilometres</dt>
            <dd>{v.start_km != null ? `Odometer ${Number(v.start_km).toLocaleString()} → ${Number(v.end_km).toLocaleString()}` : "Entered by hand"}</dd>
            <dt className="text-muted-foreground">Claimed by</dt><dd>{v.creator?.full_name ?? "—"} · {fmtDT(v.created_at)}</dd>
            <dt className="text-muted-foreground">{v.status === "rejected" ? "Rejected by" : "Approved by"}</dt>
            <dd>{v.approver?.full_name ?? "—"}{v.approved_at ? ` · ${fmtDT(v.approved_at)}` : ""}{v.approval_remarks ? ` — ${v.approval_remarks}` : ""}</dd>
            {v.paid_at && <><dt className="text-muted-foreground">Paid by</dt><dd>{v.payer?.full_name ?? "cashier"} · {fmtDT(v.paid_at)}{v.paid_remarks ? ` — ${v.paid_remarks}` : ""}</dd></>}
            {v.cancelled_at && <><dt className="text-muted-foreground">Cancelled</dt><dd>{fmtDT(v.cancelled_at)} — {v.cancel_reason}</dd></>}
            {v.notes && <><dt className="text-muted-foreground">Notes</dt><dd>{v.notes}</dd></>}
          </dl>
          {v.odometer_photo_url && (
            <a href={v.odometer_photo_url} target="_blank" rel="noreferrer" className="inline-block">
              <img src={v.odometer_photo_url} alt="Odometer" className="h-24 rounded border object-cover" />
            </a>
          )}
          {v.status === "approved" && (
            <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
              Approved. {self ? "Print or show this voucher to the cashier to collect the cash." : "The staff member collects the cash from the cashier against this voucher."}
            </div>
          )}
          {events.length > 0 && (
            <ol className="space-y-1 text-xs text-muted-foreground border-t pt-2">
              {events.map((ev) => (
                <li key={ev.id} className="flex flex-wrap gap-x-2">
                  <span className="whitespace-nowrap w-24">{fmtDT(ev.created_at)}</span>
                  <span className="font-semibold text-foreground">{EVENT_LABEL[ev.event] ?? ev.event}</span>
                  {ev.message && <span>{ev.message}</span>}
                  {ev.actor?.full_name && <span>by {ev.actor.full_name}</span>}
                </li>
              ))}
            </ol>
          )}
        </CardContent>

        <Dialog open={dialog !== null} onOpenChange={(o) => { if (!o) { setDialog(null); setRemarks(""); } }}>
          {dialog && (
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{dialogMeta[dialog].title}</DialogTitle>
                <DialogDescription>{dialogMeta[dialog].description}</DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="tfv-remarks">{dialogMeta[dialog].needReason ? "Reason" : "Remarks (optional)"}</Label>
                <Textarea id="tfv-remarks" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialog(null)}>Back</Button>
                <Button variant={dialogMeta[dialog].destructive ? "destructive" : "default"}
                  disabled={action.isPending || (dialogMeta[dialog].needReason && !remarks.trim())}
                  onClick={() => action.mutate({ fn: dialogMeta[dialog].fn, args: dialogMeta[dialog].args, done: dialogMeta[dialog].done })}>
                  {dialogMeta[dialog].title.replace("?", "")}
                </Button>
              </DialogFooter>
            </DialogContent>
          )}
        </Dialog>
      </Card>
    );
  }

  // ---- No voucher yet -------------------------------------------------------------
  if (!tripOver) {
    return (
      <Card>
        <CardHeader className="pb-2">{title}</CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Trip fuel can be claimed here once the pass has been scanned Out and In at the gate.
        </CardContent>
      </Card>
    );
  }
  if (!canClaim) return null;

  const ready = route.trim().length > 0 && km > 0 && km <= maxKm && rate > 0 && !claim.isPending;

  return (
    <Card>
      <CardHeader className="pb-2">{title}</CardHeader>
      <CardContent className="space-y-4">
        {rate <= 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            The fuel rate per km is not set yet. A super admin sets it on Expenses → Trip Fuel Vouchers.
          </div>
        )}
        <div>
          <Label htmlFor="tfv-route">Route / areas travelled</Label>
          <Input id="tfv-route" value={route} onChange={(e) => setRoute(e.target.value)} placeholder="e.g. Factory → Shah Alam market → Bank Alfalah Ferozepur Rd → Factory" />
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="How the kilometres are given">
          {([["odometer", "Bike odometer"], ["manual", "Kilometres run"]] as const).map(([m, label]) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m}
              className={cn("h-9 rounded-md text-sm font-semibold transition-colors", mode === m ? "bg-background shadow" : "text-muted-foreground")}
              onClick={() => setMode(m)}>
              {label}
            </button>
          ))}
        </div>

        {mode === "odometer" ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="tfv-start">Start reading (km)</Label>
              <Input id="tfv-start" type="number" inputMode="decimal" min={0} step="0.1" value={startKm} onChange={(e) => setStartKm(e.target.value)} placeholder={lastEndKm != null ? String(lastEndKm) : ""} />
              {lastEndKm != null && <p className="text-[11px] text-muted-foreground mt-1">Last claimed end reading: {Number(lastEndKm).toLocaleString()} km</p>}
            </div>
            <div>
              <Label htmlFor="tfv-end">End reading (km)</Label>
              <Input id="tfv-end" type="number" inputMode="decimal" min={0} step="0.1" value={endKm} onChange={(e) => setEndKm(e.target.value)} />
            </div>
          </div>
        ) : (
          <div className="max-w-xs">
            <Label htmlFor="tfv-manual">Kilometres run</Label>
            <Input id="tfv-manual" type="number" inputMode="decimal" min={0} step="0.1" value={manualKm} onChange={(e) => setManualKm(e.target.value)} />
          </div>
        )}
        {startBelowLast && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            The start reading is below the last claimed end reading ({Number(lastEndKm).toLocaleString()} km). Check the odometer; HR will see this too.
          </div>
        )}
        {km > maxKm && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-2 text-xs text-red-900">
            A single trip cannot exceed {maxKm} km. Check the readings or ask HR.
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <Label htmlFor="tfv-notes">Notes (optional)</Label>
            <Textarea id="tfv-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="sm:w-56">
            <Label>Odometer photo (optional)</Label>
            <div className="flex items-center gap-2 mt-1">
              <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={uploadPhoto} />
              <Button type="button" variant="outline" size="sm" onClick={() => photoRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />} {photoUrl ? "Change" : "Add photo"}
              </Button>
              {photoUrl && <Button type="button" variant="ghost" size="sm" onClick={() => setPhotoUrl("")}><X className="h-3.5 w-3.5" /></Button>}
            </div>
            {photoUrl && <img src={photoUrl} alt="Odometer" className="mt-2 h-16 rounded border object-cover" />}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <div className="text-sm">
            <span className="text-muted-foreground">Distance</span> <b>{km ? fmtKm(km) : "—"}</b>
            <span className="text-muted-foreground"> · Rate</span> <b>Rs {rate.toLocaleString(undefined, { maximumFractionDigits: 2 })} / km</b>
            <span className="text-muted-foreground"> · Amount</span> <b className="text-lg">{km ? fmtRs(amount) : "—"}</b>
          </div>
          <Button disabled={!ready} onClick={() => claim.mutate()} className={variant.accentButton}>
            {claim.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Fuel className="h-4 w-4 mr-2" />} Claim trip fuel
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">The HR manager approves the claim. Once approved, the voucher is printed and the cash is collected from the cashier.</p>
      </CardContent>
    </Card>
  );
}
