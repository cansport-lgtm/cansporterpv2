import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { FileSpreadsheet, ListChecks, Search } from "lucide-react";
import * as XLSX from "xlsx";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  FLAG_META, SEVERITY_TONE, STATUS_META, addDaysIso, fetchSettings, fetchSuggest, flagMeta, fmtDay, fmtQty, statusMeta,
  suggestErrorHint, sum, toExportRows, todayPk, type SuggestRow,
} from "@/lib/dispatchPlanner";

export default function DispatchPlannerPendingPage() {
  const [params] = useSearchParams();
  const today = todayPk();
  const { data: settings } = useQuery({ queryKey: ["dp-settings"], queryFn: fetchSettings });
  const to = addDaysIso(today, settings?.horizon_days ?? 14);
  const { data: rows = [], isLoading, isError, error } = useQuery<SuggestRow[]>({
    queryKey: ["dp-suggest", today, to],
    queryFn: () => fetchSuggest(today, to),
    enabled: !!settings,
    retry: false,
  });

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(params.get("status") ?? "all");
  const [flag, setFlag] = useState(params.get("flag") ?? "all");
  const [customer, setCustomer] = useState("all");

  const customers = useMemo(() => [...new Set(rows.map((r) => r.customer_name))].sort(), [rows]);
  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => rows.filter((r) =>
    (status === "all" || r.status === status) &&
    (flag === "all" || r.flags.includes(flag)) &&
    (customer === "all" || r.customer_name === customer) &&
    (!q || [r.order_number, r.customer_name, r.city, r.product_code, r.product_name, r.grade_name, r.planning_item_name]
      .some((x) => (x ?? "").toLowerCase().includes(q)))), [rows, status, flag, customer, q]);

  const exportXlsx = () => {
    const ws = XLSX.utils.json_to_sheet(toExportRows(filtered));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pending lines");
    XLSX.writeFile(wb, `dispatch-planner-pending-${today}.xlsx`);
  };

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title="Pending Lines" description="Every pending domestic order line with its stock position and suggested dispatch day. The working list for the sales order manager." icon={ListChecks}>
          <Button variant="outline" size="sm" onClick={exportXlsx} disabled={filtered.length === 0}><FileSpreadsheet className="h-4 w-4 mr-1" /> Export</Button>
        </PageHeader>

        {isError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{suggestErrorHint(error)}</div>
        )}

        <Card>
          <CardContent className="p-3 flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search order, customer, product…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9 w-[260px]" />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {Object.entries(STATUS_META).map(([k, m]) => <SelectItem key={k} value={k}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={flag} onValueChange={setFlag}>
              <SelectTrigger className="h-9 w-[190px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any flag</SelectItem>
                {Object.entries(FLAG_META).map(([k, m]) => <SelectItem key={k} value={k}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={customer} onValueChange={setCustomer}>
              <SelectTrigger className="h-9 w-[220px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All customers</SelectItem>
                {customers.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="ml-auto text-xs text-muted-foreground tabular-nums">
              {filtered.length} line(s) · {fmtQty(sum(filtered.map((r) => r.suggested_dozens)))} dz · {sum(filtered.map((r) => r.cartons))} ctn
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Suggested</TableHead>
                  <TableHead>Load</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Packing</TableHead>
                  <TableHead className="text-right">Pending dz</TableHead>
                  <TableHead className="text-right">Suggested dz</TableHead>
                  <TableHead className="text-right">Ctn</TableHead>
                  <TableHead>Deadline</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead>Flags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground py-8">Working out the suggestion…</TableCell></TableRow>}
                {!isLoading && filtered.length === 0 && <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground py-8">No pending lines match.</TableCell></TableRow>}
                {filtered.map((r) => {
                  const m = statusMeta(r.status);
                  const overdue = r.flags.includes("overdue");
                  return (
                    <TableRow key={r.line_key} title={r.reason ?? ""}>
                      <TableCell className="whitespace-nowrap font-medium">{fmtDay(r.suggested_date)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{r.load_no ?? "—"}{r.vehicle_reg ? ` · ${r.vehicle_reg}` : ""}</TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{r.order_number}{r.part > 1 ? " ②" : ""}</TableCell>
                      <TableCell><div className="max-w-[200px] truncate">{r.customer_name}</div><div className="text-[11px] text-muted-foreground">{r.city ?? ""}</div></TableCell>
                      <TableCell><div className="max-w-[220px] truncate">{r.product_code} {r.product_name}</div><div className="text-[11px] text-muted-foreground">{r.grade_name ?? ""}</div></TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{r.packing_type ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtQty(r.pending_dozens)}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{fmtQty(r.suggested_dozens)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.cartons}</TableCell>
                      <TableCell className={cn("whitespace-nowrap", overdue && "text-red-700 font-semibold")}>{fmtDay(r.deadline, "dd MMM")}</TableCell>
                      <TableCell><span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset whitespace-nowrap", m.tone)}>{m.short}</span></TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{r.stock_closing !== null ? <>{fmtQty(r.stock_closing)}<div className="text-[10px] text-muted-foreground">{fmtDay(r.stock_closing_date, "dd MMM")}</div></> : "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-[220px]">
                          {r.flags.map((f) => <span key={f} title={flagMeta(f).help} className={cn("inline-flex rounded-full px-1.5 text-[10px] font-semibold ring-1 ring-inset", SEVERITY_TONE[flagMeta(f).severity])}>{flagMeta(f).label}</span>)}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
