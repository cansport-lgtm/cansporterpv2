import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { QRCodeSVG } from "qrcode.react";
import { Pencil, Printer, Truck } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, gpDb, type GatePass } from "@/lib/gatePass";
import {
  VOUCHER_SELECT, fmtRs, modeLabel, payerLabel, printFreightVoucher, voucherStatusMeta,
  type FreightVoucher, type GatePassFreight,
} from "@/lib/gatePassFreight";
import { FreightSection, emptyFreight, freightFromRow, freightPayload, type FreightFormState } from "./FreightSection";

const fmtDate = (s: string | null | undefined) => (s ? format(new Date(s), "dd MMM yyyy") : "—");

/** Freight on a sales pass: what the office recorded, and the voucher made at gate out. */
export function FreightCard({ pass }: { pass: GatePass }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, roles, hasModulePermission } = useAuth();
  const canOffice = hasModulePermission("gate_pass", "create");
  const canManage = hasModulePermission("gate_pass", "approve");
  const canPay = roles.some((r) => ["super_admin", "gate_pass_manager", "pettycash_handler", "accounting_poster", "accounting_officer", "accounting_manager"].includes(r.role));
  const qrRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FreightFormState>(emptyFreight());
  const [reason, setReason] = useState("");

  const { data: freight, isLoading } = useQuery<GatePassFreight | null>({
    queryKey: ["gate-pass-freight", pass.id],
    queryFn: async () => {
      const { data, error } = await gpDb.from("gate_pass_freight").select("*").eq("gate_pass_id", pass.id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const { data: vouchers = [] } = useQuery<FreightVoucher[]>({
    queryKey: ["gate-pass-freight-vouchers", "pass", pass.id],
    queryFn: async () => {
      const { data, error } = await gpDb.from("gate_pass_freight_vouchers").select(VOUCHER_SELECT)
        .eq("gate_pass_id", pass.id).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const live = vouchers.find((v) => v.status !== "cancelled");
  const cancelled = vouchers.filter((v) => v.status === "cancelled");

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await gpDb.rpc("gate_pass_freight_save", {
        p_pass_id: pass.id, p_data: freightPayload(form, { reason }),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Freight saved" });
      setOpen(false);
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["gate-pass-freight", pass.id] });
      queryClient.invalidateQueries({ queryKey: ["gate-pass-freight-vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["gate-pass-freight-log"] });
      queryClient.invalidateQueries({ queryKey: ["gate-pass-events", pass.id] });
      queryClient.invalidateQueries({ queryKey: ["gate-pass-transporters"] });
    },
    onError: (e) => toast({ title: "Could not save", description: errorMessage(e), variant: "destructive" }),
  });

  if (pass.pass_type !== "sales") return null;
  const isOut = pass.status === "out";
  const isMaker = pass.created_by === user?.id;
  const canEdit = isOut
    ? canManage
    : canOffice && (isMaker || canManage) && ["draft", "approved", "held"].includes(pass.status);

  const print = () => {
    if (!live) return;
    printFreightVoucher(live, qrRef.current?.querySelector("svg")?.outerHTML ?? "");
  };

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base flex items-center gap-2"><Truck className="h-4 w-4" /> Freight</CardTitle>
        <div className="flex gap-2">
          {live && (
            <Button size="sm" variant="outline" onClick={print}><Printer className="h-4 w-4 mr-1" /> Voucher</Button>
          )}
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => { setForm(freightFromRow(freight)); setOpen(true); }}>
              <Pencil className="h-4 w-4 mr-1" /> {freight ? "Change" : "Record freight"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : !freight ? (
          <p className="text-amber-700">
            Freight not recorded on this pass{isOut ? " — no voucher was made at gate out." : ". A sales pass cannot be submitted without it."}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <span className="text-muted-foreground">Who pays</span><span className="font-medium text-right">{payerLabel(freight.payer)}</span>
            {freight.payer === "company" && (
              <>
                <span className="text-muted-foreground">Mode</span><span className="font-medium text-right">{modeLabel(freight.mode)}</span>
                <span className="text-muted-foreground">Transporter</span><span className="font-medium text-right">{freight.transporter_name}</span>
                <span className="text-muted-foreground">Amount</span><span className="font-semibold text-right">{fmtRs(freight.amount)}</span>
                {freight.booking_ref && (<><span className="text-muted-foreground">Ride ref</span><span className="font-medium text-right">{freight.booking_ref}</span></>)}
              </>
            )}
            {freight.note && (<><span className="text-muted-foreground">Note</span><span className="text-right">{freight.note}</span></>)}
          </div>
        )}

        {freight?.payer === "company" && isOut && !live && (
          <p className="text-amber-700">No live voucher for this pass{cancelled.length ? ` (${cancelled.length} cancelled)` : ""}. {canManage ? "Use Change to make one." : "Ask a gate pass manager."}</p>
        )}

        {live && (
          <div className="rounded-lg border p-3 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono font-semibold">{live.voucher_number}</span>
              <Badge variant={voucherStatusMeta(live.status).variant}>{voucherStatusMeta(live.status).label}</Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              {fmtDate(live.voucher_date)} · {fmtRs(live.amount)} to {live.transporter_name}
              {live.status === "paid" && ` · paid ${fmtDate(live.paid_date)}${live.payer_user?.full_name ? ` by ${live.payer_user.full_name}` : ""}${live.gate_pass_freight_statements?.statement_number ? ` on ${live.gate_pass_freight_statements.statement_number}` : ""}`}
            </div>
            {canPay && live.status === "unpaid" && (
              <Link to={`/gate-pass/freight?voucher=${live.id}`} className="text-xs text-primary hover:underline">Open in Freight Vouchers to mark paid</Link>
            )}
          </div>
        )}
        {cancelled.map((v) => (
          <div key={v.id} className="text-xs text-muted-foreground">
            {v.voucher_number} cancelled {fmtDate(v.cancelled_at)}: {v.cancel_reason}
          </div>
        ))}
        <div ref={qrRef} className="hidden" aria-hidden="true">
          {live && <QRCodeSVG value={live.voucher_number} size={80} level="M" />}
        </div>
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => { if (!o) setOpen(false); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Freight on {pass.pass_number}</DialogTitle>
            <DialogDescription>
              {isOut
                ? "The vehicle has left. Changing the freight corrects the unpaid voucher, makes one if there is none, or cancels it when the customer paid. A paid voucher must be cancelled first."
                : "Who pays for the vehicle, and how much. The voucher is made when the guard lets the vehicle out."}
            </DialogDescription>
          </DialogHeader>
          <FreightSection value={form} onChange={setForm} asCard={false} idPrefix="gp-frd" />
          {isOut && (
            <div className="space-y-1">
              <Label htmlFor="gp-frd-reason">Reason *</Label>
              <Textarea id="gp-frd-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Back</Button>
            <Button disabled={save.isPending} onClick={() => save.mutate()}>Save freight</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
