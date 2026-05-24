import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart3, Download, Wallet, Banknote, Package, ShoppingCart } from "lucide-react";
import { toast } from "sonner";

interface OrderRow { id: string; item_id: string | null; item_name: string | null; quantity: number | null; payment_mode: string | null; order_date: string; order_value: number | null }
interface ItemRow { id: string; name: string; price: number | null }
interface ReturnRow { order_id: string; refund_amount: number | null }

const fmtPKR = (n: number) => `Rs. ${Math.round(n).toLocaleString()}`;

function firstOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function OnlineSalesAnalysisPage() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [returns, setReturns] = useState<ReturnRow[]>([]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [oRes, iRes] = await Promise.all([
        supabase.from("online_orders")
          .select("id,item_id,item_name,quantity,payment_mode,order_date,order_value")
          .gte("order_date", from).lte("order_date", to),
        supabase.from("online_items").select("id,name,price"),
      ]);
      if (oRes.error) throw oRes.error;
      if (iRes.error) throw iRes.error;

      const orderRows = (oRes.data as OrderRow[]) || [];
      const orderIds = orderRows.map(o => o.id);

      let returnRows: ReturnRow[] = [];
      if (orderIds.length) {
        const { data: rData, error: rErr } = await supabase
          .from("online_returns")
          .select("order_id,refund_amount")
          .in("order_id", orderIds);
        if (rErr) throw rErr;
        returnRows = (rData as ReturnRow[]) || [];
      }

      setOrders(orderRows);
      setItems((iRes.data as ItemRow[]) || []);
      setReturns(returnRows);
    } catch (e: any) {
      toast.error(e.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line */ }, []);

  const { totals, breakdown } = useMemo(() => {
    const itemMap = new Map(items.map(i => [i.id, i]));
    const itemByName = new Map(items.map(i => [i.name.trim().toLowerCase(), i]));
    const refundByOrder = new Map<string, number>();
    returns.forEach(r => {
      refundByOrder.set(r.order_id, (refundByOrder.get(r.order_id) || 0) + Number(r.refund_amount || 0));
    });

    let grossTotal = 0, grossCOD = 0, grossPrep = 0;
    let refTotal = 0, refCOD = 0, refPrep = 0;
    let returnedOrders = 0;

    type Agg = { name: string; qty: number; price: number; gross: number; refund: number };
    const byItem = new Map<string, Agg>();

    orders.forEach(o => {
      let item = o.item_id ? itemMap.get(o.item_id) : undefined;
      if (!item && o.item_name) item = itemByName.get(o.item_name.trim().toLowerCase());
      const qty = Number(o.quantity || 0);
      const price = Number(item?.price || 0);
      // Fallback: use order_value if no item price linked
      const gross = price > 0 ? price * qty : Number(o.order_value || 0);
      const effectivePrice = price > 0 ? price : (qty > 0 ? gross / qty : 0);
      const refund = refundByOrder.get(o.id) || 0;
      const isCOD = (o.payment_mode || "").toLowerCase() === "cod";

      grossTotal += gross;
      refTotal += refund;
      if (refund > 0) returnedOrders += 1;

      if (isCOD) { grossCOD += gross; refCOD += refund; }
      else { grossPrep += gross; refPrep += refund; }

      const key = item?.id || (o.item_name?.trim() || "__unknown__");
      const name = item?.name || o.item_name || "(Unknown / unmapped)";
      const cur = byItem.get(key) || { name, qty: 0, price: effectivePrice, gross: 0, refund: 0 };
      cur.qty += qty;
      cur.gross += gross;
      cur.refund += refund;
      cur.price = effectivePrice;
      byItem.set(key, cur);
    });

    const breakdown = Array.from(byItem.values())
      .map(r => ({ ...r, net: r.gross - r.refund }))
      .sort((a, b) => b.net - a.net);

    return {
      totals: {
        grossTotal, netTotal: grossTotal - refTotal,
        grossCOD, netCOD: grossCOD - refCOD,
        grossPrep, netPrep: grossPrep - refPrep,
        orders: orders.length, returnedOrders,
      },
      breakdown,
    };
  }, [orders, items, returns]);

  const exportCSV = () => {
    const header = ["Item", "Qty Sold", "Unit Price", "Gross Sales", "Returns", "Net Sales"];
    const rows = breakdown.map(r => [r.name, r.qty, r.price, r.gross, r.refund, r.net]);
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `online-sales-analysis_${from}_to_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Sales Analysis" description="Total sales calculated from item price × quantity, net of returns" icon={BarChart3} iconColor="bg-emerald-600 text-white" />

        <Card>
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <div>
              <Label>From</Label>
              <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-44" />
            </div>
            <div>
              <Label>To</Label>
              <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-44" />
            </div>
            <Button onClick={fetchAll} disabled={loading}>{loading ? "Loading..." : "Apply"}</Button>
            <Button variant="outline" onClick={exportCSV} disabled={!breakdown.length}>
              <Download className="h-4 w-4 mr-1" /> Export CSV
            </Button>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard title="Total Sales (Net)" value={fmtPKR(totals.netTotal)} icon={BarChart3} iconColor="text-emerald-600" description={`Gross ${fmtPKR(totals.grossTotal)}`} />
          <MetricCard title="COD Sales (Net)" value={fmtPKR(totals.netCOD)} icon={Banknote} iconColor="text-amber-600" description={`Gross ${fmtPKR(totals.grossCOD)}`} />
          <MetricCard title="Prepaid Sales (Net)" value={fmtPKR(totals.netPrep)} icon={Wallet} iconColor="text-blue-600" description={`Gross ${fmtPKR(totals.grossPrep)}`} />
          <MetricCard title="Orders" value={totals.orders.toLocaleString()} icon={ShoppingCart} iconColor="text-slate-600" description={`${totals.returnedOrders} with returns`} />
        </div>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><Package className="h-4 w-4 inline mr-1" />Item</TableHead>
                  <TableHead className="text-right">Qty Sold</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead className="text-right">Gross Sales</TableHead>
                  <TableHead className="text-right">Returns</TableHead>
                  <TableHead className="text-right">Net Sales</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
                ) : breakdown.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No orders in this date range</TableCell></TableRow>
                ) : breakdown.map((r, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-right">{r.qty.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{fmtPKR(r.price)}</TableCell>
                    <TableCell className="text-right">{fmtPKR(r.gross)}</TableCell>
                    <TableCell className="text-right text-red-600">{r.refund ? fmtPKR(r.refund) : "-"}</TableCell>
                    <TableCell className="text-right font-semibold">{fmtPKR(r.net)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              {breakdown.length > 0 && (
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-bold">Total</TableCell>
                    <TableCell className="text-right font-bold">{breakdown.reduce((s, r) => s + r.qty, 0).toLocaleString()}</TableCell>
                    <TableCell />
                    <TableCell className="text-right font-bold">{fmtPKR(totals.grossTotal)}</TableCell>
                    <TableCell className="text-right font-bold text-red-600">{fmtPKR(totals.grossTotal - totals.netTotal)}</TableCell>
                    <TableCell className="text-right font-bold">{fmtPKR(totals.netTotal)}</TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
