import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fingerprint, Link2, Wand2, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeviceStatusBadge } from "@/components/hr/DeviceStatusBadge";
import { EmployeePicker, type PickerEmployee } from "@/components/hr/EmployeePicker";
import {
  bioDb, dayStartIso, fmtDateTime, fmtHours, fmtTime, nextDayStartIso, todayKarachi, verifyLabel,
  type DailyRow, type DeviceUser, type PunchLog,
} from "@/lib/biometricAttendance";

const PAGE_SIZE = 50;

function useEmployees() {
  return useQuery({
    queryKey: ["bio-employees"],
    queryFn: async (): Promise<PickerEmployee[]> => {
      const { data, error } = await bioDb
        .from("employees").select("id, employee_code, full_name").eq("is_active", true).order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useDeviceUsers() {
  return useQuery({
    queryKey: ["device-users"],
    queryFn: async (): Promise<DeviceUser[]> => {
      const { data, error } = await bioDb
        .from("device_users")
        .select("*, employee:employees(id, employee_code, full_name)")
        .order("user_id");
      if (error) throw error;
      return data ?? [];
    },
  });
}

const who = (name: string | null | undefined, userId: string) => name || `Device user ${userId}`;

function Filters({
  from, to, employeeId, setFrom, setTo, setEmployeeId, employees,
}: {
  from: string; to: string; employeeId: string | null; employees: PickerEmployee[];
  setFrom: (v: string) => void; setTo: (v: string) => void; setEmployeeId: (v: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} className="w-40" /></div>
      <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} className="w-40" /></div>
      <div className="min-w-[240px]">
        <Label className="text-xs">Employee</Label>
        <EmployeePicker employees={employees} value={employeeId} onChange={setEmployeeId} placeholder="All employees" className="w-full" />
      </div>
    </div>
  );
}

function PunchLogsTab({ from, to, employeeId }: { from: string; to: string; employeeId: string | null }) {
  const [page, setPage] = useState(0);
  const { data: users = [] } = useDeviceUsers();
  const byUser = useMemo(() => new Map(users.map((u) => [u.user_id, u])), [users]);
  const userIds = useMemo(
    () => (employeeId ? users.filter((u) => u.employee_id === employeeId).map((u) => u.user_id) : null),
    [employeeId, users],
  );

  const { data, isLoading } = useQuery({
    queryKey: ["punch-logs", from, to, userIds, page],
    enabled: userIds === null || userIds.length > 0,
    queryFn: async () => {
      let q = bioDb
        .from("attendance_logs")
        .select("id, user_id, punched_at, verify_mode, state, device_serial", { count: "exact" })
        .gte("punched_at", dayStartIso(from))
        .lt("punched_at", nextDayStartIso(to))
        .order("punched_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (userIds) q = q.in("user_id", userIds);
      const { data, count, error } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as PunchLog[], count: count ?? 0 };
    },
  });
  const rows = userIds && userIds.length === 0 ? [] : data?.rows ?? [];
  const total = userIds && userIds.length === 0 ? 0 : data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      {userIds && userIds.length === 0 && (
        <p className="text-sm text-muted-foreground">This employee is not linked to any device user yet (see the Device Users tab).</p>
      )}
      <DataTable<PunchLog>
        data={rows}
        emptyMessage={isLoading ? "Loading..." : "No punches in this range"}
        columns={[
          { key: "punched_at", header: "Time (PKT)", render: (r) => fmtDateTime(r.punched_at) },
          {
            key: "user_id", header: "Employee",
            render: (r) => {
              const u = byUser.get(r.user_id);
              return (
                <div>
                  <div>{u?.employee?.full_name ?? who(u?.name, r.user_id)}</div>
                  <div className="text-xs text-muted-foreground">
                    Device ID {r.user_id}{u?.employee ? ` · ${u.employee.employee_code}` : " · not linked"}
                  </div>
                </div>
              );
            },
          },
          { key: "verify_mode", header: "Verified by", render: (r) => verifyLabel(r.verify_mode) },
          { key: "state", header: "Button", render: (r) => r.state },
        ]}
      />
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{total.toLocaleString()} punches · page {page + 1} of {pages}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
    </div>
  );
}

function DailyTab({ from, to, employeeId }: { from: string; to: string; employeeId: string | null }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["device-daily", from, to, employeeId],
    queryFn: async (): Promise<(DailyRow & { id: string })[]> => {
      const { data, error } = await bioDb.rpc("device_attendance_daily", {
        p_from: from, p_to: to, p_employee_id: employeeId,
      });
      if (error) throw error;
      return ((data ?? []) as DailyRow[]).map((r) => ({ ...r, id: `${r.day}_${r.user_id}` }));
    },
  });
  return (
    <DataTable
      data={data}
      emptyMessage={isLoading ? "Loading..." : "No punches in this range"}
      columns={[
        { key: "day", header: "Date" },
        {
          key: "employee_name", header: "Employee",
          render: (r) => (
            <div>
              <div>{r.employee_name ?? who(r.device_name, r.user_id)}</div>
              <div className="text-xs text-muted-foreground">
                Device ID {r.user_id}{r.employee_code ? ` · ${r.employee_code}` : " · not linked"}
              </div>
            </div>
          ),
        },
        { key: "first_in", header: "First in", render: (r) => fmtTime(r.first_in) },
        { key: "last_out", header: "Last out", render: (r) => (r.punches > 1 ? fmtTime(r.last_out) : "—") },
        { key: "hours_worked", header: "Hours", render: (r) => fmtHours(r.hours_worked) },
        { key: "punches", header: "Punches" },
      ]}
    />
  );
}

