import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addHours, format } from "date-fns";
import { CheckCircle2, Clock, Siren, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { emergencyValid, errorMessage, gpDb, hoursClosed, useGateHours, type GatePass } from "@/lib/gatePass";

const fmtDT = (s: string | null | undefined) => (s ? format(new Date(s), "dd MMM yyyy, HH:mm") : "—");

/** Status line for an after-hours (emergency) pass; null when the pass has none. */
export function EmergencyBadge({ pass }: { pass: Pick<GatePass, "emergency_status" | "emergency_valid_until"> }) {
  if (!pass.emergency_status) return null;
  const label = pass.emergency_status === "requested" ? "Emergency · waiting for super admin"
    : pass.emergency_status === "rejected" ? "Emergency rejected"
    : emergencyValid(pass) ? `Emergency · valid until ${format(new Date(pass.emergency_valid_until!), "dd MMM HH:mm")}`
    : "Emergency approval expired";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset whitespace-nowrap",
      pass.emergency_status === "approved" && emergencyValid(pass) ? "bg-red-600 text-white ring-red-700" : "bg-red-50 text-red-800 ring-red-200")}>
      <Siren className="h-3 w-3" /> {label}
    </span>
  );
}

/**
 * After-hours handling on a pass: the officer asks for emergency approval, a super admin
 * approves until a time they choose, or rejects. Shows the decision once made.
 */
export function EmergencyPanel({ pass, onDone }: { pass: GatePass; onDone?: () => void }) {
  const { roles, hasModulePermission } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: hours } = useGateHours();
  const isSuperAdmin = roles.some((r) => r.role === "super_admin");
  const canCreate = hasModulePermission("gate_pass", "create");
  const [dialog, setDialog] = useState<null | "request" | "approve" | "reject">(null);
  const [text, setText] = useState("");
  const [until, setUntil] = useState("");

  const createClosed = hoursClosed(hours, pass.pass_type, "create");
  const gateClosed = hoursClosed(hours, pass.pass_type, "gate");
  const canRequest = canCreate && pass.emergency_status !== "requested" && (
    (pass.status === "draft" && !!createClosed) ||
    (["approved", "held"].includes(pass.status) && !!gateClosed && !emergencyValid(pass))
  );
  const canDecide = isSuperAdmin && pass.emergency_status === "requested";

  const act = useMutation({
    mutationFn: async ({ fn, args }: { fn: string; args: Record<string, unknown>; done: string }) => {
      const { error } = await gpDb.rpc(fn, args);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast({ title: v.done });
      setDialog(null);
      setText("");
      ["gate-pass", "gate-pass-events", "gate-passes", "gate-passes-live", "gate-pass-approvals"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }));
      onDone?.();
    },
    onError: (e) => toast({ title: "Could not complete", description: errorMessage(e), variant: "destructive" }),
  });

  if (!pass.emergency_status && !canRequest) return null;

  const openApprove = () => {
    setUntil(format(addHours(new Date(), 2), "yyyy-MM-dd'T'HH:mm"));
    setText("");
    setDialog("approve");
  };

  return (
    <div className="rounded-xl border-2 border-red-300 bg-red-50 p-3 text-sm text-red-900 space-y-2">
      <div className="flex items-center gap-2 font-semibold text-red-800">
        <Siren className="h-4 w-4" /> After hours / emergency
      </div>

      {canRequest && (
        <p className="flex gap-2"><Clock className="h-4 w-4 shrink-0 mt-0.5" />
          {pass.status === "draft" ? createClosed : gateClosed} A super admin can give emergency approval.
        </p>
      )}

      {pass.emergency_status && (
        <div className="space-y-1">
          <div><span className="text-red-700">Reason:</span> <b>{pass.emergency_reason}</b></div>
          <div className="text-xs">Asked by {pass.emergency_requester?.full_name ?? "—"} · {fmtDT(pass.emergency_requested_at)}</div>
          {pass.emergency_status === "requested" && <div className="font-semibold">Waiting for a super admin.</div>}
          {pass.emergency_status === "approved" && (
            <div className={cn("font-semibold", !emergencyValid(pass) && "line-through")}>
              Approved by {pass.emergency_decider?.full_name ?? "super admin"} · may leave until {fmtDT(pass.emergency_valid_until)}
              {pass.emergency_remarks ? ` — ${pass.emergency_remarks}` : ""}
            </div>
          )}
          {pass.emergency_status === "approved" && !emergencyValid(pass) && <div className="font-semibold">This approval has expired.</div>}
          {pass.emergency_status === "rejected" && (
            <div className="font-semibold">Rejected by {pass.emergency_decider?.full_name ?? "super admin"}{pass.emergency_remarks ? `: ${pass.emergency_remarks}` : ""}</div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {canRequest && (
          <Button size="sm" variant="destructive" onClick={() => { setText(""); setDialog("request"); }}>
            <Siren className="h-4 w-4 mr-1" /> Request emergency approval
          </Button>
        )}
        {canDecide && (
          <>
            <Button size="sm" variant="outline" className="text-destructive bg-white" onClick={() => { setText(""); setDialog("reject"); }}>
              <XCircle className="h-4 w-4 mr-1" /> Reject
            </Button>
            <Button size="sm" onClick={openApprove}>
              <CheckCircle2 className="h-4 w-4 mr-1" /> Approve emergency
            </Button>
          </>
        )}
      </div>

      <Dialog open={dialog !== null} onOpenChange={(o) => { if (!o) setDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === "request" ? `Emergency approval for ${pass.pass_number}`
                : dialog === "approve" ? `Approve ${pass.pass_number} after hours` : `Reject emergency for ${pass.pass_number}`}
            </DialogTitle>
            <DialogDescription>
              {dialog === "request" ? "Super admins are notified. The pass cannot leave until one approves."
                : dialog === "approve" ? "The guard can let it out only until the time you set. After that it is held again."
                : "The pass will not leave after hours."}
            </DialogDescription>
          </DialogHeader>
          {dialog === "approve" && (
            <div className="space-y-1">
              <Label htmlFor="em-until">May leave until *</Label>
              <Input id="em-until" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
              <p className="text-xs text-muted-foreground">At most 24 hours from now.</p>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="em-text">{dialog === "request" ? "Why must this go now? *" : dialog === "reject" ? "Reason *" : "Remarks (optional)"}</Label>
            <Textarea id="em-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Back</Button>
            <Button
              variant={dialog === "approve" ? "default" : "destructive"}
              disabled={act.isPending || (dialog !== "approve" && !text.trim()) || (dialog === "approve" && !until)}
              onClick={() => {
                if (dialog === "request") act.mutate({ fn: "gate_pass_request_emergency", args: { p_id: pass.id, p_reason: text }, done: "Emergency request sent" });
                if (dialog === "approve") act.mutate({ fn: "gate_pass_emergency_review", args: { p_id: pass.id, p_approve: true, p_valid_until: new Date(until).toISOString(), p_remarks: text }, done: "Emergency approved" });
                if (dialog === "reject") act.mutate({ fn: "gate_pass_emergency_review", args: { p_id: pass.id, p_approve: false, p_valid_until: null, p_remarks: text }, done: "Emergency rejected" });
              }}
            >
              {dialog === "request" ? "Send request" : dialog === "approve" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
