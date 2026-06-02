import { useState, useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TrendingDown, Save, Plus, Trash2, FileText } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

const HOUR_SLOTS = Array.from({ length: 16 }, (_, i) => {
  const h = i + 6;
  const start = h % 12 === 0 ? 12 : h % 12;
  const end = (h + 1) % 12 === 0 ? 12 : (h + 1) % 12;
  const startAmPm = h < 12 ? "AM" : "PM";
  const endAmPm = (h + 1) < 12 || (h + 1) === 24 ? "AM" : "PM";
  return { value: h, label: `${start}:00 ${startAmPm} – ${end}:00 ${endAmPm}` };
});

interface LossRow {
  process_name: string;
  reason_id: string;
  lost_minutes: string;
  lost_quantity: string;
  remarks: string;
}

const emptyRow = (): LossRow => ({
  process_name: "",
  reason_id: "",
  lost_minutes: "",
  lost_quantity: "",
  remarks: "",
});

export default function HourlyProductionLossEntryPage() {
  const [params] = useSearchParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [selectedDate, setSelectedDate] = useState(
    params.get("date") || format(new Date(), "yyyy-MM-dd"),
  );
  const [selectedHour, setSelectedHour] = useState<number>(
    Number(params.get("hour")) || new Date().getHours(),
  );
  const [selectedDepartment, setSelectedDepartment] = useState<string>(
    params.get("department") || "all",
  );
  const [rows, setRows] = useState<LossRow[]>([emptyRow()]);

  const { data: departments = [] } = useQuery({
    queryKey: ["production-departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: processes = [] } = useQuery({
    queryKey: ["qa-processes-hourly-loss", selectedDepartment],
    queryFn: async () => {
      let query = (supabase as any)
        .from("qa_processes")
        .select("id, name, code, department_id")
        .eq("is_active", true)
        .eq("is_hourly_tracked", true);
      if (selectedDepartment !== "all") {
        query = query.eq("department_id", selectedDepartment);
      }
      const { data, error } = await query.order("name");
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const { data: reasons = [] } = useQuery({
    queryKey: ["hourly-loss-reasons-active"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("hourly_loss_reasons")
        .select("id, code, name, category")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const { data: reasonProcessLinks = [] } = useQuery({
    queryKey: ["hourly-loss-reason-processes-active"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("hourly_loss_reason_processes")
        .select("reason_id, process_name");
      if (error) throw error;
      return (data || []) as { reason_id: string; process_name: string }[];
    },
  });

  // Map reason_id -> set of allowed process names. Empty/missing => "all processes"
  const reasonProcessMap = (() => {
    const map: Record<string, Set<string>> = {};
    reasonProcessLinks.forEach((l) => {
      if (!map[l.reason_id]) map[l.reason_id] = new Set();
      map[l.reason_id].add(l.process_name);
    });
    return map;
  })();

  const reasonsForProcess = (processName: string) => {
    if (!processName) return reasons;
    return reasons.filter((r: any) => {
      const allowed = reasonProcessMap[r.id];
      if (!allowed || allowed.size === 0) return true; // applies to all
      return allowed.has(processName);
    });
  };

  // Load existing losses for the selected slot
  const { data: existing = [] } = useQuery({
    queryKey: ["hourly-losses", selectedDate, selectedHour, selectedDepartment],
    queryFn: async () => {
      let q = (supabase as any)
        .from("hourly_production_losses")
        .select("*")
        .eq("entry_date", selectedDate)
        .eq("hour_slot", selectedHour);
      if (selectedDepartment !== "all") q = q.eq("department_id", selectedDepartment);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  useEffect(() => {
    if (existing.length > 0) {
      setRows(
        existing.map((e) => ({
          process_name: e.process_name || "",
          reason_id: e.loss_reason_id || e.reason_id || "",
          lost_minutes: String(e.lost_minutes ?? ""),
          lost_quantity: String(e.lost_quantity ?? ""),
          remarks: e.remarks || "",
        })),
      );
    } else {
      setRows([emptyRow()]);
    }
  }, [existing.length, selectedDate, selectedHour, selectedDepartment]);

  const updateRow = (idx: number, field: keyof LossRow, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  const addRow = () => setRows((prev) => [...prev, emptyRow()]);
  const removeRow = (idx: number) =>
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));

  const saveMutation = useMutation({
    mutationFn: async () => {
      const valid = rows.filter(
        (r) =>
          r.process_name &&
          r.reason_id &&
          ((r.lost_minutes && Number(r.lost_minutes) > 0) ||
            (r.lost_quantity && Number(r.lost_quantity) > 0)),
      );
      if (valid.length === 0) throw new Error("Add at least one valid loss row");

      // Replace existing for the same slot+department scope
      let del = (supabase as any)
        .from("hourly_production_losses")
        .delete()
        .eq("entry_date", selectedDate)
        .eq("hour_slot", selectedHour);
      if (selectedDepartment !== "all") del = del.eq("department_id", selectedDepartment);
      await del;

      const inserts = valid.map((r) => ({
        entry_date: selectedDate,
        hour_slot: selectedHour,
        department_id: selectedDepartment === "all" ? null : selectedDepartment,
        process_name: r.process_name,
        loss_reason_id: r.reason_id,
        reason_id: null,
        lost_minutes: Number(r.lost_minutes || 0),
        lost_quantity: Number(r.lost_quantity || 0),
        remarks: r.remarks || null,
        created_by: user?.id || null,
      }));

      const { error } = await (supabase as any)
        .from("hourly_production_losses")
        .insert(inserts);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Hourly losses saved");
      queryClient.invalidateQueries({ queryKey: ["hourly-losses"] });
      queryClient.invalidateQueries({ queryKey: ["hourly-losses-logs"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <ERPLayout>
      <div className="space-y-6 pb-24 md:pb-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <PageHeader
            title="Hourly Loss Entry"
            description="Log production hour losses with reason"
            icon={TrendingDown}
            iconColor="bg-amber-600 text-white"
          />
          <Button variant="outline" asChild className="w-full md:w-auto h-12 md:h-10">
            <Link to="/hourly-production/loss-logs">
              <FileText className="h-4 w-4 mr-2" /> View Loss Logs
            </Link>
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Select Date, Hour & Department</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-base">Date</Label>
                <Input
                  type="date"
                  className="h-12 text-base"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-base">Hour Slot</Label>
                <Select
                  value={String(selectedHour)}
                  onValueChange={(v) => setSelectedHour(Number(v))}
                >
                  <SelectTrigger className="h-12 text-base">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOUR_SLOTS.map((s) => (
                      <SelectItem key={s.value} value={String(s.value)}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-base">Department</Label>
                <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                  <SelectTrigger className="h-12 text-base">
                    <SelectValue placeholder="All Departments" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Departments</SelectItem>
                    {departments.map((d: any) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Loss Entries</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {rows.map((row, idx) => (
              <Card key={idx} className="border-2 border-amber-200/60 bg-amber-50/30">
                <CardHeader className="flex flex-row items-center justify-between py-3 px-4">
                  <CardTitle className="text-base font-semibold text-amber-900">
                    Loss #{idx + 1}
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10"
                    onClick={() => removeRow(idx)}
                    disabled={rows.length === 1}
                  >
                    <Trash2 className="h-5 w-5 text-destructive" />
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4 px-4 pb-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-base">Process</Label>
                      <Select
                        value={row.process_name || undefined}
                        onValueChange={(v) => {
                          // Clear reason if it's not allowed for the new process
                          const allowed = reasonsForProcess(v).map((r: any) => r.id);
                          setRows((prev) =>
                            prev.map((r, i) =>
                              i === idx
                                ? {
                                    ...r,
                                    process_name: v,
                                    reason_id: allowed.includes(r.reason_id) ? r.reason_id : "",
                                  }
                                : r,
                            ),
                          );
                        }}
                      >
                        <SelectTrigger className="h-12 text-base">
                          <SelectValue placeholder="Select process" />
                        </SelectTrigger>
                        <SelectContent>
                          {processes.map((p: any) => (
                            <SelectItem key={p.id} value={p.name}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-base">Reason</Label>
                      <Select
                        value={row.reason_id || undefined}
                        onValueChange={(v) => updateRow(idx, "reason_id", v)}
                        disabled={!row.process_name}
                      >
                        <SelectTrigger className="h-12 text-base">
                          <SelectValue
                            placeholder={row.process_name ? "Select reason" : "Pick process first"}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {reasonsForProcess(row.process_name).length === 0 ? (
                            <div className="px-2 py-2 text-xs text-muted-foreground">
                              No reasons mapped to this process
                            </div>
                          ) : (
                            reasonsForProcess(row.process_name).map((r: any) => (
                              <SelectItem key={r.id} value={r.id}>
                                {r.name}
                                {r.category ? ` (${r.category})` : ""}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-base">Lost Minutes</Label>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={60}
                        className="h-14 text-2xl font-semibold text-center"
                        value={row.lost_minutes}
                        onChange={(e) => updateRow(idx, "lost_minutes", e.target.value)}
                        placeholder="0"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-base">Lost Quantity</Label>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        className="h-14 text-2xl font-semibold text-center"
                        value={row.lost_quantity}
                        onChange={(e) => updateRow(idx, "lost_quantity", e.target.value)}
                        placeholder="0"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-base">Remarks</Label>
                    <Input
                      className="h-12 text-base"
                      value={row.remarks}
                      onChange={(e) => updateRow(idx, "remarks", e.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                </CardContent>
              </Card>
            ))}

            <Button
              variant="outline"
              onClick={addRow}
              className="w-full md:w-auto h-12 text-base border-dashed border-2"
            >
              <Plus className="h-5 w-5 mr-2" /> Add Another Loss
            </Button>

            {/* Desktop save */}
            <div className="hidden md:flex justify-end pt-2">
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="h-12 px-8 text-base"
              >
                <Save className="h-5 w-5 mr-2" />
                {saveMutation.isPending ? "Saving..." : "Save Losses"}
              </Button>
            </div>

            {reasons.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No loss reasons found. Add them in Master Data → Hourly Loss Reasons.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Mobile sticky save bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-background border-t border-border p-3 shadow-lg">
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="w-full h-14 text-base font-semibold"
        >
          <Save className="h-5 w-5 mr-2" />
          {saveMutation.isPending ? "Saving..." : "Save Losses"}
        </Button>
      </div>
    </ERPLayout>
  );
}
