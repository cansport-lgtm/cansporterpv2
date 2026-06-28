import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PackageCheck, Search, CheckCircle2, AlertTriangle, RotateCcw, Banknote, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { OrderTrackingDialog } from "@/components/online-sales/OrderTrackingDialog";

const daysSince = (d: string | null) => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null;

export default function OnlineReturnReconciliationPage() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [receivedMap, setReceivedMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("awaiting");
  const [quick, setQuick] = useState("");
  const [trackOrder, setTrackOrder] = useState<any>(null);
  const quickRef = useRef<HTMLInputElement>(null);

  const fetchData = async () => {
    setLoading(true);
    // Parcels the courier says are returning/returned.
    const { data: ords } = await supabase
      .from("online_orders")
      .select("id, order_number, tracking_number, customer_name, platform, city, order_value, status, courier_order_status, last_tracked_at")
      .in("status", ["returned", "return_awaited"])
      .order("last_tracked_at", { ascending: true, nullsFirst: true });
    const list = ords || [];
    const ids = list.map(o => o.id);
    const map: Record<string, boolean> = {};
    if (ids.length) {
      const { data: rets } = await supabase
        .from("online_returns").select("order_id, received_back").in("order_id", ids);
      (rets || []).forEach((r: any) => { if (r.received_back) map[r.order_id] = true; });
    }
    setOrders(list);
    setReceivedMap(map);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);
  useEffect(() => { quickRef.current?.focus(); }, []);

  // Acknowledge a parcel as physically received back.
  const acknowledge = async (order: any) => {
    const { data: existing } = await supabase
      .from("online_returns").select("id, received_back").eq("order_id", order.id).limit(1);
    if (existing && existing.length) {
      if (!existing[0].received_back) {
        await supabase.from("online_returns")
          .update({ received_back: true, received_date: format(new Date(), "yyyy-MM-dd") })
          .eq("id", existing[0].id);
      }
    } else {
      await supabase.from("online_returns").insert({
        return_number: "", order_id: order.id, return_date: format(new Date(), "yyyy-MM-dd"),
        return_reason: "RTO - Undelivered", refund_amount: order.order_value || 0,
        received_back: true, received_date: format(new Date(), "yyyy-MM-dd"),
        remarks: "Acknowledged in return reconciliation", created_by: user?.id || null,
      });
    }
    if (order.status !== "returned") {
      await supabase.from("online_orders").update({ status: "returned" }).eq("id", order.id);
    }
    setReceivedMap(prev => ({ ...prev, [order.id]: true }));
    toast.success(`Acknowledged: ${order.order_number || order.tracking_number} — ${order.customer_name}`);
  };

  const quickAcknowledge = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = quick.trim(); setQuick("");
    if (!code) return;
    const match = orders.find(o =>
      o.tracking_number === code || o.order_number === code);
    if (!match) { toast.error(`No courier-returned parcel matches "${code}"`); quickRef.current?.focus(); return; }
    if (receivedMap[match.id]) { toast.info(`Already acknowledged: ${match.order_number}`); quickRef.current?.focus(); return; }
    await acknowledge(match);
    quickRef.current?.focus();
  };

  const { awaiting, received, atRisk } = useMemo(() => {
    const s = search.toLowerCase();
    const match = (o: any) => !search || o.order_number?.toLowerCase().includes(s) ||
      o.tracking_number?.toLowerCase().includes(s) || o.customer_name?.toLowerCase().includes(s);
    const awaiting = orders.filter(o => !receivedMap[o.id] && match(o))
      .map(o => ({ ...o, age: daysSince(o.last_tracked_at) }));
    const received = orders.filter(o => receivedMap[o.id] && match(o));
    const atRisk = orders.filter(o => !receivedMap[o.id]).reduce((sum, o) => sum + Number(o.order_value || 0), 0);
    return { awaiting, received, atRisk };
  }, [orders, receivedMap, search]);

  const outstandingCount = orders.filter(o => !receivedMap[o.id]).length;
  const receivedCount = orders.filter(o => receivedMap[o.id]).length;
  const agedCount = orders.filter(o => !receivedMap[o.id] && (daysSince(o.last_tracked_at) ?? 0) >= 7).length;

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Return Reconciliation" description="Acknowledge parcels physically received back; track returns the courier shows but you haven't got" icon={PackageCheck} iconColor="bg-red-600 text-white" />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard title="Courier Returned" value={orders.length} icon={RotateCcw} iconColor="text-orange-600" />
          <MetricCard title="Received Back" value={receivedCount} icon={CheckCircle2} iconColor="text-emerald-600" />
          <MetricCard title="Not Received (chase)" value={outstandingCount} icon={AlertTriangle} iconColor="text-red-600" description={`${agedCount} over 7 days`} />
          <MetricCard title="Value at Risk" value={`Rs. ${Math.round(atRisk).toLocaleString()}`} icon={Banknote} iconColor="text-red-600" />
        </div>

        <Card className="border-2 border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><ScanLine className="h-5 w-5 text-primary" /> Acknowledge Received Parcel</CardTitle>
            <p className="text-sm text-muted-foreground">Scan or type the tracking / order number of a parcel you physically received back, then Enter.</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={quickAcknowledge} className="flex flex-col sm:flex-row gap-2">
              <Input ref={quickRef} value={quick} onChange={e => setQuick(e.target.value)} placeholder="Tracking # or order #" className="flex-1 text-lg h-12 font-mono" autoFocus />
              <Button type="submit" size="lg" className="gap-2" disabled={!quick.trim()}><CheckCircle2 className="h-5 w-5" /> Acknowledge</Button>
            </form>
          </CardContent>
        </Card>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="awaiting">Awaiting Acknowledgement ({outstandingCount})</TabsTrigger>
            <TabsTrigger value="received">Received Back ({receivedCount})</TabsTrigger>
          </TabsList>

          <TabsContent value="awaiting">
            <Card><CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Order #</TableHead><TableHead>Tracking #</TableHead><TableHead>Customer</TableHead>
                  <TableHead>City</TableHead><TableHead>Courier Status</TableHead>
                  <TableHead className="text-right">Value</TableHead><TableHead className="text-right">Age</TableHead><TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : awaiting.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Nothing outstanding 🎉</TableCell></TableRow>
                  ) : awaiting.map(o => (
                    <TableRow key={o.id} className={(o.age ?? 0) >= 7 ? "bg-red-50/50" : ""}>
                      <TableCell className="font-medium">{o.order_number}</TableCell>
                      <TableCell className="font-mono text-xs">{o.tracking_number || "-"}</TableCell>
                      <TableCell>{o.customer_name}</TableCell>
                      <TableCell>{o.city || "-"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate" title={o.courier_order_status}>{o.courier_order_status || o.status}</TableCell>
                      <TableCell className="text-right">{Number(o.order_value || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        {o.age != null ? <Badge variant={o.age >= 7 ? "destructive" : "secondary"}>{o.age}d</Badge> : "-"}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" className="h-8" onClick={() => setTrackOrder(o)}>Track</Button>
                        <Button size="sm" variant="outline" className="h-8 ml-1" onClick={() => acknowledge(o)}>Acknowledge</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="received">
            <Card><CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Order #</TableHead><TableHead>Tracking #</TableHead><TableHead>Customer</TableHead>
                  <TableHead>City</TableHead><TableHead className="text-right">Value</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {received.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">None yet</TableCell></TableRow>
                  ) : received.map(o => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium">{o.order_number}</TableCell>
                      <TableCell className="font-mono text-xs">{o.tracking_number || "-"}</TableCell>
                      <TableCell>{o.customer_name}</TableCell>
                      <TableCell>{o.city || "-"}</TableCell>
                      <TableCell className="text-right">{Number(o.order_value || 0).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>
        </Tabs>
      </div>

      <OrderTrackingDialog order={trackOrder} open={!!trackOrder} onOpenChange={v => !v && setTrackOrder(null)} />
    </ERPLayout>
  );
}
