import { useEffect, useMemo, useRef, useState } from "react";
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
import { Receipt, CheckCircle2, Clock, Banknote, FileText, Info, Upload } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { formatPKR } from "@/lib/currency";
import * as XLSX from "xlsx";

interface Stmt {
  payment_ref: string; settled_date: string | null;
  deliveredCount: number; deliveredCod: number; returnedCount: number; returnedCod: number;
  parcels: number; shipping: number; gst: number; whIncome: number; whSales: number; net: number;
  officialNet: number | null;
  acknowledged: boolean; received_amount: number | null; bank_ref: string | null;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
const numOf = (v: any) => { const n = parseFloat(String(v ?? "").replace(/[(),\s]/g, "")); return isNaN(n) ? 0 : n; };

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
  const [importOpen, setImportOpen] = useState(false);
  const [importForm, setImportForm] = useState({ cpr: "", date: "" });
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchData = async () => {
    setLoading(true);
    const [oRes, aRes, cRes] = await Promise.all([
      supabase.from("online_orders")
        .select("id, order_number, tracking_number, customer_name, status, cod_amount, shipping_charges, net_amount, settled_at, payment_ref")
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
    const keys = new Set([...g.keys(), ...Object.keys(acks)]);
    return Array.from(keys).map(ref => {
      const ps = g.get(ref) || [];
      const delivered = ps.filter(o => o.status === "delivered");
      const returned = ps.filter(o => o.status === "returned" || o.status === "return_awaited");
      const deliveredCod = delivered.reduce((s, o) => s + Number(o.cod_amount || 0), 0);
      const shipping = ps.reduce((s, o) => s + Number(o.shipping_charges || 0), 0);
      const gst = shipping * rates.gst / 100;
      const whIncome = deliveredCod * rates.whInc / 100;
      const whSales = deliveredCod * rates.whSales / 100;
      const net = deliveredCod - shipping - gst - whIncome - whSales;
      const a = acks[ref];
      const date = a?.statement_date || ps.reduce((m: string | null, o) => o.settled_at && (!m || o.settled_at < m) ? o.settled_at : m, null);
      return {
        payment_ref: ref, settled_date: date,
        deliveredCount: delivered.length, deliveredCod, returnedCount: returned.length,
        returnedCod: returned.reduce((s, o) => s + Number(o.cod_amount || 0), 0),
        parcels: ps.length, shipping, gst, whIncome, whSales, net,
        officialNet: a?.official_net ?? null,
        acknowledged: !!a?.acknowledged, received_amount: a?.received_amount ?? null, bank_ref: a?.bank_ref || null,
      };
    }).sort((a, b) => (b.settled_date || "").localeCompare(a.settled_date || ""));
  }, [orders, acks, rates]);

  const pending = receipts.filter(r => !r.acknowledged);
  const acknowledged = receipts.filter(r => r.acknowledged);
  const expectedOf = (r: Stmt) => r.officialNet ?? r.net;
  const totals = useMemo(() => ({
    net: receipts.reduce((s, r) => s + expectedOf(r), 0),
    ack: acknowledged.reduce((s, r) => s + (r.received_amount ?? expectedOf(r)), 0),
    pend: pending.reduce((s, r) => s + expectedOf(r), 0),
  }), [receipts, pending, acknowledged]);

  const openAck = (r: Stmt) => {
    setAckTarget(r);
    setAckForm({ received_amount: String(Math.round(expectedOf(r))), bank_ref: "", notes: "" });
    setAckOpen(true);
  };
  const confirmAck = async () => {
    if (!ackTarget) return;
    const received = ackForm.received_amount.trim() === "" ? expectedOf(ackTarget) : Number(ackForm.received_amount);
    const { error } = await supabase.from("payment_receipts").upsert({
      payment_ref: ackTarget.payment_ref, acknowledged: true, acknowledged_at: new Date().toISOString(),
      received_amount: received, bank_ref: ackForm.bank_ref.trim() || null, notes: ackForm.notes.trim() || null,
      created_by: user?.id || null,
    }, { onConflict: "payment_ref" });
    if (error) { toast.error(error.message); return; }
    toast.success(`Acknowledged ${ackTarget.payment_ref}`);
    setAckOpen(false); setAckTarget(null); fetchData();
  };

  // Import a PostEx CPR statement (CSV/Excel): backfill/update the parcels and
  // store the official totals so the receipt matches PostEx exactly.
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const cpr = importForm.cpr.trim();
    if (!cpr) { toast.error("Enter the CPR number first"); if (fileRef.current) fileRef.current.value = ""; return; }
    setImporting(true);
    try {
      const wb = XLSX.read(await file.arrayBuffer());
      const rowsRaw: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      const rows = rowsRaw.map(r => { const m: Record<string, any> = {}; Object.entries(r).forEach(([k, v]) => (m[norm(k)] = v)); return m; });
      const pick = (m: Record<string, any>, keys: string[]) => { for (const k of keys) if (m[k] != null && m[k] !== "") return m[k]; return undefined; };

      const date = importForm.date || null;
      const { data: existing } = await supabase.from("online_orders").select("id, tracking_number").not("tracking_number", "is", null);
      const byTrack = new Map((existing || []).map((o: any) => [String(o.tracking_number), o.id]));

      let updated = 0, inserted = 0, skipped = 0;
      let dC = 0, dCod = 0, rC = 0, rCod = 0, ship = 0, gstT = 0, whi = 0, whs = 0, netT = 0;

      for (const m of rows) {
        const track = String(pick(m, ["trackingnumber", "trackingno", "cn", "tracking"]) ?? "").trim();
        if (!track) { skipped++; continue; }
        const statusRaw = String(pick(m, ["status", "ordertype", "transactionstatus"]) ?? "").toLowerCase();
        const status = statusRaw.includes("return") ? "returned" : statusRaw.includes("deliver") ? "delivered" : "delivered";
        const cod = numOf(pick(m, ["codamount", "cod", "invoicepayment"]));
        const shipping = numOf(pick(m, ["shippingcharges", "shipping", "deliverycharges"]));
        const netAmt = numOf(pick(m, ["netamount", "net", "payableamount", "payable"]));
        const gst = numOf(pick(m, ["gst"]));
        const whInc = numOf(pick(m, ["whinctax2", "whincometax2", "whinctax", "whincometax", "whinc"]));
        const whSal = numOf(pick(m, ["whsalestax2", "whsalestax", "whsales"]));

        // totals (official)
        if (status === "returned") { rC++; rCod += cod; } else { dC++; dCod += cod; }
        ship += shipping; gstT += gst; whi += whInc; whs += whSal; netT += netAmt;

        const row: any = {
          tracking_number: track, payment_ref: cpr, settled: true, settled_at: date,
          status, cod_amount: cod, shipping_charges: shipping, net_amount: netAmt,
          payment_mode: cod > 0 ? "cod" : "prepaid",
        };
        const id = byTrack.get(track);
        if (id) {
          const { error } = await supabase.from("online_orders").update(row).eq("id", id);
          if (error) skipped++; else updated++;
        } else {
          const { error } = await supabase.from("online_orders").insert({
            ...row, order_number: "", platform: "PostEx", customer_name: "PostEx (CPR import)",
            order_date: date || new Date().toISOString().slice(0, 10),
          });
          if (error) skipped++; else inserted++;
        }
      }

      const { error: prErr } = await supabase.from("payment_receipts").upsert({
        payment_ref: cpr, statement_date: date, official_net: netT,
        delivered_count: dC, delivered_cod: dCod, returned_count: rC, returned_cod: rCod,
        shipping: ship, gst: gstT, wh_income: whi, wh_sales: whs, imported_at: new Date().toISOString(),
        created_by: user?.id || null,
      }, { onConflict: "payment_ref" });
      if (prErr) throw prErr;

      toast.success(`CPR ${cpr}: ${updated} updated, ${inserted} backfilled${skipped ? `, ${skipped} skipped` : ""}. Official net ${formatPKR(netT)}`);
      setImportOpen(false); setImportForm({ cpr: "", date: "" });
      fetchData();
    } catch (err: any) {
      toast.error(`Import failed: ${err.message || err}`);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const detailParcels = useMemo(() => orders.filter(o => o.payment_ref === detail?.payment_ref), [orders, detail]);

  const renderTable = (list: Stmt[]) => (
    <Card><CardContent className="p-0 overflow-x-auto">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Receipt # (CPR)</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Parcels</TableHead>
          <TableHead className="text-right">Computed Net</TableHead><TableHead className="text-right">Official Net</TableHead>
          <TableHead className="text-right">Variance</TableHead><TableHead className="text-right">Received</TableHead><TableHead className="text-right">Action</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {loading ? (
            <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
          ) : list.length === 0 ? (
            <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No receipts</TableCell></TableRow>
          ) : list.map(r => {
            const variance = r.officialNet != null ? (r.officialNet - r.net) : null;
            return (
              <TableRow key={r.payment_ref}>
                <TableCell><Button variant="link" className="h-auto p-0 font-mono text-xs" onClick={() => setDetail(r)}>{r.payment_ref}</Button></TableCell>
                <TableCell>{r.settled_date ? format(new Date(r.settled_date), "dd MMM yyyy") : "-"}</TableCell>
                <TableCell className="text-right">{r.deliveredCount}D / {r.returnedCount}R</TableCell>
                <TableCell className="text-right">{formatPKR(r.net)}</TableCell>
                <TableCell className="text-right font-medium">{r.officialNet != null ? formatPKR(r.officialNet) : <span className="text-muted-foreground text-xs">not imported</span>}</TableCell>
                <TableCell className={`text-right ${variance && Math.abs(variance) >= 1 ? "text-destructive" : ""}`}>
                  {variance != null ? (Math.abs(variance) < 1 ? "✓ match" : formatPKR(variance)) : "-"}
                </TableCell>
                <TableCell className="text-right">{r.acknowledged ? formatPKR(Number(r.received_amount ?? expectedOf(r))) : "-"}</TableCell>
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
        <div className="flex items-start justify-between flex-wrap gap-3">
          <PageHeader title="Payment Receipts" description="PostEx settlement batches (CPR) — match, acknowledge & reconcile" icon={Receipt} iconColor="bg-emerald-600 text-white" />
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} className="gap-1"><Upload className="h-4 w-4" /> Import CPR</Button>
        </div>

        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="py-3 px-4 text-xs text-amber-800 flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <span><b>Computed Net</b> uses PostEx's formula on the parcels in the system (COD − shipping − GST {rates.gst}% − WH {rates.whInc}%+{rates.whSales}%). <b>Import CPR</b> loads PostEx's official statement (CSV/Excel) → matches exactly, fills variance, and backfills any missing parcels so the rest of the module becomes complete too.</span>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard title="Receipts" value={receipts.length} icon={FileText} iconColor="text-slate-600" />
          <MetricCard title="Net Payable" value={formatPKR(totals.net)} icon={Banknote} iconColor="text-blue-600" description="official where imported" />
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

      {/* Import CPR */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import PostEx CPR</DialogTitle>
            <DialogDescription>Download the CPR as CSV/Excel from PostEx, enter its number & date, then choose the file. Parcels are matched by tracking number; missing ones are backfilled.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div><Label>CPR Number</Label><Input value={importForm.cpr} onChange={e => setImportForm(p => ({ ...p, cpr: e.target.value }))} placeholder="e.g. CPR-16GMX982296" /></div>
            <div><Label>CPR Date</Label><Input type="date" value={importForm.date} onChange={e => setImportForm(p => ({ ...p, date: e.target.value }))} /></div>
            <Button onClick={() => fileRef.current?.click()} disabled={importing || !importForm.cpr.trim()} className="gap-1 w-full">
              <Upload className="h-4 w-4" /> {importing ? "Importing…" : "Choose CSV / Excel file"}
            </Button>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleImport} />
            <p className="text-xs text-muted-foreground">Expected columns (header names flexible): Tracking Number, Status, Shipping Charges, COD Amount, Net Amount, GST, WH Income Tax, WH Sales Tax.</p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Acknowledge */}
      <Dialog open={ackOpen} onOpenChange={setAckOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Acknowledge Payment</DialogTitle>
            <DialogDescription>{ackTarget?.payment_ref} · expected {ackTarget ? formatPKR(expectedOf(ackTarget)) : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div><Label>Net received in bank (Rs.)</Label><Input type="number" value={ackForm.received_amount} onChange={e => setAckForm(p => ({ ...p, received_amount: e.target.value }))} /></div>
            <div><Label>Bank / transaction reference</Label><Input value={ackForm.bank_ref} onChange={e => setAckForm(p => ({ ...p, bank_ref: e.target.value }))} placeholder="optional" /></div>
            <div><Label>Notes</Label><Input value={ackForm.notes} onChange={e => setAckForm(p => ({ ...p, notes: e.target.value }))} placeholder="optional" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAckOpen(false)}>Cancel</Button>
            <Button onClick={confirmAck}>Confirm Received</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Statement detail */}
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
              <div className="flex justify-between text-base py-2 border-t-2 font-bold"><span>Computed Net</span><span>{formatPKR(detail.net)}</span></div>
              {detail.officialNet != null && (
                <div className="flex justify-between text-base font-bold"><span>PostEx Official Net</span><span className="text-emerald-700">{formatPKR(detail.officialNet)}</span></div>
              )}
              {detail.officialNet != null && Math.abs(detail.officialNet - detail.net) >= 1 && (
                <p className="text-[11px] text-destructive pt-1">Variance {formatPKR(detail.officialNet - detail.net)} — some parcels in this CPR may still be missing from the system.</p>
              )}
            </div>
          )}
          <div className="border-t pt-2">
            <p className="text-xs font-medium text-muted-foreground mb-1">Parcels in this receipt ({detailParcels.length})</p>
            <Table>
              <TableHeader><TableRow><TableHead>Tracking</TableHead><TableHead>Status</TableHead><TableHead className="text-right">COD</TableHead></TableRow></TableHeader>
              <TableBody>
                {detailParcels.map(o => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono text-[10px]">{o.tracking_number}</TableCell>
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
