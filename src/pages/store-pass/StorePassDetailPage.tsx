import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import { QRCodeSVG } from "qrcode.react";
import { AlertTriangle, ArrowLeft, CheckCircle2, Link2, Pencil, Printer, Warehouse } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { photoUrl, statusMeta as gpStatusMeta } from "@/lib/gatePass";
import {
  canLinkStorePass,
  SP_SELECT, errorMessage, fmtQty, printStorePass, sortedItems, spDb, spStatusMeta, totals, type StorePass,
} from "@/lib/storePass";

type EventRow = { id: string; event: string; message: string | null; created_at: string; actor: { full_name: string | null } | null };
type GateRow = { dispatch_id: string; gate_pass_id: string; pass_number: string; status: string; gate_out_at: string | null };
type OrderRef = { order_number: string; customers: { name: string } | null } | null;
type DispatchRow = {
  id: string; dispatch_number: string; dispatch_date: string; delivery_status: string;
  sales_orders: OrderRef; sales_dispatch_orders: { sales_orders: OrderRef }[];
  sales_dispatch_items: { quantity_dozens: number; packages: number | null }[];
};

const EVENT_LABEL: Record<string, string> = {
  created: "Draft created",
  edited: "Edited",
  issued: "Issued — goods handed over",
  cancelled: "Cancelled",
  linked: "Dispatch link changed",
  refreshed: "Refreshed from dispatches",
};
const fmtDT = (s: string | null) => (s ? format(new Date(s), "dd MMM yyyy, HH:mm") : "—");
const customersOf = (d: DispatchRow) => {
  const list = [d.sales_orders, ...d.sales_dispatch_orders.map((o) => o.sales_orders)].filter(Boolean) as NonNullable<OrderRef>[];
  return [...new Set(list.map((o) => o.customers?.name).filter(Boolean))].join("; ");
};

