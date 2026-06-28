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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Users, ShieldAlert, ShieldOff, Repeat, Ban, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { formatPKR } from "@/lib/currency";

interface Cust {
  phone: string; name: string; city: string;
  orders: number; delivered: number; returned: number; inTransit: number;
  resolved: number; returnRate: number;
  spent: number; codBooked: number; lastOrder: string | null;
  blacklisted: boolean; riskNote: string | null;
  risk: "blacklist" | "high" | "medium" | "low";
}

const RETURNED = ["returned", "return_awaited"];

export default function OnlineCustomersPage() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [flags, setFlags] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<Cust | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteTarget, setNoteTarget] = useState<Cust | null>(null);
  const [noteForm, setNoteForm] = useState({ risk_note: "", is_blacklisted: false });

  const fetchData = async () => {
    setLoading(true);
    const [oRes, cRes] = await Promise.all([
      supabase.from("online_orders")
        .select("customer_phone, customer_name, city, status, cod_amount, order_value, order_date, platform")
        .not("customer_phone", "is", null).neq("customer_phone", ""),
      supabase.from("online_customers").select("*"),
    ]);
    setOrders(oRes.data || []);
    const m: Record<string, any> = {};
    (cRes.data || []).forEach((c: any) => (m[c.phone] = c));
    setFlags(m);
    setLoading(false);
  };
  useEffect(() => { fetchData(); }, []);

  const customers: Cust[] = useMemo(() => {
    const g = new Map<string, any[]>();
    orders.forEach(o => {
      const k = String(o.customer_phone).trim();
      if (!k) return;
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(o);
    });
    return Array.from(g.entries()).map(([phone, list]) => {
      const delivered = list.filter(o => o.status === "delivered");
      const returned = list.filter(o => RETURNED.includes(o.status));
      const inTransit = list.filter(o => !["delivered", "cancelled", ...RETURNED].includes(o.status));
      const resolved = delivered.length + returned.length;
      const returnRate = resolved > 0 ? returned.length / resolved : 0;
      const latest = list.reduce((a, b) => (a.order_date > b.order_date ? a : b));
      const f = flags[phone];
      const blacklisted = !!f?.is_blacklisted;
      const risk: Cust["risk"] = blacklisted ? "blacklist"
        : (list.length >= 2 && returnRate >= 0.5) ? "high"
        : (returnRate >= 0.3 && resolved >= 1) ? "medium" : "low";
      return {
        phone, name: f?.name || latest.customer_name || "-", city: f?.city || latest.city || "-",
        orders: list.length, delivered: delivered.length, returned: returned.length, inTransit: inTransit.length,
        resolved, returnRate,
        spent: delivered.reduce((s, o) => s + Number(o.order_value || 0), 0),
        codBooked: list.reduce((s, o) => s + Number(o.cod_amount || 0), 0),
        lastOrder: latest.order_date || null,
        blacklisted, riskNote: f?.risk_note || null, risk,
      };
    }).sort((a, b) => (b.returned - a.returned) || (b.returnRate - a.returnRate) || (b.orders - a.orders));
  }, [orders, flags]);

  const stats = useMemo(() => ({
    total: customers.length,
    repeat: customers.filter(c => c.orders >= 2).length,
    highRisk: customers.filter(c => c.risk === "high").length,
    blacklisted: customers.filter(c => c.blacklisted).length,
  }), [customers]);

  const filtered = useMemo(() => {
    let list = customers;
    if (tab === "repeat") list = list.filter(c => c.orders >= 2);
    else if (tab === "high") list = list.filter(c => c.risk === "high" || c.risk === "medium");
    else if (tab === "blacklist") list = list.filter(c => c.blacklisted);
    const s = q.trim().toLowerCase();
    if (s) list = list.filter(c => c.phone.toLowerCase().includes(s) || (c.name || "").toLowerCase().includes(s));
    return list;
  }, [customers, tab, q]);

  const saveFlags = async (c: Cust, patch: { is_blacklisted?: boolean; risk_note?: string | null }) => {
    const { error } = await supabase.from("online_customers").upsert({
      phone: c.phone, name: c.name === "-" ? null : c.name, city: c.city === "-" ? null : c.city,
      is_blacklisted: patch.is_blacklisted ?? c.blacklisted,
      risk_note: patch.risk_note !== undefined ? patch.risk_note : c.riskNote,
      updated_at: new Date().toISOString(), created_by: user?.id || null,
    }, { onConflict: "phone" });
    if (error) { toast.error(error.message); return; }
    fetchData();
  };

  const toggleBlacklist = async (c: Cust) => {
    await saveFlags(c, { is_blacklisted: !c.blacklisted });
    toast.success(c.blacklisted ? `Removed ${c.phone} from blacklist` : `Blacklisted ${c.phone}`);
  };

  const openNote = (c: Cust) => { setNoteTarget(c); setNoteForm({ risk_note: c.riskNote || "", is_blacklisted: c.blacklisted }); setNoteOpen(true); };
  const saveNote = async () => {
    if (!noteTarget) return;
    await saveFlags(noteTarget, { risk_note: noteForm.risk_note.trim() || null, is_blacklisted: noteForm.is_blacklisted });
    toast.success("Saved"); setNoteOpen(false); setNoteTarget(null);
  };

  const riskBadge = (c: Cust) => {
    if (c.blacklisted) return <Badge className="bg-black text-white">Blacklisted</Badge>;
    if (c.risk === "high") return <Badge className="bg-red-100 text-red-800 border-red-400">High risk</Badge>;
    if (c.risk === "medium") return <Badge className="bg-amber-100 text-amber-800 border-amber-400">Medium</Badge>;
    return <Badge variant="secondary">Low</Badge>;
  };

  const detailOrders = useMemo(() => orders.filter(o => String(o.customer_phone).trim() === detail?.phone)
    .sort((a, b) => (b.order_date || "").localeCompare(a.order_date || "")), [orders, detail]);

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Customers" description="Buyer database with return history & serial-returner blacklist" icon={Users} iconColor="bg-emerald-600 text-white" />

        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="py-3 px-4 text-xs text-amber-800 flex items-start gap-2">
            <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
            <span>Customers are derived from order history (by phone). <b>High risk</b> = 2+ orders with a 50%+ return rate. Use <b>Blacklist</b> to flag serial returners — check a buyer here before booking a COD parcel to cut your return ratio.</span>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard title="Customers" value={stats.total} icon={Users} iconColor="text-slate-600" />
          <MetricCard title="Repeat Buyers" value={stats.repeat} icon={Repeat} iconColor="text-blue-600" description={stats.total ? `${Math.round(stats.repeat / stats.total * 100)}% of base` : ""} />
          <MetricCard title="High Risk" value={stats.highRisk} icon={ShieldAlert} iconColor="text-red-600" description="2+ orders, 50%+ returns" />
          <MetricCard title="Blacklisted" value={stats.blacklisted} icon={Ban} iconColor="text-black" />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="all">All ({customers.length})</TabsTrigger>
              <TabsTrigger value="repeat">Repeat ({stats.repeat})</TabsTrigger>
              <TabsTrigger value="high">At Risk</TabsTrigger>
              <TabsTrigger value="blacklist">Blacklisted ({stats.blacklisted})</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search phone or name" className="pl-8 w-60" />
          </div>
        </div>

        <Card><CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Customer</TableHead><TableHead>City</TableHead>
              <TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Delivered</TableHead>
              <TableHead className="text-right">Returned</TableHead><TableHead className="text-right">Return %</TableHead>
              <TableHead className="text-right">Spent</TableHead><TableHead>Risk</TableHead><TableHead className="text-right">Action</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No customers</TableCell></TableRow>
              ) : filtered.slice(0, 500).map(c => (
                <TableRow key={c.phone} className={c.blacklisted ? "bg-red-50/50" : ""}>
                  <TableCell>
                    <button className="text-left" onClick={() => setDetail(c)}>
                      <div className="font-medium">{c.name}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">{c.phone}</div>
                    </button>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{c.city}</TableCell>
                  <TableCell className="text-right">{c.orders}</TableCell>
                  <TableCell className="text-right text-emerald-700">{c.delivered}</TableCell>
                  <TableCell className="text-right text-red-600">{c.returned}</TableCell>
                  <TableCell className="text-right font-medium">{c.resolved ? `${Math.round(c.returnRate * 100)}%` : "-"}</TableCell>
                  <TableCell className="text-right">{formatPKR(c.spent)}</TableCell>
                  <TableCell>{riskBadge(c)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" className="h-8" onClick={() => openNote(c)}>Note</Button>
                    <Button size="sm" variant={c.blacklisted ? "outline" : "destructive"} className="h-8 ml-1 gap-1" onClick={() => toggleBlacklist(c)}>
                      {c.blacklisted ? <><ShieldCheck className="h-3.5 w-3.5" /> Unblock</> : <><ShieldOff className="h-3.5 w-3.5" /> Blacklist</>}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
        {filtered.length > 500 && <p className="text-xs text-muted-foreground">Showing first 500 of {filtered.length}. Use search to narrow.</p>}
      </div>

      {/* Risk note */}
      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Customer Flag</DialogTitle>
            <DialogDescription>{noteTarget?.name} · {noteTarget?.phone}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded border p-3">
              <div><Label className="text-sm">Blacklisted</Label><p className="text-xs text-muted-foreground">Block this buyer from COD booking</p></div>
              <Button variant={noteForm.is_blacklisted ? "destructive" : "outline"} size="sm" onClick={() => setNoteForm(p => ({ ...p, is_blacklisted: !p.is_blacklisted }))}>
                {noteForm.is_blacklisted ? "Blacklisted" : "Not blacklisted"}
              </Button>
            </div>
            <div><Label>Risk note</Label><Input value={noteForm.risk_note} onChange={e => setNoteForm(p => ({ ...p, risk_note: e.target.value }))} placeholder="e.g. refused 3 parcels, fake address" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setNoteOpen(false)}>Cancel</Button><Button onClick={saveNote}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Customer detail */}
      <Dialog open={!!detail} onOpenChange={v => !v && setDetail(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">{detail?.name} {detail && riskBadge(detail)}</DialogTitle>
            <DialogDescription className="font-mono">{detail?.phone} · {detail?.city}</DialogDescription>
          </DialogHeader>
          {detail && (
            <>
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                <div className="rounded border p-2"><div className="font-semibold">{detail.orders}</div><div className="text-xs text-muted-foreground">Orders</div></div>
                <div className="rounded border p-2"><div className="font-semibold text-red-600">{detail.returned}</div><div className="text-xs text-muted-foreground">Returned</div></div>
                <div className="rounded border p-2"><div className="font-semibold">{detail.resolved ? `${Math.round(detail.returnRate * 100)}%` : "-"}</div><div className="text-xs text-muted-foreground">Return rate</div></div>
              </div>
              {detail.riskNote && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">⚠️ {detail.riskNote}</p>}
              <div className="border-t pt-2">
                <p className="text-xs font-medium text-muted-foreground mb-1">Order history ({detailOrders.length})</p>
                <Table>
                  <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Platform</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {detailOrders.map((o, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs">{o.order_date ? format(new Date(o.order_date), "dd MMM yy") : "-"}</TableCell>
                        <TableCell className="text-xs">{o.platform || "-"}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{(o.status || "").replace(/_/g, " ")}</Badge></TableCell>
                        <TableCell className="text-right text-xs">{Number(o.order_value || 0).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
