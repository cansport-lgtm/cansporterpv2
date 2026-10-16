import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { format, subDays } from "date-fns";
import { DoorOpen, FileSpreadsheet, Plus, Search } from "lucide-react";
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
import { RescanAlerts } from "@/components/gate-pass/RescanAlerts";
import { cn } from "@/lib/utils";
import {
  PASS_TYPES, STATUS_META, fmtQty, gpDb, passTypeMeta, statusMeta, type GatePass,
} from "@/lib/gatePass";

const LIST_SELECT =
  "id, pass_number, pass_type, status, pass_date, party_name, vehicle_number, created_at, gate_out_at, held_at, hold_note, is_backfill, expected_return_date," +
  "gate_pass_items(quantity, uom)," +
  "gate_pass_dispatches(sales_dispatches(dispatch_number))," +
  "purchase_returns(return_number)";

type ListRow = Pick<GatePass,
  "id" | "pass_number" | "pass_type" | "status" | "pass_date" | "party_name" | "vehicle_number" |
  "created_at" | "gate_out_at" | "held_at" | "hold_note" | "is_backfill" | "expected_return_date"> & {
  gate_pass_items: { quantity: number; uom: string }[];
  gate_pass_dispatches: { sales_dispatches: { dispatch_number: string } | null }[];
  purchase_returns: { return_number: string | null } | null;
};

const qtySummary = (r: ListRow) => {
  const byUom = new Map<string, number>();
  r.gate_pass_items.forEach((i) => byUom.set(i.uom, (byUom.get(i.uom) ?? 0) + Number(i.quantity)));
  return [...byUom.entries()].map(([u, q]) => `${fmtQty(q)} ${u}`).join(" + ") || "—";
};

const reference = (r: ListRow) => {
  const d = r.gate_pass_dispatches.map((x) => x.sales_dispatches?.dispatch_number).filter(Boolean);
  if (d.length) return d.join(", ");
  return r.purchase_returns?.return_number ?? "";
};

export default function GatePassListPage() {
  const navigate = useNavigate();
  const { hasModulePermission } = useAuth();
  const canCreate = hasModulePermission("gate_pass", "create");
  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 6), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  const { data: rows = [], isLoading } = useQuery<ListRow[]>({
    queryKey: ["gate-passes", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await gpDb
        .from("gate_passes")
        .select(LIST_SELECT)
        .gte("pass_date", fromDate)
        .lte("pass_date", toDate)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Live counts regardless of the date range: what needs attention right now.
  const { data: live = [] } = useQuery<{ status: string }[]>({
    queryKey: ["gate-passes-live"],
    queryFn: async () => {
      const { data, error } = await gpDb
        .from("gate_passes")
        .select("status")
        .in("status", ["pending_approval", "held", "approved"]);
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) =>
      (typeFilter === "all" || r.pass_type === typeFilter) &&
      (statusFilter === "all" || r.status === statusFilter) &&
      (!q || [r.pass_number, r.party_name, r.vehicle_number ?? "", reference(r)].some((v) => v.toLowerCase().includes(q))),
    );
  }, [rows, typeFilter, statusFilter, search]);

  const today = format(new Date(), "yyyy-MM-dd");

  // Daily gate register as Excel: every pass in the filtered list (no prices).
  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(filtered.map((r) => ({
      "GP no.": r.pass_number,
      Date: r.pass_date,
      Type: passTypeMeta(r.pass_type).label,
      Party: r.party_name,
      Reference: reference(r),
      Vehicle: r.vehicle_number ?? "",
      Qty: qtySummary(r),
      Status: statusMeta(r.status).label,
      "Out at": r.gate_out_at ? format(new Date(r.gate_out_at), "yyyy-MM-dd HH:mm") : "",
      "Due back": r.expected_return_date ?? "",
      Backfill: r.is_backfill ? "Yes" : "",
      "Hold note": r.hold_note ?? "",
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Gate register");
    XLSX.writeFile(wb, `Gate-Register-${fromDate}${fromDate === toDate ? "" : `_to_${toDate}`}.xlsx`);
  };
  const kpis = [
    { label: "Out today", value: rows.filter((r) => r.gate_out_at && format(new Date(r.gate_out_at), "yyyy-MM-dd") === today).length, tone: "" },
    { label: "Waiting at gate (approved)", value: live.filter((r) => r.status === "approved").length, tone: "text-sky-700" },
    { label: "Pending approval", value: live.filter((r) => r.status === "pending_approval").length, tone: "text-amber-700" },
    { label: "Held at gate", value: live.filter((r) => r.status === "held").length, tone: "text-red-700" },
  ];

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title="Gate Passes"
          description="Every outward movement through the gate — one GP number series for all types"
          icon={DoorOpen}
        >
          <Button variant="outline" onClick={exportExcel} disabled={filtered.length === 0}>
            <FileSpreadsheet className="h-4 w-4 mr-1" /> Export
          </Button>
          {canCreate && (
            <Button onClick={() => navigate("/gate-pass/new")}>
              <Plus className="h-4 w-4 mr-1" /> New gate pass
            </Button>
          )}
        </PageHeader>

        <RescanAlerts />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {kpis.map((k) => (
            <Card key={k.label}>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">{k.label}</div>
                <div className={cn("text-2xl font-display font-bold mt-1", k.tone)}>{k.value}</div>
              </CardContent>
            </Card>
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
              <Label className="text-xs">Type</Label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {PASS_TYPES.filter((t) => t.available).map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {Object.entries(STATUS_META)
                    .filter(([k]) => k !== "draft" || canCreate)
                    .map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs" htmlFor="gp-search">Search</Label>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input id="gp-search" className="pl-8" placeholder="GP no., party, vehicle, dispatch…"
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
                  <TableHead>GP no.</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No gate passes in this range.</TableCell></TableRow>
                ) : filtered.map((r) => {
                  const t = passTypeMeta(r.pass_type);
                  const s = statusMeta(r.status);
                  return (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate(`/gate-pass/passes/${r.id}`)}>
                      <TableCell className="font-mono text-sm font-semibold">
                        <Link to={`/gate-pass/passes/${r.id}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                          {r.pass_number}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{format(new Date(r.pass_date), "dd MMM yyyy")}</TableCell>
                      <TableCell>
                        <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset whitespace-nowrap", t.badgeClass)}>{t.label}</span>
                        {r.is_backfill && <span className="ml-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200">Backfill</span>}
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate" title={r.party_name}>{r.party_name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[220px] truncate" title={reference(r)}>{reference(r) || "—"}</TableCell>
                      <TableCell className="text-sm">{r.vehicle_number || "—"}</TableCell>
                      <TableCell className="text-sm tabular-nums whitespace-nowrap">{qtySummary(r)}</TableCell>
                      <TableCell>
                        <Badge variant={s.variant}>{s.label}</Badge>
                        {r.status === "out" && r.gate_out_at && (
                          <div className="text-xs text-muted-foreground mt-1">{format(new Date(r.gate_out_at), "dd MMM HH:mm")}</div>
                        )}
                        {r.status === "held" && r.hold_note && (
                          <div className="text-xs text-red-700 mt-1 max-w-[200px] truncate" title={r.hold_note}>{r.hold_note}</div>
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
