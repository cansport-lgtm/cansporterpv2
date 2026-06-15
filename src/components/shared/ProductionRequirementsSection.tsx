import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertTriangle, Plus, Trash2, Pencil, Eye, Printer } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const REFRESH_INTERVAL = 60_000;

type LineDraft = { id?: string; planning_item_id: string; required_qty: string; unit: string; required_by: string; remarks: string };
const blankLine = (): LineDraft => ({ planning_item_id: "", required_qty: "", unit: "", required_by: "", remarks: "" });

interface Props {
  fromDate: string;
  toDate: string;
  /** Permission module key: 'production' or 'qa' */
  permissionModule?: "production" | "qa";
}

function Kpi({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

export default function ProductionRequirementsSection({ fromDate, toDate, permissionModule = "production" }: Props) {
  const today = format(new Date(), "yyyy-MM-dd");
  const { hasRole, hasModulePermission, user } = useAuth();
  const canManage = hasRole("super_admin") || hasRole("operational_manager") || hasModulePermission(permissionModule, "edit");
  const qc = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formWindowFrom, setFormWindowFrom] = useState<string>(today);
  const [formWindowTo, setFormWindowTo] = useState<string>(today);
  const [formTitle, setFormTitle] = useState<string>("");
  const [formNotes, setFormNotes] = useState<string>("");
  const [formStatus, setFormStatus] = useState<string>("Draft");
  const [formLines, setFormLines] = useState<LineDraft[]>([blankLine()]);

  const { data: planningItems = [] } = useQuery({
    queryKey: ["prs-planning-items-all"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("planning_items")
        .select("id, name, unit")
        .order("name");
      if (error) throw error;
      return (data || []) as any[];
    },
  });
  const planningMap = useMemo(() => Object.fromEntries(planningItems.map((p: any) => [p.id, p])), [planningItems]);

  const { data: holidays = [] } = useQuery({
    queryKey: ["prs-public-holidays"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("public_holidays")
        .select("holiday_date")
        .eq("is_active", true);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
  const holidaySet = useMemo(() => new Set(holidays.map((h: any) => h.holiday_date)), [holidays]);
  const workingDays = (from: string, to: string) => {
    if (!from || !to) return 0;
    const start = new Date(from + "T00:00:00");
    const end = new Date(to + "T00:00:00");
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return 0;
    let count = 0;
    const cur = new Date(start);
    while (cur <= end) {
      const iso = cur.toISOString().slice(0, 10);
      if (cur.getDay() !== 0 && !holidaySet.has(iso)) count++;
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  };

  const { data: requirements = [] } = useQuery({
    queryKey: ["prs-prod-reqs", fromDate, toDate, statusFilter],
    queryFn: async () => {
      let q = (supabase as any)
        .from("production_requirements")
        .select("*")
        .lte("window_from", toDate)
        .gte("window_to", fromDate);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      const { data, error } = await q.order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  const reqIds = requirements.map((r: any) => r.id);
  const { data: reqItems = [] } = useQuery({
    queryKey: ["prs-prod-req-items", reqIds.join(",")],
    enabled: reqIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("production_requirement_items")
        .select("*")
        .in("requirement_id", reqIds);
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  const itemsByReq = useMemo(() => {
    const m: Record<string, any[]> = {};
    reqItems.forEach((it: any) => { (m[it.requirement_id] ||= []).push(it); });
    return m;
  }, [reqItems]);

  const reqKpis = useMemo(() => {
    const todayD = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00");
    const end6 = new Date(todayD); end6.setDate(end6.getDate() + 5);
    const toISO = (d: Date) => d.toISOString().slice(0, 10);
    let next6Qty = 0;
    requirements.forEach((r: any) => {
      const its = itemsByReq[r.id] || [];
      const totalQ = its.reduce((s: number, it: any) => s + Number(it.required_qty || 0), 0);
      const wd = workingDays(r.window_from, r.window_to);
      if (wd <= 0 || totalQ <= 0) return;
      const perDay = totalQ / wd;
      const wf = new Date(r.window_from + "T00:00:00");
      const wt = new Date(r.window_to + "T00:00:00");
      const ovStart = wf > todayD ? wf : todayD;
      const ovEnd = wt < end6 ? wt : end6;
      if (ovEnd < ovStart) return;
      const overlapDays = workingDays(toISO(ovStart), toISO(ovEnd));
      next6Qty += perDay * overlapDays;
    });
    const next6WorkingDays = workingDays(toISO(todayD), toISO(end6));
    const next6PerDay = next6WorkingDays > 0 ? Math.round(next6Qty / next6WorkingDays) : 0;
    return {
      totalRequirements: requirements.length,
      open: requirements.filter((r: any) => r.status !== "Closed").length,
      totalLineItems: reqItems.length,
      totalQty: reqItems.reduce((s: number, it: any) => s + Number(it.required_qty || 0), 0),
      next6Qty: Math.round(next6Qty),
      next6PerDay,
    };
  }, [requirements, reqItems, itemsByReq, holidaySet]);

  const priorityRank: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
  const sortedRequirements = useMemo(() => {
    return [...requirements].sort((a: any, b: any) => {
      const ra = priorityRank[a.priority] ?? 99;
      const rb = priorityRank[b.priority] ?? 99;
      if (ra !== rb) return ra - rb;
      const sa = a.status === "Closed" ? 1 : 0;
      const sb = b.status === "Closed" ? 1 : 0;
      return sa - sb;
    });
  }, [requirements]);

  const resetForm = () => {
    setEditingId(null);
    setFormWindowFrom(today);
    setFormWindowTo(today);
    setFormTitle("");
    setFormNotes("");
    setFormStatus("Draft");
    setFormLines([blankLine()]);
  };

  const openCreate = () => { resetForm(); setDialogOpen(true); };

  const openEdit = (req: any) => {
    if (!canManage) { toast.error("You don't have permission to edit requirements"); return; }
    setEditingId(req.id);
    setFormWindowFrom(req.window_from);
    setFormWindowTo(req.window_to);
    setFormTitle(req.title || "");
    setFormNotes(req.notes || "");
    setFormStatus(req.status || "Draft");
    const items = itemsByReq[req.id] || [];
    setFormLines(items.length === 0 ? [blankLine()] : items.map((it: any) => ({
      id: it.id,
      planning_item_id: it.planning_item_id || "",
      required_qty: String(it.required_qty ?? ""),
      unit: it.unit || "",
      required_by: it.required_by || "",
      remarks: it.remarks || "",
    })));
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async (markInProgress: boolean) => {
      if (!canManage) throw new Error("You don't have permission to save requirements");
      if (!formWindowFrom || !formWindowTo) throw new Error("Window From/To required");
      if (formWindowTo < formWindowFrom) throw new Error("Window To must be on/after Window From");
      const validLines = formLines.filter(l => l.planning_item_id && Number(l.required_qty) > 0);
      if (validLines.length === 0) throw new Error("Add at least one valid line item");
      for (const l of validLines) {
        if (l.required_by && (l.required_by < formWindowFrom || l.required_by > formWindowTo)) {
          throw new Error("Required-by date must fall within the production window");
        }
      }
      const headerPayload: any = {
        window_from: formWindowFrom,
        window_to: formWindowTo,
        title: formTitle || null,
        notes: formNotes || null,
        status: markInProgress ? "In Progress" : formStatus || "Draft",
      };
      let requirementId = editingId;
      if (editingId) {
        const { error } = await (supabase as any)
          .from("production_requirements")
          .update(headerPayload)
          .eq("id", editingId);
        if (error) throw error;
        await (supabase as any).from("production_requirement_items").delete().eq("requirement_id", editingId);
      } else {
        headerPayload.created_by = user?.id || null;
        const { data, error } = await (supabase as any)
          .from("production_requirements")
          .insert(headerPayload)
          .select()
          .single();
        if (error) throw error;
        requirementId = data.id;
      }
      const itemsPayload = validLines.map(l => ({
        requirement_id: requirementId,
        planning_item_id: l.planning_item_id,
        required_qty: Number(l.required_qty),
        unit: l.unit || planningMap[l.planning_item_id]?.unit || null,
        required_by: l.required_by || null,
        remarks: l.remarks || null,
      }));
      const { error: ee } = await (supabase as any).from("production_requirement_items").insert(itemsPayload);
      if (ee) throw ee;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prs-prod-reqs"] });
      qc.invalidateQueries({ queryKey: ["prs-prod-req-items"] });
      qc.invalidateQueries({ queryKey: ["coord-prod-reqs"] });
      qc.invalidateQueries({ queryKey: ["coord-prod-req-items"] });
      toast.success(editingId ? "Requirement updated" : "Requirement created");
      setDialogOpen(false);
      resetForm();
    },
    onError: (e: any) => toast.error(e.message || "Failed to save"),
  });

  const setStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await (supabase as any).from("production_requirements").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prs-prod-reqs"] });
      qc.invalidateQueries({ queryKey: ["coord-prod-reqs"] });
      toast.success("Status updated");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const setPriorityMutation = useMutation({
    mutationFn: async ({ id, priority }: { id: string; priority: string }) => {
      const { error } = await (supabase as any).from("production_requirements").update({ priority }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prs-prod-reqs"] });
      qc.invalidateQueries({ queryKey: ["coord-prod-reqs"] });
      toast.success("Priority updated");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("production_requirements").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prs-prod-reqs"] });
      qc.invalidateQueries({ queryKey: ["prs-prod-req-items"] });
      qc.invalidateQueries({ queryKey: ["coord-prod-reqs"] });
      qc.invalidateQueries({ queryKey: ["coord-prod-req-items"] });
      toast.success("Deleted");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const printRequirement = (req: any) => {
    const items = itemsByReq[req.id] || [];
    const html = `<!doctype html><html><head><title>${req.requirement_number}</title>
      <style>body{font-family:Arial;padding:20px;color:#111}h1{margin:0 0 4px}small{color:#555}
      table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #ccc;padding:6px;font-size:12px;text-align:left}
      th{background:#f3f4f6}</style></head><body>
      <h1>Production Requirement</h1>
      <small>${req.requirement_number} · ${req.status}</small>
      <p><b>Window:</b> ${req.window_from} → ${req.window_to}<br/>
      ${req.title ? `<b>Title:</b> ${req.title}<br/>` : ""}
      ${req.notes ? `<b>Notes:</b> ${req.notes}` : ""}</p>
      <table><thead><tr><th>#</th><th>Item</th><th>Qty</th><th>Unit</th><th>Required By</th><th>Remarks</th></tr></thead>
      <tbody>${items.map((it: any, i: number) => `<tr><td>${i + 1}</td><td>${planningMap[it.planning_item_id]?.name || "—"}</td><td>${Number(it.required_qty).toLocaleString()}</td><td>${it.unit || ""}</td><td>${it.required_by || ""}</td><td>${it.remarks || ""}</td></tr>`).join("")}</tbody></table>
      <script>window.onload=()=>{window.print();}</script></body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      "Draft": "bg-slate-100 text-slate-800",
      "In Progress": "bg-blue-100 text-blue-800",
      "Closed": "bg-green-100 text-green-800",
    };
    return <Badge className={map[s] || ""}>{s}</Badge>;
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-lg flex-wrap gap-2">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" /> Production Requirements — Manual
          </span>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36 h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="Draft">Draft</SelectItem>
                <SelectItem value="In Progress">In Progress</SelectItem>
                <SelectItem value="Closed">Closed</SelectItem>
              </SelectContent>
            </Select>
            {canManage && (
              <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> New Requirement</Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Showing requirements whose production window overlaps the selected From–To range.</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Kpi label="Requirements" value={reqKpis.totalRequirements} />
          <Kpi label="Open (not Closed)" value={reqKpis.open} />
          <Kpi label="Line Items" value={reqKpis.totalLineItems} />
          <Kpi label="Total Qty" value={reqKpis.totalQty.toLocaleString()} />
          <Kpi label="Next 6 Days Qty" value={reqKpis.next6Qty.toLocaleString()} sub={`${reqKpis.next6PerDay.toLocaleString()} / day`} />
        </div>

        <div className="rounded-lg border overflow-hidden hidden md:block">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>PR #</TableHead>
                <TableHead>Window</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Planned Items</TableHead>
                <TableHead className="text-right"># Items</TableHead>
                <TableHead className="text-right">No of Days</TableHead>
                <TableHead className="text-right">Total Qty</TableHead>
                <TableHead className="text-right">Per Day Qty</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRequirements.length === 0 ? (
                <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-6">No requirements in range</TableCell></TableRow>
              ) : sortedRequirements.map((r: any) => {
                const its = itemsByReq[r.id] || [];
                const totalQ = its.reduce((s: number, it: any) => s + Number(it.required_qty || 0), 0);
                const itemNames = its.map((it: any) => planningMap[it.planning_item_id]?.name).filter(Boolean);
                const itemsLabel = itemNames.length === 0 ? "—" : itemNames.length <= 3 ? itemNames.join(", ") : `${itemNames.slice(0, 3).join(", ")} +${itemNames.length - 3} more`;
                const days = workingDays(r.window_from, r.window_to);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.requirement_number}</TableCell>
                    <TableCell className="text-xs">{r.window_from} → {r.window_to}</TableCell>
                    <TableCell>{r.title || "—"}</TableCell>
                    <TableCell className="text-xs max-w-xs truncate" title={itemNames.join(", ")}>{itemsLabel}</TableCell>
                    <TableCell className="text-right">{its.length}</TableCell>
                    <TableCell className="text-right">{days}</TableCell>
                    <TableCell className="text-right font-semibold">{totalQ.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{days > 0 ? Math.round(totalQ / days).toLocaleString() : "—"}</TableCell>
                    <TableCell>{statusBadge(r.status)}</TableCell>
                    <TableCell>
                      {canManage ? (
                        <Select value={r.priority || "Medium"} onValueChange={(v) => setPriorityMutation.mutate({ id: r.id, priority: v })}>
                          <SelectTrigger className={cn(
                            "h-7 w-[110px] text-xs font-medium border",
                            r.priority === "Urgent" && "bg-red-50 border-red-200 text-red-700",
                            r.priority === "High" && "bg-amber-50 border-amber-200 text-amber-700",
                            r.priority === "Medium" && "bg-blue-50 border-blue-200 text-blue-700",
                            r.priority === "Low" && "bg-slate-50 border-slate-200 text-slate-600"
                          )}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Low">Low</SelectItem>
                            <SelectItem value="Medium">Medium</SelectItem>
                            <SelectItem value="High">High</SelectItem>
                            <SelectItem value="Urgent">Urgent</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className={cn(
                          "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border",
                          r.priority === "Urgent" && "bg-red-50 border-red-200 text-red-700",
                          r.priority === "High" && "bg-amber-50 border-amber-200 text-amber-700",
                          r.priority === "Medium" && "bg-blue-50 border-blue-200 text-blue-700",
                          r.priority === "Low" && "bg-slate-50 border-slate-200 text-slate-600"
                        )}>
                          {r.priority || "Medium"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="icon" variant="ghost" onClick={() => { setViewId(r.id); setViewOpen(true); }} title="View"><Eye className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => printRequirement(r)} title="Print"><Printer className="h-4 w-4" /></Button>
                      {canManage && (
                        <>
                          <Button size="icon" variant="ghost" onClick={() => openEdit(r)} title="Edit"><Pencil className="h-4 w-4" /></Button>
                          {r.status !== "Closed" && (
                            <Button size="sm" variant="outline" onClick={() => setStatusMutation.mutate({ id: r.id, status: "Closed" })}>Close</Button>
                          )}
                          <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete this requirement?")) deleteMutation.mutate(r.id); }} title="Delete"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Mobile */}
        <div className="md:hidden space-y-2">
          {sortedRequirements.length === 0 ? (
            <div className="text-center text-muted-foreground py-6 text-sm border rounded-lg">No requirements in range</div>
          ) : sortedRequirements.map((r: any) => {
            const its = itemsByReq[r.id] || [];
            const totalQ = its.reduce((s: number, it: any) => s + Number(it.required_qty || 0), 0);
            const days = workingDays(r.window_from, r.window_to);
            return (
              <div key={r.id} className="rounded-lg border bg-card p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-xs text-muted-foreground">{r.requirement_number}</div>
                    <div className="font-medium text-sm truncate">{r.title || "—"}</div>
                    <div className="text-[11px] text-muted-foreground">{r.window_from} → {r.window_to}</div>
                  </div>
                  {statusBadge(r.status)}
                </div>
                <div className="grid grid-cols-4 gap-1 text-center text-[11px]">
                  <div className="rounded bg-muted/50 py-1"><div className="text-muted-foreground">Items</div><div className="font-semibold">{its.length}</div></div>
                  <div className="rounded bg-muted/50 py-1"><div className="text-muted-foreground">Days</div><div className="font-semibold">{days}</div></div>
                  <div className="rounded bg-muted/50 py-1"><div className="text-muted-foreground">Qty</div><div className="font-semibold">{totalQ.toLocaleString()}</div></div>
                  <div className="rounded bg-muted/50 py-1"><div className="text-muted-foreground">/day</div><div className="font-semibold">{days > 0 ? Math.round(totalQ / days).toLocaleString() : "—"}</div></div>
                </div>
                <div className="flex flex-wrap gap-1 pt-1 border-t">
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => { setViewId(r.id); setViewOpen(true); }}><Eye className="h-3.5 w-3.5 mr-1" />View</Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => printRequirement(r)}><Printer className="h-3.5 w-3.5 mr-1" />Print</Button>
                  {canManage && (
                    <>
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5 mr-1" />Edit</Button>
                      {r.status !== "Closed" && (
                        <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setStatusMutation.mutate({ id: r.id, status: "Closed" })}>Close</Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Production Requirement" : "New Production Requirement"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div><Label>Window From *</Label><Input type="date" value={formWindowFrom} onChange={(e) => setFormWindowFrom(e.target.value)} /></div>
              <div><Label>Window To *</Label><Input type="date" value={formWindowTo} onChange={(e) => setFormWindowTo(e.target.value)} /></div>
              <div className="sm:col-span-2"><Label>Title</Label><Input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="Optional title" /></div>
              <div className="sm:col-span-4"><Label>Notes</Label><Textarea rows={2} value={formNotes} onChange={(e) => setFormNotes(e.target.value)} /></div>
            </div>
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[220px]">Planning Item *</TableHead>
                    <TableHead className="w-28">Required Qty *</TableHead>
                    <TableHead className="w-24">Unit</TableHead>
                    <TableHead className="w-40">Required By</TableHead>
                    <TableHead>Remarks</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {formLines.map((l, idx) => (
                    <TableRow key={idx}>
                      <TableCell>
                        <Select value={l.planning_item_id || undefined} onValueChange={(v) => {
                          const n = [...formLines];
                          n[idx].planning_item_id = v;
                          if (!n[idx].unit) n[idx].unit = planningMap[v]?.unit || "";
                          setFormLines(n);
                        }}>
                          <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                          <SelectContent className="max-h-72">
                            {planningItems.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell><Input type="number" step="0.01" value={l.required_qty} onChange={(e) => { const n = [...formLines]; n[idx].required_qty = e.target.value; setFormLines(n); }} /></TableCell>
                      <TableCell><Input value={l.unit} onChange={(e) => { const n = [...formLines]; n[idx].unit = e.target.value; setFormLines(n); }} /></TableCell>
                      <TableCell><Input type="date" value={l.required_by} onChange={(e) => { const n = [...formLines]; n[idx].required_by = e.target.value; setFormLines(n); }} /></TableCell>
                      <TableCell><Input value={l.remarks} onChange={(e) => { const n = [...formLines]; n[idx].remarks = e.target.value; setFormLines(n); }} /></TableCell>
                      <TableCell>
                        {formLines.length > 1 && <Button size="icon" variant="ghost" onClick={() => setFormLines(formLines.filter((_, i) => i !== idx))}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Button variant="outline" size="sm" onClick={() => setFormLines([...formLines, blankLine()])}><Plus className="h-4 w-4 mr-1" /> Add Line</Button>
          </div>
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button variant="secondary" onClick={() => saveMutation.mutate(false)} disabled={saveMutation.isPending}>Save as Draft</Button>
            <Button onClick={() => saveMutation.mutate(true)} disabled={saveMutation.isPending}>Save & Mark In Progress</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          {(() => {
            const r = requirements.find((x: any) => x.id === viewId);
            if (!r) return null;
            const its = itemsByReq[r.id] || [];
            return (
              <>
                <DialogHeader><DialogTitle>{r.requirement_number} — {statusBadge(r.status)}</DialogTitle></DialogHeader>
                <div className="space-y-3 text-sm">
                  <div><b>Window:</b> {r.window_from} → {r.window_to}</div>
                  {r.title && <div><b>Title:</b> {r.title}</div>}
                  {r.notes && <div><b>Notes:</b> {r.notes}</div>}
                  <div className="border rounded-md overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>#</TableHead>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead>Unit</TableHead>
                          <TableHead>Required By</TableHead>
                          <TableHead>Remarks</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {its.map((it: any, i: number) => (
                          <TableRow key={it.id}>
                            <TableCell>{i + 1}</TableCell>
                            <TableCell>{planningMap[it.planning_item_id]?.name || "—"}</TableCell>
                            <TableCell className="text-right">{Number(it.required_qty).toLocaleString()}</TableCell>
                            <TableCell>{it.unit || ""}</TableCell>
                            <TableCell>{it.required_by || ""}</TableCell>
                            <TableCell>{it.remarks || ""}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
