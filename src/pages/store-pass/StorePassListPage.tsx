import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { format, subDays } from "date-fns";
import { FileSpreadsheet, Plus, Search, Warehouse } from "lucide-react";
import * as XLSX from "xlsx";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { SP_STATUS_META, fmtQty, spDb, spStatusMeta, todayPk, type StorePass } from "@/lib/storePass";

const LIST_SELECT =
  "id, pass_number, status, pass_date, dispatch_plan_no, received_by_name, party_name, created_at, issued_at, cancelled_at, cancel_reason," +
  "issuer:app_users!store_passes_issued_by_fkey(full_name)," +
  "store_pass_items(quantity, packages)," +
  "store_pass_dispatches(sales_dispatches(dispatch_number))";

type ListRow = Pick<StorePass,
  "id" | "pass_number" | "status" | "pass_date" | "dispatch_plan_no" | "received_by_name" | "party_name" |
  "created_at" | "issued_at" | "cancelled_at" | "cancel_reason" | "issuer"> & {
  store_pass_items: { quantity: number; packages: number | null }[];
  store_pass_dispatches: { sales_dispatches: { dispatch_number: string } | null }[];
};

const sum = (xs: (number | null)[]) => xs.reduce((s, x) => s + Number(x ?? 0), 0);
const dispatchesOf = (r: ListRow) =>
  r.store_pass_dispatches.map((x) => x.sales_dispatches?.dispatch_number).filter(Boolean).sort().join(", ");

