import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wallet, Banknote, ReceiptText, TrendingUp, Truck, Clock, Search, RefreshCw, Download, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { formatPKR } from "@/lib/currency";

const ACTIVE = ["sent_to_courier", "dispatched", "return_awaited"];
const OVERDUE_DAYS = 7; // delivered COD unpaid beyond this => chase PostEx
const daysSince = (d: string | null) => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null;

export default function OnlineMoneyPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("owed");
  const [lastSync, setLastSync] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("online_orders")
      .select("id, order_number, tracking_number, customer_name, status, cod_amount, order_value, shipping_charges, gst, net_amount, settled, settled_at, payment_ref, last_tracked_at, delivered_at")
      .or("cod_amount.gt.0,payment_mode.eq.cod")
      .order("settled_at", { ascending: false, nullsFirst: true });
    setOrders(data || []);
    setLastSync((data || []).reduce((m: string | null, o: any) => o.last_tracked_at && (!m || o.last_tracked_at > m) ? o.last_tracked_at : m, null));
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const syncSettlement = async () => {
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke("postex", { body: { action: "settlement" } });
    setSyncing(false);
    if (error || (data as any)?.error) { toast.error(`Settlement sync failed: ${(data as any)?.error || error?.message}`); return; }
    const d = data as any;
    toast.success(`Checked ${d?.checked ?? 0} parcels — ${d?.settled ?? 0} settled by PostEx`);
    fetchData();
  };

  const net = (o: any) => Math.max(0, Number(o.cod_amount || 0) - Number(o.shipping_charges || 0) - Number(o.gst || 0));

  const t = useMemo(() => {
    const cod = (o: any) => Number(o.cod_amount || 0) > 0;
    const delivered = orders.filter(o => o.status === "delivered" && cod(o));
    const inTransit = orders.filter(o => ACTIVE.includes(o.status) && cod(o));
    const settled = delivered.filter(o => o.settled);
    const unsettled = delivered.filter(o => !o.settled);
    const overdue = unsettled.filter(o => (daysSince(o.delivered_at) ?? 0) >= OVERDUE_DAYS);
    return {
      codGross: delivered.reduce((s, o) => s + Number(o.cod_amount || 0), 0),
      deductions: delivered.reduce((s, o) => s + Number(o.shipping_charges || 0) + Number(o.gst || 0), 0),
      netReceivable: delivered.reduce((s, o) => s + net(o), 0),
      received: settled.reduce((s, o) => s + net(o), 0),
      owed: unsettled.reduce((s, o) => s + net(o), 0),
      owedCount: unsettled.length,
      overdue: overdue.reduce((s, o) => s + net(o), 0),
      overdueCount: overdue.length,
      pipeline: inTransit.reduce((s, o) => s + Number(o.cod_amount || 0), 0),
      pipelineCount: inTransit.length,
    };
  }, [orders]);

  const rows = useMemo(() => {
    const s = search.toLowerCase();
    return orders.filter(o => {
      const isCod = Number(o.cod_amount || 0) > 0;
      const matchSearch = !search || o.order_number?.toLowerCase().includes(s) ||
        o.tracking_number?.toLowerCase().includes(s) || o.customer_name?.toLowerCase().includes(s) ||
        o.payment_ref?.toLowerCase().includes(s);
      const matchFilter =
        filter === "owed" ? (o.status === "delivered" && isCod && !o.settled) :
        filter === "received" ? (o.status === "delivered" && isCod && o.settled) :
        filter === "transit" ? (ACTIVE.includes(o.status) && isCod) :
        isCod;
      return matchSearch && matchFilter;
    });
  }, [orders, search, filter]);

  const exportCSV = () => {
    const header = ["Order #", "Tracking #", "Customer", "Status", "COD", "Deductions", "Net", "Settled", "Settled Date", "Payment Ref"];
    const data = rows.map(o => [o.order_number, o.tracking_number, o.customer_name, o.status,
      Number(o.cod_amount || 0), Number(o.shipping_charges || 0) + Number(o.gst || 0), net(o),
      o.settled ? "Yes" : "No", o.settled_at ? format(new Date(o.settled_at), "yyyy-MM-dd") : "", o.payment_ref || ""]);
    const csv = [header, ...data].map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `online-money_${format(new Date(), "yyyyMMdd")}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <PageHeader title="Money / COD Settlement" description="What the courier owes you, deductions, and what's been paid out" icon={Wallet} iconColor="bg-emerald-600 text-white" />
          <Button variant="outline" size="sm" onClick={syncSettlement} disabled={syncing} className="gap-1">
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} /> {syncing ? "Syncing…" : "Sync Settlement"}
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <MetricCard title="COD Collected" value={formatPKR(t.codGross)} icon={Banknote} iconColor="text-blue-600" description="delivered parcels" />
          <MetricCard title="Courier Deductions" value={formatPKR(t.deductions)} icon={ReceiptText} iconColor="text-amber-600" description="fees + tax" />
          <MetricCard title="Net Receivable" value={formatPKR(t.netReceivable)} icon={TrendingUp} iconColor="text-slate-600" description="COD − deductions" />
          <MetricCard title="Received (settled)" value={formatPKR(t.received)} icon={Wallet} iconColor="text-emerald-600" />
          <MetricCard title="Owed to us" value={formatPKR(t.owed)} icon={Banknote} iconColor="text-red-600" description={`${t.owedCount} parcels unpaid`} />
          <MetricCard title={`Overdue (${OVERDUE_DAYS}d+)`} value={formatPKR(t.overdue)} icon={AlertTriangle} iconColor="text-red-700" description={`${t.overdueCount} to chase`} />
          <MetricCard title="In-Transit Pipeline" value={formatPKR(t.pipeline)} icon={Truck} iconColor="text-purple-600" description={`${t.pipelineCount} COD coming`} />
        </div>

        <Card className="bg-muted/30">
          <CardContent className="py-3 px-4 text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
            <Clock className="h-3.5 w-3.5" />
            Figures are pulled per parcel from PostEx: COD amount &amp; courier fees from tracking, and settled status / date / payment reference from PostEx's payment endpoint.
            {lastSync && <span>· Last synced {format(new Date(lastSync), "dd MMM yyyy HH:mm")}</span>}
            <span>· Use “Sync Settlement” to refresh payouts.</span>
          </CardContent>
        </Card>

        <div className="flex gap-3 flex-wrap items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search order, tracking, customer, payment ref…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="owed">Owed to us (unpaid)</SelectItem>
              <SelectItem value="received">Received (settled)</SelectItem>
              <SelectItem value="transit">In-transit pipeline</SelectItem>
              <SelectItem value="all">All COD parcels</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={!rows.length} className="gap-1"><Download className="h-4 w-4" /> Export</Button>
        </div>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order #</TableHead><TableHead>Tracking #</TableHead><TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">COD</TableHead><TableHead className="text-right">Deductions</TableHead>
                  <TableHead className="text-right">Net</TableHead><TableHead>Settled</TableHead>
                  <TableHead className="text-right">Unpaid Age</TableHead>
                  <TableHead>Settled Date</TableHead><TableHead>Payment Ref</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">No parcels</TableCell></TableRow>
                ) : rows.map(o => {
                  const unpaidAge = (o.status === "delivered" && Number(o.cod_amount || 0) > 0 && !o.settled) ? daysSince(o.delivered_at) : null;
                  const overdue = (unpaidAge ?? 0) >= OVERDUE_DAYS;
                  return (
                  <TableRow key={o.id} className={overdue ? "bg-red-50/50" : ""}>
                    <TableCell className="font-medium">{o.order_number}</TableCell>
                    <TableCell className="font-mono text-xs">{o.tracking_number || "-"}</TableCell>
                    <TableCell>{o.customer_name}</TableCell>
                    <TableCell><Badge variant="outline">{(o.status || "").replace(/_/g, " ")}</Badge></TableCell>
                    <TableCell className="text-right">{Number(o.cod_amount || 0).toLocaleString()}</TableCell>
                    <TableCell className="text-right text-amber-700">{(Number(o.shipping_charges || 0) + Number(o.gst || 0)).toLocaleString()}</TableCell>
                    <TableCell className="text-right font-semibold">{net(o).toLocaleString()}</TableCell>
                    <TableCell>{o.settled ? <Badge className="bg-emerald-100 text-emerald-800 border-emerald-400">Paid</Badge> : <Badge variant="destructive">Unpaid</Badge>}</TableCell>
                    <TableCell className="text-right">{unpaidAge != null ? <Badge variant={overdue ? "destructive" : "secondary"}>{unpaidAge}d</Badge> : "-"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{o.settled_at ? format(new Date(o.settled_at), "dd MMM yyyy") : "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{o.payment_ref || "-"}</TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
