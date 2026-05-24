import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Clock, Activity, Wrench } from "lucide-react";
import { format, formatDistanceStrict } from "date-fns";

interface BreakdownRow {
  id: string;
  machine_id: string;
  breakdown_started_at: string;
  breakdown_started_by: string | null;
  breakdown_remarks: string | null;
  breakdown_ended_at: string | null;
  breakdown_ended_by: string | null;
  recovery_remarks: string | null;
  recovered_to_status: string | null;
  downtime_minutes: number | null;
  status: string;
}

interface MachineRow {
  id: string;
  name: string;
  code: string;
  department: string | null;
}

interface UserRow {
  id: string;
  full_name: string | null;
  user_id: string;
}

const formatDowntime = (minutes: number | null): string => {
  if (minutes == null) return "-";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

export default function MachineMonitorBreakdownLogsPage() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [machineFilter, setMachineFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const { data: breakdowns = [], isLoading } = useQuery({
    queryKey: ["machine-monitor-breakdowns"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("machine_monitor_breakdowns")
        .select("*")
        .order("breakdown_started_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return data as BreakdownRow[];
    },
    refetchInterval: 30000,
  });

  const { data: machines = [] } = useQuery({
    queryKey: ["machine-monitor-machines-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("machine_monitor_machines")
        .select("id, name, code, department");
      if (error) throw error;
      return data as MachineRow[];
    },
  });

  const { data: users = [] } = useQuery({
    queryKey: ["app-users-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_users")
        .select("id, full_name, user_id");
      if (error) throw error;
      return data as UserRow[];
    },
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["production-departments-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
  });

  const machineMap = useMemo(() => {
    const m = new Map<string, MachineRow>();
    machines.forEach((x) => m.set(x.id, x));
    return m;
  }, [machines]);

  const userMap = useMemo(() => {
    const m = new Map<string, UserRow>();
    users.forEach((u) => m.set(u.id, u));
    return m;
  }, [users]);

  const userName = (id: string | null) => {
    if (!id) return "-";
    const u = userMap.get(id);
    if (!u) return "Unknown";
    return u.full_name || u.user_id;
  };

  const filtered = useMemo(() => {
    return breakdowns.filter((b) => {
      if (statusFilter !== "all" && b.status !== statusFilter) return false;
      if (machineFilter !== "all" && b.machine_id !== machineFilter) return false;
      if (deptFilter !== "all") {
        const m = machineMap.get(b.machine_id);
        if (!m || m.department !== deptFilter) return false;
      }
      if (fromDate && new Date(b.breakdown_started_at) < new Date(fromDate)) return false;
      if (toDate && new Date(b.breakdown_started_at) > new Date(toDate + "T23:59:59")) return false;
      return true;
    });
  }, [breakdowns, statusFilter, machineFilter, deptFilter, fromDate, toDate, machineMap]);

  const filteredMachines = useMemo(() => {
    if (deptFilter === "all") return machines;
    return machines.filter((m) => m.department === deptFilter);
  }, [machines, deptFilter]);

  const stats = useMemo(() => {
    const open = filtered.filter((b) => b.status === "open").length;
    const closed = filtered.filter((b) => b.status === "closed");
    const totalMin = closed.reduce((s, b) => s + (b.downtime_minutes || 0), 0);
    const avg = closed.length > 0 ? Math.round(totalMin / closed.length) : 0;
    return { open, totalMin, avg, closedCount: closed.length };
  }, [filtered]);

  return (
    <ERPLayout>
      <PageHeader
        title="Machine Breakdown Logs"
        description="Auto-tracked breakdown events with downtime and responsible users"
        icon={AlertTriangle}
        iconColor="bg-red-600 text-white"
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Activity className="h-3 w-3" /> Open Breakdowns</div>
            <div className="text-2xl font-bold text-red-600">{stats.open}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Wrench className="h-3 w-3" /> Closed Events</div>
            <div className="text-2xl font-bold">{stats.closedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock className="h-3 w-3" /> Total Downtime</div>
            <div className="text-2xl font-bold text-amber-600">{formatDowntime(stats.totalMin)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock className="h-3 w-3" /> Avg Downtime</div>
            <div className="text-2xl font-bold">{formatDowntime(stats.avg)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="open">Open (Ongoing)</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Department</Label>
            <Select value={deptFilter} onValueChange={(v) => { setDeptFilter(v); setMachineFilter("all"); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map((d) => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Machine</Label>
            <Select value={machineFilter} onValueChange={setMachineFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Machines</SelectItem>
                {filteredMachines.map((m) => <SelectItem key={m.id} value={m.id}>{m.name} ({m.code})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2">Machine</th>
                <th className="px-3 py-2">Department</th>
                <th className="px-3 py-2">Breakdown Start</th>
                <th className="px-3 py-2">Set To Breakdown By</th>
                <th className="px-3 py-2">Breakdown End</th>
                <th className="px-3 py-2">Set To Running By</th>
                <th className="px-3 py-2">Downtime</th>
                <th className="px-3 py-2">Recovered To</th>
                <th className="px-3 py-2">Remarks</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={10} className="text-center py-8 text-muted-foreground">Loading...</td></tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={10} className="text-center py-8 text-muted-foreground">No breakdown events found.</td></tr>
              )}
              {filtered.map((b) => {
                const m = machineMap.get(b.machine_id);
                const ongoing = b.status === "open";
                const liveDowntime = ongoing
                  ? formatDistanceStrict(new Date(b.breakdown_started_at), new Date())
                  : formatDowntime(b.downtime_minutes);
                return (
                  <tr key={b.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <div className="font-medium">{m?.name || "-"}</div>
                      <div className="text-[11px] text-muted-foreground">{m?.code}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">{m?.department || "-"}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {format(new Date(b.breakdown_started_at), "dd-MMM-yy HH:mm")}
                    </td>
                    <td className="px-3 py-2 text-xs">{userName(b.breakdown_started_by)}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {b.breakdown_ended_at ? format(new Date(b.breakdown_ended_at), "dd-MMM-yy HH:mm") : (
                        <Badge className="bg-red-100 text-red-700 border-red-300 border">Ongoing</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">{userName(b.breakdown_ended_by)}</td>
                    <td className="px-3 py-2 font-medium text-amber-700">{liveDowntime}</td>
                    <td className="px-3 py-2 text-xs">
                      {b.recovered_to_status ? (
                        <Badge variant="outline" className="text-[10px]">{b.recovered_to_status}</Badge>
                      ) : "-"}
                    </td>
                    <td className="px-3 py-2 text-xs max-w-[220px]">
                      {b.breakdown_remarks && <div><span className="text-muted-foreground">Start:</span> {b.breakdown_remarks}</div>}
                      {b.recovery_remarks && <div><span className="text-muted-foreground">End:</span> {b.recovery_remarks}</div>}
                      {!b.breakdown_remarks && !b.recovery_remarks && "-"}
                    </td>
                    <td className="px-3 py-2">
                      <Badge className={ongoing ? "bg-red-100 text-red-700 border-red-300 border" : "bg-green-100 text-green-700 border-green-300 border"}>
                        {ongoing ? "Open" : "Closed"}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </ERPLayout>
  );
}
