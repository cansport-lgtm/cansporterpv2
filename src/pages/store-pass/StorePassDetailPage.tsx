import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import { QRCodeSVG } from "qrcode.react";
import { AlertTriangle, ArrowLeft, CheckCircle2, Pencil, Printer, RefreshCw, Warehouse } from "lucide-react";

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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { photoUrl } from "@/lib/gatePass";
import { statusMeta as gpStatusMeta } from "@/lib/gatePass";
import {
  SP_SELECT, errorMessage, fmtQty, isShort, printStorePass, sortedItems, spDb, spStatusMeta, totals, type StorePass,
} from "@/lib/storePass";

type EventRow = {
  id: string;
  event: string;
  message: string | null;
  created_at: string;
  actor: { full_name: string | null } | null;
};
type GateRow = { dispatch_id: string; gate_pass_id: string; pass_number: string; status: string; gate_out_at: string | null };

const EVENT_LABEL: Record<string, string> = {
  created: "Draft created",
  edited: "Edited",
  issued: "Issued — goods left the store",
  cancelled: "Cancelled",
  refreshed: "Refreshed from dispatches",
};

const fmtDT = (s: string | null) => (s ? format(new Date(s), "dd MMM yyyy, HH:mm") : "—");

export default function StorePassDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, hasModulePermission } = useAuth();
  const canCreate = hasModulePermission("store_pass", "create");
  const canManage = hasModulePermission("store_pass", "approve");
  const qrRef = useRef<HTMLDivElement>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");

  const { data: pass, isLoading } = useQuery<StorePass | null>({
    queryKey: ["store-pass", id],
    queryFn: async () => {
      const { data, error } = await spDb.from("store_passes").select(SP_SELECT).eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: events = [] } = useQuery<EventRow[]>({
    queryKey: ["store-pass-events", id],
    queryFn: async () => {
      const { data, error } = await spDb
        .from("store_pass_events")
        .select("id, event, message, created_at, actor:app_users!store_pass_events_created_by_fkey(full_name)")
        .eq("store_pass_id", id)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  // The gate pass (if any) each of these dispatches travelled on.
  const dispatchIds = (pass?.store_pass_dispatches ?? []).map((d) => d.dispatch_id);
  const { data: gate = [] } = useQuery<GateRow[]>({
    queryKey: ["store-pass-gate", id, dispatchIds],
    enabled: dispatchIds.length > 0,
    queryFn: async () => {
      const { data, error } = await spDb
        .from("v_dispatch_gate_pass")
        .select("dispatch_id, gate_pass_id, pass_number, status, gate_out_at")
        .in("dispatch_id", dispatchIds);
      if (error) return [];
      return data ?? [];
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["store-pass", id] });
    queryClient.invalidateQueries({ queryKey: ["store-pass-events", id] });
    queryClient.invalidateQueries({ queryKey: ["store-passes"] });
    queryClient.invalidateQueries({ queryKey: ["dispatch-store-pass"] });
    queryClient.invalidateQueries({ queryKey: ["store-gate-tracking"] });
  };

  const action = useMutation({
    mutationFn: async ({ fn, args }: { fn: string; args: Record<string, unknown>; done: string }) => {
      const { data, error } = await spDb.rpc(fn, args);
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => {
      toast({ title: v.done });
      setCancelOpen(false);
      setReason("");
      refresh();
    },
    onError: (e) => toast({ title: "Could not complete", description: errorMessage(e), variant: "destructive" }),
  });
  const run = (fn: string, args: Record<string, unknown>, done: string) => action.mutate({ fn, args, done });

  if (isLoading) {
    return <ERPLayout><div className="p-8 text-center text-muted-foreground">Loading…</div></ERPLayout>;
  }
  if (!pass) {
    return <ERPLayout><div className="p-8 text-center text-muted-foreground">Store pass not found.</div></ERPLayout>;
  }

  const items = sortedItems(pass);
  const t = totals(items);
  const status = spStatusMeta(pass.status);
  const isMaker = pass.created_by === user?.id;
  const dispatches = [...(pass.store_pass_dispatches ?? [])].sort((a, b) =>
    (a.sales_dispatches?.dispatch_number ?? "").localeCompare(b.sales_dispatches?.dispatch_number ?? ""));
  const gateOf = new Map(gate.map((g) => [g.dispatch_id, g]));
  const shortLines = items.filter(isShort);
  const isDraft = pass.status === "draft";
  const canEditDraft = isDraft && canCreate && (isMaker || canManage);
  const canCancel = pass.status !== "cancelled" && (canManage || (canCreate && isMaker && isDraft));
  const photo = photoUrl(pass.photo_path);

  const print = () => printStorePass(pass, qrRef.current?.querySelector("svg")?.outerHTML ?? "");

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <Link to="/store-pass/passes" className="text-sm text-primary inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Store Passes
        </Link>
        <PageHeader
          title={pass.pass_number}
          description={`${pass.vehicle_number ?? ""} · ${pass.party_name}`}
          icon={Warehouse}
        >
          <div className="flex flex-wrap gap-2">
            {canEditDraft && (
              <>
                <Button variant="outline" onClick={() => navigate(`/store-pass/edit/${pass.id}`)}>
                  <Pencil className="h-4 w-4 mr-1" /> Edit
                </Button>
                <Button variant="outline" disabled={action.isPending}
                  onClick={() => run("store_pass_refresh", { p_id: pass.id }, "Lines re-read from the dispatches")}>
                  <RefreshCw className="h-4 w-4 mr-1" /> Refresh from dispatches
                </Button>
                <Button disabled={action.isPending} onClick={() => run("store_pass_issue", { p_id: pass.id }, "Store pass issued")}>
                  <CheckCircle2 className="h-4 w-4 mr-1" /> Issue
                </Button>
              </>
            )}
            <Button variant="outline" onClick={print}>
              <Printer className="h-4 w-4 mr-1" /> Print
            </Button>
            {canCancel && (
              <Button variant="ghost" className="text-destructive" onClick={() => setCancelOpen(true)}>
                {isDraft ? "Cancel draft" : "Cancel pass"}
              </Button>
            )}
          </div>
        </PageHeader>

        {pass.status === "cancelled" && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
            <b>Cancelled</b> by {pass.canceller?.full_name ?? "—"} · {fmtDT(pass.cancelled_at)}
            {pass.cancel_reason && <> · {pass.cancel_reason}</>}. Its dispatches are free for a new store pass.
          </div>
        )}
        {pass.status === "issued" && shortLines.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex gap-3 text-sm text-amber-900">
            <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0" />
            <div>
              The store issued less than the dispatch on <b>{shortLines.length} line(s)</b>. The office should correct the dispatch
              to what was issued before the gate pass is made, or the guard will count against the wrong figures.
              Until then this shows as <b>Store ≠ DC</b> in the daily reconciliation.
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4">
          <div className="space-y-4 min-w-0">
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-base">Lines</CardTitle>
                <Badge variant={status.variant}>{status.label}</Badge>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table className="min-w-[760px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Packing</TableHead>
                      <TableHead className="text-right">DC dz</TableHead>
                      <TableHead className="text-right">DC ctn</TableHead>
                      <TableHead className="text-right">Issued dz</TableHead>
                      <TableHead className="text-right">Issued ctn</TableHead>
                      <TableHead>Diff</TableHead>
                      <TableHead>Remark</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dispatches.map((d) => {
                      const lines = items.filter((i) => i.dispatch_id === d.dispatch_id);
                      return (
                        <GroupBlock key={d.dispatch_id} title={d.sales_dispatches?.dispatch_number ?? ""} lines={lines} />
                      );
                    })}
                  </TableBody>
                  <tfoot>
                    <TableRow className="font-semibold">
                      <TableCell colSpan={3}>Totals</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtQty(t.dispatchQuantity)}</TableCell>
                      <TableCell className="text-right tabular-nums">{t.dispatchPackages}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtQty(t.quantity)}</TableCell>
                      <TableCell className="text-right tabular-nums">{t.packages}</TableCell>
                      <TableCell colSpan={2} className={cn("text-sm", t.quantity === t.dispatchQuantity && t.packages === t.dispatchPackages ? "text-emerald-700" : "text-amber-700")}>
                        {t.quantity === t.dispatchQuantity && t.packages === t.dispatchPackages
                          ? "Matches the dispatches"
                          : `${fmtQty(t.quantity - t.dispatchQuantity)} dz · ${t.packages - t.dispatchPackages} ctn`}
                      </TableCell>
                    </TableRow>
                  </tfoot>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Dispatches on this vehicle · and the gate</CardTitle></CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table className="min-w-[640px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dispatch</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Delivery status</TableHead>
                      <TableHead>Gate pass</TableHead>
                      <TableHead>Gate out</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dispatches.map((d) => {
                      const g = gateOf.get(d.dispatch_id);
                      return (
                        <TableRow key={d.dispatch_id}>
                          <TableCell className="font-mono font-semibold">{d.sales_dispatches?.dispatch_number}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {d.sales_dispatches ? format(new Date(d.sales_dispatches.dispatch_date), "dd MMM yyyy") : ""}
                          </TableCell>
                          <TableCell className="text-sm">{d.sales_dispatches?.delivery_status.replace(/_/g, " ")}</TableCell>
                          <TableCell>
                            {g ? (
                              <div>
                                <Link to={`/gate-pass/passes/${g.gate_pass_id}`} className="font-mono text-sm text-primary hover:underline">{g.pass_number}</Link>
                                <div className="text-xs text-muted-foreground">{gpStatusMeta(g.status).label}</div>
                              </div>
                            ) : pass.status === "issued" ? (
                              <span className="text-xs font-medium text-indigo-700">Not yet — goods are between store and gate</span>
                            ) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{g?.gate_out_at ? format(new Date(g.gate_out_at), "dd MMM, HH:mm") : "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Details</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {[
                  ["Date", format(new Date(pass.pass_date), "dd MMM yyyy")],
                  ["Vehicle", pass.vehicle_number || "—"],
                  ["Driver", [pass.driver_name, pass.driver_contact].filter(Boolean).join(" · ") || "—"],
                  ["Customers", pass.party_name],
                  ["Received by", pass.received_by_name || "—"],
                  ["Store location", pass.store_location || "—"],
                  ["Made by", `${pass.creator?.full_name ?? "—"} · ${fmtDT(pass.created_at)}`],
                  ["Issued", pass.issued_at ? `${pass.issuer?.full_name ?? "—"} · ${fmtDT(pass.issued_at)}` : "Not yet"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4">
                    <span className="text-muted-foreground shrink-0">{k}</span>
                    <span className="font-medium text-right break-words">{v}</span>
                  </div>
                ))}
                {pass.remarks && (
                  <div className="pt-2 border-t">
                    <div className="text-muted-foreground text-xs">Remarks</div>
                    <div>{pass.remarks}</div>
                  </div>
                )}
                {photo && (
                  <div className="pt-2 border-t">
                    <div className="text-muted-foreground text-xs mb-1">Photo of the loaded stack</div>
                    <a href={photo} target="_blank" rel="noreferrer">
                      <img src={photo} alt="Loaded stack" className="h-32 w-full rounded-lg object-cover border" />
                    </a>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">History</CardTitle></CardHeader>
              <CardContent>
                <ol className="space-y-3">
                  {events.map((e) => (
                    <li key={e.id} className="text-sm">
                      <div className="font-medium">{EVENT_LABEL[e.event] ?? e.event}</div>
                      <div className="text-xs text-muted-foreground">{e.actor?.full_name ?? "System"} · {fmtDT(e.created_at)}</div>
                      {e.message && <div className="text-xs mt-0.5">{e.message}</div>}
                    </li>
                  ))}
                </ol>
                <p className="text-xs text-muted-foreground border-t pt-2 mt-3">
                  Every change is kept with who did it and when. Cancelling an issued pass needs a store pass manager and a reason.
                </p>
              </CardContent>
            </Card>

            <div ref={qrRef} className="hidden" aria-hidden="true">
              <QRCodeSVG value={pass.pass_number} size={96} level="M" />
            </div>
          </div>
        </div>
      </div>

      <Dialog open={cancelOpen} onOpenChange={(o) => { if (!o) { setCancelOpen(false); setReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {pass.pass_number}</DialogTitle>
            <DialogDescription>
              {isDraft
                ? "The draft is discarded. Its dispatches become free for a new store pass."
                : "The issued pass is voided and stays in the history with your reason. Its dispatches become free for a new store pass; make one if the goods really went."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="sp-cancel-reason">{isDraft ? "Reason (optional)" : "Reason *"}</Label>
            <Textarea id="sp-cancel-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Back</Button>
            <Button variant="destructive" disabled={action.isPending || (!isDraft && !reason.trim())}
              onClick={() => run("store_pass_cancel", { p_id: pass.id, p_reason: reason }, "Store pass cancelled")}>
              Cancel pass
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}

function GroupBlock({ title, lines }: { title: string; lines: StorePass["store_pass_items"] }) {
  return (
    <>
      <TableRow className="bg-muted/40 hover:bg-muted/40">
        <TableCell colSpan={9} className="py-1.5 text-sm font-semibold">{title}</TableCell>
      </TableRow>
      {(lines ?? []).map((i) => {
        const short = isShort(i);
        const dq = Number(i.quantity) - Number(i.dispatch_quantity);
        const dp = Number(i.packages ?? 0) - Number(i.dispatch_packages ?? 0);
        return (
          <TableRow key={i.id} className={cn(short && "bg-amber-50/60")}>
            <TableCell className="text-muted-foreground">{i.line_no}</TableCell>
            <TableCell className="font-medium">{i.description}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{i.packing_type || "—"}</TableCell>
            <TableCell className="text-right tabular-nums">{fmtQty(i.dispatch_quantity)}</TableCell>
            <TableCell className="text-right tabular-nums">{i.dispatch_packages ?? "—"}</TableCell>
            <TableCell className="text-right tabular-nums font-semibold">{fmtQty(i.quantity)}</TableCell>
            <TableCell className="text-right tabular-nums font-semibold">{i.packages ?? "—"}</TableCell>
            <TableCell className={cn("text-sm font-semibold whitespace-nowrap", short ? "text-amber-700" : "text-emerald-700")}>
              {short ? `${fmtQty(dq)} dz · ${dp} ctn` : "0"}
            </TableCell>
            <TableCell className="text-sm">{i.remarks ?? ""}</TableCell>
          </TableRow>
        );
      })}
    </>
  );
}
