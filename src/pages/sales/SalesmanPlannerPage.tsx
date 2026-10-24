import { useMemo, useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { ClipboardList, Pencil, Plus, Printer, Trash2 } from "lucide-react";
import { useEmployeeCodes } from "@/lib/salesFuel";
import {
  PLANS_KEY, PLAN_KIND_LABEL, countPlanPoints, parsePlanLines, planPeriodLabel, printSalesmanPlans, weekRange,
  type PlanKind, type SalesmanPlan,
} from "@/lib/salesmanPlanner";

interface AppUser { id: string; full_name: string; }

const MANAGER_ROLES = ["super_admin", "admin", "manager", "private_label_manager"];
const today = () => new Date().toISOString().slice(0, 10);

const STATUS_COLORS: Record<string, string> = {
  Draft: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  Submitted: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
};

/** The editor's live preview and the print share the same line rules. */
function PlanPreview({ body }: { body: string }) {
  const lines = parsePlanLines(body);
  if (!lines.length) return <p className="text-sm text-muted-foreground">Type the plan on the left: one line per point.</p>;
  return (
    <div className="text-sm">
      {lines.map((l, i) =>
        l.kind === "heading"
          ? <div key={i} className="font-semibold mt-2 first:mt-0">{l.text}</div>
          : <div key={i} className="flex gap-2 pl-2"><span>•</span><span>{l.text}</span></div>,
      )}
    </div>
  );
}

export default function SalesmanPlannerPage() {
  const qc = useQueryClient();
  const { user, roles } = useAuth();
  const isManager = roles.some((r) => MANAGER_ROLES.includes(r.role as string));

  const [userFilter, setUserFilter] = useState(isManager ? "all" : user?.id || "all");
  const [statusFilter, setStatusFilter] = useState("all");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SalesmanPlan | null>(null);
  const [userId, setUserId] = useState(user?.id || "");
  const [kind, setKind] = useState<PlanKind>("day");
  const [fromDate, setFromDate] = useState(today());
  const [toDate, setToDate] = useState(today());
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const { data: users } = useQuery({
    queryKey: ["app_users_active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_users").select("id,full_name").eq("is_active", true).order("full_name");
      if (error) throw error;
      return data as unknown as AppUser[];
    },
  });
  const { data: codes } = useEmployeeCodes();
  const userMap = useMemo(() => Object.fromEntries((users || []).map((u) => [u.id, u.full_name])), [users]);
  const userLabel = (id: string) => `${userMap[id] || "—"}${codes?.[id] ? ` (${codes[id]})` : ""}`;

  const { data: plans, isLoading } = useQuery({
    queryKey: [PLANS_KEY],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_salesman_plans" as any).select("*").order("from_date", { ascending: false }).order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data as unknown as SalesmanPlan[];
    },
  });

  const filtered = useMemo(() => {
    let list = plans || [];
    if (!isManager) list = list.filter((p) => p.user_id === user?.id);
    else if (userFilter !== "all") list = list.filter((p) => p.user_id === userFilter);
    if (statusFilter !== "all") list = list.filter((p) => p.status === statusFilter);
    return list;
  }, [plans, isManager, userFilter, statusFilter, user?.id]);

  const applyKind = (k: PlanKind, anchor: string) => {
    setKind(k);
    if (k === "day") { setFromDate(anchor); setToDate(anchor); }
    else if (k === "week") { const w = weekRange(anchor); setFromDate(w.from); setToDate(w.to); }
  };
  const onFromChange = (d: string) => {
    if (!d) return;
    if (kind === "day") { setFromDate(d); setToDate(d); }
    else if (kind === "week") { const w = weekRange(d); setFromDate(w.from); setToDate(w.to); }
    else { setFromDate(d); if (toDate < d) setToDate(d); }
  };

  const openNew = () => {
    setEditing(null); setUserId(user?.id || ""); setTitle(""); setBody("");
    applyKind("day", today());
    setOpen(true);
  };
  const openEdit = (p: SalesmanPlan) => {
    setEditing(p); setUserId(p.user_id); setKind(p.plan_kind); setFromDate(p.from_date); setToDate(p.to_date);
    setTitle(p.title || ""); setBody(p.body || "");
    setOpen(true);
  };
  const close = () => { setOpen(false); setEditing(null); };

  const save = useMutation({
    mutationFn: async (status: "Draft" | "Submitted") => {
      if (!userId) throw new Error("Salesman is required");
      if (!body.trim()) throw new Error("Write at least one plan point");
      if (toDate < fromDate) throw new Error("End date is before the start date");
      const payload: any = {
        user_id: userId, plan_kind: kind, from_date: fromDate, to_date: toDate,
        title: title.trim() || null, body: body.replace(/\r\n/g, "\n"), status,
        submitted_at: status === "Submitted" ? new Date().toISOString() : null,
      };
      if (editing) {
        const { data, error } = await supabase.from("sales_salesman_plans" as any).update(payload).eq("id", editing.id).select("*").single();
        if (error) throw error;
        return data as unknown as SalesmanPlan;
      }
      const { data, error } = await supabase.from("sales_salesman_plans" as any).insert({ ...payload, created_by: user?.id || null }).select("*").single();
      if (error) throw error;
      return data as unknown as SalesmanPlan;
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: [PLANS_KEY] });
      toast.success(p.status === "Submitted" ? `Plan ${p.plan_number} submitted` : `Plan ${p.plan_number} saved as draft`);
      close();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sales_salesman_plans" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [PLANS_KEY] }); toast.success("Deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const print = (list: SalesmanPlan[]) => printSalesmanPlans(list, (id) => userMap[id] || "", (id) => codes?.[id]);
  const canEdit = (p: SalesmanPlan) => isManager || (p.user_id === user?.id && p.status === "Draft");

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Salesman Planner" description="Each salesman writes the plan for a day or a week as bullet points, submits it and prints it." />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-lg flex items-center gap-2"><ClipboardList className="h-5 w-5" /> Plans</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              {isManager && (
                <Select value={userFilter} onValueChange={setUserFilter}>
                  <SelectTrigger className="w-48 bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-background z-50 max-h-60">
                    <SelectItem value="all">All Salesmen</SelectItem>
                    {users?.map((u) => <SelectItem key={u.id} value={u.id}>{userLabel(u.id)}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36 bg-background"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-background z-50">
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="Draft">Draft</SelectItem>
                  <SelectItem value="Submitted">Submitted</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />New Plan</Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plan #</TableHead><TableHead>Salesman</TableHead><TableHead>Plan for</TableHead><TableHead>Title</TableHead>
                    <TableHead className="text-right">Points</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={7} className="text-center">Loading...</TableCell></TableRow>
                  ) : !filtered.length ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No plans yet</TableCell></TableRow>
                  ) : filtered.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.plan_number}</TableCell>
                      <TableCell className="font-medium">{userLabel(p.user_id)}</TableCell>
                      <TableCell className="text-xs">{planPeriodLabel(p)}<div className="text-muted-foreground">{PLAN_KIND_LABEL[p.plan_kind]}</div></TableCell>
                      <TableCell>{p.title || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-right">{countPlanPoints(p.body)}</TableCell>
                      <TableCell><Badge variant="outline" className={STATUS_COLORS[p.status] || ""}>{p.status}</Badge></TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button variant="ghost" size="icon" title="Print" onClick={() => print([p])}><Printer className="h-4 w-4" /></Button>
                        {canEdit(p) && <Button variant="ghost" size="icon" title="Open" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>}
                        {canEdit(p) && <Button variant="ghost" size="icon" title="Delete" onClick={() => { if (confirm("Delete this plan?")) del.mutate(p.id); }}><Trash2 className="h-4 w-4" /></Button>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
          <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editing ? `Plan ${editing.plan_number}` : "New Plan"}</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); save.mutate("Submitted"); }} className="space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <div className="space-y-2">
                  <Label>Salesman *</Label>
                  {isManager ? (
                    <Select value={userId} onValueChange={setUserId}>
                      <SelectTrigger className="bg-background"><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent className="bg-background z-50 max-h-60">
                        {users?.map((u) => <SelectItem key={u.id} value={u.id}>{userLabel(u.id)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input value={userLabel(userId)} readOnly className="bg-muted" />
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Plan for *</Label>
                  <Select value={kind} onValueChange={(v) => applyKind(v as PlanKind, fromDate)}>
                    <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-background z-50">
                      {(Object.keys(PLAN_KIND_LABEL) as PlanKind[]).map((k) => <SelectItem key={k} value={k}>{PLAN_KIND_LABEL[k]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{kind === "day" ? "Date" : "From"} *</Label>
                  <Input type="date" value={fromDate} onChange={(e) => onFromChange(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>To</Label>
                  <Input type="date" value={toDate} min={fromDate} onChange={(e) => setToDate(e.target.value)} readOnly={kind !== "custom"} className={kind !== "custom" ? "bg-muted" : ""} />
                </div>
                <div className="space-y-2 col-span-2 lg:col-span-1">
                  <Label>Title</Label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sialkot visits" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Plan points *</Label>
                  <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} className="font-mono text-sm"
                    placeholder={"Morning\n- Visit Al-Noor Sports, Sialkot — collect PO\n- Deliver samples to Khawaja Exports\nAfternoon\n- Hassan Traders payment follow-up"} />
                  <p className="text-xs text-muted-foreground">One line per point. Start a line with “-” for a bullet; a line without a dash becomes a heading (a day, a city, morning / afternoon).</p>
                </div>
                <div className="space-y-2">
                  <Label>Preview (this is what prints)</Label>
                  <div className="rounded-md border p-3 min-h-[200px] bg-background">
                    {title && <div className="font-semibold mb-1">{title}</div>}
                    <div className="text-xs text-muted-foreground mb-2">{userLabel(userId)} · {planPeriodLabel({ from_date: fromDate, to_date: toDate || fromDate })}</div>
                    <PlanPreview body={body} />
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={close}>Cancel</Button>
                {editing && <Button type="button" variant="outline" onClick={() => print([{ ...editing, user_id: userId, plan_kind: kind, from_date: fromDate, to_date: toDate, title: title.trim() || null, body }])}><Printer className="h-4 w-4 mr-2" />Print</Button>}
                <Button type="button" variant="secondary" disabled={save.isPending} onClick={() => save.mutate("Draft")}>Save draft</Button>
                <Button type="submit" disabled={save.isPending}>Submit plan</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
