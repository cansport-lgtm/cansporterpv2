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
import { TrendingUp, Download, Wallet, Package, Percent, Truck, ReceiptText } from "lucide-react";
import { toast } from "sonner";
import { formatPKR } from "@/lib/currency";

interface OrderRow {
  id: string; platform: string | null; item_id: string | null; item_name: string | null;
  quantity: number | null; payment_mode: string | null; order_date: string;
  order_value: number | null; status: string | null;
  shipping_charges: number | null; gst: number | null;
  wh_income_tax: number | null; wh_sales_tax: number | null;
}
interface ItemRow { id: string; name: string; price: number | null; cost_price: number | null }
interface PlatformRow { name: string; commission_pct: number | null }
interface ReturnRow { order_id: string; refund_amount: number | null }

// Default range starts 90 days back so historical data is visible on load.
function firstOfMonth() { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().slice(0, 10); }
function today() { return new Date().toISOString().slice(0, 10); }

export default function OnlinePnLPage() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [platforms, setPlatforms] = useState<PlatformRow[]>([]);
  const [returns, setReturns] = useState<ReturnRow[]>([]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [oRes, iRes, pRes] = await Promise.all([
        supabase.from("online_orders")
          .select("id,platform,item_id,item_name,quantity,payment_mode,order_date,order_value,status,shipping_charges,gst,wh_income_tax,wh_sales_tax")
          .gte("order_date", from).lte("order_date", to),
        supabase.from("online_items").select("id,name,price,cost_price"),
        supabase.from("online_platforms").select("name,commission_pct"),
      ]);
      if (oRes.error) throw oRes.error;
      if (iRes.error) throw iRes.error;
      if (pRes.error) throw pRes.error;

      const orderRows = (oRes.data as OrderRow[]) || [];
      const orderIds = orderRows.map(o => o.id);
      let returnRows: ReturnRow[] = [];
      if (orderIds.length) {
        const { data: rData, error: rErr } = await supabase
          .from("online_returns").select("order_id,refund_amount").in("order_id", orderIds);
        if (rErr) throw rErr;
        returnRows = (rData as ReturnRow[]) || [];
      }
      setOrders(orderRows);
      setItems((iRes.data as ItemRow[]) || []);
      setPlatforms((pRes.data as PlatformRow[]) || []);
      setReturns(returnRows);
    } catch (e: any) {
      toast.error(e.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line */ }, []);

  const { totals, byPlatform } = useMemo(() => {
    const itemById = new Map(items.map(i => [i.id, i]));
    const itemByName = new Map(items.map(i => [i.name.trim().toLowerCase(), i]));
    const commissionByPlatform = new Map(platforms.map(p => [p.name, Number(p.commission_pct || 0)]));
    const refundByOrder = new Map<string, number>();
    returns.forEach(r => refundByOrder.set(r.order_id, (refundByOrder.get(r.order_id) || 0) + Number(r.refund_amount || 0)));

    const t = { revenue: 0, refunds: 0, cogs: 0, commission: 0, shipping: 0, taxes: 0, orders: 0, unmappedCogs: 0 };
    type Agg = { platform: string; revenue: number; refunds: number; cogs: number; commission: number; shipping: number; taxes: number; orders: number };
    const plat = new Map<string, Agg>();

    orders.forEach(o => {
      if (o.status === "cancelled") return; // cancelled orders are not revenue
      const platform = o.platform || "(none)";
      const qty = Number(o.quantity || 0);
      let item = o.item_id ? itemById.get(o.item_id) : undefined;
      if (!item && o.item_name) item = itemByName.get(o.item_name.trim().toLowerCase());

      const revenue = Number(o.order_value || 0);
      const refund = refundByOrder.get(o.id) || 0;
      const cost = Number(item?.cost_price || 0);
      const cogs = cost * qty;
      const commission = revenue * (commissionByPlatform.get(platform) || 0) / 100;
      const shipping = Number(o.shipping_charges || 0);
      const taxes = Number(o.gst || 0) + Number(o.wh_income_tax || 0) + Number(o.wh_sales_tax || 0);

      t.revenue += revenue; t.refunds += refund; t.cogs += cogs;
      t.commission += commission; t.shipping += shipping; t.taxes += taxes; t.orders += 1;
      if (!item || cost === 0) t.unmappedCogs += 1;

      const cur = plat.get(platform) || { platform, revenue: 0, refunds: 0, cogs: 0, commission: 0, shipping: 0, taxes: 0, orders: 0 };
      cur.revenue += revenue; cur.refunds += refund; cur.cogs += cogs;
      cur.commission += commission; cur.shipping += shipping; cur.taxes += taxes; cur.orders += 1;
      plat.set(platform, cur);
    });

    const byPlatform = Array.from(plat.values())
      .map(p => ({ ...p, profit: p.revenue - p.refunds - p.cogs - p.commission - p.shipping - p.taxes }))
      .sort((a, b) => b.profit - a.profit);

    return { totals: t, byPlatform };
  }, [orders, items, platforms, returns]);

  const netRevenue = totals.revenue - totals.refunds;
  const netProfit = netRevenue - totals.cogs - totals.commission - totals.shipping - totals.taxes;
  const margin = totals.revenue > 0 ? (netProfit / totals.revenue) * 100 : 0;

  const waterfall: { label: string; value: number; sign: 1 | -1; icon: any }[] = [
    { label: "Gross Revenue", value: totals.revenue, sign: 1, icon: Wallet },
    { label: "Less: Returns / Refunds", value: totals.refunds, sign: -1, icon: ReceiptText },
    { label: "Less: COGS", value: totals.cogs, sign: -1, icon: Package },
    { label: "Less: Platform Commission", value: totals.commission, sign: -1, icon: Percent },
    { label: "Less: Shipping", value: totals.shipping, sign: -1, icon: Truck },
    { label: "Less: Taxes (GST + WHT)", value: totals.taxes, sign: -1, icon: ReceiptText },
  ];

  const exportCSV = () => {
    const header = ["Platform", "Orders", "Revenue", "Refunds", "COGS", "Commission", "Shipping", "Taxes", "Net Profit"];
    const rows = byPlatform.map(p => [p.platform, p.orders, p.revenue, p.refunds, p.cogs, p.commission, p.shipping, p.taxes, p.profit]);
    rows.push(["TOTAL", totals.orders, totals.revenue, totals.refunds, totals.cogs, totals.commission, totals.shipping, totals.taxes, netProfit]);
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `online-pnl_${from}_to_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Profit & Loss" description="Net profit after COGS, commission, shipping, taxes and returns" icon={TrendingUp} iconColor="bg-emerald-600 text-white" />

        <Card>
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <div><Label>From</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-44" /></div>
            <div><Label>To</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-44" /></div>
            <Button onClick={fetchAll} disabled={loading}>{loading ? "Loading..." : "Apply"}</Button>
            <Button variant="outline" onClick={exportCSV} disabled={!byPlatform.length}><Download className="h-4 w-4 mr-1" /> Export CSV</Button>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard title="Net Revenue" value={formatPKR(netRevenue)} icon={Wallet} iconColor="text-blue-600" description={`Gross ${formatPKR(totals.revenue)}`} />
          <MetricCard title="Total Costs" value={formatPKR(totals.cogs + totals.commission + totals.shipping + totals.taxes)} icon={ReceiptText} iconColor="text-amber-600" description="COGS + commission + shipping + tax" />
          <MetricCard title="Net Profit" value={formatPKR(netProfit)} icon={TrendingUp} iconColor={netProfit >= 0 ? "text-emerald-600" : "text-destructive"} description={`${totals.orders} orders`} />
          <MetricCard title="Net Margin" value={`${margin.toFixed(1)}%`} icon={Percent} iconColor={margin >= 0 ? "text-emerald-600" : "text-destructive"} />
        </div>

        {totals.unmappedCogs > 0 && (
          <Card className="border-amber-300 bg-amber-50">
            <CardContent className="py-3 px-4 text-sm text-amber-800">
              ⚠️ {totals.unmappedCogs} order(s) have no item cost set — their COGS is counted as 0, so profit is overstated. Set cost prices in Item Master and link items on orders for accurate margins.
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle className="text-sm">P&L Waterfall</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  {waterfall.map((w, i) => (
                    <TableRow key={i}>
                      <TableCell className="flex items-center gap-2"><w.icon className="h-4 w-4 text-muted-foreground" />{w.label}</TableCell>
                      <TableCell className={`text-right font-medium ${w.sign < 0 ? "text-red-600" : ""}`}>
                        {w.sign < 0 ? "-" : ""}{formatPKR(w.value)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2">
                    <TableCell className="font-bold">Net Profit</TableCell>
                    <TableCell className={`text-right font-bold ${netProfit >= 0 ? "text-emerald-600" : "text-destructive"}`}>{formatPKR(netProfit)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Profit by Platform</CardTitle></CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Platform</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Net Revenue</TableHead>
                    <TableHead className="text-right">Net Profit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
                  ) : byPlatform.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No orders in this range</TableCell></TableRow>
                  ) : byPlatform.map((p, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{p.platform}</TableCell>
                      <TableCell className="text-right">{p.orders}</TableCell>
                      <TableCell className="text-right">{formatPKR(p.revenue - p.refunds)}</TableCell>
                      <TableCell className={`text-right font-semibold ${p.profit >= 0 ? "text-emerald-600" : "text-destructive"}`}>{formatPKR(p.profit)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {byPlatform.length > 0 && (
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-bold">Total</TableCell>
                      <TableCell className="text-right font-bold">{totals.orders}</TableCell>
                      <TableCell className="text-right font-bold">{formatPKR(netRevenue)}</TableCell>
                      <TableCell className={`text-right font-bold ${netProfit >= 0 ? "text-emerald-600" : "text-destructive"}`}>{formatPKR(netProfit)}</TableCell>
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </ERPLayout>
  );
}
