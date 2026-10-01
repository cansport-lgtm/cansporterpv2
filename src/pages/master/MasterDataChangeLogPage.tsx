import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfDay, subDays } from "date-fns";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  History,
  Eye,
  ChevronLeft,
  ChevronRight,
  Users,
  Activity,
  Trash2,
  Pencil,
  Plus,
  AlertTriangle,
  Download,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// Master Data → Change Log (super admin only).
//
// Every Master Data table carries the generic audit_row_change trigger with
// module = 'master_data' (supabase/migrations/20261005120100_master_data_change_tracking.sql),
// so audit_log already holds who changed which master, when, and the full
// before/after snapshot. This page is a filtered, master-aware view of that log:
// it names the master and the record (code / name) instead of raw table names
// and ids, shows exactly which fields changed, and breaks the activity down per
// user so super admin can see at a glance who has been editing what.

// audit_log joins app_users through a FK hint the generated types do not know about,
// so the log queries go through an untyped client (same as Settings → Audit Log).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

const PAGE_SIZE = 50;
const MODULE = "master_data";
// Cap for the per-user / per-master breakdown. Master data changes are rare
// (dozens a day at most), so this covers any sensible date range.
const STATS_ROW_CAP = 5000;

// record_type (table) → the master as it is named in the sidebar.
const MASTERS: { table: string; label: string }[] = [
  { table: "production_departments", label: "Departments" },
  { table: "production_sub_departments", label: "Sub-departments" },
  { table: "grades", label: "Grades" },
  { table: "products", label: "Products / SKUs" },
  { table: "items", label: "Items" },
  { table: "units_of_measure", label: "Units" },
  { table: "defect_reasons", label: "Defect Reasons" },
  { table: "downtime_reasons", label: "Downtime Reasons" },
  { table: "hourly_loss_reasons", label: "Hourly Loss Reasons" },
  { table: "hourly_loss_reason_processes", label: "Hourly Loss Reason Processes" },
];
const MASTER_LABEL: Record<string, string> = Object.fromEntries(MASTERS.map((m) => [m.table, m.label]));

const ACTIONS = [
  { value: "create", label: "Created" },
  { value: "update", label: "Edited" },
  { value: "delete", label: "Deleted" },
];

// Columns that never carry business meaning in a diff.
const NOISE_FIELDS = new Set(["updated_at", "created_at"]);

interface LogRow {
  id: string;
  user_id: string | null;
  action: string;
  module: string;
  record_id: string | null;
  record_type: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string | null;
  app_users: { full_name: string; user_id: string } | null;
}

interface StatsRow {
  user_id: string | null;
  action: string;
  record_type: string | null;
  app_users: { full_name: string } | null;
}

// The subset of the query builder applyFilters() chains on.
interface Filterable<Q> {
  eq(column: string, value: string): Q;
  gte(column: string, value: string): Q;
  lte(column: string, value: string): Q;
  or(filters: string): Q;
}

interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

const masterLabel = (table: string | null) =>
  table ? MASTER_LABEL[table] ?? table.replace(/_/g, " ") : "—";

const actionBadge = (action: string) => {
  switch (action) {
    case "create":
      return (
        <Badge variant="default" className="bg-green-600 text-xs gap-1">
          <Plus className="h-3 w-3" />Created
        </Badge>
      );
    case "update":
      return (
        <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200 text-xs gap-1">
          <Pencil className="h-3 w-3" />Edited
        </Badge>
      );
    case "delete":
      return (
        <Badge variant="destructive" className="text-xs gap-1">
          <Trash2 className="h-3 w-3" />Deleted
        </Badge>
      );
    default:
      return <Badge variant="secondary" className="text-xs">{action}</Badge>;
  }
};

// Field-by-field diff for edits, ignoring the timestamp columns.
const computeDiff = (
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): FieldChange[] => {
  if (!before || !after) return [];
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: FieldChange[] = [];
  for (const f of fields) {
    if (NOISE_FIELDS.has(f)) continue;
    if (JSON.stringify(before[f]) !== JSON.stringify(after[f])) {
      changes.push({ field: f, before: before[f], after: after[f] });
    }
  }
  return changes;
};

// A human handle for the record: "CODE – Name" where the master has them.
const describeRecord = (row: LogRow): string => {
  const v = (row.new_values ?? row.old_values ?? {}) as Record<string, unknown>;
  const text = (k: string) => {
    const x = v[k];
    return typeof x === "string" && x.trim() ? x.trim() : null;
  };
  const code = text("code") ?? text("sku_code") ?? text("unit_code");
  const name = text("name") ?? text("process_name") ?? text("reason") ?? text("description") ?? text("title");
  if (code && name) return `${code} – ${name}`;
  return code ?? name ?? (row.record_id ? `#${row.record_id.slice(0, 8)}` : "—");
};

