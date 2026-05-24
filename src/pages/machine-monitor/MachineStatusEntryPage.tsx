import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Activity, Clock, Share2 } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import {
  BASE_STATUSES,
  BaseStatus,
  splitReasonGroups,
  parseStatus,
  buildStatus,
  statusColorClass,
} from "./statusUtils";

const formatDuration = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m} min${m === 1 ? "" : "s"}`;
  return `${h}h ${m}m`;
};

interface Machine {
  id: string;
  name: string;
  code: string;
  department: string | null;
  location: string | null;
  custom_statuses: string[];
  current_status: string;
  current_status_since: string;
  current_remarks: string | null;
  is_active: boolean;
}

const getStatusColor = (status: string): string => statusColorClass(status);

export default function MachineStatusEntryPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [changingMachine, setChangingMachine] = useState<Machine | null>(null);
  const [newBase, setNewBase] = useState<BaseStatus | "">("");
  const [newReason, setNewReason] = useState("");
  const [remarks, setRemarks] = useState("");
  const [selectedDept, setSelectedDept] = useState<string>("all");

  const { data: machines = [] } = useQuery({
    queryKey: ["machine-monitor-machines-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("machine_monitor_machines")
        .select("*")
        .eq("is_active", true)
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return data as unknown as Machine[];
    },
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["production-departments-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as { id: string; name: string; code: string }[];
    },
  });

  const filteredMachines = selectedDept === "all"
    ? machines
    : machines.filter((m) => m.department === selectedDept);

  const updateMutation = useMutation({
    mutationFn: async ({ machineId, status, remarks, previousStatus, previousSince }: { machineId: string; status: string; remarks: string; previousStatus: string; previousSince: string }) => {
      const now = new Date().toISOString();
      const userId = user?.id || null;

      const { error: logError } = await supabase
        .from("machine_monitor_status_log")
        .insert({
          machine_id: machineId,
          status,
          remarks: remarks || null,
          changed_at: now,
          changed_by: userId,
        });
      if (logError) throw logError;

      const { error } = await supabase
        .from("machine_monitor_machines")
        .update({
          current_status: status,
          current_status_since: now,
          current_remarks: remarks || null,
          updated_at: now,
        })
        .eq("id", machineId);
      if (error) throw error;

      // Auto-track breakdown events (compare base status, not full label)
      const prevBase = parseStatus(previousStatus).base;
      const newBase = parseStatus(status).base;
      if (newBase === "Breakdown" && prevBase !== "Breakdown") {
        // Open new breakdown record
        await supabase.from("machine_monitor_breakdowns").insert({
          machine_id: machineId,
          breakdown_started_at: now,
          breakdown_started_by: userId,
          breakdown_remarks: remarks || parseStatus(status).reason || null,
          status: "open",
        });
      } else if (prevBase === "Breakdown" && newBase !== "Breakdown") {
        // Close the latest open breakdown for this machine
        const { data: openBd } = await supabase
          .from("machine_monitor_breakdowns")
          .select("id, breakdown_started_at")
          .eq("machine_id", machineId)
          .eq("status", "open")
          .order("breakdown_started_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (openBd) {
          const startedMs = new Date(openBd.breakdown_started_at).getTime();
          const downtimeMin = Math.max(0, Math.ceil((Date.now() - startedMs) / 60000));
          await supabase
            .from("machine_monitor_breakdowns")
            .update({
              breakdown_ended_at: now,
              breakdown_ended_by: userId,
              recovery_remarks: remarks || null,
              recovered_to_status: status,
              downtime_minutes: downtimeMin,
              status: "closed",
            })
            .eq("id", openBd.id);
        } else {
          // Fallback: synthesize a closed record using previous status timestamp
          const startedMs = new Date(previousSince).getTime();
          const downtimeMin = Math.max(0, Math.ceil((Date.now() - startedMs) / 60000));
          await supabase.from("machine_monitor_breakdowns").insert({
            machine_id: machineId,
            breakdown_started_at: previousSince,
            breakdown_ended_at: now,
            breakdown_ended_by: userId,
            recovery_remarks: remarks || null,
            recovered_to_status: status,
            downtime_minutes: downtimeMin,
            status: "closed",
          });
        }
      }

      // Auto-track Performance Issue events (mirrors breakdown logic)
      if (newBase === "Performance Issue" && prevBase !== "Performance Issue") {
        await supabase.from("machine_monitor_performance_issues" as any).insert({
          machine_id: machineId,
          started_at: now,
          started_by: userId,
          start_reason: parseStatus(status).reason,
          start_remarks: remarks || null,
          status: "open",
        });
      } else if (prevBase === "Performance Issue" && newBase !== "Performance Issue") {
        const { data: openPi } = await supabase
          .from("machine_monitor_performance_issues" as any)
          .select("id, started_at")
          .eq("machine_id", machineId)
          .eq("status", "open")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (openPi) {
          const startedMs = new Date((openPi as any).started_at).getTime();
          const durMin = Math.max(0, Math.ceil((Date.now() - startedMs) / 60000));
          await supabase
            .from("machine_monitor_performance_issues" as any)
            .update({
              ended_at: now,
              ended_by: userId,
              recovery_remarks: remarks || null,
              recovered_to_status: status,
              duration_minutes: durMin,
              status: "closed",
            })
            .eq("id", (openPi as any).id);
        } else {
          const startedMs = new Date(previousSince).getTime();
          const durMin = Math.max(0, Math.ceil((Date.now() - startedMs) / 60000));
          await supabase.from("machine_monitor_performance_issues" as any).insert({
            machine_id: machineId,
            started_at: previousSince,
            started_by: null,
            start_reason: parseStatus(previousStatus).reason,
            ended_at: now,
            ended_by: userId,
            recovery_remarks: remarks || null,
            recovered_to_status: status,
            duration_minutes: durMin,
            status: "closed",
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["machine-monitor-machines-active"] });
      toast.success("Machine status updated");
      setChangingMachine(null);
      setNewBase("");
      setNewReason("");
      setRemarks("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const openChange = (m: Machine) => {
    setChangingMachine(m);
    setNewBase("");
    setNewReason("");
    setRemarks("");
  };

  const handleSave = () => {
    if (!changingMachine || !newBase) {
      toast.error("Please select a status");
      return;
    }
    if ((newBase === "Breakdown" || newBase === "Performance Issue") && !newReason) {
      toast.error("Please select a reason");
      return;
    }
    const status = buildStatus(newBase, newBase === "Running" ? null : newReason);
    updateMutation.mutate({
      machineId: changingMachine.id,
      status,
      remarks,
      previousStatus: changingMachine.current_status,
      previousSince: changingMachine.current_status_since,
    });
  };

  const handleShareWhatsApp = async (m: Machine) => {
    try {
      const lines: string[] = [];
      lines.push("🏭 *Machine Status Update*");
      lines.push(`Machine: ${m.name} (${m.code})`);
      if (m.department) {
        lines.push(`Department: ${m.department}${m.location ? ` • ${m.location}` : ""}`);
      }
      lines.push(`Status: *${m.current_status}*`);
      const sinceDate = new Date(m.current_status_since);
      lines.push(
        `Since: ${formatDistanceToNow(sinceDate, { addSuffix: true })} (${format(sinceDate, "dd MMM yyyy, hh:mm a")})`
      );
      lines.push(`Remarks: ${m.current_remarks || "—"}`);

      const { data: bd } = await supabase
        .from("machine_monitor_breakdowns")
        .select("*")
        .eq("machine_id", m.id)
        .order("breakdown_started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (bd) {
        const userIds = [bd.breakdown_started_by, bd.breakdown_ended_by].filter(Boolean) as string[];
        const nameMap: Record<string, string> = {};
        if (userIds.length > 0) {
          const { data: profs } = await supabase
            .from("app_users")
            .select("id, full_name, user_id")
            .in("id", userIds);
          (profs || []).forEach((p: any) => {
            nameMap[p.id] = p.full_name || p.user_id || "Unknown";
          });
        }

        if (m.current_status === "Breakdown" && bd.status === "open") {
          const startedMs = new Date(bd.breakdown_started_at).getTime();
          const durMin = Math.max(0, Math.ceil((Date.now() - startedMs) / 60000));
          lines.push("");
          lines.push("⚠️ *Breakdown Details*");
          lines.push(`Started At: ${format(new Date(bd.breakdown_started_at), "dd MMM yyyy, hh:mm a")}`);
          lines.push(`Started By: ${nameMap[bd.breakdown_started_by || ""] || "—"}`);
          lines.push(`Duration So Far: ${formatDuration(durMin)}`);
          if (bd.breakdown_remarks) lines.push(`Breakdown Remarks: ${bd.breakdown_remarks}`);
        } else if (bd.status === "closed" && bd.breakdown_ended_at) {
          const endedMs = new Date(bd.breakdown_ended_at).getTime();
          if (Date.now() - endedMs < 24 * 60 * 60 * 1000) {
            lines.push("");
            lines.push("✅ *Recovered From Breakdown*");
            lines.push(`Downtime: ${formatDuration(bd.downtime_minutes || 0)}`);
            lines.push(
              `Started By: ${nameMap[bd.breakdown_started_by || ""] || "—"} • Ended By: ${nameMap[bd.breakdown_ended_by || ""] || "—"}`
            );
            if (bd.recovery_remarks) lines.push(`Recovery Remarks: ${bd.recovery_remarks}`);
          }
        }
      }

      const msg = lines.join("\n");
      window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
    } catch (e: any) {
      toast.error(e.message || "Failed to prepare WhatsApp message");
    }
  };

  return (
    <ERPLayout>
      <PageHeader
        title="Update Machine Status"
        description="Select a machine to update its current status"
        icon={Activity}
        iconColor="bg-cyan-600 text-white"
      />

      <div className="mb-4 flex items-center gap-3">
        <Label className="text-sm whitespace-nowrap">Department:</Label>
        <Select value={selectedDept} onValueChange={setSelectedDept}>
          <SelectTrigger className="w-full sm:w-64">
            <SelectValue placeholder="All Departments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredMachines.map((m) => {
          const colorClass = getStatusColor(m.current_status);
          return (
            <Card
              key={m.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => openChange(m)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm font-semibold flex-1 min-w-0 truncate">{m.name}</CardTitle>
                  <div className="flex items-center gap-1 shrink-0">
                    <Badge variant="outline" className="text-[10px]">{m.code}</Badge>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleShareWhatsApp(m);
                      }}
                      title="Share on WhatsApp"
                    >
                      <Share2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {m.department && (
                  <p className="text-xs text-muted-foreground">{m.department}{m.location ? ` • ${m.location}` : ""}</p>
                )}
              </CardHeader>
              <CardContent className="space-y-2">
                <Badge className={`${colorClass} border text-xs`}>
                  {m.current_status}
                </Badge>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {formatDistanceToNow(new Date(m.current_status_since), { addSuffix: true })}
                </div>
                {m.current_remarks && (
                  <p className="text-xs text-muted-foreground truncate">{m.current_remarks}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
        {filteredMachines.length === 0 && (
          <p className="col-span-full text-center text-muted-foreground py-12">
            {machines.length === 0
              ? "No active machines found. Add machines in Machine Master first."
              : "No machines found for the selected department."}
          </p>
        )}
      </div>

      {/* Status Update Dialog */}
      <Dialog open={!!changingMachine} onOpenChange={(o) => !o && setChangingMachine(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Status — {changingMachine?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Current Status</Label>
              <Badge className={`${getStatusColor(changingMachine?.current_status || "")} border mt-1`}>
                {changingMachine?.current_status}
              </Badge>
            </div>
            <div>
              <Label>New Status *</Label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                {BASE_STATUSES.map((b) => {
                  const active = newBase === b;
                  const tone =
                    b === "Running"
                      ? "border-green-300 text-green-700 data-[active=true]:bg-green-600 data-[active=true]:text-white data-[active=true]:border-green-600"
                      : b === "Breakdown"
                      ? "border-red-300 text-red-700 data-[active=true]:bg-red-600 data-[active=true]:text-white data-[active=true]:border-red-600"
                      : "border-yellow-300 text-yellow-700 data-[active=true]:bg-yellow-500 data-[active=true]:text-white data-[active=true]:border-yellow-500";
                  return (
                    <button
                      key={b}
                      type="button"
                      data-active={active}
                      onClick={() => {
                        setNewBase(b);
                        setNewReason("");
                      }}
                      className={`text-sm font-semibold rounded-md border px-2 py-2 transition-colors ${tone}`}
                    >
                      {b}
                    </button>
                  );
                })}
              </div>
            </div>
            {(newBase === "Breakdown" || newBase === "Performance Issue") && (() => {
              const groups = splitReasonGroups(changingMachine?.custom_statuses);
              const reasons = newBase === "Breakdown" ? groups.breakdown_reasons : groups.performance_issue_reasons;
              return (
                <div>
                  <Label>{newBase} Reason *</Label>
                  <Select value={newReason} onValueChange={setNewReason}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder={`Select ${newBase.toLowerCase()} reason`} />
                    </SelectTrigger>
                    <SelectContent>
                      {reasons.length === 0 ? (
                        <SelectItem value="__none" disabled>No reasons configured. Add them in Machine Master.</SelectItem>
                      ) : (
                        reasons.map((r) => (
                          <SelectItem key={r} value={r}>{r}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              );
            })()}
            <div>
              <Label>Remarks</Label>
              <Textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Optional remarks..."
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setChangingMachine(null)}>Cancel</Button>
            <Button
              variant="outline"
              className="border-green-600 text-green-700 hover:bg-green-50"
              onClick={() => changingMachine && handleShareWhatsApp(changingMachine)}
            >
              <Share2 className="h-4 w-4" />
              Share on WhatsApp
            </Button>
            <Button onClick={handleSave} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving..." : "Update Status"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}