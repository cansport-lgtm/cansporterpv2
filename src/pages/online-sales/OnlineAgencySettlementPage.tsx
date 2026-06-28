import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Handshake, Save, Printer, CheckCircle2, Wallet, Percent, Building2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { formatPKR } from "@/lib/currency";

const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function OnlineAgencySettlementPage() {
  const { user } = useAuth();
  const [agencies, setAgencies] = useState<any[]>([]);
  const [agencyId, setAgencyId] = useState("");
  const [period, setPeriod] = useState(thisMonth());
  const [calc, setCalc] = useState<{ gross: number; returned: number; shipping: number; base: number } | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [settlements, setSettlements] = useState<any[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<any>(null);
  const [payForm, setPayForm] = useState({ payment_ref: "", notes: "" });

  const agency = useMemo(() => agencies.find(a => a.id === agencyId), [agencies, agencyId]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("agencies").select("*").eq("is_active", true).order("name");
      setAgencies(data || []);
      if (data && data.length && !agencyId) setAgencyId(data[0].id);
    })();
  }, []);

  const fetchSettlements = async () => {
    if (!agencyId) return;
    const { data } = await supabase.from("agency_settlements").select("*").eq("agency_id", agencyId).order("period", { ascending: false });
    setSettlements(data || []);
  };
  useEffect(() => { fetchSettlements(); }, [agencyId]);

  const compute = async () => {
    if (!period) return;
    setCalculating(true);
    const from = `${period}-01`;
    const d = new Date(`${period}-01T00:00:00`);
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
    const { data } = await supabase.from("online_orders")
      .select("order_value, shipping_charges, status")
      .neq("status", "cancelled").gte("order_date", from).lte("order_date", to);
    const rows = data || [];
    const gross = rows.reduce((s, o) => s + Number(o.order_value || 0), 0);
    const returned = rows.filter(o => o.status === "returned" || o.status === "return_awaited").reduce((s, o) => s + Number(o.order_value || 0), 0);
    const shipping = rows.reduce((s, o) => s + Number(o.shipping_charges || 0), 0);
    setCalc({ gross, returned, shipping, base: gross - returned - shipping });
    setCalculating(false);
  };
  useEffect(() => { compute(); /* eslint-disable-next-line */ }, [period, agencyId]);

  const commission = calc && agency ? calc.base * Number(agency.commission_pct || 0) / 100 : 0;
  const fixed = agency ? Number(agency.monthly_fixed || 0) : 0;
  const total = commission + fixed;

  const saveSettlement = async () => {
    if (!agency || !calc) return;
    const { error } = await supabase.from("agency_settlements").upsert({
      agency_id: agency.id, period, fixed_amount: fixed, commission_base: calc.base,
      commission_pct: Number(agency.commission_pct || 0), commission_amount: commission, total_amount: total,
      created_by: user?.id || null,
    }, { onConflict: "agency_id,period" });
    if (error) { toast.error(error.message); return; }
    toast.success(`Settlement saved for ${period}`);
    fetchSettlements();
  };

  const markPaid = async () => {
    if (!payTarget) return;
    const { error } = await supabase.from("agency_settlements").update({
      status: "paid", paid_at: new Date().toISOString(), payment_ref: payForm.payment_ref.trim() || null, notes: payForm.notes.trim() || null,
    }).eq("id", payTarget.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Marked paid"); setPayOpen(false); setPayTarget(null); fetchSettlements();
  };

  const printStatement = (s: any) => {
    const a = agency;
    const html = `<!DOCTYPE html><html><head><title>Agency Settlement ${s.period}</title></head>
    <body style="font-family:Arial,sans-serif;padding:32px;max-width:640px;margin:auto">
      <h2 style="margin:0">Cansport — Agency Settlement</h2>
      <p style="color:#666;margin:4px 0 16px">Period: <b>${s.period}</b> · Generated ${format(new Date(), "dd MMM yyyy")}</p>
      <div style="border:1px solid #ddd;border-radius:8px;padding:16px;margin-bottom:16px">
        <div><b>Agency:</b> ${a?.name || ""}</div>
        ${a?.contact ? `<div><b>Contact:</b> ${a.contact}</div>` : ""}
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:8px 0">Gross Sales</td><td style="text-align:right">Rs. ${Math.round(s.commission_base + 0).toLocaleString()}</td></tr>
        <tr><td colspan="2" style="border-bottom:1px solid #eee"></td></tr>
        <tr><td style="padding:8px 0;color:#555">Commission base (net sales = gross − returns − shipping)</td><td style="text-align:right">Rs. ${Math.round(s.commission_base).toLocaleString()}</td></tr>
        <tr><td style="padding:8px 0">Commission @ ${Number(s.commission_pct)}%</td><td style="text-align:right">Rs. ${Math.round(s.commission_amount).toLocaleString()}</td></tr>
        <tr><td style="padding:8px 0">Monthly Fixed Fee</td><td style="text-align:right">Rs. ${Math.round(s.fixed_amount).toLocaleString()}</td></tr>
        <tr style="border-top:2px solid #333"><td style="padding:10px 0;font-weight:bold;font-size:16px">Total Payable</td><td style="text-align:right;font-weight:bold;font-size:16px">Rs. ${Math.round(s.total_amount).toLocaleString()}</td></tr>
      </table>
      <p style="margin-top:16px">Status: <b>${(s.status || "pending").toUpperCase()}</b>${s.paid_at ? ` (paid ${format(new Date(s.paid_at), "dd MMM yyyy")}${s.payment_ref ? ", ref " + s.payment_ref : ""})` : ""}</p>
      <script>window.print()</script>
    </body></html>`;
    const w = window.open("", "_blank"); if (w) { w.document.write(html); w.document.close(); }
  };

  const whatsappShare = (s: any) => {
    const a = agency;
    const rs = (n: number) => "Rs. " + Math.round(Number(n || 0)).toLocaleString();
    const lines = [
      "*Cansport — Agency Settlement*",
      `Agency: ${a?.name || ""}`,
      `Period: ${s.period}`,
      "————————————",
      `Net Sales (base): ${rs(s.commission_base)}`,
      `Commission @ ${Number(s.commission_pct)}%: ${rs(s.commission_amount)}`,
      `Monthly Fixed Fee: ${rs(s.fixed_amount)}`,
      `*Total Payable: ${rs(s.total_amount)}*`,
      `Status: ${(s.status || "pending").toUpperCase()}${s.paid_at ? ` (paid${s.payment_ref ? ", ref " + s.payment_ref : ""})` : ""}`,
    ];
    const text = encodeURIComponent(lines.join("\n"));
    // If the agency contact looks like a phone number, address the chat to it.
    const digits = (a?.contact || "").replace(/[^\d]/g, "");
    const url = digits.length >= 10 ? `https://wa.me/${digits}?text=${text}` : `https://wa.me/?text=${text}`;
    window.open(url, "_blank");
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Agency Settlement" description="Monthly agency bill: fixed fee + commission on net sales — generate & share" icon={Handshake} iconColor="bg-emerald-600 text-white" />

        <Card><CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div><Label>Agency</Label>
            <Select value={agencyId} onValueChange={setAgencyId}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Select agency" /></SelectTrigger>
              <SelectContent>{agencies.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Month</Label><Input type="month" value={period} onChange={e => setPeriod(e.target.value)} className="w-44" /></div>
          <Button onClick={compute} disabled={calculating}>{calculating ? "Calculating…" : "Recalculate"}</Button>
        </CardContent></Card>

        {agencies.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">No active agencies — add one on the Agencies page first.</CardContent></Card>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard title="Net Sales (base)" value={formatPKR(calc?.base || 0)} icon={Wallet} iconColor="text-blue-600" description={calc ? `Gross ${formatPKR(calc.gross)} − ret ${formatPKR(calc.returned)} − ship ${formatPKR(calc.shipping)}` : ""} />
              <MetricCard title={`Commission @ ${Number(agency?.commission_pct || 0)}%`} value={formatPKR(commission)} icon={Percent} iconColor="text-purple-600" />
              <MetricCard title="Monthly Fixed" value={formatPKR(fixed)} icon={Building2} iconColor="text-amber-600" />
              <MetricCard title="Total Payable" value={formatPKR(total)} icon={Handshake} iconColor="text-emerald-600" />
            </div>

            <div className="flex gap-2">
              <Button onClick={saveSettlement} disabled={!calc} className="gap-1"><Save className="h-4 w-4" /> Save Settlement for {period}</Button>
            </div>

            <Card>
              <CardHeader><CardTitle className="text-sm">Saved Settlements — {agency?.name}</CardTitle></CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Period</TableHead><TableHead className="text-right">Net Sales</TableHead>
                    <TableHead className="text-right">Commission</TableHead><TableHead className="text-right">Fixed</TableHead>
                    <TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {settlements.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No saved settlements</TableCell></TableRow>
                    ) : settlements.map(s => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.period}</TableCell>
                        <TableCell className="text-right">{formatPKR(s.commission_base)}</TableCell>
                        <TableCell className="text-right">{formatPKR(s.commission_amount)} <span className="text-xs text-muted-foreground">@{Number(s.commission_pct)}%</span></TableCell>
                        <TableCell className="text-right">{formatPKR(s.fixed_amount)}</TableCell>
                        <TableCell className="text-right font-semibold">{formatPKR(s.total_amount)}</TableCell>
                        <TableCell>{s.status === "paid" ? <Badge className="bg-emerald-100 text-emerald-800 border-emerald-400">Paid</Badge> : <Badge variant="secondary">Pending</Badge>}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={() => printStatement(s)}><Printer className="h-3.5 w-3.5" /> Print</Button>
                          <Button size="sm" variant="ghost" className="h-8 ml-1 gap-1 text-emerald-700" onClick={() => whatsappShare(s)}><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</Button>
                          {s.status !== "paid" && <Button size="sm" variant="outline" className="h-8 ml-1 gap-1" onClick={() => { setPayTarget(s); setPayForm({ payment_ref: "", notes: "" }); setPayOpen(true); }}><CheckCircle2 className="h-3.5 w-3.5" /> Mark Paid</Button>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Mark Settlement Paid</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">{agency?.name} · {payTarget?.period} · {payTarget ? formatPKR(payTarget.total_amount) : ""}</div>
            <div><Label>Payment reference</Label><Input value={payForm.payment_ref} onChange={e => setPayForm(p => ({ ...p, payment_ref: e.target.value }))} placeholder="bank / cheque ref" /></div>
            <div><Label>Notes</Label><Input value={payForm.notes} onChange={e => setPayForm(p => ({ ...p, notes: e.target.value }))} placeholder="optional" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button><Button onClick={markPaid}>Confirm Paid</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