export default function StorePassDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, roles, hasModulePermission } = useAuth();
  const canCreate = hasModulePermission("store_pass", "create");
  const canManage = hasModulePermission("store_pass", "approve");
  const canLink = canLinkStorePass(roles); // the dispatch operator, not the store keeper
  const qrRef = useRef<HTMLDivElement>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkIds, setLinkIds] = useState<string[]>([]);

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
  const dispatchIds = useMemo(() => (pass?.store_pass_dispatches ?? []).map((d) => d.dispatch_id), [pass]);
  const { data: gate = [] } = useQuery<GateRow[]>({
    queryKey: ["store-pass-gate", id, dispatchIds],
    enabled: dispatchIds.length > 0,
    queryFn: async () => {
      const { data, error } = await spDb.from("v_dispatch_gate_pass").select("dispatch_id, gate_pass_id, pass_number, status, gate_out_at").in("dispatch_id", dispatchIds);
      if (error) return [];
      return data ?? [];
    },
  });
  // Candidates for the link dialog: recent domestic dispatches not on another live pass.
  const { data: candidates = [] } = useQuery<DispatchRow[]>({
    queryKey: ["store-pass-link-candidates"],
    enabled: linkOpen,
    queryFn: async () => {
      const { data, error } = await spDb
        .from("sales_dispatches")
        .select("id, dispatch_number, dispatch_date, delivery_status, sales_orders(order_number, customers(name)), sales_dispatch_orders(sales_orders(order_number, customers(name))), sales_dispatch_items(quantity_dozens, packages)")
        .eq("sales_segment", "domestic")
        .order("dispatch_date", { ascending: false })
        .limit(150);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: taken = [] } = useQuery<{ dispatch_id: string; store_pass_id: string; pass_number: string }[]>({
    queryKey: ["dispatch-store-pass"],
    enabled: linkOpen,
    queryFn: async () => {
      const { data, error } = await spDb.from("v_dispatch_store_pass").select("dispatch_id, store_pass_id, pass_number");
      if (error) throw error;
      return data ?? [];
    },
  });
  const takenBy = useMemo(() => {
    const m = new Map<string, string>();
    taken.filter((t) => t.store_pass_id !== id).forEach((t) => m.set(t.dispatch_id, t.pass_number));
    return m;
  }, [taken, id]);

  const refresh = () => {
    ["store-passes", "dispatch-store-pass", "store-gate-tracking", "store-gate-recon"].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
    queryClient.invalidateQueries({ queryKey: ["store-pass", id] });
    queryClient.invalidateQueries({ queryKey: ["store-pass-events", id] });
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
      setLinkOpen(false);
      setReason("");
      refresh();
    },
    onError: (e) => toast({ title: "Could not complete", description: errorMessage(e), variant: "destructive" }),
  });
  const run = (fn: string, args: Record<string, unknown>, done: string) => action.mutate({ fn, args, done });

  if (isLoading) return <ERPLayout><div className="p-8 text-center text-muted-foreground">Loading…</div></ERPLayout>;
  if (!pass) return <ERPLayout><div className="p-8 text-center text-muted-foreground">Store pass not found.</div></ERPLayout>;

  const items = sortedItems(pass);
  const t = totals(items);
  const status = spStatusMeta(pass.status);
  const isMaker = pass.created_by === user?.id;
  const dispatches = [...(pass.store_pass_dispatches ?? [])].sort((a, b) => (a.sales_dispatches?.dispatch_number ?? "").localeCompare(b.sales_dispatches?.dispatch_number ?? ""));
  const gateOf = new Map(gate.map((g) => [g.dispatch_id, g]));
  const isDraft = pass.status === "draft";
  const canEditDraft = isDraft && canCreate && (isMaker || canManage);
  const canCancel = pass.status !== "cancelled" && (canManage || (canCreate && isMaker && isDraft));
  const photo = photoUrl(pass.photo_path);
  const unlinked = pass.status === "issued" && dispatches.length === 0;

  const print = () => printStorePass(pass, qrRef.current?.querySelector("svg")?.outerHTML ?? "");
  const openLink = () => { setLinkIds(dispatchIds); setLinkOpen(true); };

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <Link to="/store-pass/passes" className="text-sm text-primary inline-flex items-center gap-1"><ArrowLeft className="h-4 w-4" /> Store Passes</Link>
        <PageHeader title={pass.pass_number} description={`Plan ${pass.dispatch_plan_no ?? "—"} · handed over to ${pass.received_by_name ?? "—"}`} icon={Warehouse}>
          <div className="flex flex-wrap gap-2">
            {canEditDraft && (
              <>
                <Button variant="outline" onClick={() => navigate(`/store-pass/edit/${pass.id}`)}><Pencil className="h-4 w-4 mr-1" /> Edit</Button>
                <Button disabled={action.isPending} onClick={() => run("store_pass_issue", { p_id: pass.id }, "Store pass issued")}><CheckCircle2 className="h-4 w-4 mr-1" /> Issue</Button>
              </>
            )}
            {canLink && pass.status !== "cancelled" && (
              <Button variant={unlinked ? "default" : "outline"} onClick={openLink}><Link2 className="h-4 w-4 mr-1" /> {dispatches.length ? "Change linked dispatches" : "Link to dispatch"}</Button>
            )}
            <Button variant="outline" onClick={print}><Printer className="h-4 w-4 mr-1" /> Print</Button>
            {canCancel && <Button variant="ghost" className="text-destructive" onClick={() => setCancelOpen(true)}>{isDraft ? "Cancel draft" : "Cancel pass"}</Button>}
          </div>
        </PageHeader>

        {pass.status === "cancelled" && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
            <b>Cancelled</b> by {pass.canceller?.full_name ?? "—"} · {fmtDT(pass.cancelled_at)}{pass.cancel_reason && <> · {pass.cancel_reason}</>}.
          </div>
        )}
        {unlinked && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex gap-3 text-sm text-amber-900">
            <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0" />
            <div>This pass is not linked to any system dispatch, so the daily reconciliation cannot compare it with the dispatch or the gate yet. {canLink ? "Link it to the dispatch it went on." : "The dispatch operator links it from the Domestic Dispatch page once the dispatch sheet is made."}</div>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4">
          <div className="space-y-4 min-w-0">
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-base">Items handed over</CardTitle>
                <Badge variant={status.variant}>{status.label}</Badge>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table className="min-w-[560px]">
                  <TableHeader>
                    <TableRow><TableHead className="w-10">#</TableHead><TableHead>Item</TableHead><TableHead>Product</TableHead><TableHead className="text-right">Dozens</TableHead><TableHead className="text-right">Cartons</TableHead><TableHead>Remark</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell className="text-muted-foreground">{i.line_no}</TableCell>
                        <TableCell className="font-medium">{i.description}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{i.products ? `${i.products.code} · ${i.products.name}` : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">{fmtQty(i.quantity)}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">{i.packages ?? "—"}</TableCell>
                        <TableCell className="text-sm">{i.remarks ?? ""}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <tfoot>
                    <TableRow className="font-semibold">
                      <TableCell colSpan={3}>Total</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtQty(t.quantity)}</TableCell>
                      <TableCell className="text-right tabular-nums">{t.packages}</TableCell>
                      <TableCell />
                    </TableRow>
                  </tfoot>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Linked dispatches · and the gate</CardTitle></CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                {dispatches.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">Not linked to a system dispatch.</p>
                ) : (
                  <Table className="min-w-[640px]">
                    <TableHeader>
                      <TableRow><TableHead>Dispatch</TableHead><TableHead>Date</TableHead><TableHead>Delivery status</TableHead><TableHead>Gate pass</TableHead><TableHead>Gate out</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {dispatches.map((d) => {
                        const g = gateOf.get(d.dispatch_id);
                        return (
                          <TableRow key={d.dispatch_id}>
                            <TableCell className="font-mono font-semibold">{d.sales_dispatches?.dispatch_number}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{d.sales_dispatches ? format(new Date(d.sales_dispatches.dispatch_date), "dd MMM yyyy") : ""}</TableCell>
                            <TableCell className="text-sm">{d.sales_dispatches?.delivery_status.replace(/_/g, " ")}</TableCell>
                            <TableCell>
                              {g ? (
                                <div><Link to={`/gate-pass/passes/${g.gate_pass_id}`} className="font-mono text-sm text-primary hover:underline">{g.pass_number}</Link><div className="text-xs text-muted-foreground">{gpStatusMeta(g.status).label}</div></div>
                              ) : pass.status === "issued" ? <span className="text-xs font-medium text-indigo-700">Not yet — goods are between store and gate</span> : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{g?.gate_out_at ? format(new Date(g.gate_out_at), "dd MMM, HH:mm") : "—"}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Details</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {[
                  ["Date", format(new Date(pass.pass_date), "dd MMM yyyy")],
                  ["Dispatch plan no.", pass.dispatch_plan_no || "—"],
                  ["Handed over to", pass.received_by_name || "—"],
                  ["Made by", `${pass.creator?.full_name ?? "—"} · ${fmtDT(pass.created_at)}`],
                  ["Issued", pass.issued_at ? `${pass.issuer?.full_name ?? "—"} · ${fmtDT(pass.issued_at)}` : "Not yet"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4"><span className="text-muted-foreground shrink-0">{k}</span><span className="font-medium text-right break-words">{v}</span></div>
                ))}
                {pass.remarks && <div className="pt-2 border-t"><div className="text-muted-foreground text-xs">Remarks</div><div>{pass.remarks}</div></div>}
                <div className="pt-2 border-t">
                  <div className="text-muted-foreground text-xs mb-1">Stock at the loading dock</div>
                  {photo ? (
                    <a href={photo} target="_blank" rel="noreferrer"><img src={photo} alt="Stock at the loading dock" className="w-full rounded-lg object-cover border max-h-64" /></a>
                  ) : <div className={cn("text-sm", isDraft ? "text-amber-700" : "text-muted-foreground")}>{isDraft ? "No photo yet — needed to issue." : "No photo."}</div>}
                </div>
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
              </CardContent>
            </Card>

            <div ref={qrRef} className="hidden" aria-hidden="true"><QRCodeSVG value={pass.pass_number} size={96} level="M" /></div>
          </div>
        </div>
      </div>

      <Dialog open={cancelOpen} onOpenChange={(o) => { if (!o) { setCancelOpen(false); setReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {pass.pass_number}</DialogTitle>
            <DialogDescription>{isDraft ? "The draft is discarded." : "The issued pass is voided and stays in the history with your reason. Make a new one if the goods really went."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="sp-cancel-reason">{isDraft ? "Reason (optional)" : "Reason *"}</Label>
            <Textarea id="sp-cancel-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Back</Button>
            <Button variant="destructive" disabled={action.isPending || (!isDraft && !reason.trim())} onClick={() => run("store_pass_cancel", { p_id: pass.id, p_reason: reason }, "Store pass cancelled")}>Cancel pass</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={linkOpen} onOpenChange={(o) => { if (!o) setLinkOpen(false); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Link {pass.pass_number} to system dispatches</DialogTitle>
            <DialogDescription>Tick the dispatch(es) these goods went on. Tracking and the daily reconciliation then compare this pass with the dispatch and the gate. A dispatch can be on one live store pass only.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-auto border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow><TableHead className="w-10" /><TableHead>Dispatch</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">Dz / Ctn</TableHead><TableHead>Status</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {candidates.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : candidates.map((d) => {
                  const onPass = takenBy.get(d.id);
                  const checked = linkIds.includes(d.id);
                  return (
                    <TableRow key={d.id} className={cn(onPass && !checked && "opacity-60", checked && "bg-primary/5")}>
                      <TableCell><Checkbox aria-label={`Link ${d.dispatch_number}`} checked={checked} disabled={Boolean(onPass) && !checked}
                        onCheckedChange={(v) => setLinkIds((prev) => (v === true ? [...prev, d.id] : prev.filter((x) => x !== d.id)))} /></TableCell>
                      <TableCell className="font-mono text-sm font-semibold">{d.dispatch_number}</TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{format(new Date(d.dispatch_date), "dd MMM")}</TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate" title={customersOf(d)}>{customersOf(d)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm whitespace-nowrap">{fmtQty(d.sales_dispatch_items.reduce((s, i) => s + Number(i.quantity_dozens), 0))} / {d.sales_dispatch_items.reduce((s, i) => s + Number(i.packages ?? 0), 0)}</TableCell>
                      <TableCell className="text-xs">{onPass ? <span className="text-red-700 font-medium">On {onPass}</span> : d.delivery_status.replace(/_/g, " ")}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)}>Back</Button>
            <Button disabled={action.isPending} onClick={() => run("store_pass_link_dispatches", { p_id: pass.id, p_dispatch_ids: linkIds }, linkIds.length ? "Dispatches linked" : "Links removed")}>
              Save links ({linkIds.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
