import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RotateCcw, Percent, Scale, Clock, Banknote } from "lucide-react";
import { toast } from "sonner";
import { formatPKR } from "@/lib/currency";

interface OrderRow {
  id: string; status: string | null; payment_mode: string | null; order_value: number | null;
  order_date: string; booked_at: string | null; tracking_number: string | null;
  customer_name: string | null; platform: string | null;
  booking_weight: number | null; actual_weight: number | null; courier_weight: number | null;
  net_amount: number | null;
}
interface ReturnRow { order_id: string; return_reason: string | null; refund_amount: number | null; received_back: boolean | null }

// Default range starts 90 days back so historical data is visible on load.
function firstOfMonth() { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().slice(0, 10); }
function today() { return new Date().toISOString().slice(0, 10); }
const daysBetween = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / 86400000);

export default function OnlineReturnsAnalyticsPage() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [returns, setReturns] = useState<ReturnRow[]>([]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const { data: oData, error: oErr } = await supabase.from("online_orders")
        .select("id,status,payment_mode,order_value,order_date,booked_at,tracking_number,customer_name,platform,booking_weight,actual_weight,courier_weight,net_amount")
        .gte("order_date", from).lte("order_date", to);
      if (oErr) throw oErr;
      const orderRows = (oData as OrderRow[]) || [];
      const ids = orderRows.map(o => o.id);
      let returnRows: ReturnRow[] = [];
      if (ids.length) {
        const { data, error } = await supabase.from("online_returns")
          .select("order_id,return_reason,refund_amount,received_back").in("order_id", ids);
        if (error) throw error;
        returnRows = (data as ReturnRow[]) || [];
      }
      setOrders(orderRows);
      setReturns(returnRows);
    } catch (e: any) {
      toast.error(e.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchAll(); /* eslint-disable-next-line */ }, []);

  const stats = useMemo(() => {
    const returnByOrder = new Map<string, ReturnRow>();
    returns.forEach(r => returnByOrder.set(r.order_id, r));

    const active = orders.filter(o => o.status !== "cancelled");
    const total = active.length;

    // Cohort-correct: a return is counted against the order that generated it
    // (both in this date range), not period-vs-period.
    const isReturned = (o: OrderRow) => o.status === "returned" || o.status === "return_awaited" || returnByOrder.has(o.id);
    const returnedOrders = active.filter(isReturned);

    const cod = active.filter(o => o.payment_mode === "cod");
    const prepaid = active.filter(o => o.payment_mode === "prepaid");
    const codReturned = cod.filter(isReturned).length;
    const prepaidReturned = prepaid.filter(isReturned).length;

    // RTO vs customer-initiated, from the return reason.
    let rto = 0, customer = 0;
    const reasonCounts = new Map<string, number>();
    returnedOrders.forEach(o => {
      const r = returnByOrder.get(o.id);
      const reason = r?.return_reason || "Unspecified";
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
      if (/rto|undeliver/i.test(reason)) rto++; else customer++;
    });
    const reasons = Array.from(reasonCounts.entries()).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);

    // Weight disputes: courier charged more than our measured actual weight.
    const weightDisputes = active
      .filter(o => o.courier_weight != null && o.actual_weight != null && Number(o.courier_weight) > Number(o.actual_weight))
      .map(o => ({ ...o, diff: Number(o.courier_weight) - Number(o.actual_weight) }))
      .sort((a, b) => b.diff - a.diff);

    // COD reconciliation: COD orders delivered but with no settled net_amount captured.
    const codDelivered = cod.filter(o => o.status === "delivered");
    const codUnsettled = codDelivered.filter(o => !(Number(o.net_amount) > 0));
    const codExpected = codDelivered.reduce((s, o) => s + Number(o.order_value || 0), 0);
    const codSettled = codDelivered.reduce((s, o) => s + Number(o.net_amount || 0), 0);

    // In-transit aging: still moving, bucket by days since order date.
    const now = new Date();
    const inTransit = active.filter(o => o.status === "sent_to_courier" || o.status === "dispatched");
    const aging = { "0-3": 0, "4-7": 0, "8-14": 0, "15+": 0 } as Record<string, number>;
    const stuck: (OrderRow & { age: number })[] = [];
    inTransit.forEach(o => {
      const ref = o.booked_at ? new Date(o.booked_at) : new Date(o.order_date);
      const age = daysBetween(ref, now);
      if (age <= 3) aging["0-3"]++; else if (age <= 7) aging["4-7"]++; else if (age <= 14) aging["8-14"]++; else aging["15+"]++;
      if (age >= 8) stuck.push({ ...o, age });
    });
    stuck.sort((a, b) => b.age - a.age);

    const pct = (n: number, d: number) => d > 0 ? (n / d) * 100 : 0;
    return {
      total, returned: returnedOrders.length, returnRate: pct(returnedOrders.length, total),
      rto, customer,
      codRate: pct(codReturned, cod.length), prepaidRate: pct(prepaidReturned, prepaid.length),
      codCount: cod.length, prepaidCount: prepaid.length,
      reasons, weightDisputes, codExpected, codSettled, codUnsettled, codDeliveredCount: codDelivered.length,
      aging, stuck,
    };
  }, [orders, returns]);

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Returns & Reconciliation" description="Return ratio, RTO analysis, weight disputes, COD reconciliation & in-transit aging" icon={RotateCcw} iconColor="bg-red-600 text-white" />

        <Card>
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <div><Label>From</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-44" /></div>
            <div><Label>To</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-44" /></div>
            <Button onClick={fetchAll} disabled={loading}>{loading ? "Loading..." : "Apply"}</Button>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <MetricCard title="Return Rate" value={`${stats.returnRate.toFixed(1)}%`} icon={Percent} iconColor="text-red-600" description={`${stats.returned} of ${stats.total} orders`} />
          <MetricCard title="RTO (undelivered)" value={stats.rto} icon={RotateCcw} iconColor="text-orange-600" />
          <MetricCard title="Customer Returns" value={stats.customer} icon={RotateCcw} iconColor="text-amber-600" />
          <MetricCard title="COD Return Rate" value={`${stats.codRate.toFixed(1)}%`} icon={Percent} iconColor="text-red-600" description={`${stats.codCount} COD orders`} />
          <MetricCard title="Prepaid Return Rate" value={`${stats.prepaidRate.toFixed(1)}%`} icon={Percent} iconColor="text-blue-600" description={`${stats.prepaidCount} prepaid`} />
          <MetricCard title="Weight Disputes" value={stats.weightDisputes.length} icon={Scale} iconColor="text-purple-600" description="courier > actual wt" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><RotateCcw className="h-4 w-4" /> Return Reasons</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Reason</TableHead><TableHead className="text-right">Count</TableHead><TableHead className="text-right">Share</TableHead></TableRow></TableHeader>
                <TableBody>
                  {stats.reasons.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-center py-6 text-muted-foreground">No returns in range</TableCell></TableRow>
                  ) : stats.reasons.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{r.reason}</TableCell>
                      <TableCell className="text-right font-medium">{r.count}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{stats.returned > 0 ? ((r.count / stats.returned) * 100).toFixed(0) : 0}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Banknote className="h-4 w-4" /> COD Reconciliation</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">COD delivered orders</span><span className="font-medium">{stats.codDeliveredCount}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Expected COD (order value)</span><span className="font-medium">{formatPKR(stats.codExpected)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Settled (net received)</span><span className="font-medium">{formatPKR(stats.codSettled)}</span></div>
              <div className="flex justify-between text-sm border-t pt-2">
                <span className="text-muted-foreground">Unsettled / not yet captured</span>
                <Badge variant={stats.codUnsettled.length > 0 ? "destructive" : "default"}>{stats.codUnsettled.length} orders</Badge>
              </div>
              <p className="text-xs text-muted-foreground">Settlement amounts are populated from the courier (PostEx settlement sync). Until that runs, settled shows what was captured via the status sheet.</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Scale className="h-4 w-4" /> Weight Disputes (courier charged more than measured)</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Tracking #</TableHead><TableHead>Customer</TableHead>
                <TableHead className="text-right">Booking (g)</TableHead><TableHead className="text-right">Actual (g)</TableHead>
                <TableHead className="text-right">Courier (g)</TableHead><TableHead className="text-right">Over-charged (g)</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {stats.weightDisputes.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No weight disputes 🎉</TableCell></TableRow>
                ) : stats.weightDisputes.slice(0, 50).map((o, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{o.tracking_number || "-"}</TableCell>
                    <TableCell>{o.customer_name}</TableCell>
                    <TableCell className="text-right">{o.booking_weight ?? "-"}</TableCell>
                    <TableCell className="text-right">{o.actual_weight ?? "-"}</TableCell>
                    <TableCell className="text-right">{o.courier_weight ?? "-"}</TableCell>
                    <TableCell className="text-right font-semibold text-destructive">+{o.diff}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4" /> In-Transit Aging</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4 mb-4">
              {Object.entries(stats.aging).map(([bucket, count]) => (
                <div key={bucket} className="text-center p-3 rounded border">
                  <div className={`text-2xl font-bold ${bucket === "15+" ? "text-destructive" : bucket === "8-14" ? "text-amber-600" : ""}`}>{count}</div>
                  <div className="text-xs text-muted-foreground mt-1">{bucket} days</div>
                </div>
              ))}
            </div>
            {stats.stuck.length > 0 && (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Tracking #</TableHead><TableHead>Customer</TableHead><TableHead>Platform</TableHead>
                  <TableHead>Status</TableHead><TableHead className="text-right">Age (days)</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {stats.stuck.slice(0, 50).map((o, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{o.tracking_number || "-"}</TableCell>
                      <TableCell>{o.customer_name}</TableCell>
                      <TableCell>{o.platform}</TableCell>
                      <TableCell><Badge variant="outline">{(o.status || "").replace(/_/g, " ")}</Badge></TableCell>
                      <TableCell className="text-right font-semibold">{o.age}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