export default function StorePassListPage() {
  const navigate = useNavigate();
  const { hasModulePermission } = useAuth();
  const canCreate = hasModulePermission("store_pass", "create");
  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 6), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  const { data: rows = [], isLoading } = useQuery<ListRow[]>({
    queryKey: ["store-passes", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await spDb
        .from("store_passes")
        .select(LIST_SELECT)
        .gte("pass_date", fromDate)
        .lte("pass_date", toDate)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Where today's dispatches stand, regardless of the date range.
  const { data: stages = [] } = useQuery<{ stage: string; sp_issued_at: string | null }[]>({
    queryKey: ["store-gate-tracking", "open"],
    queryFn: async () => {
      const { data, error } = await spDb
        .from("v_store_gate_tracking")
        .select("stage, sp_issued_at")
        .in("stage", ["no_store_pass", "draft", "issued", "on_gate_pass", "held"]);
      if (error) return [];
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) =>
      (statusFilter === "all" || r.status === statusFilter) &&
      (!q || [r.pass_number, r.party_name, r.dispatch_plan_no ?? "", r.received_by_name ?? "", dispatchesOf(r)].some((v) => v.toLowerCase().includes(q))),
    );
  }, [rows, statusFilter, search]);

  const today = todayPk();
  const issuedToday = rows.filter((r) => r.issued_at && new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date(r.issued_at)) === today);

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(filtered.map((r) => ({
      "SP no.": r.pass_number,
      Date: r.pass_date,
      "Dispatch plan": r.dispatch_plan_no ?? "",
      "Handed over to": r.received_by_name ?? "",
      "Linked dispatches": dispatchesOf(r),
      Customers: r.party_name,
      Items: r.store_pass_items.length,
      "Dozens": sum(r.store_pass_items.map((i) => i.quantity)),
      "Cartons": sum(r.store_pass_items.map((i) => i.packages)),
      Status: spStatusMeta(r.status).label,
      "Issued at": r.issued_at ? format(new Date(r.issued_at), "yyyy-MM-dd HH:mm") : "",
      "Issued by": r.issuer?.full_name ?? "",
      "Cancel reason": r.cancel_reason ?? "",
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Store passes");
    XLSX.writeFile(wb, `Store-Passes-${fromDate}${fromDate === toDate ? "" : `_to_${toDate}`}.xlsx`);
  };

  const kpis = [
    { label: "Issued today", value: issuedToday.length, tone: "", href: "/store-pass/passes" },
    { label: "Issued, waiting for gate pass", value: stages.filter((s) => s.stage === "issued").length, tone: "text-indigo-700", href: "/store-pass/tracking" },
    { label: "Dispatches with no store pass", value: stages.filter((s) => s.stage === "no_store_pass").length, tone: stages.some((s) => s.stage === "no_store_pass") ? "text-red-700" : "", href: "/store-pass/tracking" },
    { label: "Held at gate", value: stages.filter((s) => s.stage === "held").length, tone: stages.some((s) => s.stage === "held") ? "text-amber-700" : "", href: "/store-pass/tracking" },
  ];

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title="Store Passes"
          description="Finished goods handed over by the store at the loading dock — one SP number series"
          icon={Warehouse}
        >
          <Button variant="outline" onClick={exportExcel} disabled={filtered.length === 0}>
            <FileSpreadsheet className="h-4 w-4 mr-1" /> Export
          </Button>
          {canCreate && (
            <Button onClick={() => navigate("/store-pass/new")}>
              <Plus className="h-4 w-4 mr-1" /> New store pass
            </Button>
          )}
        </PageHeader>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {kpis.map((k) => (
            <Link key={k.label} to={k.href}>
              <Card className="hover:border-primary/40 transition-colors h-full">
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">{k.label}</div>
                  <div className={cn("text-2xl font-display font-bold mt-1", k.tone)}>{k.value}</div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <Card>
          <CardContent className="p-3 md:p-4 flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" className="w-40" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" className="w-40" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {Object.entries(SP_STATUS_META).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs" htmlFor="sp-search">Search</Label>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input id="sp-search" className="pl-8" placeholder="SP no., plan no., handed over to, customer, dispatch…"
                  value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table className="min-w-[1000px]">
              <TableHeader>
                <TableRow>
                  <TableHead>SP no.</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Dispatch plan</TableHead>
                  <TableHead>Linked dispatch</TableHead>
                  <TableHead>Handed over to</TableHead>
                  <TableHead className="text-right">Items · dz / ctn</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No store passes in this range.</TableCell></TableRow>
                ) : filtered.map((r) => {
                  const s = spStatusMeta(r.status);
                  return (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate(`/store-pass/passes/${r.id}`)}>
                      <TableCell className="font-mono text-sm font-semibold">
                        <Link to={`/store-pass/passes/${r.id}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                          {r.pass_number}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{format(new Date(r.pass_date), "dd MMM yyyy")}</TableCell>
                      <TableCell className="text-sm font-medium">{r.dispatch_plan_no || "—"}</TableCell>
                      <TableCell className="text-sm">
                        <div className="font-mono max-w-[200px] truncate" title={dispatchesOf(r)}>{dispatchesOf(r) || <span className={r.status === "issued" ? "text-amber-700 font-medium" : "text-muted-foreground"}>{r.status === "issued" ? "Not linked" : "—"}</span>}</div>
                        {dispatchesOf(r) && <div className="text-xs text-muted-foreground max-w-[200px] truncate" title={r.party_name}>{r.party_name}</div>}
                      </TableCell>
                      <TableCell className="text-sm max-w-[180px] truncate" title={r.received_by_name ?? ""}>{r.received_by_name || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap">
                        <span className="text-muted-foreground">{r.store_pass_items.length} · </span>{fmtQty(sum(r.store_pass_items.map((i) => i.quantity)))} / {sum(r.store_pass_items.map((i) => i.packages))}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {r.issued_at ? (
                          <>
                            <div>{format(new Date(r.issued_at), "dd MMM, HH:mm")}</div>
                            <div className="text-xs text-muted-foreground">{r.issuer?.full_name ?? ""}</div>
                          </>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={s.variant}>{s.label}</Badge>
                        {r.status === "cancelled" && r.cancel_reason && (
                          <div className="text-xs text-red-700 mt-1 max-w-[200px] truncate" title={r.cancel_reason}>{r.cancel_reason}</div>
                        )}
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
