import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RefreshCw, UserPlus, PhoneCall, ArrowRightCircle } from "lucide-react";
import { toast } from "sonner";

const STATUSES = ["pending", "in_progress", "reactivated", "not_interested", "lost"] as const;
type Status = typeof STATUSES[number];

const STATUS_LABEL: Record<Status, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  reactivated: "Reactivated",
  not_interested: "Not Interested",
  lost: "Lost",
};

const statusColor = (s: Status) => {
  switch (s) {
    case "reactivated": return "bg-green-100 text-green-800 border-green-300";
    case "in_progress": return "bg-amber-100 text-amber-800 border-amber-300";
    case "not_interested":
    case "lost": return "bg-red-100 text-red-800 border-red-300";
    default: return "bg-slate-100 text-slate-800 border-slate-300";
  }
};

const fmtPKR = (n: number) => `Rs. ${Math.round(n).toLocaleString()}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

interface CustomerRow {
  customer_id: string;
  code: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  area: string | null;
  last_order_date: string | null;
  days_since: number;
  lifetime_revenue: number;
  reactivation_id: string | null;
  status: Status;
  assigned_to: string | null;
  assigned_name: string | null;
  last_contacted: string | null;
  converted_lead_id: string | null;
}

interface RawCustomer {
  id: string; code: string; name: string;
  contact_person: string | null; phone: string | null; email: string | null;
  city: string | null; area: string | null;
}

export default function CRMReactivationPage() {
  const [loading, setLoading] = useState(false);
  const [customers, setCustomers] = useState<RawCustomer[]>([]);
  const [lastOrderMap, setLastOrderMap] = useState<Map<string, string>>(new Map());
  const [revenueMap, setRevenueMap] = useState<Map<string, number>>(new Map());
  const [reactByCust, setReactByCust] = useState<Map<string, any>>(new Map());
  const [lastAttemptByReact, setLastAttemptByReact] = useState<Map<string, string>>(new Map());
  const [users, setUsers] = useState<{ id: string; full_name: string }[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [repFilter, setRepFilter] = useState<string>("all");
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [areaFilter, setAreaFilter] = useState<string>("all");
  const [thresholdDays, setThresholdDays] = useState<number>(180);

  const [logOpen, setLogOpen] = useState(false);
  const [logRow, setLogRow] = useState<CustomerRow | null>(null);
  const [logForm, setLogForm] = useState({ attempt_date: todayStr(), channel: "call", outcome: "neutral", notes: "" });

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: customersData }, { data: usersData }, { data: reactivations }, { data: attempts }] = await Promise.all([
        supabase.from("customers").select("id,code,name,contact_person,phone,email,city,area")
          .eq("sales_segment", "private_label").eq("is_active", true).order("name"),
        supabase.from("app_users").select("id,full_name").eq("is_active", true).order("full_name"),
        supabase.from("crm_reactivations").select("*"),
        supabase.from("crm_reactivation_attempts").select("reactivation_id,attempt_date"),
      ]);

      setUsers(usersData || []);
      setCustomers(customersData || []);

      const custIds = (customersData || []).map(c => c.id);
      const orderRows: { customer_id: string; order_date: string; id: string }[] = [];
      for (let i = 0; i < custIds.length; i += 500) {
        const chunk = custIds.slice(i, i + 500);
        if (!chunk.length) break;
        const { data } = await supabase.from("sales_orders").select("id,customer_id,order_date").in("customer_id", chunk);
        if (data) orderRows.push(...data as any);
      }

      const orderIds = orderRows.map(o => o.id);
      const itemRows: { order_id: string; amount: number }[] = [];
      for (let i = 0; i < orderIds.length; i += 500) {
        const chunk = orderIds.slice(i, i + 500);
        if (!chunk.length) break;
        const { data } = await supabase.from("sales_order_items").select("order_id,amount").in("order_id", chunk);
        if (data) itemRows.push(...(data as any));
      }

      const orderToCust = new Map(orderRows.map(o => [o.id, o.customer_id]));
      const lastOrder = new Map<string, string>();
      orderRows.forEach(o => {
        const prev = lastOrder.get(o.customer_id);
        if (!prev || o.order_date > prev) lastOrder.set(o.customer_id, o.order_date);
      });
      const revenue = new Map<string, number>();
      itemRows.forEach(it => {
        const cid = orderToCust.get(it.order_id);
        if (!cid) return;
        revenue.set(cid, (revenue.get(cid) || 0) + Number(it.amount || 0));
      });

      const lastAttempt = new Map<string, string>();
      (attempts || []).forEach(a => {
        const prev = lastAttempt.get(a.reactivation_id);
        if (!prev || a.attempt_date > prev) lastAttempt.set(a.reactivation_id, a.attempt_date);
      });

      setLastOrderMap(lastOrder);
      setRevenueMap(revenue);
      setReactByCust(new Map((reactivations || []).map(r => [r.customer_id, r])));
      setLastAttemptByReact(lastAttempt);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const rows: CustomerRow[] = useMemo(() => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - thresholdDays);
    const cutoff = cutoffDate.toISOString().slice(0, 10);
    const userMap = new Map<string, string>(users.map(u => [u.id, u.full_name]));
    const today = new Date();
    const result: CustomerRow[] = [];
    customers.forEach(c => {
      const last = lastOrderMap.get(c.id) || null;
      // Dormant = never ordered, OR last order strictly before cutoff
      if (last && last >= cutoff) return;
      const days = last ? Math.floor((today.getTime() - new Date(last).getTime()) / 86400000) : -1;
      const r = reactByCust.get(c.id);
      result.push({
        customer_id: c.id,
        code: c.code,
        name: c.name,
        contact_person: c.contact_person,
        phone: c.phone,
        email: c.email,
        city: c.city,
        area: c.area,
        last_order_date: last,
        days_since: days,
        lifetime_revenue: revenueMap.get(c.id) || 0,
        reactivation_id: r?.id || null,
        status: (r?.status || "pending") as Status,
        assigned_to: r?.assigned_to || null,
        assigned_name: r?.assigned_to ? (userMap.get(r.assigned_to) || null) : null,
        last_contacted: r?.id ? (lastAttemptByReact.get(r.id) || null) : null,
        converted_lead_id: r?.converted_lead_id || null,
      });
    });
    // Never-ordered (days = -1) sort to bottom; otherwise oldest first
    result.sort((a, b) => {
      if (a.days_since === -1 && b.days_since !== -1) return 1;
      if (b.days_since === -1 && a.days_since !== -1) return -1;
      return b.days_since - a.days_since;
    });
    return result;
  }, [customers, lastOrderMap, revenueMap, reactByCust, lastAttemptByReact, users, thresholdDays]);

  const ensureReactivation = async (row: CustomerRow): Promise<string> => {
    if (row.reactivation_id) return row.reactivation_id;
    const { data, error } = await supabase.from("crm_reactivations")
      .insert({ customer_id: row.customer_id, status: "pending" }).select("id").single();
    if (error) throw error;
    return data.id;
  };

  const updateAssign = async (row: CustomerRow, userId: string | null) => {
    try {
      const id = await ensureReactivation(row);
      const { error } = await supabase.from("crm_reactivations").update({ assigned_to: userId }).eq("id", id);
      if (error) throw error;
      toast.success("Assigned");
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  const updateStatus = async (row: CustomerRow, status: Status) => {
    try {
      const id = await ensureReactivation(row);
      const patch: any = { status };
      if (status === "reactivated") patch.reactivated_at = new Date().toISOString();
      const { error } = await supabase.from("crm_reactivations").update(patch).eq("id", id);
      if (error) throw error;
      toast.success("Status updated");
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  const openLog = (row: CustomerRow) => {
    setLogRow(row);
    setLogForm({ attempt_date: todayStr(), channel: "call", outcome: "neutral", notes: "" });
    setLogOpen(true);
  };

  const submitLog = async () => {
    if (!logRow) return;
    try {
      const id = await ensureReactivation(logRow);
      const { error } = await supabase.from("crm_reactivation_attempts").insert({
        reactivation_id: id,
        attempt_date: logForm.attempt_date,
        channel: logForm.channel,
        outcome: logForm.outcome,
        notes: logForm.notes || null,
      });
      if (error) throw error;
      if (logRow.status === "pending") {
        await supabase.from("crm_reactivations").update({ status: "in_progress" }).eq("id", id);
      }
      toast.success("Attempt logged");
      setLogOpen(false);
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  const convertToLead = async (row: CustomerRow) => {
    if (row.converted_lead_id) { toast.info("Already converted to lead"); return; }
    try {
      const id = await ensureReactivation(row);
      const { data: lead, error } = await supabase.from("crm_leads").insert({
        name: row.contact_person || row.name,
        company: row.name,
        phone: row.phone,
        email: row.email,
        source: "reactivation",
        status: "new",
        assigned_to: row.assigned_to,
        notes: `Reactivation lead from dormant customer ${row.code} (${row.days_since === -1 ? "never ordered" : row.days_since + " days since last order"})`,
      } as any).select("id").single();
      if (error) throw error;
      await supabase.from("crm_reactivations").update({ converted_lead_id: lead.id, status: "in_progress" }).eq("id", id);
      toast.success("Converted to CRM lead");
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  const cityOptions = useMemo(() => {
    const s = new Set<string>();
    customers.forEach(c => { if (c.city) s.add(c.city); });
    return Array.from(s).sort();
  }, [customers]);

  const areaOptions = useMemo(() => {
    const s = new Set<string>();
    customers.forEach(c => {
      if (!c.area) return;
      if (cityFilter !== "all" && c.city !== cityFilter) return;
      s.add(c.area);
    });
    return Array.from(s).sort();
  }, [customers, cityFilter]);

  useEffect(() => { setAreaFilter("all"); }, [cityFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (q && !`${r.name} ${r.code}`.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (cityFilter !== "all" && r.city !== cityFilter) return false;
      if (areaFilter !== "all" && r.area !== areaFilter) return false;
      if (repFilter !== "all") {
        if (repFilter === "unassigned" && r.assigned_to) return false;
        if (repFilter !== "unassigned" && r.assigned_to !== repFilter) return false;
      }
      return true;
    });
  }, [rows, search, statusFilter, repFilter, cityFilter, areaFilter]);

  const kpis = useMemo(() => {
    const total = rows.length;
    const assigned = rows.filter(r => r.assigned_to).length;
    const inProgress = rows.filter(r => r.status === "in_progress").length;
    const reactivatedRecent = rows.filter(r => r.status === "reactivated").length;
    return { total, assigned, inProgress, reactivatedRecent };
  }, [rows]);

  return (
    <ERPLayout>
      <PageHeader
        title="Customer Reactivation"
        description="Private label customers with no order in the last 6 months"
        icon={RefreshCw}
        iconColor="bg-amber-500 text-white"
      >
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Dormant total</div><div className="text-2xl font-bold">{kpis.total}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Assigned</div><div className="text-2xl font-bold">{kpis.assigned}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">In progress</div><div className="text-2xl font-bold text-amber-700">{kpis.inProgress}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Reactivated</div><div className="text-2xl font-bold text-green-700">{kpis.reactivatedRecent}</div></CardContent></Card>
      </div>

      <Card className="mb-4">
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Input placeholder="Search customer / code" value={search} onChange={e => setSearch(e.target.value)} />
          <Select value={String(thresholdDays)} onValueChange={v => setThresholdDays(Number(v))}>
            <SelectTrigger><SelectValue placeholder="Dormant after" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="30">Dormant &gt; 30 days</SelectItem>
              <SelectItem value="60">Dormant &gt; 60 days</SelectItem>
              <SelectItem value="90">Dormant &gt; 90 days</SelectItem>
              <SelectItem value="180">Dormant &gt; 180 days</SelectItem>
              <SelectItem value="365">Dormant &gt; 365 days</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map(s => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={repFilter} onValueChange={setRepFilter}>
            <SelectTrigger><SelectValue placeholder="Assigned rep" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All reps</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {users.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={cityFilter} onValueChange={setCityFilter}>
            <SelectTrigger><SelectValue placeholder="City" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All cities</SelectItem>
              {cityOptions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={areaFilter} onValueChange={setAreaFilter} disabled={areaOptions.length === 0}>
            <SelectTrigger><SelectValue placeholder="Area" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All areas</SelectItem>
              {areaOptions.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Last Order</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead className="text-right">Lifetime Rs.</TableHead>
                  <TableHead>Assigned To</TableHead>
                  <TableHead>Last Contacted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    {loading ? "Loading..." : "No dormant customers"}
                  </TableCell></TableRow>
                )}
                {filtered.map(r => (
                  <TableRow key={r.customer_id}>
                    <TableCell>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">{r.code}{r.contact_person ? ` · ${r.contact_person}` : ""}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{r.last_order_date || <span className="text-muted-foreground">Never</span>}</TableCell>
                    <TableCell className="text-right font-medium text-amber-700">{r.days_since === -1 ? "—" : r.days_since}</TableCell>
                    <TableCell className="text-right">{fmtPKR(r.lifetime_revenue)}</TableCell>
                    <TableCell className="min-w-[160px]">
                      <Select value={r.assigned_to || "unassigned"} onValueChange={v => updateAssign(r, v === "unassigned" ? null : v)}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned">— Unassigned —</SelectItem>
                          {users.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{r.last_contacted || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="min-w-[150px]">
                      <Select value={r.status} onValueChange={v => updateStatus(r, v as Status)}>
                        <SelectTrigger className={`h-8 border ${statusColor(r.status)}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STATUSES.map(s => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button size="sm" variant="outline" className="mr-1" onClick={() => openLog(r)}>
                        <PhoneCall className="h-3.5 w-3.5 mr-1" /> Log
                      </Button>
                      <Button size="sm" variant="outline" disabled={!!r.converted_lead_id} onClick={() => convertToLead(r)}>
                        <ArrowRightCircle className="h-3.5 w-3.5 mr-1" />
                        {r.converted_lead_id ? "Converted" : "To Lead"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Log Reactivation Attempt</DialogTitle>
          </DialogHeader>
          {logRow && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">{logRow.name} · {logRow.code}</div>
              <div>
                <Label>Date</Label>
                <Input type="date" value={logForm.attempt_date} onChange={e => setLogForm({ ...logForm, attempt_date: e.target.value })} />
              </div>
              <div>
                <Label>Channel</Label>
                <Select value={logForm.channel} onValueChange={v => setLogForm({ ...logForm, channel: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="call">Call</SelectItem>
                    <SelectItem value="visit">Visit</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Outcome</Label>
                <Select value={logForm.outcome} onValueChange={v => setLogForm({ ...logForm, outcome: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="positive">Positive</SelectItem>
                    <SelectItem value="neutral">Neutral</SelectItem>
                    <SelectItem value="negative">Negative</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Notes</Label>
                <Textarea rows={3} value={logForm.notes} onChange={e => setLogForm({ ...logForm, notes: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogOpen(false)}>Cancel</Button>
            <Button onClick={submitLog}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
