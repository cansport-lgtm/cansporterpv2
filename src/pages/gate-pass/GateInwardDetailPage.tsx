import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft, Camera, ClipboardCheck, LogOut, PackageCheck, Pencil, Printer, Truck, XCircle,
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
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { GuardShell } from "@/components/gate-pass/GuardShell";
import { useGuardOnly } from "@/hooks/useGuardOnly";
import { errorMessage, photoUrl } from "@/lib/gatePass";
import {
  INWARD_EVENT_LABEL, canInwardGate, canInwardOffice, canInwardPurchasePages, fmtInAt, giDb, inwardReference,
  inwardStatusMeta, kindMeta, printInwardSlip, type InwardEntry, type InwardEvent,
} from "@/lib/gateInward";

type DialogKind = null | "reject" | "cancel" | "close";

/** One inward entry. Mounted at /gate-pass/inward/:id (gate) and /purchase/gate-inward/:id (office). */
export default function GateInwardDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, roles } = useAuth();
  const guardOnly = useGuardOnly();
  const officeView = location.pathname.startsWith("/purchase");
  const isGate = canInwardGate(roles);
  const isOffice = canInwardOffice(roles);
  const qrRef = useRef<HTMLDivElement>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [reason, setReason] = useState("");

  const { data: entry, isLoading } = useQuery<InwardEntry | null>({
    queryKey: ["gate-inward", id],
    queryFn: async () => {
      const { data, error } = await giDb.from("v_gate_inward_register").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const { data: events = [] } = useQuery<InwardEvent[]>({
    queryKey: ["gate-inward-events", id],
    queryFn: async () => {
      const { data, error } = await giDb
        .from("gate_inward_events")
        .select("id, event, message, created_at, actor:app_users!gate_inward_events_created_by_fkey(full_name)")
        .eq("entry_id", id)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["gate-inward"] });
    queryClient.invalidateQueries({ queryKey: ["gate-inward-events", id] });
    queryClient.invalidateQueries({ queryKey: ["gate-check-inward"] });
  };

  const action = useMutation({
    mutationFn: async ({ fn, args }: { fn: string; args: Record<string, unknown>; done: string }) => {
      const { data, error } = await giDb.rpc(fn, args);
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => {
      toast({ title: v.done });
      setDialog(null);
      setReason("");
      refresh();
    },
    onError: (e) => toast({ title: "Could not complete", description: errorMessage(e), variant: "destructive" }),
  });
  const run = (fn: string, args: Record<string, unknown>, done: string) => action.mutate({ fn, args, done });

  const Shell = ({ children }: { children: React.ReactNode }) =>
    guardOnly ? <GuardShell title="Inward Entry">{children}</GuardShell> : <ERPLayout>{children}</ERPLayout>;

  if (isLoading) {
    return <Shell><div className="p-8 text-center text-muted-foreground">Loading…</div></Shell>;
  }
  if (!entry) {
    return <Shell><div className="p-8 text-center text-muted-foreground">Inward entry not found.</div></Shell>;
  }

  const kind = kindMeta(entry.entry_kind);
  const status = inwardStatusMeta(entry.status);
  const ref = inwardReference(entry);
  const isMaker = entry.created_by === user?.id;
  const atGate = entry.status === "at_gate";
  const canEdit = atGate && (isOffice || (isGate && isMaker));
  const canCancel = atGate && (isOffice || (isGate && isMaker));
  const canReject = atGate && isOffice;
  const canClose = atGate && isOffice && ["sample", "other", "loading_vehicle"].includes(entry.entry_kind);
  const canVehicleOut = !entry.vehicle_out_at && (isGate || isOffice);
  const canMakeGrn = atGate && entry.entry_kind === "purchase" && canInwardPurchasePages(roles);
  const passReturn = entry.entry_kind === "returnable_return" || entry.entry_kind === "job_work_return";
  const backTo = officeView ? "/purchase/gate-inward" : "/gate-pass/check";
  const backLabel = officeView ? "Gate Inward Register" : "Gate Check";

  const print = () => printInwardSlip(entry, qrRef.current?.querySelector("svg")?.outerHTML ?? "");

  const facts: [string, React.ReactNode][] = [
    ["Type", kind.label],
    ["In at", fmtInAt(entry.in_at)],
    ["From", entry.party_name],
    ...(entry.entry_kind === "purchase" ? [["Purchase order", entry.po_number ?? "—"] as [string, React.ReactNode]] : []),
    ...(passReturn ? [["Gate pass", entry.pass_number
      ? <Link to={`/gate-pass/passes/${entry.gate_pass_id}`} className="text-primary hover:underline">{entry.pass_number}</Link>
      : "—"] as [string, React.ReactNode]] : []),
    ["Vehicle", entry.vehicle_number],
    ["Driver", [entry.driver_name, entry.driver_contact].filter(Boolean).join(" · ") || "—"],
    ["Transporter", entry.transporter_name || "—"],
    ["Challan / bilty", entry.challan_number ? `${entry.challan_number}${entry.challan_date ? ` · ${format(new Date(entry.challan_date), "dd MMM yyyy")}` : ""}` : "—"],
    ["Packages", entry.packages_count ?? "—"],
    ["Gross weight", entry.gross_weight_kg != null ? `${entry.gross_weight_kg} kg` : "—"],
    ["Recorded by", `${entry.created_by_name ?? "—"} · ${fmtInAt(entry.created_at)}`],
    ...(entry.vehicle_out_at ? [["Vehicle left", `${entry.vehicle_out_by_name ?? ""} · ${fmtInAt(entry.vehicle_out_at)}`] as [string, React.ReactNode]] : []),
    ...(entry.grn_number ? [["GRN", `${entry.grn_number}${entry.grn_date ? ` · ${format(new Date(entry.grn_date), "dd MMM yyyy")}` : ""}`] as [string, React.ReactNode]] : []),
    ...(entry.receipt_number ? [["Receipt", `${entry.receipt_number}${entry.receipt_date ? ` · ${format(new Date(entry.receipt_date), "dd MMM yyyy")}` : ""}`] as [string, React.ReactNode]] : []),
    ...(entry.status === "closed" ? [["Closed", `${fmtInAt(entry.closed_at)}${entry.close_note ? ` · ${entry.close_note}` : ""}`] as [string, React.ReactNode]] : []),
    ...(entry.rejected_at ? [["Rejected", `${fmtInAt(entry.rejected_at)}${entry.reject_reason ? ` · ${entry.reject_reason}` : ""}`] as [string, React.ReactNode]] : []),
    ...(entry.cancelled_at ? [["Cancelled", `${fmtInAt(entry.cancelled_at)}${entry.cancel_reason ? ` · ${entry.cancel_reason}` : ""}`] as [string, React.ReactNode]] : []),
  ];

  const challanUrl = photoUrl(entry.challan_photo_path);
  const vehicleUrl = photoUrl(entry.vehicle_photo_path);

  const actions = (
    <div className="flex flex-wrap gap-2">
      {canVehicleOut && (
        <Button disabled={action.isPending} onClick={() => run("gate_inward_vehicle_out", { p_id: entry.id }, "Vehicle left — recorded")}>
          <LogOut className="h-4 w-4 mr-1" /> Vehicle left
        </Button>
      )}
      {canMakeGrn && (
        <Button onClick={() => navigate(`/purchase/grn?gin=${entry.id}`)}>
          <ClipboardCheck className="h-4 w-4 mr-1" /> Make GRN
        </Button>
      )}
      {atGate && passReturn && isOffice && entry.gate_pass_id && (
        <Button onClick={() => navigate(`/gate-pass/passes/${entry.gate_pass_id}`)}>
          <PackageCheck className="h-4 w-4 mr-1" /> Receive goods on {entry.pass_number}
        </Button>
      )}
      {canEdit && (
        <Button variant="outline" onClick={() => navigate(`/gate-pass/inward/edit/${entry.id}`)}>
          <Pencil className="h-4 w-4 mr-1" /> Edit
        </Button>
      )}
      <Button variant="outline" onClick={print}><Printer className="h-4 w-4 mr-1" /> Print slip</Button>
      {canClose && <Button variant="outline" onClick={() => setDialog("close")}>Close with a note</Button>}
      {canReject && (
        <Button variant="outline" className="text-destructive" onClick={() => setDialog("reject")}>
          <XCircle className="h-4 w-4 mr-1" /> Reject vehicle
        </Button>
      )}
      {canCancel && <Button variant="ghost" className="text-destructive" onClick={() => setDialog("cancel")}>Cancel entry</Button>}
    </div>
  );

  return (
    <Shell>
      <div className={cn("w-full max-w-full overflow-x-hidden space-y-4", guardOnly && "space-y-3")}>
        <Link to={backTo} className="text-sm text-primary inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> {backLabel}
        </Link>
        {guardOnly ? (
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-display text-2xl font-bold">{entry.entry_number}</div>
              <div className="text-sm text-muted-foreground">{kind.label} · {entry.party_name}</div>
            </div>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
        ) : (
          <PageHeader title={entry.entry_number} description={`${kind.label} · ${entry.party_name}${ref ? ` · ${ref}` : ""}`} icon={Truck}>
            {actions}
          </PageHeader>
        )}

        {atGate && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            At the gate{entry.is_stale ? <b> for {entry.age_days} days</b> : null} — not yet received by the store.
            {entry.entry_kind === "purchase" ? " The GRN for this PO closes it." : passReturn ? ` "Receive goods" on ${entry.pass_number ?? "the pass"} closes it.` : ` Closed by ${kind.closedBy}.`}
          </div>
        )}
        {entry.status === "rejected" && (
          <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            <b>Rejected</b>{entry.reject_reason ? `: ${entry.reject_reason}` : ""}. The vehicle was turned away.
          </div>
        )}

        <div className={cn("grid gap-4", !guardOnly && "grid-cols-1 xl:grid-cols-[1fr_340px]")}>
          <div className="space-y-4 min-w-0">
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-base">Details</CardTitle>
                {!guardOnly && <Badge variant={status.variant}>{status.label}</Badge>}
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {facts.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4">
                    <span className="text-muted-foreground shrink-0">{k}</span>
                    <span className="font-medium text-right break-words">{v}</span>
                  </div>
                ))}
                {entry.remarks && (
                  <div className="pt-2 border-t">
                    <div className="text-muted-foreground text-xs">Remarks</div>
                    <div>{entry.remarks}</div>
                  </div>
                )}
              </CardContent>
            </Card>

            {(challanUrl || vehicleUrl) && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Camera className="h-4 w-4" /> Photos</CardTitle></CardHeader>
                <CardContent className="flex flex-wrap gap-3">
                  {challanUrl && (
                    <a href={challanUrl} target="_blank" rel="noreferrer" className="space-y-1">
                      <img src={challanUrl} alt="Challan" className="h-40 w-40 rounded-lg object-cover border" />
                      <div className="text-xs text-center text-muted-foreground">Challan</div>
                    </a>
                  )}
                  {vehicleUrl && (
                    <a href={vehicleUrl} target="_blank" rel="noreferrer" className="space-y-1">
                      <img src={vehicleUrl} alt="Vehicle" className="h-40 w-40 rounded-lg object-cover border" />
                      <div className="text-xs text-center text-muted-foreground">Vehicle</div>
                    </a>
                  )}
                </CardContent>
              </Card>
            )}

            {guardOnly && <div className="sticky bottom-0 bg-background/95 backdrop-blur py-3">{actions}</div>}
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">History</CardTitle></CardHeader>
              <CardContent>
                <ol className="space-y-3">
                  {events.map((e) => (
                    <li key={e.id} className="text-sm">
                      <div className="font-medium">{INWARD_EVENT_LABEL[e.event] ?? e.event}</div>
                      <div className="text-xs text-muted-foreground">{e.actor?.full_name ?? "System"} · {fmtInAt(e.created_at)}</div>
                      {e.message && <div className="text-xs mt-0.5">{e.message}</div>}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
            <div ref={qrRef} className="hidden" aria-hidden="true">
              <QRCodeSVG value={entry.entry_number} size={96} level="M" />
            </div>
          </div>
        </div>
      </div>

      <Dialog open={dialog !== null} onOpenChange={(o) => { if (!o) { setDialog(null); setReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === "reject" ? `Reject ${entry.entry_number}` : dialog === "cancel" ? `Cancel ${entry.entry_number}` : `Close ${entry.entry_number}`}
            </DialogTitle>
            <DialogDescription>
              {dialog === "reject" ? "The vehicle is turned away. The guard who made the entry is told why."
                : dialog === "cancel" ? "For an entry made by mistake. It stays in the register as cancelled."
                : "Note who received the goods. Nothing is counted into stock."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="gi-dialog-reason">{dialog === "close" ? "Received by / note *" : "Reason *"}</Label>
            <Textarea id="gi-dialog-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Back</Button>
            <Button variant={dialog === "close" ? "default" : "destructive"} disabled={action.isPending || !reason.trim()}
              onClick={() => {
                if (dialog === "reject") run("gate_inward_reject", { p_id: entry.id, p_reason: reason }, "Vehicle rejected");
                if (dialog === "cancel") run("gate_inward_cancel", { p_id: entry.id, p_reason: reason }, "Entry cancelled");
                if (dialog === "close") run("gate_inward_close", { p_id: entry.id, p_note: reason }, "Entry closed");
              }}>
              {dialog === "reject" ? "Reject" : dialog === "cancel" ? "Cancel entry" : "Close"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Shell>
  );
}
