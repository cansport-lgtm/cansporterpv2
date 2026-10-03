import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format, subDays } from "date-fns";
import { FileSpreadsheet, Route, Search } from "lucide-react";
import * as XLSX from "xlsx";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { StageStrip } from "@/components/store-pass/StageStrip";
import { statusMeta as gpStatusMeta } from "@/lib/gatePass";
import { STAGE_META, fmtQty, hoursBetween, spDb, stageMeta, type TrackingRow, type TrackingStage } from "@/lib/storePass";

const OPEN_STAGES: TrackingStage[] = ["no_store_pass", "draft", "issued", "on_gate_pass", "held"];
const TRACKING_SELECT = "*";

export default function DispatchTrackingPage() {
  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 6), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [stageFilter, setStageFilter] = useState("all");
  const [search, setSearch] = useState("");

  // Dispatches dated in the range, plus everything still open whatever its date.
  const { data: rows = [], isLoading } = useQuery<TrackingRow[]>({
    queryKey: ["store-gate-tracking", fromDate, toDate],
    queryFn: async () => {
      const [inRange, open] = await Promise.all([
        spDb.from("v_store_gate_tracking").select(TRACKING_SELECT).gte("dispatch_date", fromDate).lte("dispatch_date", toDate).limit(2000),
        spDb.from("v_store_gate_tracking").select(TRACKING_SELECT).in("stage", OPEN_STAGES).limit(2000),
      ]);
      if (inRange.error) throw inRange.error;
      if (open.error) throw open.error;
      const m = new Map<string, TrackingRow>();
      [...(open.data ?? []), ...(inRange.data ?? [])].forEach((r: TrackingRow) => m.set(r.dispatch_id, r));
      return [...m.values()].sort((a, b) => {
        const d = stageMeta(a.stage).order - stageMeta(b.stage).order;
        return d !== 0 ? d : b.dispatch_created_at.localeCompare(a.dispatch_created_at);
      });
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) =>
      (stageFilter === "all" || r.stage === stageFilter) &&
      (!q || [r.dispatch_number, r.customer_name ?? "", r.order_numbers ?? "", r.sp_number ?? "", r.gp_number ?? "", r.dc_vehicle ?? "", r.sp_vehicle ?? ""]
        .some((v) => v.toLowerCase().includes(q))),
    );
  }, [rows, stageFilter, search]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r) => m.set(r.stage, (m.get(r.stage) ?? 0) + 1));
    return m;
  }, [rows]);

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(filtered.map((r) => ({
      Dispatch: r.dispatch_number,
      "DC date": r.dispatch_date,
      "DC made": format(new Date(r.dispatch_created_at), "yyyy-MM-dd HH:mm"),
      Customer: r.customer_name ?? "",
      Orders: r.order_numbers ?? "",
      "DC dz": Number(r.dc_quantity),
      "DC ctn": Number(r.dc_packages),
      "Store pass": r.sp_number ?? "",
      "SP issued": r.sp_issued_at ? format(new Date(r.sp_issued_at), "yyyy-MM-dd HH:mm") : "",
      "SP dz": r.sp_quantity ?? "",
      "SP ctn": r.sp_packages ?? "",
      "Gate pass": r.gp_number ?? "",
      "GP made": r.gp_created_at ? format(new Date(r.gp_created_at), "yyyy-MM-dd HH:mm") : "",
      "Gate out": r.gate_out_at ? format(new Date(r.gate_out_at), "yyyy-MM-dd HH:mm") : "",
      "GP counted ctn": r.gp_counted_packages ?? "",
      "GP counted dz": r.gp_counted_quantity ?? "",
      "DC → SP": hoursBetween(r.dispatch_created_at, r.sp_issued_at),
      "SP → Out": hoursBetween(r.sp_issued_at, r.gate_out_at),
      Stage: stageMeta(r.stage).label,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Dispatch tracking");
    XLSX.writeFile(wb, `Dispatch-Tracking-${fromDate}_to_${toDate}.xlsx`);
  };

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title="Dispatch Tracking"
          description="Every domestic dispatch and where it is now: office → store → gate pass → gate out → delivered"
          icon={Route}
        >
          <Button variant="outline" onClick={exportExcel} disabled={filtered.length === 0}>
            <FileSpreadsheet className="h-4 w-4 mr-1" /> Export
          </Button>
        </PageHeader>

        <div className="flex flex-wrap gap-2">
          {(Object.keys(STAGE_META) as TrackingStage[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStageFilter(stageFilter === s ? "all" : s)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ring-1 ring-inset transition-colors",
                STAGE_META[s].tone,
                stageFilter === s ? "ring-2 ring-primary" : "ring-transparent",
              )}
            >
              <b className="tabular-nums">{counts.get(s) ?? 0}</b> {STAGE_META[s].label}
            </button>
          ))}
        </div>

        <Card>
          <CardContent className="p-3 md:p-4 flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">Dispatch date from</Label>
              <Input type="date" className="w-40" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" className="w-40" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Stage</Label>
              <Select value={stageFilter} onValueChange={setStageFilter}>
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All stages</SelectItem>
                  {(Object.keys(STAGE_META) as TrackingStage[]).map((s) => <SelectItem key={s} value={s}>{STAGE_META[s].label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs" htmlFor="trk-search">Search</Label>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input id="trk-search" className="pl-8" placeholder="DC, SP, GP, customer, vehicle…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table className="min-w-[1180px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Dispatch</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Dz / Ctn</TableHead>
                  <TableHead>Store pass</TableHead>
                  <TableHead>Gate pass</TableHead>
                  <TableHead>DC → SP → GP → Out → Delivered</TableHead>
                  <TableHead>Stage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No dispatches match.</TableCell></TableRow>
                ) : filtered.map((r) => {
                  const st = stageMeta(r.stage);
                  const counted = r.gp_counted_packages ?? r.gp_counted_quantity;
                  return (
                    <TableRow key={r.dispatch_id}>
                      <TableCell>
                        <div className="font-mono text-sm font-semibold">{r.dispatch_number}</div>
                        <div className="text-xs text-muted-foreground whitespace-nowrap">
                          {format(new Date(r.dispatch_created_at), "dd MMM HH:mm")}{r.order_numbers ? ` · ${r.order_numbers}` : ""}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm" title={r.customer_name ?? ""}>{r.customer_name ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap text-sm">{fmtQty(r.dc_quantity)} / {Number(r.dc_packages)}</TableCell>
                      <TableCell className="text-sm">
                        {r.store_pass_id ? (
                          <div>
                            <Link to={`/store-pass/passes/${r.store_pass_id}`} className="font-mono text-primary hover:underline">{r.sp_number}</Link>
                            <div className="text-xs text-muted-foreground whitespace-nowrap">
                              {r.sp_status === "issued" && r.sp_issued_at
                                ? `${format(new Date(r.sp_issued_at), "HH:mm")} · ${fmtQty(r.sp_quantity)} / ${Number(r.sp_packages ?? 0)}`
                                : "Draft"}
                            </div>
                          </div>
                        ) : (
                          <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset", r.stage === "no_store_pass" || r.stage === "out" || r.stage === "delivered" || r.stage === "on_gate_pass" || r.stage === "held" ? "bg-red-50 text-red-800 ring-red-200" : "bg-slate-100 text-slate-700 ring-slate-200")}>None</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.gate_pass_id ? (
                          <div>
                            <Link to={`/gate-pass/passes/${r.gate_pass_id}`} className="font-mono text-primary hover:underline">{r.gp_number}</Link>
                            <div className="text-xs text-muted-foreground whitespace-nowrap">
                              {gpStatusMeta(r.gp_status ?? "").label}
                              {counted !== null && counted !== undefined ? ` · counted ${fmtQty(counted)}${r.gp_counted_packages !== null ? " ctn" : " dz"}` : ""}
                            </div>
                          </div>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell><StageStrip r={r} /></TableCell>
                      <TableCell>
                        <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset whitespace-nowrap", st.tone)}>{st.label}</span>
                        {r.stage === "issued" && r.sp_issued_at && (
                          <div className="text-xs text-indigo-700 mt-1 whitespace-nowrap">waiting {hoursBetween(r.sp_issued_at, new Date().toISOString())}</div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
          <div className="flex flex-wrap justify-between gap-2 px-4 py-2 text-xs text-muted-foreground border-t">
            <div>{filtered.length} dispatch(es) · open stages first, whatever their date</div>
            <div>Green = done · red = missing step · amber = held · hollow blue = next step</div>
          </div>
        </Card>
      </div>
    </ERPLayout>
  );
}
