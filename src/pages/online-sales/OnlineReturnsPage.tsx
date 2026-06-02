import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { RotateCcw, Plus, Search, ScanLine, CheckCircle2, XCircle, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { QRScannerDialog } from "@/components/fixed-assets/QRScannerDialog";

type ReceiveLogEntry = {
  code: string;
  order_number?: string;
  customer_name?: string;
  status: "received" | "already_returned" | "not_found" | "not_dispatchable";
  at: Date;
};

const RETURN_REASONS = ["Damaged in transit", "Wrong product", "Size mismatch", "Quality issue", "Customer changed mind", "Not as described", "RTO - Undelivered", "Other"];

export default function OnlineReturnsPage() {
  const { user } = useAuth();
  const [returns, setReturns] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [returnAwaitedOrders, setReturnAwaitedOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("awaiting");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannedCodes, setScannedCodes] = useState<string[]>([]);
  const [quickInput, setQuickInput] = useState("");
  const [recentReceives, setRecentReceives] = useState<ReceiveLogEntry[]>([]);
  const quickInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    order_id: "",
    return_date: format(new Date(), "yyyy-MM-dd"),
    return_reason: "",
    refund_amount: "",
    remarks: "",
  });

  useEffect(() => { fetchData(); }, []);
  useEffect(() => {
    // Focus the quick-receive input as soon as the page mounts so scanners and
    // typed input work without an extra click.
    quickInputRef.current?.focus();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const [rRes, oRes, raRes] = await Promise.all([
      supabase.from("online_returns").select("*, online_orders(order_number, customer_name, platform, order_value, tracking_number)").order("created_at", { ascending: false }),
      supabase.from("online_orders").select("id, order_number, customer_name, order_value, tracking_number").in("status", ["sent_to_courier", "dispatched", "delivered", "return_awaited"]),
      supabase.from("online_orders").select("*").eq("status", "return_awaited").order("created_at", { ascending: false }),
    ]);
    setReturns(rRes.data || []);
    setOrders(oRes.data || []);
    setReturnAwaitedOrders(raRes.data || []);
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!form.order_id || !form.return_reason) { toast.error("Order and reason required"); return; }
    const { error } = await supabase.from("online_returns").insert({
      return_number: "",
      order_id: form.order_id,
      return_date: form.return_date,
      return_reason: form.return_reason,
      refund_amount: parseFloat(form.refund_amount) || 0,
      remarks: form.remarks || null,
      created_by: user?.id || null,
    });
    if (error) { toast.error(error.message); return; }
    await supabase.from("online_orders").update({ status: "returned" }).eq("id", form.order_id);
    toast.success("Return logged & order marked as returned");
    setIsDialogOpen(false);
    setForm({ order_id: "", return_date: format(new Date(), "yyyy-MM-dd"), return_reason: "", refund_amount: "", remarks: "" });
    fetchData();
  };

  const updateRefundStatus = async (id: string, status: string) => {
    await supabase.from("online_returns").update({ refund_status: status }).eq("id", id);
    toast.success(`Refund status updated to ${status}`);
    fetchData();
  };

  const markReceived = async (id: string) => {
    await supabase.from("online_returns").update({ received_back: true, received_date: format(new Date(), "yyyy-MM-dd") }).eq("id", id);
    toast.success("Return received");
    fetchData();
  };

  // Lookup an order by any identifier the user might scan/type:
  // tracking_number, online_dispatches.awb_number, online_dispatches.dispatch_number,
  // online_orders.order_number, or platform_order_id.
  const lookupOrder = async (code: string) => {
    const direct = await supabase
      .from("online_orders")
      .select("id, order_number, customer_name, order_value, status, tracking_number")
      .or(`tracking_number.eq.${code},order_number.eq.${code},platform_order_id.eq.${code}`)
      .limit(2);
    if (direct.data && direct.data.length === 1) return direct.data[0];
    if (direct.data && direct.data.length > 1) return { __multiple: true } as const;

    const viaDispatch = await supabase
      .from("online_dispatches")
      .select("id, awb_number, dispatch_number, online_orders(id, order_number, customer_name, order_value, status, tracking_number)")
      .or(`awb_number.eq.${code},dispatch_number.eq.${code}`)
      .limit(2);
    if (viaDispatch.data && viaDispatch.data.length === 1) {
      return (viaDispatch.data[0] as any).online_orders;
    }
    if (viaDispatch.data && viaDispatch.data.length > 1) return { __multiple: true } as const;

    return null;
  };

  // Single entry point — handles both keyboard input and QR scanner.
  const quickReceive = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;

    const found = await lookupOrder(trimmed);

    if (!found) {
      toast.error(`No order found for "${trimmed}"`);
      setRecentReceives(prev => [{ code: trimmed, status: "not_found", at: new Date() }, ...prev].slice(0, 10));
      return;
    }
    if ((found as any).__multiple) {
      toast.info(`Multiple matches for "${trimmed}" — open Log Return and pick the right one`);
      return;
    }

    const order = found as { id: string; order_number: string; customer_name: string; order_value: number | null; status: string | null };

    if (order.status === "returned") {
      toast.info(`Already returned: ${order.order_number}`);
      setRecentReceives(prev => [
        { code: trimmed, order_number: order.order_number, customer_name: order.customer_name, status: "already_returned", at: new Date() },
        ...prev,
      ].slice(0, 10));
      return;
    }

    const receivableStatuses = ["sent_to_courier", "dispatched", "delivered", "return_awaited"];
    if (!order.status || !receivableStatuses.includes(order.status)) {
      toast.error(`Cannot receive ${order.order_number}: status is "${order.status ?? "unknown"}"`);
      setRecentReceives(prev => [
        { code: trimmed, order_number: order.order_number, customer_name: order.customer_name, status: "not_dispatchable", at: new Date() },
        ...prev,
      ].slice(0, 10));
      return;
    }

    // If a return record already exists, mark it received; otherwise create one.
    const { data: existing } = await supabase
      .from("online_returns")
      .select("id, received_back")
      .eq("order_id", order.id)
      .limit(1);

    if (existing && existing.length > 0) {
      const ret = existing[0];
      if (!ret.received_back) {
        const { error } = await supabase
          .from("online_returns")
          .update({ received_back: true, received_date: format(new Date(), "yyyy-MM-dd") })
          .eq("id", ret.id);
        if (error) { toast.error(error.message); return; }
      }
    } else {
      const { error: retErr } = await supabase.from("online_returns").insert({
        return_number: "",
        order_id: order.id,
        return_date: format(new Date(), "yyyy-MM-dd"),
        return_reason: "RTO - Undelivered",
        refund_amount: order.order_value || 0,
        remarks: `Auto-received via ${trimmed}`,
        received_back: true,
        received_date: format(new Date(), "yyyy-MM-dd"),
        created_by: user?.id || null,
      });
      if (retErr) { toast.error(retErr.message); return; }
    }

    await supabase.from("online_orders").update({ status: "returned" }).eq("id", order.id);
    toast.success(`Received: ${order.order_number} — ${order.customer_name}`);
    setRecentReceives(prev => [
      { code: trimmed, order_number: order.order_number, customer_name: order.customer_name, status: "received", at: new Date() },
      ...prev,
    ].slice(0, 10));
    fetchData();
  };

  const handleScanForReturn = async (scannedCode: string) => {
    const trimmed = scannedCode.trim();
    setScannedCodes(prev => [...prev, trimmed]);
    setIsScannerOpen(false);
    await quickReceive(trimmed);
    quickInputRef.current?.focus();
  };

  const handleQuickSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = quickInput;
    setQuickInput("");
    await quickReceive(code);
    quickInputRef.current?.focus();
  };

  const filteredReturns = returns.filter(r => {
    if (!search) return true;
    const s = search.toLowerCase();
    return r.return_number?.toLowerCase().includes(s) || r.online_orders?.customer_name?.toLowerCase().includes(s) || r.online_orders?.order_number?.toLowerCase().includes(s);
  });

  const filteredAwaiting = returnAwaitedOrders.filter(o => {
    if (!search) return true;
    const s = search.toLowerCase();
    return o.order_number?.toLowerCase().includes(s) || o.customer_name?.toLowerCase().includes(s) || o.tracking_number?.toLowerCase().includes(s);
  });

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Returns" description="Track return parcels & receive them physically" icon={RotateCcw} iconColor="bg-red-600 text-white" action={{ label: "Log Return", onClick: () => setIsDialogOpen(true), icon: Plus }} />

        <Card className="border-2 border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <PackageCheck className="h-5 w-5 text-primary" /> Quick Receive
            </CardTitle>
            <p className="text-sm text-muted-foreground">Scan the parcel barcode or type the tracking / AWB / order number, then press Enter.</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleQuickSubmit} className="flex flex-col sm:flex-row gap-2">
              <Input
                ref={quickInputRef}
                value={quickInput}
                onChange={e => setQuickInput(e.target.value)}
                placeholder="Tracking #, AWB, or order #"
                className="flex-1 text-lg h-12 font-mono"
                autoFocus
              />
              <Button type="submit" size="lg" className="gap-2" disabled={!quickInput.trim()}>
                <CheckCircle2 className="h-5 w-5" /> Receive
              </Button>
              <Button type="button" size="lg" variant="outline" className="gap-2" onClick={() => setIsScannerOpen(true)}>
                <ScanLine className="h-5 w-5" /> Scan
              </Button>
            </form>

            {recentReceives.length > 0 && (
              <div className="mt-4 border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">Recent activity</p>
                <ul className="space-y-1.5 max-h-48 overflow-y-auto">
                  {recentReceives.map((r, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      {r.status === "received" && <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />}
                      {r.status === "already_returned" && <CheckCircle2 className="h-4 w-4 text-muted-foreground shrink-0" />}
                      {(r.status === "not_found" || r.status === "not_dispatchable") && <XCircle className="h-4 w-4 text-red-600 shrink-0" />}
                      <span className="font-mono text-xs">{r.code}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="truncate">
                        {r.status === "received" && <>Received: {r.order_number} — {r.customer_name}</>}
                        {r.status === "already_returned" && <>Already returned: {r.order_number}</>}
                        {r.status === "not_found" && <>Not found</>}
                        {r.status === "not_dispatchable" && <>{r.order_number}: not dispatchable</>}
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground shrink-0">{format(r.at, "HH:mm:ss")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search returns..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="awaiting">
              Awaiting Return ({returnAwaitedOrders.length})
            </TabsTrigger>
            <TabsTrigger value="processed">
              Processed Returns ({returns.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="awaiting">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order #</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Tracking #</TableHead>
                      <TableHead>Platform</TableHead>
                      <TableHead>City</TableHead>
                      <TableHead className="text-right">Value (₹)</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
                    ) : filteredAwaiting.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No return-awaited parcels</TableCell></TableRow>
                    ) : filteredAwaiting.map(o => (
                      <TableRow key={o.id}>
                        <TableCell className="font-medium">{o.order_number}</TableCell>
                        <TableCell>{o.customer_name}</TableCell>
                        <TableCell className="font-mono text-xs">{o.tracking_number || "-"}</TableCell>
                        <TableCell>{o.platform}</TableCell>
                        <TableCell>{o.city || "-"}</TableCell>
                        <TableCell className="text-right font-medium">{(o.order_value || 0).toLocaleString()}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="border-orange-500 text-orange-700 bg-orange-50">return awaited</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="processed">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Return #</TableHead>
                      <TableHead>Order #</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead className="text-right">Refund (₹)</TableHead>
                      <TableHead>Refund Status</TableHead>
                      <TableHead>Received</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
                    ) : filteredReturns.length === 0 ? (
                      <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No returns found</TableCell></TableRow>
                    ) : filteredReturns.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.return_number}</TableCell>
                        <TableCell>{r.online_orders?.order_number}</TableCell>
                        <TableCell>{r.online_orders?.customer_name}</TableCell>
                        <TableCell>{format(new Date(r.return_date), "dd MMM yyyy")}</TableCell>
                        <TableCell className="text-sm">{r.return_reason}</TableCell>
                        <TableCell className="text-right font-medium">{(r.refund_amount || 0).toLocaleString()}</TableCell>
                        <TableCell>
                          <Badge variant={r.refund_status === "refunded" ? "default" : r.refund_status === "rejected" ? "destructive" : "secondary"}>{r.refund_status}</Badge>
                        </TableCell>
                        <TableCell>
                          {r.received_back ? (
                            <Badge variant="default">Yes</Badge>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => markReceived(r.id)}>Mark Received</Button>
                          )}
                        </TableCell>
                        <TableCell>
                          {r.refund_status === "pending" && (
                            <div className="flex gap-1">
                              <Button size="sm" variant="outline" onClick={() => updateRefundStatus(r.id, "refunded")}>Refund</Button>
                              <Button size="sm" variant="ghost" onClick={() => updateRefundStatus(r.id, "rejected")}>Reject</Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log Return</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Order *</Label>
              <Select value={form.order_id} onValueChange={v => setForm(p => ({ ...p, order_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select order" /></SelectTrigger>
                <SelectContent>
                  {orders.map(o => <SelectItem key={o.id} value={o.id}>{o.order_number} - {o.customer_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Return Date</Label>
              <Input type="date" value={form.return_date} onChange={e => setForm(p => ({ ...p, return_date: e.target.value }))} />
            </div>
            <div>
              <Label>Return Reason *</Label>
              <Select value={form.return_reason} onValueChange={v => setForm(p => ({ ...p, return_reason: v }))}>
                <SelectTrigger><SelectValue placeholder="Select reason" /></SelectTrigger>
                <SelectContent>{RETURN_REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Refund Amount (₹)</Label>
              <Input type="number" value={form.refund_amount} onChange={e => setForm(p => ({ ...p, refund_amount: e.target.value }))} />
            </div>
            <div>
              <Label>Remarks</Label>
              <Textarea value={form.remarks} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate}>Log Return</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <QRScannerDialog
        open={isScannerOpen}
        onOpenChange={setIsScannerOpen}
        onAssetScanned={handleScanForReturn}
        scannedCodes={scannedCodes}
      />
    </ERPLayout>
  );
}
