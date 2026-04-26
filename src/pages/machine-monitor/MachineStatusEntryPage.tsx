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
import { Activity, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

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

const STATUS_COLORS: Record<string, string> = {
  Running: "bg-green-100 text-green-700 border-green-300",
  Stopped: "bg-slate-100 text-slate-600 border-slate-300",
  Idle: "bg-yellow-100 text-yellow-700 border-yellow-300",
  Breakdown: "bg-red-100 text-red-700 border-red-300",
  Maintenance: "bg-blue-100 text-blue-700 border-blue-300",
  Setup: "bg-purple-100 text-purple-700 border-purple-300",
};

export default function MachineStatusEntryPage() {
  const queryClient = useQueryClient();
  const [changingMachine, setChangingMachine] = useState<Machine | null>(null);
  const [newStatus, setNewStatus] = useState("");
  const [remarks, setRemarks] = useState("");

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

  const updateMutation = useMutation({
    mutationFn: async ({ machineId, status, remarks }: { machineId: string; status: string; remarks: string }) => {
      const now = new Date().toISOString();
      const { error: logError } = await supabase
        .from("machine_monitor_status_log")
        .insert({
          machine_id: machineId,
          status,
          remarks: remarks || null,
          changed_at: now,
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["machine-monitor-machines-active"] });
      toast.success("Machine status updated");
      setChangingMachine(null);
      setNewStatus("");
      setRemarks("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const openChange = (m: Machine) => {
    setChangingMachine(m);
    setNewStatus("");
    setRemarks("");
  };

  const handleSave = () => {
    if (!newStatus || !changingMachine) {
      toast.error("Please select a status");
      return;
    }
    updateMutation.mutate({ machineId: changingMachine.id, status: newStatus, remarks });
  };

  return (
    <ERPLayout>
      <PageHeader
        title="Update Machine Status"
        description="Select a machine to update its current status"
        icon={Activity}
        iconColor="bg-cyan-600 text-white"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {machines.map((m) => {
          const colorClass = STATUS_COLORS[m.current_status] || "bg-muted text-muted-foreground border-border";
          return (
            <Card
              key={m.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => openChange(m)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">{m.name}</CardTitle>
                  <Badge variant="outline" className="text-[10px]">{m.code}</Badge>
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
        {machines.length === 0 && (
          <p className="col-span-full text-center text-muted-foreground py-12">No active machines found. Add machines in Machine Master first.</p>
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
              <Badge className={`${STATUS_COLORS[changingMachine?.current_status || ""] || "bg-muted"} border mt-1`}>
                {changingMachine?.current_status}
              </Badge>
            </div>
            <div>
              <Label>New Status *</Label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {changingMachine?.custom_statuses
                    .filter((s) => s !== changingMachine.current_status)
                    .map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangingMachine(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving..." : "Update Status"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}