function DeviceUsersTab({ employees }: { employees: PickerEmployee[] }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [onlyUnmatched, setOnlyUnmatched] = useState(true);
  const { data: users = [], isLoading } = useDeviceUsers();

  const setEmployee = useMutation({
    mutationFn: async ({ id, employeeId }: { id: string; employeeId: string | null }) => {
      const { error } = await bioDb.rpc("device_user_set_employee", { p_device_user_id: id, p_employee_id: employeeId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["device-users"] }),
    onError: (e: any) => toast.error(e?.message ?? "Could not save the link"),
  });
  const autoMatch = useMutation({
    mutationFn: async () => {
      const { data, error } = await bioDb.rpc("device_users_auto_match");
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => { toast.success(`${n} device user(s) linked`); qc.invalidateQueries({ queryKey: ["device-users"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Auto-match failed"),
  });

  const unmatched = users.filter((u) => !u.employee_id).length;
  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return users
      .filter((u) => !onlyUnmatched || !u.employee_id)
      .filter((u) => !s || u.user_id.toLowerCase().includes(s) || u.name.toLowerCase().includes(s))
      .slice(0, 200);
  }, [users, search, onlyUnmatched]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input placeholder="Search device ID or name" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
        <Button variant={onlyUnmatched ? "default" : "outline"} size="sm" onClick={() => setOnlyUnmatched(!onlyUnmatched)}>
          {onlyUnmatched ? "Showing unmatched only" : "Showing all"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => autoMatch.mutate()} disabled={autoMatch.isPending}>
          <Wand2 className="mr-1 h-4 w-4" /> Auto-match by employee code
        </Button>
        <Badge variant={unmatched ? "destructive" : "secondary"}>{unmatched} unmatched of {users.length}</Badge>
      </div>
      <DataTable<DeviceUser>
        data={shown}
        emptyMessage={isLoading ? "Loading..." : "No device users"}
        columns={[
          { key: "user_id", header: "Device ID" },
          { key: "name", header: "Name on device", render: (u) => u.name || <span className="text-muted-foreground">(blank)</span> },
          {
            key: "employee_id", header: "ERP employee",
            render: (u) => (
              <div className="flex items-center gap-2">
                <EmployeePicker
                  className="w-[260px]"
                  employees={employees}
                  value={u.employee_id}
                  placeholder="Not linked"
                  onChange={(employeeId) => setEmployee.mutate({ id: u.id, employeeId })}
                />
                {u.employee_id && <Link2 className="h-4 w-4 text-emerald-600" />}
              </div>
            ),
          },
        ]}
      />
      {users.filter((u) => (!onlyUnmatched || !u.employee_id)).length > 200 && (
        <p className="text-xs text-muted-foreground">Showing the first 200. Use the search box to narrow the list.</p>
      )}
    </div>
  );
}

export default function BiometricAttendancePage() {
  const [from, setFrom] = useState(todayKarachi(-6));
  const [to, setTo] = useState(todayKarachi());
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const { data: employees = [] } = useEmployees();
  const filters = { from, to, employeeId, setFrom, setTo, setEmployeeId, employees };

  return (
    <ERPLayout>
      <PageHeader
        title="Biometric Attendance"
        description="Punches from the attendance device, pushed by the office bridge. Times are Pakistan time."
        icon={Fingerprint}
      />
      <DeviceStatusBadge className="mb-4" />
      <Tabs defaultValue="logs" className="space-y-4">
        <TabsList>
          <TabsTrigger value="logs">Punch Logs</TabsTrigger>
          <TabsTrigger value="daily">Daily Summary</TabsTrigger>
          <TabsTrigger value="users">Device Users</TabsTrigger>
        </TabsList>
        <TabsContent value="logs" className="space-y-4">
          <Filters {...filters} />
          <PunchLogsTab key={`${from}${to}${employeeId}`} from={from} to={to} employeeId={employeeId} />
        </TabsContent>
        <TabsContent value="daily" className="space-y-4">
          <Filters {...filters} />
          <DailyTab from={from} to={to} employeeId={employeeId} />
        </TabsContent>
        <TabsContent value="users">
          <DeviceUsersTab employees={employees} />
        </TabsContent>
      </Tabs>
    </ERPLayout>
  );
}
