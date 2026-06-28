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
import { Receipt, CheckCircle2, Clock, Banknote, FileText } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { formatPKR } from "@/lib/currency";

interface ReceiptRow {
  payment_ref: string; parcels: number; expected: number; settled_date: string | null;
  acknowledged: boolean; acknowledged_at: string | null; received_amount: number | null; bank_ref: string | null;
}

export default function OnlinePaymentReceiptsPage() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [acks, setAcks] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("pending");
  const [ackOpen, setAckOpen] = useState(false);
  const [ackTarget, setAckTarget] = useState<ReceiptRow | null>(null);
  const [ackForm, setAckForm] = useState({ received_amount: "", bank_ref: "", notes: "" });
  const [drill, setDrill] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    const [oRes, aRes] = await Promise.all([
      supabase.from("online_orders")
        .select("id, order_number, tracking_number, customer_name, net_amount, settled_at, payment_ref")
        .eq("settled", true).not("payment_ref", "is", null).neq("payment_ref", ""),
      supabase.from("payment_receipts").select("*"),
    ]);
    setOrders(oRes.data || []);
    const map: Record<string, any> = {};
    (aRes.data || []).forEach((a: any) => (map[a.payment_ref] = a));
    setAcks(map);
    setLoading(false);
  };
  useEffect(() => { fetchData(); }, []);

  const receipts: ReceiptRow[] = useMemo(() => {
    const g = new Map<string, { parcels: number; expected: number; date: string | null }>();
    orders.forEach(o => {
      const k = o.payment_ref;
      const cur = g.get(k) || { parcels: 0, expected: 0, date: null };
      cur.parcels += 1;
      cur.expected += Number(o.net_amount || 0);
      if (o.settled_at && (!cur.date || o.settled_at < cur.date)) cur.date = o.settled_at;
      g.set(k, cur);
    });
    return Array.from(g.entries()).map(([ref, v]) => {
      const a = acks[ref];
      return {
        payment_ref: ref, parcels: v.parcels, expected: v.expected, settled_date: v.date,
        acknowledged: !!a?.acknowledged, acknowledged_at: a?.acknowledged_at || null,
        received_amount: a?.received_amount ?? null, bank_ref: a?.bank_ref || null,
      };
    }).sort((a, b) => (b.settled_date || "").localeCompare(a.settled_date || ""));
  }, [orders, acks]);

  const pending = receipts.filter(r => !r.acknowledged);
  const acknowledged = receipts.filter(r => r.acknowledged);
  const totals = useMemo(() => ({
    settled: receipts.reduce((s, r) => s + r.expected, 0),
    ackAmount: acknowledged.reduce((s, r) => s + (r.received_amount ?? r.expected), 0),
    pendingAmount: pending.reduce((s, r) => s + r.expected, 0),
  }), [receipts, pending, acknowledged]);

  const openAck = (r: ReceiptRow) => {
    setAckTarget(r);
    setAckForm({ received_amount: String(Math.round(r.expected)), bank_ref: "", notes: "" });
    setAckOpen(true);
  };

  const confirmAck = async () => {
    if (!ackTarget) return;
    const received = ackForm.received_amount.trim() === "" ? ackTarget.expected : Number(ackForm.received_amount);
    const { error } = await supabase.from("payment_receipts").upsert({
      payment_ref: ackTarget.payment_ref, acknowledged: true, acknowledged_at: new Date().toISOString(),
      received_amount: received, bank_ref: ackForm.bank_ref.trim() || null, notes: ackForm.notes.trim() || null,
      created_by: user?.id || null,
    }, { onConflict: "payment_ref" });
    if (error) { toast.error(error.message); return; }
    toast.success(`Acknowledged ${ackTarget.payment_ref}`);
    setAckOpen(false); setAckTarget(null);
    fetchData();
  };

  const drillParcels = useMemo(() => orders.filter(o => o.payment_ref === drill), [orders, drill]);

  const renderTable = (list: ReceiptRow[]) => (
    <Card><CardContent className="p-0 overflow-x-auto">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Receipt # (CPR)</TableHead><TableHead>Settled Date</TableHead><TableHead className="text-right">Parcels</TableHead>
          <TableHead className="text-right">Expected</TableHead><TableHead className="text-right">Received</TableHead>
          <TableHead className="text-right">Variance</TableHead><TableHead>Bank Ref</TableHead><TableHead className="text-right">Action</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {loading ? (
            <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
          ) : list.length === 0 ? (
            <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No receipts</TableCell></TableRow>
          ) : list.map(r => {
            const variance = r.acknowledged ? (Number(r.received_amount ?? r.expected) - r.expected) : 0;
            return (
              <TableRow key={r.payment_ref}>
                <TableCell className="font-mono text-xs font-medium">{r.payment_ref}</TableCell>
                <TableCell>{r.settled_date ? format(new Date(r.settled_date), "dd MMM yyyy") : "-"}</TableCell>
                <TableCell className="text-right">
                  <Button variant="link" className="h-auto p-0 text-xs" onClick={() => setDrill(r.payment_ref)}>{r.parcels}</Button>
                </TableCell>
                <TableCell className="text-right font-medium">{formatPKR(r.expected)}</TableCell>
                <TableCell className="text-right">{r.acknowledged ? formatPKR(Number(r.received_amount ?? r.expected)) : "-"}</TableCell>
                <TableCell className={`text-right ${variance < 0 ? "text-destructive" : variance > 0 ? "text-emerald-600" : ""}`}>
                  {r.acknowledged && variance !== 0 ? formatPKR(variance) : (r.acknowledged ? "—" : "-")}
                </TableCell>
                <TableCell className="font-mono text-xs">{r.bank_ref || "-"}</TableCell>
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

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Payment Receipts" description="PostEx settlement batches (CPR) — acknowledge funds received in bank" icon={Receipt} iconColor="bg-emerald-600 text-white" />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard title="Receipts" value={receipts.length} icon={FileText} iconColor="text-slate-600" />
          <MetricCard title="Total Settled" value={formatPKR(totals.settled)} icon={Banknote} iconColor="text-blue-600" />
          <MetricCard title="Acknowledged" value={formatPKR(totals.ackAmount)} icon={CheckCircle2} iconColor="text-emerald-600" description={`${acknowledged.length} receipts`} />
          <MetricCard title="Pending Acknowledgement" value={formatPKR(totals.pendingAmount)} icon={Clock} iconColor="text-amber-600" description={`${pending.length} receipts`} />
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
            <DialogDescription>{ackTarget?.payment_ref} · {ackTarget?.parcels} parcels · expected {ackTarget ? formatPKR(ackTarget.expected) : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div><Label>Amount received in bank (Rs.)</Label><Input type="number" value={ackForm.received_amount} onChange={e => setAckForm(p => ({ ...p, received_amount: e.target.value }))} /></div>
            <div><Label>Bank / transaction reference</Label><Input value={ackForm.bank_ref} onChange={e => setAckForm(p => ({ ...p, bank_ref: e.target.value }))} placeholder="optional" /></div>
            <div><Label>Notes</Label><Input value={ackForm.notes} onChange={e => setAckForm(p => ({ ...p, notes: e.target.value }))} placeholder="optional" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAckOpen(false)}>Cancel</Button>
            <Button onClick={confirmAck}>Confirm Received</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Parcels under a receipt */}
      <Dialog open={!!drill} onOpenChange={v => !v && setDrill(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Parcels in {drill}</DialogTitle></DialogHeader>
          <Table>
            <TableHeader><TableRow><TableHead>Order #</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">Net</TableHead></TableRow></TableHeader>
            <TableBody>
              {drillParcels.map(o => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.order_number}<div className="font-mono text-[10px] text-muted-foreground">{o.tracking_number}</div></TableCell>
                  <TableCell>{o.customer_name}</TableCell>
                  <TableCell className="text-right">{Number(o.net_amount || 0).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