const formatValue = (x: unknown): string => {
  if (x === null || x === undefined) return "—";
  if (typeof x === "boolean") return x ? "Yes" : "No";
  if (typeof x === "string") return x === "" ? "(empty)" : x;
  return JSON.stringify(x);
};

const csvEscape = (s: string) => `"${s.replace(/"/g, '""')}"`;

export default function MasterDataChangeLogPage() {
  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [masterFilter, setMasterFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(0);
  const [viewEntry, setViewEntry] = useState<LogRow | null>(null);

  const resetPage = () => setPage(0);
  const rangeStart = fromDate + "T00:00:00";
  const rangeEnd = toDate + "T23:59:59";

  const { data: users } = useQuery({
    queryKey: ["master-change-log-users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_users")
        .select("id, full_name, user_id")
        .order("full_name");
      if (error) throw error;
      return data || [];
    },
  });

  // Applies every filter except the page window; shared by the list and the export.
  const applyFilters = <Q extends Filterable<Q>>(q: Q): Q => {
    q = q.eq("module", MODULE).gte("created_at", rangeStart).lte("created_at", rangeEnd);
    if (masterFilter !== "all") q = q.eq("record_type", masterFilter);
    if (actionFilter !== "all") q = q.eq("action", actionFilter);
    if (userFilter !== "all") q = q.eq("user_id", userFilter);
    const term = searchTerm.trim().replace(/[,()]/g, " ");
    if (term) {
      // Match the record's code or name, before or after the change.
      const like = `ilike.%${term}%`;
      q = q.or(
        [
          `new_values->>code.${like}`,
          `new_values->>name.${like}`,
          `old_values->>code.${like}`,
          `old_values->>name.${like}`,
        ].join(","),
      );
    }
    return q;
  };

  const { data: logPage, isLoading } = useQuery({
    queryKey: ["master-change-log", fromDate, toDate, masterFilter, actionFilter, userFilter, searchTerm, page],
    queryFn: async () => {
      const q = applyFilters(
        sb
          .from("audit_log")
          .select(
            "id, user_id, action, module, record_id, record_type, old_values, new_values, ip_address, created_at, app_users!audit_log_user_id_fkey (full_name, user_id)",
            { count: "exact" },
          ),
      )
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data || []) as LogRow[], count: count ?? 0 };
    },
  });

  // Per-user / per-master breakdown for the selected date range (other filters ignored
  // so the panel always shows the whole picture for the period).
  const { data: statsRows } = useQuery({
    queryKey: ["master-change-log-stats", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await sb
        .from("audit_log")
        .select("user_id, action, record_type, app_users!audit_log_user_id_fkey (full_name)")
        .eq("module", MODULE)
        .gte("created_at", rangeStart)
        .lte("created_at", rangeEnd)
        .order("created_at", { ascending: false })
        .limit(STATS_ROW_CAP);
      if (error) throw error;
      return (data || []) as StatsRow[];
    },
  });

  const { data: todayCount } = useQuery({
    queryKey: ["master-change-log-today"],
    queryFn: async () => {
      const { count, error } = await sb
        .from("audit_log")
        .select("id", { count: "exact", head: true })
        .eq("module", MODULE)
        .gte("created_at", startOfDay(new Date()).toISOString());
      if (error) throw error;
      return count ?? 0;
    },
  });

  const breakdown = useMemo(() => {
    const byUser = new Map<string, { name: string; create: number; update: number; delete: number; masters: Set<string> }>();
    const byMaster = new Map<string, number>();
    let deletes = 0;
    for (const r of statsRows ?? []) {
      const key = r.user_id ?? "system";
      const entry = byUser.get(key) ?? {
        name: r.app_users?.full_name ?? "System / unknown",
        create: 0,
        update: 0,
        delete: 0,
        masters: new Set<string>(),
      };
      if (r.action === "create") entry.create++;
      else if (r.action === "update") entry.update++;
      else if (r.action === "delete") entry.delete++;
      if (r.record_type) entry.masters.add(r.record_type);
      byUser.set(key, entry);
      if (r.action === "delete") deletes++;
      if (r.record_type) byMaster.set(r.record_type, (byMaster.get(r.record_type) ?? 0) + 1);
    }
    const userRows = [...byUser.entries()]
      .map(([id, e]) => ({ id, ...e, total: e.create + e.update + e.delete }))
      .sort((a, b) => b.total - a.total);
    const masterRows = [...byMaster.entries()]
      .map(([table, count]) => ({ table, count }))
      .sort((a, b) => b.count - a.count);
    return { userRows, masterRows, total: statsRows?.length ?? 0, deletes, capped: (statsRows?.length ?? 0) >= STATS_ROW_CAP };
  }, [statsRows]);

  const totalPages = Math.max(1, Math.ceil((logPage?.count ?? 0) / PAGE_SIZE));

  const summarizeChange = (e: LogRow): string => {
    if (e.action !== "update") return "";
    const diff = computeDiff(e.old_values, e.new_values);
    if (!diff.length) return "";
    const names = diff.map((c) => c.field.replace(/_/g, " "));
    return names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3} more` : names.join(", ");
  };

  const exportCsv = async () => {
    const q = applyFilters(
      sb
        .from("audit_log")
        .select(
          "id, user_id, action, module, record_id, record_type, old_values, new_values, ip_address, created_at, app_users!audit_log_user_id_fkey (full_name, user_id)",
        ),
    )
      .order("created_at", { ascending: false })
      .limit(STATS_ROW_CAP);
    const { data, error } = await q;
    if (error) {
      console.error("Master data change log export failed:", error);
      return;
    }
    const rows = (data || []) as LogRow[];
    const header = ["When", "User", "Login", "Master", "Record", "Action", "Changed fields", "Record id", "IP"];
    const lines = rows.map((e) =>
      [
        e.created_at ? format(new Date(e.created_at), "yyyy-MM-dd HH:mm:ss") : "",
        e.app_users?.full_name ?? "System",
        e.app_users?.user_id ?? "",
        masterLabel(e.record_type),
        describeRecord(e),
        e.action,
        e.action === "update"
          ? computeDiff(e.old_values, e.new_values)
              .map((c) => `${c.field}: ${formatValue(c.before)} → ${formatValue(c.after)}`)
              .join("; ")
          : "",
        e.record_id ?? "",
        e.ip_address ?? "",
      ]
        .map((v) => csvEscape(String(v)))
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `master-data-changes-${fromDate}-to-${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ERPLayout>
      <PageHeader
        title="Master Data Change Log"
        description="Who changed which master, when, and exactly what changed — every create, edit and delete"
        icon={History}
      >
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!logPage?.count}>
          <Download className="h-4 w-4 mr-1" /> Export CSV
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><Activity className="h-3 w-3" />Changes today</div>
            <div className="text-2xl font-semibold">{todayCount ?? "—"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><History className="h-3 w-3" />Changes in range</div>
            <div className="text-2xl font-semibold">{statsRows ? breakdown.total : "—"}{breakdown.capped ? "+" : ""}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" />People who made changes</div>
            <div className="text-2xl font-semibold">{statsRows ? breakdown.userRows.filter((u) => u.id !== "system").length : "—"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><Trash2 className="h-3 w-3" />Deletes in range</div>
            <div className={`text-2xl font-semibold ${breakdown.deletes > 0 ? "text-red-600" : ""}`}>{statsRows ? breakdown.deletes : "—"}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3 mb-4">
        <Card className="lg:col-span-2">
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Changes by person ({fromDate} to {toDate})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead className="text-right">Created</TableHead>
                  <TableHead className="text-right">Edited</TableHead>
                  <TableHead className="text-right">Deleted</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Masters touched</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!breakdown.userRows.length && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground text-xs">
                      {statsRows ? "No master data changes in this range" : "Loading…"}
                    </TableCell>
                  </TableRow>
                )}
                {breakdown.userRows.map((u) => (
                  <TableRow
                    key={u.id}
                    className={u.id !== "system" ? "cursor-pointer" : undefined}
                    onClick={() => {
                      if (u.id !== "system") {
                        setUserFilter(u.id);
                        resetPage();
                      }
                    }}
                    title={u.id !== "system" ? "Show only this user's changes" : undefined}
                  >
                    <TableCell className="text-xs font-medium">{u.name}</TableCell>
                    <TableCell className="text-xs text-right text-green-700">{u.create}</TableCell>
                    <TableCell className="text-xs text-right text-amber-700">{u.update}</TableCell>
                    <TableCell className={`text-xs text-right ${u.delete > 0 ? "text-red-600 font-semibold" : ""}`}>{u.delete}</TableCell>
                    <TableCell className="text-xs text-right font-semibold">{u.total}</TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">
                      {[...u.masters].map(masterLabel).join(", ")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Changes by master</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Master</TableHead>
                  <TableHead className="text-right">Changes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!breakdown.masterRows.length && (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground text-xs">
                      {statsRows ? "—" : "Loading…"}
                    </TableCell>
                  </TableRow>
                )}
                {breakdown.masterRows.map((m) => (
                  <TableRow
                    key={m.table}
                    className="cursor-pointer"
                    onClick={() => { setMasterFilter(m.table); resetPage(); }}
                    title="Show only this master"
                  >
                    <TableCell className="text-xs">{masterLabel(m.table)}</TableCell>
                    <TableCell className="text-xs text-right font-semibold">{m.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
        <Select value={masterFilter} onValueChange={(v) => { setMasterFilter(v); resetPage(); }}>
          <SelectTrigger className="w-[220px]"><SelectValue placeholder="Master" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All masters</SelectItem>
            {MASTERS.map((m) => (
              <SelectItem key={m.table} value={m.table}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); resetPage(); }}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Action" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {ACTIONS.map((a) => (
              <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={userFilter} onValueChange={(v) => { setUserFilter(v); resetPage(); }}>
          <SelectTrigger className="w-[220px]"><SelectValue placeholder="User" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All users</SelectItem>
            {(users || []).map((u) => (
              <SelectItem key={u.id} value={u.id}>{u.full_name} ({u.user_id})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Search code or name…"
          value={searchTerm}
          onChange={(e) => { setSearchTerm(e.target.value); resetPage(); }}
          className="w-[200px]"
        />
        {(masterFilter !== "all" || actionFilter !== "all" || userFilter !== "all" || searchTerm) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setMasterFilter("all"); setActionFilter("all"); setUserFilter("all"); setSearchTerm(""); resetPage(); }}
          >
            Clear filters
          </Button>
        )}
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Master</TableHead>
              <TableHead>Record</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>What changed</TableHead>
              <TableHead className="w-14" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!logPage?.rows.length && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  {isLoading ? "Loading…" : "No master data changes match these filters"}
                </TableCell>
              </TableRow>
            )}
            {logPage?.rows.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="text-xs font-mono">
                  {e.created_at ? format(new Date(e.created_at), "dd MMM yyyy HH:mm:ss") : "—"}
                </TableCell>
                <TableCell className="text-xs">
                  <div className="font-medium">{e.app_users?.full_name || "System"}</div>
                  {e.app_users?.user_id && (
                    <div className="text-[10px] text-muted-foreground">{e.app_users.user_id}</div>
                  )}
                </TableCell>
                <TableCell className="text-xs">{masterLabel(e.record_type)}</TableCell>
                <TableCell className="text-xs">{describeRecord(e)}</TableCell>
                <TableCell>{actionBadge(e.action)}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate" title={summarizeChange(e)}>
                  {e.action === "create" && "New record"}
                  {e.action === "delete" && "Record removed"}
                  {e.action === "update" && (summarizeChange(e) || "—")}
                </TableCell>
                <TableCell>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => setViewEntry(e)}
                    title="View details"
                  >
                    <Eye className="h-3 w-3" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between mt-3">
        <div className="text-xs text-muted-foreground">
          Page {page + 1} of {totalPages} · {logPage?.count ?? 0} changes
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
              <History className="h-4 w-4" />
              {viewEntry ? `${masterLabel(viewEntry.record_type)}: ${describeRecord(viewEntry)}` : "Change"}
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
                  {viewEntry.app_users?.user_id && (
                    <span className="text-muted-foreground"> ({viewEntry.app_users.user_id})</span>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground">Master:</span>{" "}
                  <strong>{masterLabel(viewEntry.record_type)}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Table:</span>{" "}
                  <code className="text-[10px]">{viewEntry.record_type || "—"}</code>
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
                  <div className="text-xs font-semibold mb-2">Changed fields</div>
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
                          <TableCell className="text-xs text-red-700">{formatValue(c.before)}</TableCell>
                          <TableCell className="text-xs text-green-700">{formatValue(c.after)}</TableCell>
                        </TableRow>
                      ))}
                      {!computeDiff(viewEntry.old_values, viewEntry.new_values).length && (
                        <TableRow>
                          <TableCell colSpan={3} className="text-xs text-center text-muted-foreground">
                            Only the timestamp changed
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}

              {viewEntry.action === "delete" && viewEntry.old_values && (
                <div>
                  <div className="text-xs font-semibold mb-2 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-red-600" />Deleted record (as it was)
                  </div>
                  <RecordTable values={viewEntry.old_values} tone="red" />
                </div>
              )}

              {viewEntry.action === "create" && viewEntry.new_values && (
                <div>
                  <div className="text-xs font-semibold mb-2">New record</div>
                  <RecordTable values={viewEntry.new_values} tone="green" />
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}

// Flat field/value listing of a whole record (for creates and deletes).
function RecordTable({ values, tone }: { values: Record<string, unknown>; tone: "red" | "green" }) {
  const entries = Object.entries(values).filter(([k]) => !NOISE_FIELDS.has(k));
  const bg = tone === "red" ? "bg-red-50 dark:bg-red-950/20" : "bg-green-50 dark:bg-green-950/20";
  return (
    <div className={`rounded ${bg} p-2`}>
      <Table>
        <TableBody>
          {entries.map(([k, v]) => (
            <TableRow key={k}>
              <TableCell className="font-mono text-xs w-56">{k}</TableCell>
              <TableCell className="text-xs">{formatValue(v)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
