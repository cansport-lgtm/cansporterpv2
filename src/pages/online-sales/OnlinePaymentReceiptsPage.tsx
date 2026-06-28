import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Receipt, CheckCircle2, Clock, Banknote, FileText, Info } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { formatPKR } from "@/lib/currency";

interface Stmt {
  payment_ref: string; settled_date: string | null;
  deliveredCount: number; deliveredCod: number;
  returnedCount: number; returnedCod: number;
  parcels: number; shipping: number;
  gst: number; whIncome: number; whSales: number; net: number;
  acknowledged: boolean; received_amount: number | null; bank_ref: string | null;
}

export default function OnlinePaymentReceiptsPage() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [acks, setAcks] = useState<Record<string, any>>({});
  const [rates, setRates] = useState({ gst: 15, whInc: 2, whSales: 2 });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("pending");
  const [ackOpen, setAckOpen] = useState(false);
  const [ackTarget, setAckTarget] = useState<Stmt | null>(null);
  const [ackForm, setAckForm] = useState({ received_amount: "", bank_ref: "", notes: "" });
  const [detail, setDetail] = useState<Stmt | null>(null);

  const fetchData = async () => {
    setLoading(true);
    const [oRes, aRes, cRes] = await Promise.all([
      supabase.from("online_orders")
        .select("id, order_number, tracking_number, customer_name, status, cod_amount, shipping_charges, settled_at, payment_ref")
        .not("payment_ref", "is", null).neq("payment_ref", ""),
      supabase.from("payment_receipts").select("*"),
      supabase.from("courier_partners").select("config").eq("code", "POSTEX").single(),
    ]);
    setOrders(oRes.data || []);
    const map: Record<string, any> = {};
    (aRes.data || []).forEach((a: any) => (map[a.payment_ref] = a));
    setAcks(map);
    const c = (cRes.data as any)?.config || {};
    setRates({ gst: Number(c.gst_pct ?? 15), whInc: Number(c.wh_income_pct ?? 2), whSales: Number(c.wh_sales_pct ?? 2) });
    setLoading(false);
  };
  useEffect(() => { fetchData(); }, []);

  const receipts: Stmt[] = useMemo(() => {
    const g = new Map<string, any[]>();
    orders.forEach(o => { const k = o.payment_ref; if (!g.has(k)) g.set(k, []); g.get(k)!.push(o); });
    return Array.from(g.entries()).map(([ref, ps]) => {
      const delivered = ps.filter(o => o.status === "delivered");
      const returned = ps.filter(o => o.status === "returned" || o.status === "return_awaited");
      const deliveredCod = delivered.reduce((s, o) => s + Number(o.cod_amount || 0), 0);
      const shipping = ps.reduce((s, o) => s + Number(o.shipping_charges || 0), 0);
      const gst = shipping * rates.gst / 100;
      const whIncome = deliveredCod * rates.whInc / 100;
      const whSales = deliveredCod * rates.whSales / 100;
      const net = deliveredCod - shipping - gst - whIncome - whSales;
      const date = ps.reduce((m: string | null, o) => o.settled_at && (!m || o.settled_at < m) ? o.settled_at : m, null);
      const a = acks[ref];
      return {
        payment_ref: ref, settled_date: date,
        deliveredCount: delivered.length, deliveredCod,
        returnedCount: returned.length, returnedCod: returned.reduce((s, o) => s + Number(o.cod_amount || 0), 0),
        parcels: ps.length, shipping, gst, whIncome, whSales, net,
        acknowledged: !!a?.acknowledged, received_amount: a?.received_amount ?? null, bank_ref: a?.bank_ref || null,
      };
    }).sort((a, b) => (b.settled_date || "").localeCompare(a.settled_date || ""));
  }, [orders, acks, rates]);

  const pending = receipts.filter(r => !r.acknowledged);
  const acknowledged = receipts.filter(r => r.acknowledged);
  const totals = useMemo(() => ({
    net: receipts.reduce((s, r) => s + r.net, 0),
    ack: acknowledged.reduce((s, r) => s + (r.received_amount ?? r.net), 0),
    pend: pending.reduce((s, r) => s + r.net, 0),
  }), [receipts, pending, acknowledged]);

  const openAck = (r: Stmt) => {
    setAckTarget(r);
    setAckForm({ received_amount: String(Math.round(r.net)), bank_ref: "", notes: "" });
    setAckOpen(true);
  };
  const confirmAck = async () => {
    if (!ackTarget) return;
    const received = ackForm.received_amount.trim() === "" ? ackTarget.net : Number(ackForm.received_amount);
    const { error } = await supabase.from("payment_receipts").upsert({
      payment_ref: ackTarget.payment_ref, acknowledged: true, acknowledged_at: new Date().toISOString(),
      received_amount: received, bank_ref: ackForm.bank_ref.trim() || null, notes: ackForm.notes.trim() || null,
      created_by: user?.id || null,
    }, { onConflict: "payment_ref" });
    if (error) { toast.error(error.message); return; }
    toast.success(`Acknowledged ${ackTarget.payment_ref}`);
    setAckOpen(false); setAckTarget(null); fetchData();
  };

  const detailParcels = useMemo(() => orders.filter(o => o.payment_ref === detail?.payment_ref), [orders, detail]);

  const renderTable = (list: Stmt[]) => (
    <Card><CardContent className="p-0 overflow-x-auto">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Receipt # (CPR)</TableHead><TableHead>Settled</TableHead><TableHead className="text-right">Parcels</TableHead>
          <TableHead className="text-right">Delivered COD</TableHead><TableHead className="text-right">Computed Net</TableHead>
          <TableHead className="text-right">Received</TableHead><TableHead className="text-right">Variance</TableHead><TableHead className="text-right">Action</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {loading ? (
            <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
          ) : list.length === 0 ? (
            <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No receipts</TableCell></TableRow>
          ) : list.map(r => {
            const variance = r.acknowledged ? (Number(r.received_amount ?? r.net) - r.net) : 0;
            return (
              <TableRow key={r.payment_ref}>
                <TableCell><Button variant="link" className="h-auto p-0 font-mono text-xs" onClick={() => setDetail(r)}>{r.payment_ref}</Button></TableCell>
                <TableCell>{r.settled_date ? format(new Date(r.settled_date), "dd MMM yyyy") : "-"}</TableCell>
                <TableCell className="text-right">{r.deliveredCount}D / {r.returnedCount}R</TableCell>
                <TableCell className="text-right">{formatPKR(r.deliveredCod)}</TableCell>
                <TableCell className="text-right font-medium">{formatPKR(r.net)}</TableCell>
                <TableCell className="text-right">{r.acknowledged ? formatPKR(Number(r.received_amount ?? r.net)) : "-"}</TableCell>
                <TableCell className={`text-right ${variance < 0 ? "text-destructive" : variance > 0 ? "text-emerald-600" : ""}`}>
                  {r.acknowledged ? (variance !== 0 ? formatPKR(variance) : "—") : "-"}
                </TableCell>
                <TableCell className="text-right">
                  {r.acknowledged
                    ? <Badge className="bg-emerald-100 text-emerald-800 border-emerald-400">Acknowledged</Badge>
                    : <Button size="sm" variant="outline" className="h-8" onClick={() => openAck(r)}>Acknowledge</Button>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </CardContent></Card>
  );

  const Line = ({ label, value, count, neg }: { label: string; value: number; count?: number; neg?: boolean }) => (
    <div className="flex justify-between text-sm py-1">
      <span className="text-muted-foreground">{label}{count != null ? ` (${count})` : ""}</span>
      <span className={neg ? "text-red-600" : ""}>{neg ? "(" : ""}{formatPKR(Math.abs(value))}{neg ? ")" : ""}</span>
    </div>
  );

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Payment Receipts" description="PostEx settlement batches (CPR) — acknowledge funds received in bank" icon={Receipt} iconColor="bg-emerald-600 text-white" />

        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="py-3 px-4 text-xs text-amber-800 flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <span>Net is computed from parcels in the system using PostEx's formula (Delivered COD − Shipping − GST {rates.gst}% − WH Income {rates.whInc}% − WH Sales {rates.whSales}%). If a CPR has more parcels in PostEx than imported here, the computed net will differ — enter PostEx's official net when you acknowledge to record the exact figure (variance is shown).</span>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard title="Receipts" value={receipts.length} icon={FileText} iconColor="text-slate-600" />
          <MetricCard title="Computed Net" value={formatPKR(totals.net)} icon={Banknote} iconColor="text-blue-600" />
          <MetricCard title="Acknowledged" value={formatPKR(totals.ack)} icon={CheckCircle2} iconColor="text-emerald-600" description={`${acknowledged.length} receipts`} />
          <MetricCard title="Pending" value={formatPKR(totals.pend)} icon={Clock} iconColor="text-amber-600" description={`${pending.length} receipts`} />
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
            <TabsTrigger value="acknowledged">Acknowledged ({acknowledged.length})</TabsTrigger>
            <TabsTrigger value="all">All ({receipts.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="pending">{renderTable(pending)}</TabsContent>
          <TabsContent value="acknowledged">{renderTable(acknowledged)}</TabsContent>
          <TabsContent value="all">{renderTable(receipts)}</TabsContent>
        </Tabs>
      </div>

      {/* Acknowledge dialog */}
      <Dialog open={ackOpen} onOpenChange={setAckOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Acknowledge Payment</DialogTitle>
            <DialogDescription>{ackTarget?.payment_ref} · computed net {ackTarget ? formatPKR(ackTarget.net) : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div><Label>Net received in bank (Rs.) — use PostEx's official figure</Label><Input type="number" value={ackForm.received_amount} onChange={e => setAckForm(p => ({ ...p, received_amount: e.target.value }))} /></div>
            <div><Label>Bank / transaction reference</Label><Input value={ackForm.bank_ref} onChange={e => setAckForm(p => ({ ...p, bank_ref: e.target.value }))} placeholder="optional" /></div>
            <div><Label>Notes</Label><Input value={ackForm.notes} onChange={e => setAckForm(p => ({ ...p, notes: e.target.value }))} placeholder="optional" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAckOpen(false)}>Cancel</Button>
            <Button onClick={confirmAck}>Confirm Received</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Statement detail (PostEx Cash Payment Receipt format) */}
      <Dialog open={!!detail} onOpenChange={v => !v && setDetail(null)}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cash Payment Receipt</DialogTitle>
            <DialogDescription className="font-mono">{detail?.payment_ref} · {detail?.settled_date ? format(new Date(detail.settled_date), "dd MMM yyyy") : ""}</DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-1">
              <Line label="Delivered (COD)" value={detail.deliveredCod} count={detail.deliveredCount} />
              <Line label="Returned (COD, not payable)" value={detail.returnedCod} count={detail.returnedCount} />
              <div className="flex justify-between text-sm py-1 border-t font-medium"><span>Total COD</span><span>{formatPKR(detail.deliveredCod)}</span></div>
              <Line label="Shipping Charges" value={detail.shipping} count={detail.parcels} neg />
              <Line label={`GST (${rates.gst}% of shipping)`} value={detail.gst} neg />
              <Line label={`WH Income Tax (${rates.whInc}%)`} value={detail.whIncome} neg />
              <Line label={`WH Sales Tax (${rates.whSales}%)`} value={detail.whSales} neg />
              <div className="flex justify-between text-base py-2 border-t-2 font-bold"><span>Net Payable</span><span className="text-emerald-700">{formatPKR(detail.net)}</span></div>
              <p className="text-[11px] text-muted-foreground pt-1">Computed from {detail.parcels} parcel(s) in the system. If PostEx's receipt shows more parcels, acknowledge with PostEx's official net.</p>
            </div>
          )}
          <div className="border-t pt-2">
            <p className="text-xs font-medium text-muted-foreground mb-1">Parcels in this receipt</p>
            <Table>
              <TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Status</TableHead><TableHead className="text-right">COD</TableHead></TableRow></TableHeader>
              <TableBody>
                {detailParcels.map(o => (
                  <TableRow key={o.id}>
                    <TableCell className="text-xs">{o.order_number}<div className="font-mono text-[10px] text-muted-foreground">{o.tracking_number}</div></TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{(o.status || "").replace(/_/g, " ")}</Badge></TableCell>
                    <TableCell className="text-right text-xs">{Number(o.cod_amount || 0).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
