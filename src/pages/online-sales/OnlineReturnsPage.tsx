import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { RotateCcw, Plus, Search, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { QRScannerDialog } from "@/components/fixed-assets/QRScannerDialog";

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
  const [form, setForm] = useState({
    order_id: "",
    return_date: format(new Date(), "yyyy-MM-dd"),
    return_reason: "",
    refund_amount: "",
    remarks: "",
  });

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    const [rRes, oRes, raRes] = await Promise.all([
      supabase.from("online_returns").select("*, online_orders(order_number, customer_name, platform, order_value, tracking_number)").order("created_at", { ascending: false }),
      supabase.from("online_orders").select("id, order_number, customer_name, order_value, tracking_number").in("status", ["dispatched", "delivered", "return_awaited"]),
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

  // Scan QR to receive return parcel
  const handleScanForReturn = async (scannedCode: string) => {
    const trimmed = scannedCode.trim();
    setScannedCodes(prev => [...prev, trimmed]);
    setIsScannerOpen(false);

    // First check return_awaited orders by tracking number
    const matchedOrder = returnAwaitedOrders.find(o => o.tracking_number === trimmed);
    if (matchedOrder) {
      // Auto-create return record and mark as returned
      const { error: retErr } = await supabase.from("online_returns").insert({
        return_number: "",
        order_id: matchedOrder.id,
        return_date: format(new Date(), "yyyy-MM-dd"),
        return_reason: "RTO - Undelivered",
        refund_amount: matchedOrder.order_value || 0,
        remarks: "Auto-created from QR scan",
        received_back: true,
        received_date: format(new Date(), "yyyy-MM-dd"),
        created_by: user?.id || null,
      });
      if (retErr) { toast.error(retErr.message); return; }

      await supabase.from("online_orders").update({ status: "returned" }).eq("id", matchedOrder.id);
      toast.success(`Return received: ${matchedOrder.order_number} — ${matchedOrder.customer_name}`);
      fetchData();
      return;
    }

    // Fallback: check dispatches by AWB
    const { data: dispatches } = await supabase
      .from("online_dispatches")
      .select("id, order_id, dispatch_number, awb_number, online_orders(id, order_number, customer_name, order_value, status)")
      .eq("awb_number", trimmed);

    if (dispatches && dispatches.length === 1) {
      const d = dispatches[0];
      const order = d.online_orders as any;
      if (order) {
        setForm(p => ({
          ...p,
          order_id: order.id,
          refund_amount: String(order.order_value || ""),
        }));
        setIsDialogOpen(true);
        toast.success(`Found order ${order.order_number} — ${order.customer_name}`);
      }
    } else if (dispatches && dispatches.length > 1) {
      toast.info("Multiple dispatches found for this tracking #. Please select order manually.");
      setIsDialogOpen(true);
    } else {
      // Try direct tracking number match on any order
      const { data: orderMatch } = await supabase
        .from("online_orders")
        .select("id, order_number, customer_name, order_value, status")
        .eq("tracking_number", trimmed)
        .limit(1);

      if (orderMatch && orderMatch.length === 1) {
        const o = orderMatch[0];
        if (o.status === "return_awaited") {
          // Auto-process
          const { error: retErr } = await supabase.from("online_returns").insert({
            return_number: "",
            order_id: o.id,
            return_date: format(new Date(), "yyyy-MM-dd"),
            return_reason: "RTO - Undelivered",
            refund_amount: o.order_value || 0,
            remarks: "Auto-created from QR scan",
            received_back: true,
            received_date: format(new Date(), "yyyy-MM-dd"),
            created_by: user?.id || null,
          });
          if (!retErr) {
            await supabase.from("online_orders").update({ status: "returned" }).eq("id", o.id);
            toast.success(`Return received: ${o.order_number} — ${o.customer_name}`);
            fetchData();
          } else {
            toast.error(retErr.message);
          }
        } else {
          setForm(p => ({ ...p, order_id: o.id, refund_amount: String(o.order_value || "") }));
          setIsDialogOpen(true);
          toast.success(`Found order ${o.order_number} — ${o.customer_name}`);
        }
      } else {
        toast.error(`No order found for tracking # ${trimmed}`);
      }
    }
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

        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" className="gap-2" onClick={() => setIsScannerOpen(true)}>
            <ScanLine className="h-4 w-4" /> Scan Return Parcel
          </Button>
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
