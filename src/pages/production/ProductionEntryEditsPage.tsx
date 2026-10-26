import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { format, startOfMonth, endOfMonth, subDays } from "date-fns";
import * as XLSX from "xlsx";
import { Check, CheckCheck, FileDown, Pencil, Settings2 } from "lucide-react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  acknowledgeAllProductionEntryEdits,
  acknowledgeProductionEntryEdits,
  EDIT_FIELD_LABELS,
  peDb,
  useProductionEntriesLive,
  type ProductionEntryEdit,
} from "@/lib/productionEntryEdits";
import {
  displayEditValue,
  EditChangeList,
  useEditValueLookups,
} from "@/components/production/ProductionEntryEditHistorySheet";

const LOG_KEY = "production-entry-edits-log";

/**
 * Production entry edit log: every change made to a daily production entry
 * after it was first saved (who, when, why, old → new), with super admin
 * acknowledgement and the daily reminder settings.
 */
export default function ProductionEntryEditsPage() {
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();

  const today = new Date();
  const [fromDate, setFromDate] = useState(format(params.get("open") ? subDays(today, 90) : startOfMonth(today), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(endOfMonth(today), "yyyy-MM-dd"));
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [editorFilter, setEditorFilter] = useState("all");
  const [ackFilter, setAckFilter] = useState<"all" | "open" | "acked">(params.get("open") ? "open" : "all");
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const focusId = params.get("edit");

  useProductionEntriesLive([LOG_KEY]);

  const { data: departments } = useQuery({
    queryKey: ["production-departments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("production_departments").select("*").eq("is_active", true).order("sequence_order");
      if (error) throw error;
      return data;
    },
  });

  const { data: lookups } = useEditValueLookups(true);

  const { data: edits = [], isLoading } = useQuery({
    queryKey: [LOG_KEY, fromDate, toDate, focusId],
    queryFn: async () => {
      let q = peDb
        .from("production_entry_edits")
        .select("*, acknowledged_by_user:app_users!production_entry_edits_acknowledged_by_fkey(full_name)")
        .order("edited_at", { ascending: false })
        .limit(2000);
      // A deep link from a notification must show its edit whatever the date filter.
      if (!focusId) q = q.gte("edited_at", `${fromDate}T00:00:00`).lte("edited_at", `${toDate}T23:59:59.999`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ProductionEntryEdit[];
    },
  });

  const { data: settings } = useQuery({
    queryKey: ["production-entry-edit-settings"],
    queryFn: async () => {
      const { data, error } = await peDb.from("production_entry_edit_settings").select("*").eq("id", true).maybeSingle();
      if (error) throw error;
      return data as { summary_enabled: boolean; summary_time: string } | null;
    },
    enabled: isSuperAdmin,
  });

  const editors = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of edits) if (e.edited_by) m.set(e.edited_by, e.edited_by_name ?? e.edited_by);
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [edits]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return edits.filter((e) => {
      if (focusId && e.id === focusId) return true;
      if (departmentFilter !== "all" && e.department_id !== departmentFilter) return false;
      if (editorFilter !== "all" && e.edited_by !== editorFilter) return false;
      if (ackFilter === "open" && e.acknowledged_at) return false;
      if (ackFilter === "acked" && !e.acknowledged_at) return false;
      if (needle) {
        const hay = [e.department_name, e.grade_code, e.grade_name, e.edited_by_name, e.reason, e.summary].join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [edits, departmentFilter, editorFilter, ackFilter, search, focusId]);

  const openCount = edits.filter((e) => !e.acknowledged_at).length;

  // Scroll the deep-linked edit into view once it is on screen.
  useEffect(() => {
    if (!focusId || isLoading) return;
    const el = document.getElementById(`edit-${focusId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusId, isLoading, filtered.length]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [LOG_KEY] });
    queryClient.invalidateQueries({ queryKey: ["production-entry-edits-open"] });
    queryClient.invalidateQueries({ queryKey: ["production-entry-edits"] });
  };

  const ackMutation = useMutation({
    mutationFn: (ids: string[]) => acknowledgeProductionEntryEdits(ids),
    onSuccess: refresh,
    onError: (e: Error) => toast({ title: "Could not acknowledge", description: e.message, variant: "destructive" }),
  });
  const ackAllMutation = useMutation({
    mutationFn: acknowledgeAllProductionEntryEdits,
    onSuccess: (n) => {
      refresh();
      toast({ title: "Acknowledged", description: `${n} edit${n === 1 ? "" : "s"} acknowledged.` });
    },
    onError: (e: Error) => toast({ title: "Could not acknowledge", description: e.message, variant: "destructive" }),
  });
  const settingsMutation = useMutation({
    mutationFn: async (v: { enabled: boolean; time: string }) => {
      const { error } = await peDb.rpc("production_entry_edit_settings_save", { p_enabled: v.enabled, p_time: v.time });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["production-entry-edit-settings"] });
      toast({ title: "Settings saved" });
      setSettingsOpen(false);
    },
    onError: (e: Error) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const [sEnabled, setSEnabled] = useState(true);
  const [sTime, setSTime] = useState("09:00");
  useEffect(() => {
    if (settings) {
      setSEnabled(settings.summary_enabled);
      setSTime((settings.summary_time ?? "09:00").slice(0, 5));
    }
  }, [settings]);

  const handleExport = () => {
    if (filtered.length === 0) return;
    const rows = filtered.map((e) => {
      const changes = Object.keys(EDIT_FIELD_LABELS)
        .filter((f) => e.changes && Object.prototype.hasOwnProperty.call(e.changes, f))
        .map((f) => `${EDIT_FIELD_LABELS[f]}: ${displayEditValue(f, e.changes[f].old, lookups)} → ${displayEditValue(f, e.changes[f].new, lookups)}`)
        .join("; ");
      return {
        "Edited At": format(new Date(e.edited_at), "yyyy-MM-dd HH:mm"),
        "Edit #": e.edit_no,
        "Entry Date": e.entry_date,
        Shift: e.shift ?? "",
        Department: e.department_name ?? "",
        "Sub-Dept": e.sub_department_name ?? "",
        Grade: e.grade_code ?? "",
        "Edited By": e.edited_by_name ?? "",
        Changes: changes || e.summary,
        Reason: e.reason,
        Acknowledged: e.acknowledged_at ? format(new Date(e.acknowledged_at), "yyyy-MM-dd HH:mm") : "",
        "Acknowledged By": e.acknowledged_by_user?.full_name ?? "",
        "Entry Deleted": e.entry_id ? "" : "Yes",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Entry Edits");
    XLSX.writeFile(wb, `Production_Entry_Edits_${fromDate}_to_${toDate}.xlsx`);
  };

  return (
    <ERPLayout>
      <PageHeader
        title="Production Entry Edit Log"
        description="Every change made to a daily production entry after it was saved: who, when, why, and what changed"
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard title="Edits in range" value={edits.length} icon={Pencil} />
        <MetricCard title="Awaiting acknowledgement" value={openCount} icon={CheckCheck} />
        <MetricCard title="Shown" value={filtered.length} icon={Pencil} />
        <MetricCard title="Editors" value={editors.length} icon={Pencil} />
      </div>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <Label>From</Label>
              <Input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); if (focusId) setParams({}); }} />
            </div>
            <div>
              <Label>To</Label>
              <Input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); if (focusId) setParams({}); }} />
            </div>
            <div className="min-w-[160px]">
              <Label>Department</Label>
              <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {departments?.map((d) => (<SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[160px]">
              <Label>Edited by</Label>
              <Select value={editorFilter} onValueChange={setEditorFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone</SelectItem>
                  {editors.map(([id, name]) => (<SelectItem key={id} value={id}>{name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[160px]">
              <Label>Acknowledgement</Label>
              <Select value={ackFilter} onValueChange={(v) => setAckFilter(v as typeof ackFilter)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="open">Awaiting acknowledgement</SelectItem>
                  <SelectItem value="acked">Acknowledged</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[180px] flex-1">
              <Label>Search</Label>
              <Input placeholder="Grade, reason, editor…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Button variant="outline" onClick={handleExport} disabled={filtered.length === 0}>
              <FileDown className="mr-2 h-4 w-4" /> Export
            </Button>
            {isSuperAdmin && (
              <>
                <Button onClick={() => ackAllMutation.mutate()} disabled={openCount === 0 || ackAllMutation.isPending}>
                  <CheckCheck className="mr-2 h-4 w-4" /> Acknowledge all ({openCount})
                </Button>
                <Button variant="ghost" size="icon" title="Daily reminder settings" onClick={() => setSettingsOpen(true)}>
                  <Settings2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && filtered.length === 0 && (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No edits match these filters.</CardContent></Card>
      )}

      <div className="space-y-3">
        {filtered.map((e) => {
          const isFocus = e.id === focusId;
          return (
            <Card
              key={e.id}
              id={`edit-${e.id}`}
              className={cn(
                "border-l-4",
                e.acknowledged_at ? "border-l-emerald-400" : "border-l-red-500",
                isFocus && "ring-2 ring-primary",
              )}
            >
              <CardContent className="pt-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">
                        {e.department_name ?? "Production"}
                        {e.sub_department_name ? ` / ${e.sub_department_name}` : ""} · {format(new Date(e.entry_date), "dd MMM yyyy")} · {e.shift ?? ""} · Grade {e.grade_code ?? "?"}
                      </span>
                      <Badge variant="warning">Edit #{e.edit_no}</Badge>
                      {!e.entry_id && <Badge variant="destructive">Entry since deleted</Badge>}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      By <span className="font-medium text-foreground">{e.edited_by_name ?? "Unknown user"}</span> on {format(new Date(e.edited_at), "dd MMM yyyy HH:mm")}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {e.acknowledged_at ? (
                      <Badge variant="success">
                        Acknowledged · {e.acknowledged_by_user?.full_name ?? "super admin"} · {format(new Date(e.acknowledged_at), "dd MMM HH:mm")}
                      </Badge>
                    ) : isSuperAdmin ? (
                      <Button size="sm" variant="outline" onClick={() => ackMutation.mutate([e.id])} disabled={ackMutation.isPending}>
                        <Check className="mr-1 h-4 w-4" /> Acknowledge
                      </Button>
                    ) : (
                      <Badge variant="warning">Awaiting super admin</Badge>
                    )}
                  </div>
                </div>
                <div className="mt-3">
                  <EditChangeList edit={e} lookups={lookups} />
                </div>
                <p className="mt-2 text-sm">
                  <span className="text-muted-foreground">Reason: </span>{e.reason}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Daily reminder</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Once a day, at this Pakistan time, every super admin is reminded of edits that are still unacknowledged.
          </p>
          <div className="flex items-center justify-between py-2">
            <Label>Reminder on</Label>
            <Switch checked={sEnabled} onCheckedChange={setSEnabled} />
          </div>
          <div>
            <Label>Time</Label>
            <Input type="time" value={sTime} onChange={(e) => setSTime(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>Cancel</Button>
            <Button onClick={() => settingsMutation.mutate({ enabled: sEnabled, time: sTime })} disabled={settingsMutation.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
