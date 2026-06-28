import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Radar, Search, RefreshCw, Download, MapPin } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { OrderTrackingDialog } from "@/components/online-sales/OrderTrackingDialog";

const STATUSES = ["pending", "confirmed", "sent_to_courier", "dispatched", "delivered", "return_awaited", "returned", "cancelled"];

export default function OnlineLiveStatusPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [trackOrder, setTrackOrder] = useState<any>(null);

  const fetchOrders = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("online_orders")
      .select("id, order_number, platform, tracking_number, customer_name, city, status, courier_order_status, last_tracked_at, order_value")
      .not("tracking_number", "is", null)
      .order("last_tracked_at", { ascending: false, nullsFirst: false });
    setOrders(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchOrders(); }, []);

  const syncAll = async () => {
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke("postex", { body: { action: "track" } });
    setSyncing(false);
    if (error || (data as any)?.error) { toast.error(`Sync failed: ${(data as any)?.error || error?.message}`); return; }
    const d = data as any;
    toast.success(`Synced ${d?.tracked ?? 0} parcels, ${d?.updated ?? 0} updates`);
    fetchOrders();
  };

  const filtered = useMemo(() => orders.filter(o => {
    const s = search.toLowerCase();
    const matchSearch = !search ||
      o.order_number?.toLowerCase().includes(s) ||
      o.tracking_number?.toLowerCase().includes(s) ||
      o.customer_name?.toLowerCase().includes(s);
    const matchStatus =
      statusFilter === "all" ? true :
      statusFilter === "active" ? !["delivered", "returned", "cancelled"].includes(o.status) :
      o.status === statusFilter;
    return matchSearch && matchStatus;
  }), [orders, search, statusFilter]);

  const badgeClass = (status: string) =>
    status === "delivered" ? "bg-emerald-50 text-emerald-700 border-emerald-500" :
    status === "returned" ? "bg-red-50 text-red-700 border-red-500" :
    status === "return_awaited" ? "bg-orange-50 text-orange-700 border-orange-500" :
    status === "sent_to_courier" ? "bg-amber-50 text-amber-700 border-amber-500" :
    status === "dispatched" ? "bg-blue-50 text-blue-700 border-blue-500" : "";

  const exportCSV = () => {
    const header = ["Order #", "Tracking #", "Customer", "Platform", "City", "Status", "Courier Status", "Last Synced", "Value"];
    const rows = filtered.map(o => [
      o.order_number, o.tracking_number, o.customer_name, o.platform, o.city, o.status,
      o.courier_order_status || "", o.last_tracked_at ? format(new Date(o.last_tracked_at), "yyyy-MM-dd HH:mm") : "", o.order_value,
    ]);
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `online-live-status_${format(new Date(), "yyyyMMdd")}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Live Status" description="Order-wise live courier status, synced from PostEx" icon={Radar} iconColor="bg-emerald-600 text-white" />

        <div className="flex gap-3 flex-wrap items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search order, tracking, customer…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">In transit (active)</SelectItem>
              <SelectItem value="all">All</SelectItem>
              {STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={syncAll} disabled={syncing} className="gap-1">
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} /> {syncing ? "Syncing…" : "Sync All"}
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={!filtered.length} className="gap-1">
            <Download className="h-4 w-4" /> Export
          </Button>
        </div>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order #</TableHead>
                  <TableHead>Tracking #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Courier Status</TableHead>
                  <TableHead>Last Synced</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No parcels</TableCell></TableRow>
                ) : filtered.map(o => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">{o.order_number || o.platform}</TableCell>
                    <TableCell className="font-mono text-xs">{o.tracking_number}</TableCell>
                    <TableCell>{o.customer_name}</TableCell>
                    <TableCell>{o.city || "-"}</TableCell>
                    <TableCell><Badge variant="outline" className={badgeClass(o.status)}>{(o.status || "").replace(/_/g, " ")}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate" title={o.courier_order_status}>{o.courier_order_status || "-"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{o.last_tracked_at ? format(new Date(o.last_tracked_at), "dd MMM HH:mm") : "never"}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={() => setTrackOrder(o)}>
                        <MapPin className="h-3.5 w-3.5" /> Track
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <OrderTrackingDialog order={trackOrder} open={!!trackOrder} onOpenChange={v => !v && setTrackOrder(null)} />
    </ERPLayout>
  );
}
