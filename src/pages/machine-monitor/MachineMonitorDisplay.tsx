import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Monitor, RefreshCw, Settings, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

const REFRESH_INTERVAL = 10000;

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
  sort_order: number;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string; pulse?: boolean }> = {
  Running: { bg: "bg-green-500/20", text: "text-green-400", border: "border-green-500" },
  Stopped: { bg: "bg-slate-500/20", text: "text-slate-400", border: "border-slate-500" },
  Idle: { bg: "bg-yellow-500/20", text: "text-yellow-400", border: "border-yellow-500" },
  Breakdown: { bg: "bg-red-500/20", text: "text-red-400", border: "border-red-500", pulse: true },
  Maintenance: { bg: "bg-blue-500/20", text: "text-blue-400", border: "border-blue-500" },
  Setup: { bg: "bg-purple-500/20", text: "text-purple-400", border: "border-purple-500" },
};

const getStatusStyle = (status: string) => {
  return STATUS_COLORS[status] || { bg: "bg-muted/50", text: "text-muted-foreground", border: "border-muted" };
};

export default function MachineMonitorDisplay() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [selectedDepartment, setSelectedDepartment] = useState<string>("all");
  const [changingMachine, setChangingMachine] = useState<Machine | null>(null);
  const [newStatus, setNewStatus] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [showSettings, setShowSettings] = useState(false);

  // Load saved department filter
  useEffect(() => {
    const saved = localStorage.getItem("machine-monitor-dept");
    if (saved) setSelectedDepartment(saved);
  }, []);

  const fetchMachines = async () => {
    const { data, error } = await supabase
      .from("machine_monitor_machines")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (!error && data) {
      setMachines(data as unknown as Machine[]);
      setLastRefresh(new Date());
    }
  };

  useEffect(() => {
    fetchMachines();
    const interval = setInterval(fetchMachines, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  const departments = [...new Set(machines.map((m) => m.department).filter(Boolean))] as string[];

  const filteredMachines = selectedDepartment === "all"
    ? machines
    : machines.filter((m) => m.department === selectedDepartment);

  const handleStatusChange = async () => {
    if (!changingMachine || !newStatus) return;
    setSaving(true);

    const { error: updateError } = await supabase
      .from("machine_monitor_machines")
      .update({
        current_status: newStatus,
        current_status_since: new Date().toISOString(),
        current_remarks: remarks || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", changingMachine.id);

    if (!updateError) {
      await supabase.from("machine_monitor_status_log").insert({
        machine_id: changingMachine.id,
        status: newStatus,
        remarks: remarks || null,
      });
      toast.success(`${changingMachine.name} → ${newStatus}`);
      setChangingMachine(null);
      setNewStatus("");
      setRemarks("");
      fetchMachines();
    } else {
      toast.error("Failed to update status");
    }
    setSaving(false);
  };

  const openChangeDialog = (machine: Machine) => {
    setChangingMachine(machine);
    setNewStatus(machine.current_status);
    setRemarks("");
  };

  const saveDepartment = (dept: string) => {
    setSelectedDepartment(dept);
    localStorage.setItem("machine-monitor-dept", dept);
  };

  // Stats
  const running = filteredMachines.filter((m) => m.current_status === "Running").length;
  const stopped = filteredMachines.filter((m) => m.current_status === "Stopped").length;
  const breakdown = filteredMachines.filter((m) => m.current_status === "Breakdown").length;
  const idle = filteredMachines.filter((m) => m.current_status === "Idle").length;

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Monitor className="h-8 w-8 text-cyan-400" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Machine Status Monitor</h1>
            <p className="text-xs text-slate-400">
              Auto-refresh: 10s | Last: {lastRefresh.toLocaleTimeString()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowSettings(!showSettings)}
            className="border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700">
            <Settings className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={fetchMachines}
            className="border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="mb-4 p-4 rounded-lg border border-slate-700 bg-slate-900 flex items-center gap-4">
          <span className="text-sm text-slate-400">Department Filter:</span>
          <Select value={selectedDepartment} onValueChange={saveDepartment}>
            <SelectTrigger className="w-48 bg-slate-800 border-slate-700 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={() => setShowSettings(false)} className="ml-auto text-slate-400">
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Summary Bar */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <div className="rounded-lg bg-slate-800/50 border border-slate-700 p-3 text-center">
          <div className="text-3xl font-bold">{filteredMachines.length}</div>
          <div className="text-xs text-slate-400 uppercase tracking-wider">Total</div>
        </div>
        <div className="rounded-lg bg-green-500/10 border border-green-500/30 p-3 text-center">
          <div className="text-3xl font-bold text-green-400">{running}</div>
          <div className="text-xs text-green-400/70 uppercase tracking-wider">Running</div>
        </div>
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-center">
          <div className="text-3xl font-bold text-red-400">{breakdown}</div>
          <div className="text-xs text-red-400/70 uppercase tracking-wider">Breakdown</div>
        </div>
        <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/30 p-3 text-center">
          <div className="text-3xl font-bold text-yellow-400">{idle + stopped}</div>
          <div className="text-xs text-yellow-400/70 uppercase tracking-wider">Idle/Stopped</div>
        </div>
      </div>

      {/* Machine Grid */}
      {filteredMachines.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <Monitor className="h-16 w-16 mx-auto mb-4 opacity-30" />
          <p className="text-lg">No machines configured</p>
          <p className="text-sm">Add machines from the Machine Master page</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {filteredMachines.map((machine) => {
            const style = getStatusStyle(machine.current_status);
            const timeSince = formatDistanceToNow(new Date(machine.current_status_since), { addSuffix: false });
            return (
              <button
                key={machine.id}
                onClick={() => openChangeDialog(machine)}
                className={cn(
                  "rounded-xl border-2 p-4 text-left transition-all hover:scale-[1.02] active:scale-[0.98]",
                  style.bg, style.border,
                  style.pulse && "animate-pulse"
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono text-slate-400">{machine.code}</span>
                  {machine.department && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">{machine.department}</span>
                  )}
                </div>
                <div className="text-sm font-semibold mb-3 leading-tight">{machine.name}</div>
                <div className={cn("text-2xl font-bold uppercase tracking-wider mb-1", style.text)}>
                  {machine.current_status}
                </div>
                <div className="text-[10px] text-slate-500">{timeSince}</div>
                {machine.current_remarks && (
                  <div className="mt-2 text-[10px] text-slate-400 truncate">{machine.current_remarks}</div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Status Change Dialog */}
      <Dialog open={!!changingMachine} onOpenChange={(open) => !open && setChangingMachine(null)}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle>Change Status — {changingMachine?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-slate-400 mb-1 block">New Status</label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger className="bg-slate-800 border-slate-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {changingMachine?.custom_statuses.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-slate-400 mb-1 block">Remarks (optional)</label>
              <Textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white"
                placeholder="Reason for status change..."
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setChangingMachine(null)}
                className="border-slate-700 text-slate-300">
                Cancel
              </Button>
              <Button onClick={handleStatusChange} disabled={saving || !newStatus}>
                {saving ? "Saving..." : "Update Status"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
