import { useState, useEffect } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Plus, Search, Pencil, AlertTriangle } from "lucide-react";
import { format, differenceInMinutes } from "date-fns";

interface BreakdownLog {
  id: string;
  breakdown_number: string;
  machine_id: string;
  downtime_reason_id: string | null;
  breakdown_start: string;
  breakdown_end: string | null;
  downtime_minutes: number | null;
  description: string;
  immediate_action: string | null;
  priority: string;
  status: string;
  technician_name: string | null;
  machines?: { name: string; code: string } | null;
  downtime_reasons?: { name: string } | null;
}

interface Machine {
  id: string;
  name: string;
  code: string;
}

interface DowntimeReason {
  id: string;
  name: string;
  code: string;
}

export default function BreakdownLogsPage() {
  const { user } = useAuth();
  const [breakdowns, setBreakdowns] = useState<BreakdownLog[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [downtimeReasons, setDowntimeReasons] = useState<DowntimeReason[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingLog, setEditingLog] = useState<BreakdownLog | null>(null);

  const [formData, setFormData] = useState({
    machine_id: "",
    downtime_reason_id: "",
    breakdown_start: "",
    breakdown_end: "",
    description: "",
    immediate_action: "",
    technician_name: "",
    priority: "high",
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [logsRes, machinesRes, reasonsRes] = await Promise.all([
        supabase.from("breakdown_logs").select("*, machines(name, code), downtime_reasons(name)").order("created_at", { ascending: false }),
        supabase.from("machines").select("id, name, code").eq("is_active", true).order("name"),
        supabase.from("downtime_reasons").select("id, name, code").eq("is_active", true).order("name"),
      ]);

      if (logsRes.data) setBreakdowns(logsRes.data);
      if (machinesRes.data) setMachines(machinesRes.data);
      if (reasonsRes.data) setDowntimeReasons(reasonsRes.data);
    } catch (error) {
      console.error("Error fetching data:", error);
      toast.error("Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!formData.machine_id || !formData.breakdown_start || !formData.description) {
      toast.error("Please fill in required fields");
      return;
    }

    try {
      let downtimeMinutes: number | null = null;
      if (formData.breakdown_end) {
        downtimeMinutes = differenceInMinutes(
          new Date(formData.breakdown_end),
          new Date(formData.breakdown_start)
        );
      }

      if (editingLog) {
        const { error } = await supabase
          .from("breakdown_logs")
          .update({
            machine_id: formData.machine_id,
            downtime_reason_id: formData.downtime_reason_id || null,
            breakdown_start: formData.breakdown_start,
            breakdown_end: formData.breakdown_end || null,
            downtime_minutes: downtimeMinutes,
            description: formData.description,
            immediate_action: formData.immediate_action || null,
            technician_name: formData.technician_name || null,
            priority: formData.priority as "low" | "medium" | "high" | "critical",
            status: formData.breakdown_end ? "closed" : "in_progress",
            updated_at: new Date().toISOString(),
          })
          .eq("id", editingLog.id);

        if (error) throw error;
        toast.success("Breakdown log updated");
      } else {
        const { data: numData } = await supabase.rpc("generate_breakdown_number");

        const { error } = await supabase.from("breakdown_logs").insert({
          breakdown_number: numData || `BD-${Date.now()}`,
          machine_id: formData.machine_id,
          downtime_reason_id: formData.downtime_reason_id || null,
          breakdown_start: formData.breakdown_start,
          breakdown_end: formData.breakdown_end || null,
          downtime_minutes: downtimeMinutes,
          description: formData.description,
          immediate_action: formData.immediate_action || null,
          technician_name: formData.technician_name || null,
          priority: formData.priority as "low" | "medium" | "high" | "critical",
          reported_by: user?.id,
        });

        if (error) throw error;
        toast.success("Breakdown log created");
      }

      setIsDialogOpen(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      console.error("Error saving breakdown log:", error);
      toast.error(error.message || "Failed to save breakdown log");
    }
  };

  const resetForm = () => {
    setFormData({
      machine_id: "",
      downtime_reason_id: "",
      breakdown_start: "",
      breakdown_end: "",
      description: "",
      immediate_action: "",
      technician_name: "",
      priority: "high",
    });
    setEditingLog(null);
  };

  const openEditDialog = (log: BreakdownLog) => {
    setEditingLog(log);
    setFormData({
      machine_id: log.machine_id,
      downtime_reason_id: log.downtime_reason_id || "",
      breakdown_start: log.breakdown_start.slice(0, 16),
      breakdown_end: log.breakdown_end?.slice(0, 16) || "",
      description: log.description,
      immediate_action: log.immediate_action || "",
      technician_name: log.technician_name || "",
      priority: log.priority,
    });
    setIsDialogOpen(true);
  };

  const filteredLogs = breakdowns.filter(
    (b) =>
      b.breakdown_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      b.machines?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      b.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getPriorityColor = (priority: string) => {
    const colors: Record<string, string> = {
      low: "bg-slate-500",
      medium: "bg-blue-500",
      high: "bg-amber-500",
      critical: "bg-red-500",
    };
    return colors[priority] || "bg-slate-500";
  };

  const formatDowntime = (minutes: number | null) => {
    if (!minutes) return "-";
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const columns = [
    { key: "breakdown_number", header: "BD Number" },
    { key: "machine_id", header: "Machine", render: (row: BreakdownLog) => row.machines?.name || "-" },
    { key: "downtime_reason_id", header: "Reason", render: (row: BreakdownLog) => row.downtime_reasons?.name || "-" },
    { key: "technician_name", header: "Technician", render: (row: BreakdownLog) => row.technician_name || "-" },
    { key: "breakdown_start", header: "Start", render: (row: BreakdownLog) => format(new Date(row.breakdown_start), "dd-MMM HH:mm") },
    { key: "downtime_minutes", header: "Downtime", render: (row: BreakdownLog) => formatDowntime(row.downtime_minutes) },
    { key: "priority", header: "Priority", render: (row: BreakdownLog) => (
        <span className={`px-2 py-1 rounded text-xs text-white ${getPriorityColor(row.priority)}`}>
          {row.priority.toUpperCase()}
        </span>
      ),
    },
    { key: "status", header: "Status", render: (row: BreakdownLog) => <StatusBadge status={row.status} /> },
    { key: "id", header: "Actions", render: (row: BreakdownLog) => (
        <Button variant="ghost" size="sm" onClick={() => openEditDialog(row)}>
          <Pencil className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <ERPLayout>
      <PageHeader
        title="Breakdown Logs"
        description="Track and manage equipment breakdowns"
        action={{
          label: "Log Breakdown",
          onClick: () => { resetForm(); setIsDialogOpen(true); },
        }}
      />

      <div className="flex items-center gap-4 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search breakdowns..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : (
        <DataTable columns={columns} data={filteredLogs} />
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              {editingLog ? "Edit Breakdown Log" : "Log Breakdown"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Machine *</Label>
                <Select value={formData.machine_id} onValueChange={(v) => setFormData({ ...formData, machine_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select machine" />
                  </SelectTrigger>
                  <SelectContent>
                    {machines.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name} ({m.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Reason</Label>
                <Select value={formData.downtime_reason_id} onValueChange={(v) => setFormData({ ...formData, downtime_reason_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select reason" />
                  </SelectTrigger>
                  <SelectContent>
                    {downtimeReasons.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Breakdown Start *</Label>
                <Input
                  type="datetime-local"
                  value={formData.breakdown_start}
                  onChange={(e) => setFormData({ ...formData, breakdown_start: e.target.value })}
                />
              </div>

              <div>
                <Label>Breakdown End</Label>
                <Input
                  type="datetime-local"
                  value={formData.breakdown_end}
                  onChange={(e) => setFormData({ ...formData, breakdown_end: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Priority</Label>
                <Select value={formData.priority} onValueChange={(v) => setFormData({ ...formData, priority: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Technician</Label>
                <Input
                  value={formData.technician_name}
                  onChange={(e) => setFormData({ ...formData, technician_name: e.target.value })}
                  placeholder="Enter technician name"
                />
              </div>
            </div>

            <div>
              <Label>Description *</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe the breakdown"
              />
            </div>

            <div>
              <Label>Immediate Action Taken</Label>
              <Textarea
                value={formData.immediate_action}
                onChange={(e) => setFormData({ ...formData, immediate_action: e.target.value })}
                placeholder="What was done immediately?"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>{editingLog ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
