import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek } from "date-fns";

import { Trash2, Plus, AlertOctagon, Loader2, Droplets, Pencil, ClipboardCheck } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { Link } from "react-router-dom";

type Lookup = { id: string; name: string; code?: string | null; unit?: string | null; unit_cost?: number | null; selectable?: boolean };

export default function RejectionsWastageEntryPage() {
  const today = format(new Date(), "yyyy-MM-dd");
  const { user, hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  const qc = useQueryClient();

  const [entryDate, setEntryDate] = useState(today);
  const [tab, setTab] = useState<string>("rejections");

  // From the R&W cutover the floor checker owns ball rejections and leakages,
  // so those tabs come off this page for on/after dates — two places to type the
  // same ball is how the counts start disagreeing. Pre-cutover dates keep them,
  // because that is where the history lives and it still needs reading.
  const { data: rwCutover } = useQuery({
    queryKey: ["rw-ball-cutover"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("rw_ball_cutover");
      if (error) return null;
      return data as string | null;
    },
    staleTime: Infinity,
  });
  const ballTabsHidden = !!rwCutover && entryDate >= rwCutover;

  useEffect(() => {
    if (ballTabsHidden && tab !== "wastages") setTab("wastages");
  }, [ballTabsHidden, tab]);

  const [departmentId, setDepartmentId] = useState<string>("");
  const [shift, setShift] = useState<string>("Day");

  // View period filter (for entries list)
  const [periodMode, setPeriodMode] = useState<"day" | "week" | "month" | "custom">("day");
  const [periodMonth, setPeriodMonth] = useState<string>(format(new Date(), "yyyy-MM"));
  const [periodFrom, setPeriodFrom] = useState<string>(today);
  const [periodTo, setPeriodTo] = useState<string>(today);

  const { fromDate: viewFrom, toDate: viewTo } = useMemo(() => {
    if (periodMode === "day") return { fromDate: entryDate, toDate: entryDate };
    if (periodMode === "week") {
      const base = new Date(entryDate);
      return {
        fromDate: format(startOfWeek(base, { weekStartsOn: 1 }), "yyyy-MM-dd"),
        toDate: format(endOfWeek(base, { weekStartsOn: 1 }), "yyyy-MM-dd"),
      };
    }
    if (periodMode === "month") {
      const [y, m] = periodMonth.split("-").map(Number);
      const base = new Date(y, (m || 1) - 1, 1);
      return {
        fromDate: format(startOfMonth(base), "yyyy-MM-dd"),
        toDate: format(endOfMonth(base), "yyyy-MM-dd"),
      };
    }
    return { fromDate: periodFrom, toDate: periodTo };
  }, [periodMode, periodMonth, periodFrom, periodTo, entryDate]);


  // Lookups
  const { data: departments = [] } = useQuery<Lookup[]>({
    queryKey: ["rw-depts"],
    queryFn: async () => {
      const [{ data: eligible }, { data: depts }] = await Promise.all([
        supabase.from("job_order_eligible_departments").select("department_id"),
        supabase.from("production_departments").select("id, name").eq("is_active", true).order("name"),
      ]);
      const allowed = new Set((eligible || []).map((r: any) => r.department_id));
      return ((depts || []) as Lookup[]).filter((d) => allowed.has(d.id));
    },
  });

  const { data: processes = [] } = useQuery<Lookup[]>({
    queryKey: ["rw-processes"],
    queryFn: async () => {
      const { data } = await supabase
        .from("hourly_production_processes")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      return (data || []) as Lookup[];
    },
  });

  const { data: products = [] } = useQuery<Lookup[]>({
    queryKey: ["rw-products"],
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("id, name, code")
        .order("name");
      return (data || []) as Lookup[];
    },
  });

  const { data: materials = [] } = useQuery<Lookup[]>({
    queryKey: ["rw-materials"],
    queryFn: async () => {
      // Active cost rows from the R&W master
      const { data: master } = await (supabase as any)
        .from("rw_materials")
        .select("id, hp_material_id, unit, unit_cost, is_active")
        .eq("is_active", true);
      // All hp_materials — source of material names
      const { data: hp } = await supabase
        .from("hp_materials")
        .select("id, name, code, unit")
        .order("name");
      const hpById = new Map<string, any>((hp || []).map((h: any) => [h.id, h]));
      // Selectable: rw_materials rows resolved via hp name (these are the only ones a user can pick)
      const selectable: Lookup[] = ((master || []) as any[])
        .map((m) => {
          const h = hpById.get(m.hp_material_id);
          if (!h) return null;
          return { id: h.id, name: h.name, code: h.code, unit: m.unit || h.unit, unit_cost: Number(m.unit_cost || 0), selectable: true };
        })
        .filter(Boolean) as Lookup[];
      selectable.sort((a, b) => a.name.localeCompare(b.name));
      // Display-only fallback so older entries (with material_id pointing to hp_materials) still show a name
      const selectableIds = new Set(selectable.map((s) => s.id));
      const legacyDisplay: Lookup[] = (hp || [])
        .filter((h: any) => !selectableIds.has(h.id))
        .map((h: any) => ({ id: h.id, name: h.name, code: h.code, unit: h.unit, unit_cost: 0, selectable: false }));
      return [...selectable, ...legacyDisplay];
    },
  });

  const selectableMaterials = useMemo(() => materials.filter((m) => m.selectable), [materials]);


  const { data: reasons = [] } = useQuery({
    queryKey: ["rw-reasons-active"],
    queryFn: async () => {
      const { data } = await supabase
        .from("rw_reasons")
        .select("id, name, type, category")
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
  });

  const { data: units = [] } = useQuery({
    queryKey: ["rw-units-active"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("rw_units")
        .select("id, symbol, name, is_active")
        .eq("is_active", true)
        .order("symbol");
      return (data || []) as { id: string; symbol: string; name: string }[];
    },
  });

  const { data: dispositions = [] } = useQuery({
    queryKey: ["rw-dispositions-active"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("rw_dispositions")
        .select("id, name, is_active")
        .eq("is_active", true)
        .order("name");
      return (data || []) as { id: string; name: string }[];
    },
  });

  const dispositionMap = useMemo(
    () => Object.fromEntries((dispositions as any[]).map((d) => [d.id, d])),
    [dispositions]
  );

  const rejectionReasons = reasons.filter((r: any) => r.type === "rejection");
  const wastageReasons = reasons.filter((r: any) => r.type === "wastage");
  const leakageReasons = reasons.filter((r: any) => r.type === "leakage");

  // Entries (filtered by period)
  const { data: todayRejections = [], refetch: refetchRej } = useQuery({
    queryKey: ["rw-rejections-list", viewFrom, viewTo, departmentId],
    queryFn: async () => {
      let q = supabase
        .from("rw_rejections")
        .select("*")
        .gte("entry_date", viewFrom)
        .lte("entry_date", viewTo)
        .order("entered_at", { ascending: false });
      if (departmentId) q = q.eq("department_id", departmentId);
      const { data } = await q;
      return data || [];
    },
    enabled: !!viewFrom && !!viewTo,
  });

  const { data: todayWastages = [], refetch: refetchWst } = useQuery({
    queryKey: ["rw-wastages-list", viewFrom, viewTo, departmentId],
    queryFn: async () => {
      let q = supabase
        .from("rw_wastages")
        .select("*")
        .gte("entry_date", viewFrom)
        .lte("entry_date", viewTo)
        .order("entered_at", { ascending: false });
      if (departmentId) q = q.eq("department_id", departmentId);
      const { data } = await q;
      return data || [];
    },
    enabled: !!viewFrom && !!viewTo,
  });

  const { data: todayLeakages = [], refetch: refetchLkg } = useQuery({
    queryKey: ["rw-leakages-list", viewFrom, viewTo, departmentId],
    queryFn: async () => {
      let q = (supabase as any)
        .from("rw_leakages")
        .select("*")
        .gte("entry_date", viewFrom)
        .lte("entry_date", viewTo)
        .order("entered_at", { ascending: false });
      if (departmentId) q = q.eq("department_id", departmentId);
      const { data } = await q;
      return data || [];
    },
    enabled: !!viewFrom && !!viewTo,
  });


  const productMap = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const processMap = useMemo(() => Object.fromEntries(processes.map((p) => [p.id, p])), [processes]);
  const materialMap = useMemo(() => Object.fromEntries(materials.map((m) => [m.id, m])), [materials]);
  const reasonMap = useMemo(() => Object.fromEntries((reasons as any[]).map((r) => [r.id, r])), [reasons]);

  // Rejection form
  const [rejForm, setRejForm] = useState({
    process_id: "none",
    material_id: "none",
    rejected_qty: "",
    unit: "pcs",
    disposition_id: "none",
    reason_id: "none",
    unit_cost: "",
    remarks: "",
  });
  const [savingRej, setSavingRej] = useState(false);

  // Wastage form
  const [wstForm, setWstForm] = useState({
    material_id: "none",
    wasted_qty: "",
    unit: "kg",
    disposition_id: "none",
    reason_id: "none",
    unit_cost: "",
    remarks: "",
  });
  const [savingWst, setSavingWst] = useState(false);

  // Leakage form
  const [lkgForm, setLkgForm] = useState({
    process_id: "none",
    material_id: "none",
    leaked_qty: "",
    unit: "pcs",
    disposition_id: "none",
    reason_id: "none",
    unit_cost: "",
    remarks: "",
  });
  const [savingLkg, setSavingLkg] = useState(false);

  const addRejection = async () => {
    if (!departmentId) return toast({ title: "Select department", variant: "destructive" });
    const qty = parseFloat(rejForm.rejected_qty);
    if (!qty || qty <= 0) return toast({ title: "Enter rejected qty", variant: "destructive" });
    const uc = parseFloat(rejForm.unit_cost) || 0;
    setSavingRej(true);
    const dispoId = rejForm.disposition_id !== "none" ? rejForm.disposition_id : null;
    const dispoName = dispoId ? (dispositionMap[dispoId]?.name || "scrap") : "scrap";
    const { error } = await (supabase as any).from("rw_rejections").insert({
      entry_date: entryDate,
      department_id: departmentId,
      process_id: rejForm.process_id !== "none" ? rejForm.process_id : null,
      material_id: rejForm.material_id !== "none" ? rejForm.material_id : null,
      shift,
      rejected_qty: qty,
      unit: rejForm.unit,
      disposition: dispoName.toLowerCase(),
      disposition_id: dispoId,
      rework_status: "pending",
      reason_id: rejForm.reason_id !== "none" ? rejForm.reason_id : null,
      remarks: rejForm.remarks || null,
      unit_cost: uc,
      total_cost: qty * uc,
      entered_by: user?.id || null,
    });
    setSavingRej(false);
    if (error) return toast({ title: "Save failed", description: error.message, variant: "destructive" });
    toast({ title: "Rejection logged" });
    setRejForm({ ...rejForm, rejected_qty: "", remarks: "" });
    refetchRej();
  };

  const addWastage = async () => {
    if (!departmentId) return toast({ title: "Select department", variant: "destructive" });
    if (wstForm.material_id === "none") return toast({ title: "Select material", variant: "destructive" });
    const qty = parseFloat(wstForm.wasted_qty);
    if (!qty || qty <= 0) return toast({ title: "Enter wasted qty", variant: "destructive" });
    const uc = parseFloat(wstForm.unit_cost) || 0;
    setSavingWst(true);
    const { error } = await (supabase as any).from("rw_wastages").insert({
      entry_date: entryDate,
      department_id: departmentId,
      material_id: wstForm.material_id,
      shift,
      wasted_qty: qty,
      unit: wstForm.unit,
      disposition_id: wstForm.disposition_id !== "none" ? wstForm.disposition_id : null,
      reason_id: wstForm.reason_id !== "none" ? wstForm.reason_id : null,
      remarks: wstForm.remarks || null,
      unit_cost: uc,
      total_cost: qty * uc,
      entered_by: user?.id || null,
    });
    setSavingWst(false);
    if (error) return toast({ title: "Save failed", description: error.message, variant: "destructive" });
    toast({ title: "Wastage logged" });
    setWstForm({ ...wstForm, wasted_qty: "", remarks: "" });
    refetchWst();
  };

  const addLeakage = async () => {
    if (!departmentId) return toast({ title: "Select department", variant: "destructive" });
    const qty = parseFloat(lkgForm.leaked_qty);
    if (!qty || qty <= 0) return toast({ title: "Enter leaked qty", variant: "destructive" });
    const uc = parseFloat(lkgForm.unit_cost) || 0;
    setSavingLkg(true);
    const { error } = await (supabase as any).from("rw_leakages").insert({
      entry_date: entryDate,
      department_id: departmentId,
      process_id: lkgForm.process_id !== "none" ? lkgForm.process_id : null,
      material_id: lkgForm.material_id !== "none" ? lkgForm.material_id : null,
      shift,
      leaked_qty: qty,
      unit: lkgForm.unit,
      disposition_id: lkgForm.disposition_id !== "none" ? lkgForm.disposition_id : null,
      reason_id: lkgForm.reason_id !== "none" ? lkgForm.reason_id : null,
      remarks: lkgForm.remarks || null,
      unit_cost: uc,
      total_cost: qty * uc,
      entered_by: user?.id || null,
    });
    setSavingLkg(false);
    if (error) return toast({ title: "Save failed", description: error.message, variant: "destructive" });
    toast({ title: "Leakage logged" });
    setLkgForm({ ...lkgForm, leaked_qty: "", remarks: "" });
    refetchLkg();
  };

  const deleteRej = async (id: string) => {
    if (!confirm("Delete this entry?")) return;
    await supabase.from("rw_rejections").delete().eq("id", id);
    refetchRej();
  };

  const deleteWst = async (id: string) => {
    if (!confirm("Delete this entry?")) return;
    await supabase.from("rw_wastages").delete().eq("id", id);
    refetchWst();
  };

  const deleteLkg = async (id: string) => {
    if (!confirm("Delete this entry?")) return;
    await (supabase as any).from("rw_leakages").delete().eq("id", id);
    refetchLkg();
  };

  // ============ Super admin edit dialog ============
  type EditKind = "rejection" | "wastage" | "leakage";
  const [editEntry, setEditEntry] = useState<{ kind: EditKind; row: any } | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [savingEdit, setSavingEdit] = useState(false);

  const openEdit = (kind: EditKind, row: any) => {
    setEditEntry({ kind, row });
    setEditForm({
      entry_date: row.entry_date,
      shift: row.shift || "Day",
      process_id: row.process_id || "none",
      material_id: row.material_id || "none",
      qty: String(row.rejected_qty ?? row.wasted_qty ?? row.leaked_qty ?? ""),
      unit: row.unit || "pcs",
      disposition_id: row.disposition_id || "none",
      reason_id: row.reason_id || "none",
      unit_cost: String(row.unit_cost ?? ""),
      remarks: row.remarks || "",
    });
  };

  const saveEdit = async () => {
    if (!editEntry) return;
    const qty = parseFloat(editForm.qty) || 0;
    const uc = parseFloat(editForm.unit_cost) || 0;
    const base: any = {
      entry_date: editForm.entry_date,
      shift: editForm.shift,
      material_id: editForm.material_id !== "none" ? editForm.material_id : null,
      unit: editForm.unit,
      disposition_id: editForm.disposition_id !== "none" ? editForm.disposition_id : null,
      reason_id: editForm.reason_id !== "none" ? editForm.reason_id : null,
      remarks: editForm.remarks || null,
      unit_cost: uc,
      total_cost: qty * uc,
    };
    setSavingEdit(true);
    let error: any = null;
    if (editEntry.kind === "rejection") {
      const dispoName = base.disposition_id ? (dispositionMap[base.disposition_id]?.name || "scrap") : "scrap";
      const payload = {
        ...base,
        process_id: editForm.process_id !== "none" ? editForm.process_id : null,
        rejected_qty: qty,
        disposition: dispoName.toLowerCase(),
      };
      ({ error } = await (supabase as any).from("rw_rejections").update(payload).eq("id", editEntry.row.id));
    } else if (editEntry.kind === "wastage") {
      const payload = { ...base, wasted_qty: qty };
      ({ error } = await (supabase as any).from("rw_wastages").update(payload).eq("id", editEntry.row.id));
    } else {
      const payload = {
        ...base,
        process_id: editForm.process_id !== "none" ? editForm.process_id : null,
        leaked_qty: qty,
      };
      ({ error } = await (supabase as any).from("rw_leakages").update(payload).eq("id", editEntry.row.id));
    }
    setSavingEdit(false);
    if (error) return toast({ title: "Update failed", description: error.message, variant: "destructive" });
    toast({ title: "Updated" });
    setEditEntry(null);
    if (editEntry.kind === "rejection") refetchRej();
    else if (editEntry.kind === "wastage") refetchWst();
    else refetchLkg();
  };


  const onPickMaterial = (id: string, formSetter: (f: any) => void) => {
    const m = materialMap[id];
    const uc = m?.unit_cost != null ? String(m.unit_cost) : "";
    formSetter((f: any) => ({ ...f, material_id: id, unit: m?.unit || f.unit, unit_cost: uc }));
  };

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-3 pb-20">
        <PageHeader
          title="Rejections & Wastages"
          description="Live entry — log rejections, wastages and leakages"
          icon={AlertOctagon}
          iconColor="bg-amber-500 text-white"
        />

        {/* Context bar */}
        <Card>
          <CardContent className="p-2 md:p-4 grid grid-cols-2 md:grid-cols-3 gap-2">
            <div>
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Date</Label>
              <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className="h-11 md:h-10" />
            </div>
            <div>
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Shift</Label>
              <div className="grid grid-cols-2 gap-1">
                {["Day", "Night"].map((s) => (
                  <Button
                    key={s}
                    type="button"
                    size="sm"
                    variant={shift === s ? "default" : "outline"}
                    onClick={() => setShift(s)}
                    className="h-11 md:h-10"
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>
            <div className="col-span-2 md:col-span-1">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Department</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger className="h-11 md:h-10"><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* View period filter */}
        <Card>
          <CardContent className="p-2 md:p-4 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Label className="text-xs font-semibold">View Entries For</Label>
              <span className="text-[11px] text-muted-foreground">
                {viewFrom === viewTo ? viewFrom : `${viewFrom} → ${viewTo}`}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {(["day","week","month","custom"] as const).map((m) => (
                <Button
                  key={m}
                  type="button"
                  size="sm"
                  variant={periodMode === m ? "default" : "outline"}
                  onClick={() => setPeriodMode(m)}
                  className="capitalize h-9 px-1 text-xs"
                >
                  {m === "day" ? "Day" : m === "week" ? "Week" : m === "month" ? "Month" : "Custom"}
                </Button>
              ))}
            </div>
            {periodMode === "month" && (
              <Input type="month" value={periodMonth} onChange={(e) => setPeriodMonth(e.target.value)} className="h-10" />
            )}
            {periodMode === "custom" && (
              <div className="grid grid-cols-2 gap-2">
                <Input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} className="h-10" />
                <Input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} className="h-10" />
              </div>
            )}
          </CardContent>
        </Card>


        {ballTabsHidden && (
          <div className="flex items-start gap-2 rounded-lg bg-primary/5 ring-1 ring-inset ring-primary/20 px-3 py-2 mb-3">
            <ClipboardCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <div className="text-xs">
              <div className="font-semibold">Ball rejections and leakages moved to the checker's screen</div>
              <div className="text-muted-foreground mt-0.5">
                From {rwCutover} they are counted on{' '}
                <Link to="/rejections/checker" className="underline font-medium">Daily Checker Entry</Link>,
                where they post to the bin and drive the production figure. Pick an earlier date to read
                the history here.
              </div>
            </div>
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList
            className={`grid ${ballTabsHidden ? "grid-cols-1" : "grid-cols-3"} w-full h-12 sticky top-16 z-20 shadow-sm`}
          >
            {!ballTabsHidden && (
              <TabsTrigger value="rejections" className="text-xs sm:text-sm h-10">Rejections</TabsTrigger>
            )}
            <TabsTrigger value="wastages" className="text-xs sm:text-sm h-10">Wastages</TabsTrigger>
            {!ballTabsHidden && (
              <TabsTrigger value="leakages" className="text-xs sm:text-sm h-10">Leakages</TabsTrigger>
            )}
          </TabsList>

          {/* REJECTIONS TAB */}
          <TabsContent value="rejections" className="space-y-3">
            <Card>
              <CardHeader className="p-3 md:p-4"><CardTitle className="text-base">New Rejection</CardTitle></CardHeader>
              <CardContent className="p-3 md:p-4 pt-0 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <Label className="text-xs">Process</Label>
                    <Select value={rejForm.process_id} onValueChange={(v) => setRejForm({ ...rejForm, process_id: v })}>
                      <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— None —</SelectItem>
                        {processes.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Material</Label>
                    <Select value={rejForm.material_id} onValueChange={(v) => onPickMaterial(v, setRejForm)}>
                      <SelectTrigger className="h-11"><SelectValue placeholder="Select material" /></SelectTrigger>
                      <SelectContent className="max-h-72">
                        <SelectItem value="none">— None —</SelectItem>
                        {selectableMaterials.map((m) => <SelectItem key={m.id} value={m.id}>{m.code ? `${m.code} — ` : ""}{m.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Qty</Label>
                    <Input type="number" inputMode="decimal" value={rejForm.rejected_qty} onChange={(e) => setRejForm({ ...rejForm, rejected_qty: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">Unit</Label>
                    <Input value={rejForm.unit} readOnly className="h-11 bg-muted" />
                  </div>
                  <div>
                    <Label className="text-xs">Disposition</Label>
                    <Select value={rejForm.disposition_id} onValueChange={(v) => setRejForm({ ...rejForm, disposition_id: v })}>
                      <SelectTrigger className="h-11"><SelectValue placeholder="Select disposition" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— None —</SelectItem>
                        {dispositions.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}{d.name_urdu ? ` (${d.name_urdu})` : ""}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Unit Cost (Rs.)</Label>
                    <Input type="number" inputMode="decimal" value={rejForm.unit_cost} readOnly className="bg-muted" />
                    <p className="text-[10px] text-muted-foreground mt-1">Set in Materials Master</p>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Reason</Label>
                    <Select value={rejForm.reason_id} onValueChange={(v) => setRejForm({ ...rejForm, reason_id: v })}>
                      <SelectTrigger className="h-11"><SelectValue placeholder="Reason" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— None —</SelectItem>
                        {rejectionReasons.map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Remarks</Label>
                    <Textarea rows={2} value={rejForm.remarks} onChange={(e) => setRejForm({ ...rejForm, remarks: e.target.value })} />
                  </div>
                </div>
                <Button onClick={addRejection} disabled={savingRej} className="w-full h-11">
                  {savingRej ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                  Add Entry
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-3 md:p-4 flex flex-row items-center justify-between">
                <CardTitle className="text-base">{periodMode === 'day' ? "Today's Rejections" : 'Rejections'}</CardTitle>
                <Badge variant="secondary">{todayRejections.length}</Badge>
              </CardHeader>
              <CardContent className="p-3 md:p-4 pt-0 space-y-2">
                {todayRejections.length === 0 && <p className="text-sm text-muted-foreground">No entries yet.</p>}
                {todayRejections.map((r: any) => (
                  <div key={r.id} className="border rounded-md p-3 bg-card">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap gap-2 items-center text-sm">
                          <Badge variant={r.disposition === "rework" ? "default" : "destructive"}>
                            {r.disposition}
                          </Badge>
                          <span className="font-medium">{r.rejected_qty} {r.unit}</span>
                          {r.unit_cost > 0 && <span className="text-xs text-muted-foreground">Rs. {Number(r.total_cost).toLocaleString()}</span>}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {materialMap[r.material_id]?.name || "—"} · {processMap[r.process_id]?.name || "—"}
                        </div>
                        <div className="text-xs">
                          <span className="text-muted-foreground">Reason: </span>{reasonMap[r.reason_id]?.name || "—"}
                        </div>
                        {r.remarks && <div className="text-xs italic text-muted-foreground">{r.remarks}</div>}
                      </div>
                      <div className="shrink-0 flex flex-col gap-1">
                        {isSuperAdmin && (
                          <Button variant="ghost" size="icon" onClick={() => openEdit("rejection", r)} className="h-8 w-8">
                            <Pencil className="h-4 w-4 text-blue-600" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" onClick={() => deleteRej(r.id)} className="h-8 w-8">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* WASTAGES TAB */}
          <TabsContent value="wastages" className="space-y-3">
            <Card>
              <CardHeader className="p-3 md:p-4"><CardTitle className="text-base">New Wastage</CardTitle></CardHeader>
              <CardContent className="p-3 md:p-4 pt-0 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <Label className="text-xs">Material</Label>
                    <Select value={wstForm.material_id} onValueChange={(v) => onPickMaterial(v, setWstForm)}>
                      <SelectTrigger className="h-11"><SelectValue placeholder="Select material" /></SelectTrigger>
                      <SelectContent className="max-h-72">
                        <SelectItem value="none">— Select —</SelectItem>
                        {selectableMaterials.map((m) => <SelectItem key={m.id} value={m.id}>{m.code ? `${m.code} — ` : ""}{m.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Wasted Qty</Label>
                    <Input type="number" inputMode="decimal" value={wstForm.wasted_qty} onChange={(e) => setWstForm({ ...wstForm, wasted_qty: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">Unit</Label>
                    <Input value={wstForm.unit} readOnly className="h-11 bg-muted" />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Unit Cost (Rs.)</Label>
                    <Input type="number" inputMode="decimal" value={wstForm.unit_cost} readOnly className="bg-muted" />
                    <p className="text-[10px] text-muted-foreground mt-1">Set in Materials Master</p>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Disposition</Label>
                    <Select value={wstForm.disposition_id} onValueChange={(v) => setWstForm({ ...wstForm, disposition_id: v })}>
                      <SelectTrigger className="h-11"><SelectValue placeholder="Select disposition" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— None —</SelectItem>
                        {dispositions.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}{d.name_urdu ? ` (${d.name_urdu})` : ""}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Reason</Label>
                    <Select value={wstForm.reason_id} onValueChange={(v) => setWstForm({ ...wstForm, reason_id: v })}>
                      <SelectTrigger className="h-11"><SelectValue placeholder="Reason" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— None —</SelectItem>
                        {wastageReasons.map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Remarks</Label>
                    <Textarea rows={2} value={wstForm.remarks} onChange={(e) => setWstForm({ ...wstForm, remarks: e.target.value })} />
                  </div>
                </div>
                <Button onClick={addWastage} disabled={savingWst} className="w-full h-11">
                  {savingWst ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                  Add Entry
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-3 md:p-4 flex flex-row items-center justify-between">
                <CardTitle className="text-base">{periodMode === 'day' ? "Today's Wastages" : 'Wastages'}</CardTitle>
                <Badge variant="secondary">{todayWastages.length}</Badge>
              </CardHeader>
              <CardContent className="p-3 md:p-4 pt-0 space-y-2">
                {todayWastages.length === 0 && <p className="text-sm text-muted-foreground">No entries yet.</p>}
                {todayWastages.map((w: any) => (
                  <div key={w.id} className="border rounded-md p-3 bg-card">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap gap-2 items-center text-sm">
                          <span className="font-medium">{materialMap[w.material_id]?.name || "—"}</span>
                          <Badge variant="outline">{w.wasted_qty} {w.unit}</Badge>
                          {w.unit_cost > 0 && <span className="text-xs text-muted-foreground">Rs. {Number(w.total_cost).toLocaleString()}</span>}
                        </div>
                        <div className="text-xs">
                          <span className="text-muted-foreground">Reason: </span>{reasonMap[w.reason_id]?.name || "—"}
                        </div>
                        {w.remarks && <div className="text-xs italic text-muted-foreground">{w.remarks}</div>}
                      </div>
                      <div className="shrink-0 flex flex-col gap-1">
                        {isSuperAdmin && (
                          <Button variant="ghost" size="icon" onClick={() => openEdit("wastage", w)} className="h-8 w-8">
                            <Pencil className="h-4 w-4 text-blue-600" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" onClick={() => deleteWst(w.id)} className="h-8 w-8">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* LEAKAGES TAB */}
          <TabsContent value="leakages" className="space-y-3">
            <Card>
              <CardHeader className="p-3 md:p-4"><CardTitle className="text-base">New Leakage</CardTitle></CardHeader>
              <CardContent className="p-3 md:p-4 pt-0 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <Label className="text-xs">Process</Label>
                    <Select value={lkgForm.process_id} onValueChange={(v) => setLkgForm({ ...lkgForm, process_id: v })}>
                      <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— None —</SelectItem>
                        {processes.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Material</Label>
                    <Select value={lkgForm.material_id} onValueChange={(v) => onPickMaterial(v, setLkgForm)}>
                      <SelectTrigger className="h-11"><SelectValue placeholder="Select material" /></SelectTrigger>
                      <SelectContent className="max-h-72">
                        <SelectItem value="none">— Select —</SelectItem>
                        {selectableMaterials.map((m) => <SelectItem key={m.id} value={m.id}>{m.code ? `${m.code} — ` : ""}{m.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Leaked Qty</Label>
                    <Input type="number" inputMode="decimal" value={lkgForm.leaked_qty} onChange={(e) => setLkgForm({ ...lkgForm, leaked_qty: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">Unit</Label>
                    <Input value={lkgForm.unit} readOnly className="h-11 bg-muted" />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Unit Cost (Rs.)</Label>
                    <Input type="number" inputMode="decimal" value={lkgForm.unit_cost} readOnly className="bg-muted" />
                    <p className="text-[10px] text-muted-foreground mt-1">Set in Materials Master</p>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Disposition</Label>
                    <Select value={lkgForm.disposition_id} onValueChange={(v) => setLkgForm({ ...lkgForm, disposition_id: v })}>
                      <SelectTrigger className="h-11"><SelectValue placeholder="Select disposition" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— None —</SelectItem>
                        {dispositions.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}{d.name_urdu ? ` (${d.name_urdu})` : ""}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Reason</Label>
                    <Select value={lkgForm.reason_id} onValueChange={(v) => setLkgForm({ ...lkgForm, reason_id: v })}>
                      <SelectTrigger className="h-11"><SelectValue placeholder="Reason" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— None —</SelectItem>
                        {leakageReasons.map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Remarks</Label>
                    <Textarea rows={2} value={lkgForm.remarks} onChange={(e) => setLkgForm({ ...lkgForm, remarks: e.target.value })} />
                  </div>
                </div>
                <Button onClick={addLeakage} disabled={savingLkg} className="w-full h-11">
                  {savingLkg ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Droplets className="h-4 w-4 mr-2" />}
                  Add Entry
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-3 md:p-4 flex flex-row items-center justify-between">
                <CardTitle className="text-base">{periodMode === 'day' ? "Today's Leakages" : 'Leakages'}</CardTitle>
                <Badge variant="secondary">{todayLeakages.length}</Badge>
              </CardHeader>
              <CardContent className="p-3 md:p-4 pt-0 space-y-2">
                {todayLeakages.length === 0 && <p className="text-sm text-muted-foreground">No entries yet.</p>}
                {todayLeakages.map((l: any) => (
                  <div key={l.id} className="border rounded-md p-3 bg-card">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap gap-2 items-center text-sm">
                          <span className="font-medium">{materialMap[l.material_id]?.name || "—"}</span>
                          <Badge variant="outline">{l.leaked_qty} {l.unit}</Badge>
                          {l.unit_cost > 0 && <span className="text-xs text-muted-foreground">Rs. {Number(l.total_cost).toLocaleString()}</span>}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {processMap[l.process_id]?.name || "—"}
                        </div>
                        <div className="text-xs">
                          <span className="text-muted-foreground">Reason: </span>{reasonMap[l.reason_id]?.name || "—"}
                        </div>
                        {l.remarks && <div className="text-xs italic text-muted-foreground">{l.remarks}</div>}
                      </div>
                      <div className="shrink-0 flex flex-col gap-1">
                        {isSuperAdmin && (
                          <Button variant="ghost" size="icon" onClick={() => openEdit("leakage", l)} className="h-8 w-8">
                            <Pencil className="h-4 w-4 text-blue-600" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" onClick={() => deleteLkg(l.id)} className="h-8 w-8">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Super admin edit dialog */}
      <Dialog open={!!editEntry} onOpenChange={(o) => !o && setEditEntry(null)}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="capitalize">Edit {editEntry?.kind}</DialogTitle>
          </DialogHeader>
          {editEntry && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Date</Label>
                <Input type="date" value={editForm.entry_date} onChange={(e) => setEditForm({ ...editForm, entry_date: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Shift</Label>
                <Select value={editForm.shift} onValueChange={(v) => setEditForm({ ...editForm, shift: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Day">Day</SelectItem>
                    <SelectItem value="Night">Night</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {editEntry.kind !== "wastage" && (
                <div className="col-span-2">
                  <Label className="text-xs">Process</Label>
                  <Select value={editForm.process_id} onValueChange={(v) => setEditForm({ ...editForm, process_id: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— None —</SelectItem>
                      {processes.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="col-span-2">
                <Label className="text-xs">Material</Label>
                <Select value={editForm.material_id} onValueChange={(v) => {
                  const m = materialMap[v];
                  setEditForm({
                    ...editForm,
                    material_id: v,
                    unit: m?.unit || editForm.unit,
                    unit_cost: m?.unit_cost != null ? String(m.unit_cost) : editForm.unit_cost,
                  });
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="none">— None —</SelectItem>
                    {selectableMaterials.map((m) => <SelectItem key={m.id} value={m.id}>{m.code ? `${m.code} — ` : ""}{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Qty</Label>
                <Input type="number" inputMode="decimal" value={editForm.qty} onChange={(e) => setEditForm({ ...editForm, qty: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Unit</Label>
                <Input value={editForm.unit} readOnly className="bg-muted" />
              </div>
              <div>
                <Label className="text-xs">Unit Cost (Rs.)</Label>
                <Input type="number" inputMode="decimal" value={editForm.unit_cost} readOnly className="bg-muted" />
              </div>
              <div>
                <Label className="text-xs">Disposition</Label>
                <Select value={editForm.disposition_id} onValueChange={(v) => setEditForm({ ...editForm, disposition_id: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {dispositions.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Reason</Label>
                <Select value={editForm.reason_id} onValueChange={(v) => setEditForm({ ...editForm, reason_id: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {(editEntry.kind === "rejection" ? rejectionReasons : editEntry.kind === "wastage" ? wastageReasons : leakageReasons).map((r: any) => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Remarks</Label>
                <Textarea rows={2} value={editForm.remarks} onChange={(e) => setEditForm({ ...editForm, remarks: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditEntry(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={savingEdit}>
              {savingEdit && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>

  );
}
