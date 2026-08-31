import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfDay, subDays } from "date-fns";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FileText,
  Eye,
  ChevronLeft,
  ChevronRight,
  Users,
  Activity,
  ShieldAlert,
  History,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;

const PAGE_SIZE = 50;

const MODULES = [
  { value: "auth", label: "Logins (auth)" },
  { value: "accounting", label: "Accounting" },
  { value: "sales", label: "Sales" },
  { value: "purchase", label: "Purchase" },
  { value: "labour", label: "Labour Productivity" },
  { value: "production", label: "Production" },
];

const ACTIONS = ["login", "login_failed", "logout", "create", "update", "delete"];

interface LogRow {
  id: string;
  user_id: string | null;
  action: string;
  module: string;
  record_id: string | null;
  record_type: string | null;
  old_values: any;
  new_values: any;
  ip_address: string | null;
  created_at: string | null;
  app_users: { full_name: string; user_id: string } | null;
}

const actionBadge = (action: string) => {
  switch (action) {
    case "create":
    case "login":
      return <Badge variant="default" className="bg-green-600 text-xs">{action}</Badge>;
    case "update":
      return <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200 text-xs">{action}</Badge>;
    case "delete":
    case "login_failed":
      return <Badge variant="destructive" className="text-xs">{action}</Badge>;
    case "logout":
      return <Badge variant="secondary" className="text-xs">{action}</Badge>;
    default:
      return <Badge variant="secondary" className="text-xs">{action}</Badge>;
  }
};

// Field-by-field diff for update events
const computeDiff = (before: any, after: any): { field: string; before: any; after: any }[] => {
  if (!before || !after) return [];
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: { field: string; before: any; after: any }[] = [];
  for (const f of fields) {
    if (JSON.stringify(before[f]) !== JSON.stringify(after[f])) {
      changes.push({ field: f, before: before[f], after: after[f] });
    }
  }
  return changes;
};

