import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Eye, History, AlertTriangle } from "lucide-react";
import { format, startOfMonth } from "date-fns";

const sb = supabase as any;

const actionBadge = (action: string) => {
  if (action === "INSERT") return <Badge variant="default" className="bg-green-600 text-xs">INSERT</Badge>;
  if (action === "UPDATE") return <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200 text-xs">UPDATE</Badge>;
  if (action === "DELETE") return <Badge variant="destructive" className="text-xs">DELETE</Badge>;
  return <Badge variant="secondary" className="text-xs">{action}</Badge>;
};

export default function AuditLogPage() {
  const [fromDate, setFromDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [filterTable, setFilterTable] = useState<string>("all");
  const [filterAction, setFilterAction] = useState<string>("all");
  const [viewEntryId, setViewEntryId] = useState<string | null>(null);

  // Accounting rows in the central audit_log (populated by DB triggers).
  // Actions there are lowercase create/update/delete; this page keeps its
  // historical INSERT/UPDATE/DELETE labels, so map both ways.
  const toDbAction: Record<string, string> = { INSERT: "create", UPDATE: "update", DELETE: "delete" };
  const fromDbAction: Record<string, string> = { create: "INSERT", update: "UPDATE", delete: "DELETE" };

  const { data: entries } = useQuery({
    queryKey: ["acc-audit-log", fromDate, toDate, filterTable, filterAction],
    queryFn: async () => {
      let q = sb
        .from("audit_log")
        .select("id, record_type, record_id, action, old_values, new_values, created_at, app_users!audit_log_user_id_fkey (full_name)")
        .eq("module", "accounting")
        .gte("created_at", fromDate + "T00:00:00")
        .lte("created_at", toDate + "T23:59:59")
        .order("created_at", { ascending: false })
        .limit(500);
      if (filterTable !== "all") q = q.eq("record_type", filterTable);
      if (filterAction !== "all") q = q.eq("action", toDbAction[filterAction] || filterAction);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).map((r: any) => ({
        id: r.id,
        table_name: r.record_type,
        record_id: r.record_id,
        action: fromDbAction[r.action] || r.action,
        before_data: r.old_values,
        after_data: r.new_values,
        changed_at: r.created_at,
        user_name: r.app_users?.full_name || null,
      }));
    },
  });

  const totals = {
    inserts: (entries || []).filter((e: any) => e.action === "INSERT").length,
    updates: (entries || []).filter((e: any) => e.action === "UPDATE").length,
    deletes: (entries || []).filter((e: any) => e.action === "DELETE").length,
    total: entries?.length || 0,
  };

  const selectedEntry = entries?.find((e: any) => e.id === viewEntryId);

  // Build a brief one-liner for each row
  const summary = (e: any): string => {
    const d = e.after_data || e.before_data || {};
    if (e.table_name === "accounting_vouchers") {
      return `${d.voucher_number || "(no #)"} · ${d.voucher_type || ""} · Rs. ${Number(d.total_amount || 0).toLocaleString()}`;
    }
    if (e.table_name === "accounting_voucher_lines") {
      const dr = Number(d.debit_amount || 0);
      const cr = Number(d.credit_amount || 0);
      return `line · Dr ${dr ? `Rs. ${dr.toLocaleString()}` : "—"} · Cr ${cr ? `Rs. ${cr.toLocaleString()}` : "—"}`;
    }
    return "—";
  };

  // Compute a simple diff for UPDATE entries
  const computeDiff = (before: any, after: any): { field: string; before: any; after: any }[] => {
    if (!before || !after) return [];
    const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
    const changes: { field: string; before: any; after: any }[] = [];
    for (const f of fields) {
      const b = before[f]; const a = after[f];
      if (JSON.stringify(b) !== JSON.stringify(a)) {
        changes.push({ field: f, before: b, after: a });
      }
    }
    return changes;
  };

  return (
    <ERPLayout>
      <PageHeader title="Audit Log" description="Every INSERT / UPDATE / DELETE on accounting tables (DB-trigger-captured)">
        <div className="flex gap-2">
          <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-[150px]" />
          <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="w-[150px]" />
          <Select value={filterTable} onValueChange={setFilterTable}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tables</SelectItem>
              <SelectItem value="accounting_vouchers">Vouchers</SelectItem>
              <SelectItem value="accounting_voucher_lines">Voucher lines</SelectItem>
              <SelectItem value="accounting_parties">Parties</SelectItem>
              <SelectItem value="accounting_chart_of_accounts">Chart of accounts</SelectItem>
              <SelectItem value="accounting_default_accounts">Default accounts</SelectItem>
              <SelectItem value="accounting_period_close">Period close</SelectItem>
              <SelectItem value="accounting_budgets">Budgets</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterAction} onValueChange={setFilterAction}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              <SelectItem value="INSERT">INSERT</SelectItem>
              <SelectItem value="UPDATE">UPDATE</SelectItem>
              <SelectItem value="DELETE">DELETE</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </PageHeader>

      <div className="grid grid-cols-4 gap-3 mb-4">
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Total events</div><div className="text-2xl font-semibold">{totals.total}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Inserts</div><div className="text-2xl font-semibold text-green-600">{totals.inserts}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Updates</div><div className="text-2xl font-semibold text-amber-600">{totals.updates}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Deletes</div><div className="text-2xl font-semibold text-red-600">{totals.deletes}</div></CardContent></Card>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">Timestamp</TableHead>
              <TableHead>By</TableHead>
              <TableHead>Table</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Record</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!entries?.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No audit entries in this range</TableCell></TableRow>}
            {entries?.map((e: any) => (
              <TableRow key={e.id}>
                <TableCell className="text-xs font-mono">{format(new Date(e.changed_at), "dd MMM HH:mm:ss")}</TableCell>
                <TableCell className="text-xs">{e.user_name || "System"}</TableCell>
                <TableCell className="text-xs">{(e.table_name || "").replace("accounting_", "")}</TableCell>
                <TableCell>{actionBadge(e.action)}</TableCell>
                <TableCell className="text-[10px] font-mono text-muted-foreground">{e.record_id ? e.record_id.slice(0, 8) + "…" : "—"}</TableCell>
                <TableCell className="text-xs">{summary(e)}</TableCell>
                <TableCell>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setViewEntryId(e.id)} title="View JSON"><Eye className="h-3 w-3" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!viewEntryId} onOpenChange={(o) => !o && setViewEntryId(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-4 w-4" />Audit Entry
              {selectedEntry && actionBadge(selectedEntry.action)}
            </DialogTitle>
          </DialogHeader>
          {selectedEntry && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><span className="text-muted-foreground">Timestamp:</span> <strong className="font-mono">{format(new Date(selectedEntry.changed_at), "dd MMM yyyy HH:mm:ss")}</strong></div>
                <div><span className="text-muted-foreground">By:</span> <strong>{selectedEntry.user_name || "System"}</strong></div>
                <div><span className="text-muted-foreground">Table:</span> <strong>{selectedEntry.table_name}</strong></div>
                <div><span className="text-muted-foreground">Record id:</span> <code className="text-[10px]">{selectedEntry.record_id}</code></div>
              </div>

              {selectedEntry.action === "UPDATE" && (
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
                      {computeDiff(selectedEntry.before_data, selectedEntry.after_data).map(c => (
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

              {selectedEntry.action === "DELETE" && selectedEntry.before_data && (
                <div>
                  <div className="text-xs font-semibold mb-2 flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-red-600" />Deleted record (before)</div>
                  <pre className="text-[10px] bg-red-50 dark:bg-red-950/20 p-3 rounded overflow-x-auto">{JSON.stringify(selectedEntry.before_data, null, 2)}</pre>
                </div>
              )}

              {selectedEntry.action === "INSERT" && selectedEntry.after_data && (
                <div>
                  <div className="text-xs font-semibold mb-2">Inserted record</div>
                  <pre className="text-[10px] bg-green-50 dark:bg-green-950/20 p-3 rounded overflow-x-auto">{JSON.stringify(selectedEntry.after_data, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
