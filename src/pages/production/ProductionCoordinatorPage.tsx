import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/PageHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ClipboardList, Package, Factory, RefreshCw, ChevronDown, ChevronRight, AlertTriangle, Plus, Trash2, Pencil, Eye, Printer, Workflow } from "lucide-react";
import { Link } from "react-router-dom";
import { fetchStages, fetchThresholds, fetchEntriesAsOf, latestPerStage, statusFromUtil, fmtNum } from "@/pages/wip/wipShared";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const REFRESH_INTERVAL = 60_000;

type LineDraft = { id?: string; planning_item_id: string; required_qty: string; unit: string; required_by: string; remarks: string };
const blankLine = (): LineDraft => ({ planning_item_id: "", required_qty: "", unit: "", required_by: "", remarks: "" });

export default function ProductionCoordinatorPage() {
  const today = format(new Date(), "yyyy-MM-dd");
  const [fromDate, setFromDate] = useState<string>(today);
  const [toDate, setToDate] = useState<string>(today);
  const [selectedDepartment, setSelectedDepartment] = useState<string>("all");
  const [expandedDeptMat, setExpandedDeptMat] = useState<Set<string>>(new Set());
  const [expandedDeptPlan, setExpandedDeptPlan] = useState<Set<string>>(new Set());

  const { hasRole, hasModulePermission, user } = useAuth();
  const canManage = hasRole("super_admin") || hasRole("operational_manager") || hasModulePermission("production", "edit");
  const qc = useQueryClient();

  const toggle = (set: Set<string>, key: string, setter: (s: Set<string>) => void) => {
    const n = new Set(set);
    n.has(key) ? n.delete(key) : n.add(key);
    setter(n);
  };

  // Departments
  const { data: departments = [], refetch: refetchDepts } = useQuery({
    queryKey: ["coord-departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as any[];
    },
  });
  const deptMap = useMemo(() => Object.fromEntries(departments.map((d: any) => [d.id, d])), [departments]);

  // ---------- Material Issuances ----------
  const { data: matIssuances = [], refetch: refetchMatIss } = useQuery({
    queryKey: ["coord-mat-issuances", fromDate, toDate, selectedDepartment],
    queryFn: async () => {
      let q = (supabase as any)
        .from("hp_material_issuance")
        .select("*")
        .gte("issue_date", fromDate)
        .lte("issue_date", toDate);
      if (selectedDepartment !== "all") q = q.eq("department_id", selectedDepartment);
      const { data, error } = await q.order("issue_date", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  const matIssIds = matIssuances.map((i: any) => i.id);
  const { data: matIssItems = [], refetch: refetchMatItems } = useQuery({
    queryKey: ["coord-mat-iss-items", matIssIds.join(",")],
    enabled: matIssIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("hp_material_issuance_items")
        .select("*")
        .in("issuance_id", matIssIds);
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  const { data: hpMaterials = [] } = useQuery({
    queryKey: ["coord-hp-materials"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("hp_materials")
        .select("id, name, unit, category");
      if (error) throw error;
      return (data || []) as any[];
    },
  });
  const matMap = useMemo(() => Object.fromEntries(hpMaterials.map((m: any) => [m.id, m])), [hpMaterials]);

  type MatDeptItem = { name: string; unit: string; qty: number; remarks: string; issueDate: string };
  type MatDeptRow = {
    deptId: string;
    deptName: string;
    issuances: number;
    distinctMaterials: number;
    totalQty: number;
    items: MatDeptItem[];
  };
  const matByDept: MatDeptRow[] = useMemo(() => {
    const issuanceMetaMap: Record<string, { dept: string; date: string }> = {};
    matIssuances.forEach((i: any) => { issuanceMetaMap[i.id] = { dept: i.department_id, date: i.issue_date }; });
    const buckets: Record<string, { items: MatDeptItem[]; issuanceIds: Set<string>; matNames: Set<string> }> = {};
    matIssItems.forEach((it: any) => {
      const meta = issuanceMetaMap[it.issuance_id];
      if (!meta) return;
      const bucket = (buckets[meta.dept] = buckets[meta.dept] || { items: [], issuanceIds: new Set(), matNames: new Set() });
      bucket.issuanceIds.add(it.issuance_id);
      const mat = matMap[it.material_id];
      const name = mat?.name || "—";
      const unit = mat?.unit || "";
      bucket.matNames.add(name);
      bucket.items.push({
        name,
        unit,
        qty: Number(it.issued_qty || 0),
        remarks: it.remarks || "",
        issueDate: meta.date || "",
      });
    });
    matIssuances.forEach((i: any) => {
      const b = (buckets[i.department_id] = buckets[i.department_id] || { items: [], issuanceIds: new Set(), matNames: new Set() });
      b.issuanceIds.add(i.id);
    });
    return Object.entries(buckets).map(([deptId, b]) => {
      const items = b.items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      return {
        deptId,
        deptName: deptMap[deptId]?.name || "—",
        issuances: b.issuanceIds.size,
        distinctMaterials: b.matNames.size,
        totalQty: items.reduce((s, m) => s + m.qty, 0),
        items,
      };
    }).sort((a, b) => a.deptName.localeCompare(b.deptName));
  }, [matIssuances, matIssItems, matMap, deptMap]);


  const matKpis = useMemo(() => ({
    totalIssuances: matIssuances.length,
    totalItems: matIssItems.length,
    totalQty: matIssItems.reduce((s: number, it: any) => s + Number(it.issued_qty || 0), 0),
    departments: new Set(matIssuances.map((i: any) => i.department_id)).size,
  }), [matIssuances, matIssItems]);

  // ---------- Job Orders ----------
  const { data: jobOrders = [], refetch: refetchJO } = useQuery({
    queryKey: ["coord-job-orders", fromDate, toDate, selectedDepartment],
    queryFn: async () => {
      let q = (supabase as any)
        .from("job_orders")
        .select("*")
        .gte("required_by_date", fromDate)
        .lte("required_by_date", toDate)
        .in("status", ["Issued", "Closed"]);
      if (selectedDepartment !== "all") q = q.eq("department_id", selectedDepartment);
      const { data, error } = await q.order("required_by_date", { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  const joIds = jobOrders.map((o: any) => o.id);
  const { data: joItems = [], refetch: refetchJOItems } = useQuery({
    queryKey: ["coord-jo-items", joIds.join(",")],
    enabled: joIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("job_order_items")
        .select("*")
        .in("job_order_id", joIds);
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  // Planning items master (also used by requirement dialog)
  const { data: planningItems = [] } = useQuery({
    queryKey: ["coord-planning-items-all"],
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
    queryKey: ["coord-public-holidays"],
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

  type PlanDeptRow = {
    deptId: string;
    deptName: string;
    joCount: number;
    totalQty: number;
    items: { name: string; detail?: string; qty: number; unit: string; joNumber: string }[];
  };
  const planByDept: PlanDeptRow[] = useMemo(() => {
    const joDeptMap: Record<string, { dept: string; number: string }> = {};
    jobOrders.forEach((o: any) => { joDeptMap[o.id] = { dept: o.department_id, number: o.job_order_number || "" }; });
    const buckets: Record<string, { joIds: Set<string>; items: PlanDeptRow["items"]; totalQty: number }> = {};
    joItems.forEach((it: any) => {
      const meta = joDeptMap[it.job_order_id];
      if (!meta) return;
      const b = (buckets[meta.dept] = buckets[meta.dept] || { joIds: new Set(), items: [], totalQty: 0 });
      b.joIds.add(it.job_order_id);
      const pi = planningMap[it.planning_item_id];
      const qty = Number(it.quantity || 0);
      b.items.push({
        name: pi?.name || "—",
        detail: it.item_detail || undefined,
        qty,
        unit: it.unit || pi?.unit || "",
        joNumber: meta.number,
      });
      b.totalQty += qty;
    });
    jobOrders.forEach((o: any) => {
      const b = (buckets[o.department_id] = buckets[o.department_id] || { joIds: new Set(), items: [], totalQty: 0 });
      b.joIds.add(o.id);
    });
    return Object.entries(buckets).map(([deptId, b]) => ({
      deptId,
      deptName: deptMap[deptId]?.name || "—",
      joCount: b.joIds.size,
      totalQty: b.totalQty,
      items: b.items.sort((a, b) => b.qty - a.qty),
    })).sort((a, b) => a.deptName.localeCompare(b.deptName));
  }, [jobOrders, joItems, planningMap, deptMap]);

  const planKpis = useMemo(() => ({
    jobOrders: jobOrders.length,
    departments: new Set(jobOrders.map((o: any) => o.department_id)).size,
    totalQty: joItems.reduce((s: number, it: any) => s + Number(it.quantity || 0), 0),
  }), [jobOrders, joItems]);

  // ---------- Manual Production Requirements ----------
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

  const { data: requirements = [], refetch: refetchReqs } = useQuery({
    queryKey: ["coord-prod-reqs", fromDate, toDate, statusFilter],
    queryFn: async () => {
      // overlap: window_from <= toDate AND window_to >= fromDate
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
  const { data: reqItems = [], refetch: refetchReqItems } = useQuery({
    queryKey: ["coord-prod-req-items", reqIds.join(",")],
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

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = async (req: any) => {
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
        // Replace items
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

  const refreshAll = () => {
    refetchDepts();
    refetchMatIss();
    refetchMatItems();
    refetchJO();
    refetchJOItems();
    refetchReqs();
    refetchReqItems();
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
    <div className="p-3 sm:p-4 space-y-4">
      <PageHeader
        title="Production Coordinator"
        description="Live coordination view — material flow, today's plan and manual production requirements"
        icon={ClipboardList}
      />

      {/* Filters */}
      <Card>
        <CardContent className="p-3 grid grid-cols-2 sm:flex sm:flex-wrap sm:items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">From</label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-full sm:w-40" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">To</label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-full sm:w-40" />
          </div>
          <div className="flex flex-col gap-1 col-span-2">
            <label className="text-xs text-muted-foreground">Department</label>
            <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
              <SelectTrigger className="w-full sm:w-56"><SelectValue placeholder="All Departments" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 sm:ml-auto">
            <Button variant="outline" onClick={refreshAll} size="sm" className="w-full sm:w-auto">
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <WIPMonitorSection today={today} />

      {/* Section 1: Production Requirements */}
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
          {/* Mobile card list */}
          <div className="md:hidden space-y-2">
            {sortedRequirements.length === 0 ? (
              <div className="text-center text-muted-foreground py-6 text-sm border rounded-lg">No requirements in range</div>
            ) : sortedRequirements.map((r: any) => {
              const its = itemsByReq[r.id] || [];
              const totalQ = its.reduce((s: number, it: any) => s + Number(it.required_qty || 0), 0);
              const itemNames = its.map((it: any) => planningMap[it.planning_item_id]?.name).filter(Boolean);
              const itemsLabel = itemNames.length === 0 ? "—" : itemNames.length <= 2 ? itemNames.join(", ") : `${itemNames.slice(0, 2).join(", ")} +${itemNames.length - 2}`;
              const days = workingDays(r.window_from, r.window_to);
              const priorityCls = cn(
                r.priority === "Urgent" && "bg-red-50 border-red-200 text-red-700",
                r.priority === "High" && "bg-amber-50 border-amber-200 text-amber-700",
                (r.priority === "Medium" || !r.priority) && "bg-blue-50 border-blue-200 text-blue-700",
                r.priority === "Low" && "bg-slate-50 border-slate-200 text-slate-600",
              );
              return (
                <div key={r.id} className="rounded-lg border bg-card p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-xs text-muted-foreground">{r.requirement_number}</div>
                      <div className="font-medium text-sm truncate">{r.title || "—"}</div>
                      <div className="text-[11px] text-muted-foreground">{r.window_from} → {r.window_to}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {statusBadge(r.status)}
                      {canManage ? (
                        <Select value={r.priority || "Medium"} onValueChange={(v) => setPriorityMutation.mutate({ id: r.id, priority: v })}>
                          <SelectTrigger className={cn("h-6 w-[90px] text-[11px] font-medium border", priorityCls)}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Low">Low</SelectItem>
                            <SelectItem value="Medium">Medium</SelectItem>
                            <SelectItem value="High">High</SelectItem>
                            <SelectItem value="Urgent">Urgent</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border", priorityCls)}>{r.priority || "Medium"}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground line-clamp-2">{itemsLabel}</div>
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
                        <Button size="sm" variant="ghost" className="h-7 px-2 ml-auto" onClick={() => { if (confirm("Delete this requirement?")) deleteMutation.mutate(r.id); }}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
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
                  <TableHead className="text-right" title="Working days (excludes Sundays & public holidays)">No of Days</TableHead>
                  <TableHead className="text-right">Total Qty</TableHead>
                  <TableHead className="text-right" title="Total Qty ÷ working days">Per Day Qty</TableHead>
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
                      <TableCell className="text-right" title="Working days (excludes Sundays & public holidays)">{days}</TableCell>
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
        </CardContent>
      </Card>

      {/* Section 2: Production Plan */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Factory className="h-5 w-5 text-indigo-600" /> Production Plan — Department-wise
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Kpi label="Job Orders" value={planKpis.jobOrders} />
            <Kpi label="Departments Planned" value={planKpis.departments} />
            <Kpi label="Total Planned Qty" value={planKpis.totalQty.toLocaleString()} />
          </div>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-10" />
                  <TableHead>Department</TableHead>
                  <TableHead className="text-right hidden sm:table-cell"># Job Orders</TableHead>
                  <TableHead className="text-right">Total Planned Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {planByDept.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No job orders in range</TableCell></TableRow>
                ) : planByDept.map((row) => {
                  const open = expandedDeptPlan.has(row.deptId);
                  return (
                    <>
                      <TableRow key={row.deptId} className="cursor-pointer" onClick={() => toggle(expandedDeptPlan, row.deptId, setExpandedDeptPlan)}>
                        <TableCell className="p-2"><button className="p-1">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></TableCell>
                        <TableCell className="font-medium">
                          <div>{row.deptName}</div>
                          <div className="sm:hidden text-[11px] text-muted-foreground mt-0.5">{row.joCount} JOs</div>
                        </TableCell>
                        <TableCell className="text-right hidden sm:table-cell">{row.joCount}</TableCell>
                        <TableCell className="text-right font-semibold">{row.totalQty.toLocaleString()}</TableCell>
                      </TableRow>
                      {open && (
                        <TableRow key={row.deptId + "-x"} className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={4} className="p-2 sm:p-3">
                            {row.items.length === 0 ? (
                              <p className="text-xs text-muted-foreground italic">No items planned</p>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs sm:text-sm">
                                  <thead>
                                    <tr className="text-left text-xs text-muted-foreground border-b">
                                      <th className="py-1 pr-3">Item</th>
                                      <th className="py-1 pr-3 hidden sm:table-cell">Detail</th>
                                      <th className="py-1 pr-3 text-right">Qty</th>
                                      <th className="py-1 pr-3 hidden sm:table-cell">Unit</th>
                                      <th className="py-1 pr-3 hidden md:table-cell">JO #</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.items.map((it, i) => (
                                      <tr key={i} className="border-b last:border-0">
                                        <td className="py-1 pr-3">
                                          <div>{it.name}</div>
                                          <div className="sm:hidden text-[10px] text-muted-foreground">{it.detail || ""} {it.joNumber ? `· ${it.joNumber}` : ""}</div>
                                        </td>
                                        <td className="py-1 pr-3 text-muted-foreground hidden sm:table-cell">{it.detail || "—"}</td>
                                        <td className="py-1 pr-3 text-right font-semibold whitespace-nowrap">{it.qty.toLocaleString()} <span className="sm:hidden text-[10px] text-muted-foreground">{it.unit}</span></td>
                                        <td className="py-1 pr-3 hidden sm:table-cell">{it.unit}</td>
                                        <td className="py-1 pr-3 hidden md:table-cell"><Badge variant="outline" className="text-[10px]">{it.joNumber || "—"}</Badge></td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Section 3: Material Received */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Package className="h-5 w-5 text-amber-600" /> Material Received — Department-wise
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Total Issuances" value={matKpis.totalIssuances} />
            <Kpi label="Total Items" value={matKpis.totalItems} />
            <Kpi label="Total Qty Issued" value={matKpis.totalQty.toLocaleString()} />
            <Kpi label="Departments" value={matKpis.departments} />
          </div>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-10" />
                  <TableHead>Department</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">Issuances</TableHead>
                  <TableHead className="text-right hidden md:table-cell">Distinct Materials</TableHead>
                  <TableHead className="text-right">Total Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matByDept.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No material issuances in range</TableCell></TableRow>
                ) : matByDept.map((row) => {
                  const open = expandedDeptMat.has(row.deptId);
                  return (
                    <>
                      <TableRow key={row.deptId} className="cursor-pointer" onClick={() => toggle(expandedDeptMat, row.deptId, setExpandedDeptMat)}>
                        <TableCell className="p-2"><button className="p-1">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></TableCell>
                        <TableCell className="font-medium">
                          <div>{row.deptName}</div>
                          <div className="sm:hidden text-[11px] text-muted-foreground mt-0.5">
                            {row.issuances} iss · {row.distinctMaterials} mat
                          </div>
                        </TableCell>
                        <TableCell className="text-right hidden sm:table-cell">{row.issuances}</TableCell>
                        <TableCell className="text-right hidden md:table-cell">{row.distinctMaterials}</TableCell>
                        <TableCell className="text-right font-semibold">{row.totalQty.toLocaleString()}</TableCell>
                      </TableRow>
                      {open && (
                        <TableRow key={row.deptId + "-x"} className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={5} className="p-2 sm:p-3">
                            {row.items.length === 0 ? (
                              <p className="text-xs text-muted-foreground italic">No items in these issuances</p>
                            ) : (
                              <div className="overflow-x-auto rounded border bg-background">
                                <table className="w-full text-xs sm:text-sm">
                                  <thead>
                                    <tr className="text-left text-xs text-muted-foreground border-b">
                                      <th className="py-1.5 px-2 w-8" />
                                      <th className="py-1.5 px-2">Material</th>
                                      <th className="py-1.5 px-2 text-right whitespace-nowrap">Qty</th>
                                      <th className="py-1.5 px-2">Remarks</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.items.map((m, i) => {
                                      const ch = (m.name || "").trim().charAt(0).toUpperCase();
                                      const letter = /[A-Z]/.test(ch) ? ch : "#";
                                      const prevCh = i > 0 ? (row.items[i - 1].name || "").trim().charAt(0).toUpperCase() : "";
                                      const prevLetter = /[A-Z]/.test(prevCh) ? prevCh : (i > 0 ? "#" : "");
                                      const showLetter = i === 0 || letter !== prevLetter;
                                      const nextCh = i < row.items.length - 1 ? (row.items[i + 1].name || "").trim().charAt(0).toUpperCase() : "";
                                      const nextLetter = /[A-Z]/.test(nextCh) ? nextCh : (i < row.items.length - 1 ? "#" : "");
                                      const isLastOfGroup = i === row.items.length - 1 || letter !== nextLetter;
                                      return (
                                        <tr key={i} className={cn("border-b last:border-0", isLastOfGroup && "border-b-2")}>
                                          <td className="py-1.5 px-2 font-bold text-muted-foreground text-center align-top">{showLetter ? letter : ""}</td>
                                          <td className="py-1.5 px-2 align-top">{m.name}</td>
                                          <td className="py-1.5 px-2 text-right font-semibold whitespace-nowrap align-top">{m.qty.toLocaleString()} {m.unit}</td>
                                          <td className="py-1.5 px-2 text-muted-foreground align-top">{m.remarks || "—"}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}

                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

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
                            <TableCell className="text-right font-semibold">{Number(it.required_qty).toLocaleString()}</TableCell>
                            <TableCell>{it.unit || "—"}</TableCell>
                            <TableCell>{it.required_by || "—"}</TableCell>
                            <TableCell className="text-muted-foreground">{it.remarks || "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => printRequirement(r)}><Printer className="h-4 w-4 mr-1" /> Print</Button>
                  <Button onClick={() => setViewOpen(false)}>Close</Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function WIPMonitorSection({ today }: { today: string }) {
  const { data: stages = [] } = useQuery({ queryKey: ["pcoord-wip-stages"], queryFn: () => fetchStages(true), refetchInterval: REFRESH_INTERVAL });
  const { data: thresholds = [] } = useQuery({ queryKey: ["pcoord-wip-thresholds"], queryFn: fetchThresholds, refetchInterval: REFRESH_INTERVAL });
  const { data: entries = [], refetch } = useQuery({ queryKey: ["pcoord-wip-entries", today], queryFn: () => fetchEntriesAsOf(today), refetchInterval: REFRESH_INTERVAL });

  const thresholdMap = useMemo(() => new Map(thresholds.map((t: any) => [t.stage_id, t])), [thresholds]);
  const latestMap = useMemo(() => latestPerStage(entries), [entries]);

  const rows = useMemo(() => stages.map((s: any) => {
    const latest = latestMap.get(s.id);
    const wip = latest ? Number(latest.quantity) : 0;
    const th: any = thresholdMap.get(s.id);
    const threshold = th ? Number(th.max_threshold) : 0;
    const unit = th?.unit || s.unit || "dozens";
    const util = threshold > 0 ? (wip / threshold) * 100 : 0;
    const st = statusFromUtil(util);
    return { s, latest, wip, threshold, unit, util, st, hasThreshold: !!th, hasEntry: !!latest };
  }), [stages, latestMap, thresholdMap]);

  const bottlenecks = rows.filter(r => r.hasThreshold && r.util > 100).length;
  const warnings = rows.filter(r => r.hasThreshold && r.util >= 75 && r.util <= 100).length;

  const latestEntryAt = useMemo(() => {
    if (!entries.length) return null;
    const e: any = entries[0];
    return new Date(`${e.entry_date}T${(e.entry_time || "00:00:00").slice(0, 8)}`);
  }, [entries]);
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const minutesSinceLast = latestEntryAt ? Math.floor((nowTick - latestEntryAt.getTime()) / 60_000) : null;
  const isStale = minutesSinceLast === null || minutesSinceLast > 120;

  return (
    <Card className="rounded-xl">
      <CardHeader className="px-3 sm:px-6 pt-3 sm:pt-4 pb-2 space-y-2">
        <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
          <Workflow className="h-4 w-4 text-amber-500 shrink-0" />
          <span className="leading-tight">WIP Monitor</span>
        </CardTitle>
        <p className="text-sm sm:text-base font-bold text-foreground">Stock Hold Status</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="text-amber-600 text-[10px] sm:text-xs">Warning: {warnings}</Badge>
          <Badge variant="outline" className="text-red-600 text-[10px] sm:text-xs">Bottleneck: {bottlenecks}</Badge>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => refetch()}><RefreshCw className="h-3 w-3 mr-1" />Refresh</Button>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" asChild><Link to="/wip/dashboard">Open</Link></Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
        <p className="text-[11px] sm:text-xs text-muted-foreground mb-2">Latest stock entries as of {today}</p>
        <div className="rounded-lg border overflow-hidden">
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <Table className="min-w-[560px] text-xs sm:text-sm">
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="h-9 w-10">#</TableHead>
                  <TableHead className="h-9">Stage</TableHead>
                  <TableHead className="text-right h-9">Current WIP</TableHead>
                  <TableHead className="text-right h-9">Threshold</TableHead>
                  <TableHead className="text-right h-9">Utilisation</TableHead>
                  <TableHead className="h-9">Status</TableHead>
                  <TableHead className="h-9">Last Entry</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No WIP stages configured</TableCell></TableRow>
                ) : rows.map(r => (
                  <TableRow key={r.s.id}>
                    <TableCell className={cn("py-2", r.st.label === "Bottleneck" && "font-bold text-red-600")}>{r.s.sequence_order}</TableCell>
                    <TableCell className={cn("font-medium py-2", r.st.label === "Bottleneck" && "font-bold text-red-600")}>{r.s.name}</TableCell>
                    <TableCell className={cn("text-right py-2", r.st.label === "Bottleneck" && "font-bold text-red-600")}>{r.hasEntry ? `${fmtNum(r.wip)} ${r.unit}` : "—"}</TableCell>
                    <TableCell className={cn("text-right py-2", r.st.label === "Bottleneck" && "font-bold text-red-600")}>{r.hasThreshold ? `${fmtNum(r.threshold)} ${r.unit}` : "—"}</TableCell>
                    <TableCell className={cn("text-right py-2", r.st.label === "Bottleneck" && "font-bold text-red-600")}>{r.hasThreshold ? `${r.util.toFixed(0)}%` : "—"}</TableCell>
                    <TableCell className={cn("py-2", r.st.label === "Bottleneck" && "font-bold text-red-600")}>
                      {r.hasThreshold ? (
                        <Badge variant="outline" className={r.st.color}>{r.st.label}</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">No threshold</Badge>
                      )}
                    </TableCell>
                    <TableCell className={cn("py-2 text-muted-foreground", r.st.label === "Bottleneck" && "font-bold text-red-600")}>
                      {r.latest ? `${r.latest.entry_date} ${r.latest.entry_time?.slice(0,5)}` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {/* Mobile cards */}
          <div className="sm:hidden divide-y">
            {rows.length === 0 ? (
              <div className="text-center text-muted-foreground py-6 text-sm">No WIP stages configured</div>
            ) : rows.map(r => (
              <div key={r.s.id} className={cn("p-3 space-y-1.5", r.st.label === "Bottleneck" && "bg-red-50")}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-sm truncate">
                    <span className={cn("mr-1", r.st.label === "Bottleneck" ? "font-bold text-red-600" : "text-muted-foreground")}>{r.s.sequence_order}.</span>
                    <span className={cn(r.st.label === "Bottleneck" && "font-bold text-red-600")}>{r.s.name}</span>
                  </div>
                  {r.hasThreshold ? (
                    <Badge variant="outline" className={cn(r.st.color, "text-[10px] shrink-0")}>{r.st.label}</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground text-[10px] shrink-0">No threshold</Badge>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                  <div className="rounded bg-muted/40 px-1.5 py-1">
                    <div className="text-muted-foreground">WIP</div>
                    <div className={cn("font-semibold truncate", r.st.label === "Bottleneck" && "font-bold text-red-600")}>{r.hasEntry ? `${fmtNum(r.wip)}` : "—"}</div>
                  </div>
                  <div className="rounded bg-muted/40 px-1.5 py-1">
                    <div className="text-muted-foreground">Threshold</div>
                    <div className={cn("font-semibold truncate", r.st.label === "Bottleneck" && "font-bold text-red-600")}>{r.hasThreshold ? `${fmtNum(r.threshold)}` : "—"}</div>
                  </div>
                  <div className="rounded bg-muted/40 px-1.5 py-1">
                    <div className="text-muted-foreground">Util.</div>
                    <div className={cn("font-semibold", r.st.label === "Bottleneck" && "font-bold text-red-600")}>{r.hasThreshold ? `${r.util.toFixed(0)}%` : "—"}</div>
                  </div>
                </div>
                <div className={cn("text-[10px] text-muted-foreground", r.st.label === "Bottleneck" && "font-bold text-red-600")}>
                  {r.unit} · {r.latest ? `${r.latest.entry_date} ${r.latest.entry_time?.slice(0,5)}` : "no entry"}
                </div>
              </div>
            ))}
          </div>
        </div>
        {isStale && (
          <div className="mt-3 flex items-center gap-2 rounded-md border-2 border-red-500 bg-red-50 px-3 py-2 animate-pulse">
            <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
            <span className="text-xs sm:text-sm font-bold text-red-600">
              ⚠ No WIP data posted in last 2 hours
              {minutesSinceLast !== null
                ? ` — last entry ${minutesSinceLast >= 60 ? `${Math.floor(minutesSinceLast / 60)}h ${minutesSinceLast % 60}m` : `${minutesSinceLast}m`} ago`
                : " — no entries today"}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

