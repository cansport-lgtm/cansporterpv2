import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReceiptText, Download, Truck, Percent, Landmark, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { formatPKR } from "@/lib/currency";

interface OrderRow {
  id: string; platform: string | null; order_date: string; order_value: number | null; status: string | null;
  shipping_charges: number | null; gst: number | null; wh_income_tax: number | null; wh_sales_tax: number | null;
}
interface PlatformRow { name: string; commission_pct: number | null }
interface ReturnRow { order_id: string; refund_amount: number | null }

// Default range starts 90 days back so historical data is visible on load.
function firstOfMonth() { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().slice(0, 10); }
function today() { return new Date().toISOString().slice(0, 10); }

type Buckets = { shipping: number; commission: number; gst: number; wht: number; refunds: number };
const emptyBuckets = (): Buckets => ({ shipping: 0, commission: 0, gst: 0, wht: 0, refunds: 0 });
const bucketTotal = (b: Buckets) => b.shipping + b.commission + b.gst + b.wht + b.refunds;

export default function OnlineExpensesPage() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [platforms, setPlatforms] = useState<PlatformRow[]>([]);
  const [returns, setReturns] = useState<ReturnRow[]>([]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [oRes, pRes] = await Promise.all([
        supabase.from("online_orders")
          .select("id,platform,order_date,order_value,status,shipping_charges,gst,wh_income_tax,wh_sales_tax")
          .gte("order_date", from).lte("order_date", to),
        supabase.from("online_platforms").select("name,commission_pct"),
      ]);
      if (oRes.error) throw oRes.error;
      if (pRes.error) throw pRes.error;
      const orderRows = (oRes.data as OrderRow[]) || [];
      const ids = orderRows.map(o => o.id);
      let returnRows: ReturnRow[] = [];
      if (ids.length) {
        const { data, error } = await supabase.from("online_returns").select("order_id,refund_amount").in("order_id", ids);
        if (error) throw error;
        returnRows = (data as ReturnRow[]) || [];
      }
      setOrders(orderRows);
      setPlatforms((pRes.data as PlatformRow[]) || []);
      setReturns(returnRows);
    } catch (e: any) {
      toast.error(e.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line */ }, []);

  const { totals, byMonth, byPlatform } = useMemo(() => {
    const commissionByPlatform = new Map(platforms.map(p => [p.name, Number(p.commission_pct || 0)]));
    const refundByOrder = new Map<string, number>();
    returns.forEach(r => refundByOrder.set(r.order_id, (refundByOrder.get(r.order_id) || 0) + Number(r.refund_amount || 0)));

    const totals = emptyBuckets();
    const months = new Map<string, Buckets>();
    const plats = new Map<string, Buckets>();

    orders.forEach(o => {
      if (o.status === "cancelled") return;
      const platform = o.platform || "(none)";
      const month = (o.order_date || "").slice(0, 7);
      const add = (b: Buckets) => {
        b.shipping += Number(o.shipping_charges || 0);
        b.commission += Number(o.order_value || 0) * (commissionByPlatform.get(platform) || 0) / 100;
        b.gst += Number(o.gst || 0);
        b.wht += Number(o.wh_income_tax || 0) + Number(o.wh_sales_tax || 0);
        b.refunds += refundByOrder.get(o.id) || 0;
      };
      add(totals);
      if (!months.has(month)) months.set(month, emptyBuckets());
      add(months.get(month)!);
      if (!plats.has(platform)) plats.set(platform, emptyBuckets());
      add(plats.get(platform)!);
    });

    const byMonth = Array.from(months.entries()).map(([m, b]) => ({ key: m, ...b })).sort((a, b) => a.key.localeCompare(b.key));
    const byPlatform = Array.from(plats.entries()).map(([m, b]) => ({ key: m, ...b })).sort((a, b) => bucketTotal(b) - bucketTotal(a));
    return { totals, byMonth, byPlatform };
  }, [orders, platforms, returns]);

  const grand = bucketTotal(totals);

  const exportCSV = () => {
    const header = ["Group", "Shipping", "Commission", "GST", "Withholding Tax", "Refunds", "Total"];
    const line = (label: string, b: Buckets) => [label, b.shipping, b.commission, b.gst, b.wht, b.refunds, bucketTotal(b)];
    const rows = [
      ...byMonth.map(b => line(b.key, b)),
      ...byPlatform.map(b => line(`Platform: ${b.key}`, b)),
      line("TOTAL", totals),
    ];
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `online-expenses_${from}_to_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const renderRows = (data: (Buckets & { key: string })[]) =>
    data.map((b, i) => (
      <TableRow key={i}>
        <TableCell className="font-medium">{b.key}</TableCell>
        <TableCell className="text-right">{formatPKR(b.shipping)}</TableCell>
        <TableCell className="text-right">{formatPKR(b.commission)}</TableCell>
        <TableCell className="text-right">{formatPKR(b.gst)}</TableCell>
        <TableCell className="text-right">{formatPKR(b.wht)}</TableCell>
        <TableCell className="text-right">{formatPKR(b.refunds)}</TableCell>
        <TableCell className="text-right font-semibold">{formatPKR(bucketTotal(b))}</TableCell>
      </TableRow>
    ));

  const headerRow = (firstCol: string) => (
    <TableRow>
      <TableHead>{firstCol}</TableHead>
      <TableHead className="text-right">Shipping</TableHead>
      <TableHead className="text-right">Commission</TableHead>
      <TableHead className="text-right">GST</TableHead>
      <TableHead className="text-right">WHT</TableHead>
      <TableHead className="text-right">Refunds</TableHead>
      <TableHead className="text-right">Total</TableHead>
    </TableRow>
  );

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Expenses Report" description="Courier, commission, tax and refund costs of online sales" icon={ReceiptText} iconColor="bg-emerald-600 text-white" />

        <Card>
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <div><Label>From</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-44" /></div>
            <div><Label>To</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-44" /></div>
            <Button onClick={fetchAll} disabled={loading}>{loading ? "Loading..." : "Apply"}</Button>
            <Button variant="outline" onClick={exportCSV} disabled={!byMonth.length}><Download className="h-4 w-4 mr-1" /> Export CSV</Button>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <MetricCard title="Total Expenses" value={formatPKR(grand)} icon={ReceiptText} iconColor="text-amber-600" />
          <MetricCard title="Shipping" value={formatPKR(totals.shipping)} icon={Truck} iconColor="text-blue-600" />
          <MetricCard title="Commission" value={formatPKR(totals.commission)} icon={Percent} iconColor="text-purple-600" />
          <MetricCard title="GST" value={formatPKR(totals.gst)} icon={Landmark} iconColor="text-slate-600" />
          <MetricCard title="Withholding Tax" value={formatPKR(totals.wht)} icon={Landmark} iconColor="text-slate-600" />
          <MetricCard title="Refunds" value={formatPKR(totals.refunds)} icon={RotateCcw} iconColor="text-red-600" />
        </div>

        <Card>
          <CardHeader><CardTitle className="text-sm">Monthly Breakdown</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>{headerRow("Month")}</TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
                ) : byMonth.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No expenses in this range</TableCell></TableRow>
                ) : renderRows(byMonth)}
              </TableBody>
              {byMonth.length > 0 && (
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-bold">Total</TableCell>
                    <TableCell className="text-right font-bold">{formatPKR(totals.shipping)}</TableCell>
                    <TableCell className="text-right font-bold">{formatPKR(totals.commission)}</TableCell>
                    <TableCell className="text-right font-bold">{formatPKR(totals.gst)}</TableCell>
                    <TableCell className="text-right font-bold">{formatPKR(totals.wht)}</TableCell>
                    <TableCell className="text-right font-bold">{formatPKR(totals.refunds)}</TableCell>
                    <TableCell className="text-right font-bold">{formatPKR(grand)}</TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">By Platform</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>{headerRow("Platform")}</TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
                ) : byPlatform.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No expenses in this range</TableCell></TableRow>
                ) : renderRows(byPlatform)}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