export default function AuditLogPage() {
  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 7), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [moduleFilter, setModuleFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(0);
  const [viewEntry, setViewEntry] = useState<LogRow | null>(null);

  const resetPage = () => setPage(0);

  const { data: users } = useQuery({
    queryKey: ["audit-users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_users")
        .select("id, full_name, user_id")
        .order("full_name");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: logPage, isLoading } = useQuery({
    queryKey: ["audit-log", fromDate, toDate, moduleFilter, actionFilter, userFilter, searchTerm, page],
    queryFn: async () => {
      let q = sb
        .from("audit_log")
        .select(
          "id, user_id, action, module, record_id, record_type, old_values, new_values, ip_address, created_at, app_users!audit_log_user_id_fkey (full_name, user_id)",
          { count: "exact" }
        )
        .gte("created_at", fromDate + "T00:00:00")
        .lte("created_at", toDate + "T23:59:59")
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (moduleFilter !== "all") q = q.eq("module", moduleFilter);
      if (actionFilter !== "all") q = q.eq("action", actionFilter);
      if (userFilter !== "all") q = q.eq("user_id", userFilter);
      if (searchTerm.trim()) q = q.ilike("record_type", `%${searchTerm.trim()}%`);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data || []) as LogRow[], count: count ?? 0 };
    },
  });

  // Summary cards (independent of the filters so they always show the big picture)
  const { data: stats } = useQuery({
    queryKey: ["audit-stats"],
    queryFn: async () => {
      const todayStart = startOfDay(new Date()).toISOString();
      const weekStart = subDays(new Date(), 7).toISOString();

      const [{ count: eventsToday }, { data: usersToday }, { count: failedLogins }] =
        await Promise.all([
          sb.from("audit_log").select("id", { count: "exact", head: true }).gte("created_at", todayStart),
          sb.from("audit_log").select("user_id").gte("created_at", todayStart).not("user_id", "is", null),
          sb
            .from("audit_log")
            .select("id", { count: "exact", head: true })
            .eq("action", "login_failed")
            .gte("created_at", weekStart),
        ]);

      return {
        eventsToday: eventsToday ?? 0,
        activeUsersToday: new Set((usersToday || []).map((r: any) => r.user_id)).size,
        failedLogins7d: failedLogins ?? 0,
      };
    },
  });

  const totalPages = Math.max(1, Math.ceil((logPage?.count ?? 0) / PAGE_SIZE));

  const describeRow = (e: LogRow): string => {
    if (e.module === "auth") {
      if (e.action === "login_failed") {
        return `Failed login attempt${e.new_values?.attempted_user_id ? ` as "${e.new_values.attempted_user_id}"` : ""}`;
      }
      return e.action === "login" ? "Signed in" : "Signed out";
    }
    return e.record_type ? e.record_type.replace(/_/g, " ") : "—";
  };

  return (
    <ERPLayout>
      <PageHeader
        title="Audit Trail"
        description="Who did what, when — logins and every change in the audited modules"
        icon={FileText}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><Activity className="h-3 w-3" />Events today</div>
            <div className="text-2xl font-semibold">{stats?.eventsToday ?? "—"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" />Active users today</div>
            <div className="text-2xl font-semibold">{stats?.activeUsersToday ?? "—"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><ShieldAlert className="h-3 w-3" />Failed logins (7d)</div>
            <div className={`text-2xl font-semibold ${(stats?.failedLogins7d ?? 0) > 0 ? "text-red-600" : ""}`}>{stats?.failedLogins7d ?? "—"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><History className="h-3 w-3" />Matching events</div>
            <div className="text-2xl font-semibold">{logPage?.count ?? "—"}</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <Input
          type="date"
          value={fromDate}
          onChange={(e) => { setFromDate(e.target.value); resetPage(); }}
          className="w-[150px]"
        />
        <Input
          type="date"
          value={toDate}
          onChange={(e) => { setToDate(e.target.value); resetPage(); }}
          className="w-[150px]"
        />
        <Select value={moduleFilter} onValueChange={(v) => { setModuleFilter(v); resetPage(); }}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Module" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All modules</SelectItem>
            {MODULES.map((m) => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); resetPage(); }}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Action" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {ACTIONS.map((a) => (
              <SelectItem key={a} value={a}>{a}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={userFilter} onValueChange={(v) => { setUserFilter(v); resetPage(); }}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="User" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All users</SelectItem>
            {(users || []).map((u: any) => (
              <SelectItem key={u.id} value={u.id}>{u.full_name} ({u.user_id})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Filter by table…"
          value={searchTerm}
          onChange={(e) => { setSearchTerm(e.target.value); resetPage(); }}
          className="w-[180px]"
        />
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">Timestamp</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Module</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>What</TableHead>
              <TableHead className="w-28">IP</TableHead>
              <TableHead className="w-14" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!logPage?.rows.length && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  {isLoading ? "Loading…" : "No activity in this range"}
                </TableCell>
              </TableRow>
            )}
            {logPage?.rows.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="text-xs font-mono">
                  {e.created_at ? format(new Date(e.created_at), "dd MMM HH:mm:ss") : "—"}
                </TableCell>
                <TableCell className="text-xs">
                  {e.app_users?.full_name || (e.action === "login_failed" ? "Unknown" : "System")}
                </TableCell>
                <TableCell className="text-xs capitalize">{e.module}</TableCell>
                <TableCell>{actionBadge(e.action)}</TableCell>
                <TableCell className="text-xs">
                  {describeRow(e)}
                  {e.record_id && (
                    <span className="text-[10px] font-mono text-muted-foreground ml-1">
                      {e.record_id.slice(0, 8)}…
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-[10px] font-mono text-muted-foreground">{e.ip_address || "—"}</TableCell>
                <TableCell>
                  {(e.old_values || e.new_values) && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => setViewEntry(e)}
                      title="View details"
                    >
                      <Eye className="h-3 w-3" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between mt-3">
        <div className="text-xs text-muted-foreground">
          Page {page + 1} of {totalPages} · {logPage?.count ?? 0} events
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" /> Prev
          </Button>
          <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Dialog open={!!viewEntry} onOpenChange={(o) => !o && setViewEntry(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-4 w-4" />Audit Entry
              {viewEntry && actionBadge(viewEntry.action)}
            </DialogTitle>
          </DialogHeader>
          {viewEntry && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">When:</span>{" "}
                  <strong className="font-mono">
                    {viewEntry.created_at ? format(new Date(viewEntry.created_at), "dd MMM yyyy HH:mm:ss") : "—"}
                  </strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Who:</span>{" "}
                  <strong>{viewEntry.app_users?.full_name || "System"}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Module:</span>{" "}
                  <strong className="capitalize">{viewEntry.module}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Table:</span>{" "}
                  <strong>{viewEntry.record_type || "—"}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Record id:</span>{" "}
                  <code className="text-[10px]">{viewEntry.record_id || "—"}</code>
                </div>
                <div>
                  <span className="text-muted-foreground">IP:</span>{" "}
                  <code className="text-[10px]">{viewEntry.ip_address || "—"}</code>
                </div>
              </div>

              {viewEntry.action === "update" && (
                <div>
                  <div className="text-xs font-semibold mb-2">Changes</div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Field</TableHead>
                        <TableHead>Before</TableHead>
                        <TableHead>After</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {computeDiff(viewEntry.old_values, viewEntry.new_values).map((c) => (
                        <TableRow key={c.field}>
                          <TableCell className="font-mono text-xs">{c.field}</TableCell>
                          <TableCell className="text-xs text-red-700"><code>{JSON.stringify(c.before)}</code></TableCell>
                          <TableCell className="text-xs text-green-700"><code>{JSON.stringify(c.after)}</code></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {viewEntry.action === "delete" && viewEntry.old_values && (
                <div>
                  <div className="text-xs font-semibold mb-2 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-red-600" />Deleted record
                  </div>
                  <pre className="text-[10px] bg-red-50 dark:bg-red-950/20 p-3 rounded overflow-x-auto">
                    {JSON.stringify(viewEntry.old_values, null, 2)}
                  </pre>
                </div>
              )}

              {viewEntry.action !== "update" && viewEntry.action !== "delete" && viewEntry.new_values && (
                <div>
                  <div className="text-xs font-semibold mb-2">Record</div>
                  <pre className="text-[10px] bg-green-50 dark:bg-green-950/20 p-3 rounded overflow-x-auto">
                    {JSON.stringify(viewEntry.new_values, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
