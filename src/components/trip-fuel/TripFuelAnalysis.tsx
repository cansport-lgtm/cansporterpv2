import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import * as XLSX from "xlsx";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CheckCircle2, Download, Fuel, Gauge, Hourglass, Link2, Route as RouteIcon, ThumbsUp } from "lucide-react";

import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ppDb } from "@/lib/personGatePass";
import { FUEL_FILTER_STATUSES, FUEL_KEYS, FUEL_SELECT, FUEL_STATUS_META, fmtKm, fmtRs, isApprovedFuel, type TripFuelVoucher } from "@/lib/tripFuel";
import { PRESETS, STATUS_LABEL, TRIP_FUEL_REF, applyPreset, differenceText, groupReconciliation, useReconciliation } from "@/lib/expenseLinks";
import { fetchAllRows } from "@/lib/accounting/fetchAllRows";

type Scope = "hr" | "accounting";

const LIVE = ["pending_approval", "approved", "paid"];
const monthKey = (d: string) => d.slice(0, 7);
const monthLabel = (k: string) => format(new Date(`${k}-01T00:00:00`), "MMM yyyy");
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtRs(Math.abs(n))}`;

type Agg = { name: string; sub?: string; trips: number; km: number; claimed: number; approved: number };

function aggregate(rows: TripFuelVoucher[], keyOf: (v: TripFuelVoucher) => { key: string; name: string; sub?: string }): Agg[] {
  const map = new Map<string, Agg>();
  rows.forEach((v) => {
    const { key, name, sub } = keyOf(v);
    const a = map.get(key) ?? { name, sub, trips: 0, km: 0, claimed: 0, approved: 0 };
    a.trips += 1;
    a.km += Number(v.km);
    a.claimed += Number(v.amount);
    if (isApprovedFuel(v.status)) a.approved += Number(v.amount);
    map.set(key, a);
  });
  return [...map.values()].sort((a, b) => b.claimed - a.claimed);
}

/**
 * Staff trip fuel analysis, shared by HR and Accounting. HR sees the trips, the
 * kilometres and the money by staff, destination and month. Accounting sees the
 * same plus the comparison with the ledger account the fuel is linked to.
 */
export function TripFuelAnalysis({ scope }: { scope: Scope }) {
  const [preset, setPreset] = useState("this_year");
  const [range, setRange] = useState(() => applyPreset("this_year"));
  const [staff, setStaff] = useState("all");
  const [dept, setDept] = useState("all");
  const [status, setStatus] = useState("live");

  const { data: all = [], isLoading, error } = useQuery<TripFuelVoucher[]>({
    queryKey: [FUEL_KEYS.list, "analysis", range.from, range.to],
    queryFn: () =>
      fetchAllRows<TripFuelVoucher>((from, to) =>
        ppDb
          .from("staff_trip_fuel_vouchers")
          .select(FUEL_SELECT)
          .gte("trip_date", range.from)
          .lte("trip_date", range.to)
          .order("trip_date", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      ),
  });

  const staffOptions = useMemo(() => {
    const m = new Map<string, string>();
    all.forEach((v) => m.set(v.employee_id, `${v.person?.full_name ?? "Unknown"}${v.person?.employee_code ? ` (${v.person.employee_code})` : ""}`));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all]);
  const deptOptions = useMemo(() => [...new Set(all.map((v) => v.person?.production_departments?.name).filter(Boolean) as string[])].sort(), [all]);

  const rows = useMemo(
    () =>
      all.filter(
        (v) =>
          (staff === "all" || v.employee_id === staff) &&
          (dept === "all" || v.person?.production_departments?.name === dept) &&
          (status === "all" ? true : status === "live" ? LIVE.includes(v.status) : status === "approved" ? isApprovedFuel(v.status) : v.status === status),
      ),
    [all, staff, dept, status],
  );
  const live = useMemo(() => rows.filter((v) => LIVE.includes(v.status)), [rows]);

  const kpi = useMemo(() => {
    const sum = (f: (v: TripFuelVoucher) => boolean) => live.filter(f).reduce((s, v) => s + Number(v.amount), 0);
    const km = live.reduce((s, v) => s + Number(v.km), 0);
    const claimed = sum(() => true);
    return {
      trips: live.length,
      km,
      claimed,
      approved: sum((v) => isApprovedFuel(v.status)),
      awaiting: sum((v) => v.status === "pending_approval"),
      awaitingCount: live.filter((v) => v.status === "pending_approval").length,
      avgTrip: live.length ? claimed / live.length : 0,
      perKm: km ? claimed / km : 0,
    };
  }, [live]);

  const monthly = useMemo(() => {
    const map = new Map<string, { key: string; label: string; trips: number; km: number; claimed: number; approved: number }>();
    live.forEach((v) => {
      const k = monthKey(v.trip_date);
      const m = map.get(k) ?? { key: k, label: monthLabel(k), trips: 0, km: 0, claimed: 0, approved: 0 };
      m.trips += 1;
      m.km += Number(v.km);
      m.claimed += Number(v.amount);
      if (isApprovedFuel(v.status)) m.approved += Number(v.amount);
      map.set(k, m);
    });
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [live]);

  const byStaff = useMemo(() => aggregate(live, (v) => ({ key: v.employee_id, name: v.person?.full_name ?? "Unknown", sub: [v.person?.employee_code, v.person?.production_departments?.name].filter(Boolean).join(" · ") })), [live]);
  const byDestination = useMemo(() => aggregate(live, (v) => { const d = (v.destination ?? "").trim() || "Not given"; return { key: d.toLowerCase(), name: d }; }), [live]);

  const chooseDates = (key: string) => { setPreset(key); if (key !== "custom") setRange(applyPreset(key)); };

  // Accounting only: the trip fuel rows of the reconciliation.
  const recon = useReconciliation(range.from, range.to, scope === "accounting");
  const fuelRecon = useMemo(() => (recon.data ?? []).filter((r) => r.source_refs.includes(TRIP_FUEL_REF)), [recon.data]);
  const fuelGroups = useMemo(() => groupReconciliation(fuelRecon), [fuelRecon]);
  const hasLink = fuelRecon.some((r) => r.row_kind === "linked");
  const unlinkedAmount = fuelRecon.filter((r) => r.row_kind === "unlinked").reduce((s, r) => s + r.source_amount, 0);

  const exportXlsx = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map((v) => ({
      Voucher: v.voucher_number,
      "Trip date": v.trip_date,
      Staff: v.person?.full_name ?? "",
      Code: v.person?.employee_code ?? "",
      Department: v.person?.production_departments?.name ?? "",
      "Gate pass": v.pass?.pass_number ?? "",
      Destination: v.destination ?? "",
      Route: v.route ?? "",
      "Start km": v.start_km ?? "",
      "End km": v.end_km ?? "",
      Km: Number(v.km),
      "Rate / km": Number(v.rate_per_km),
      Amount: Number(v.amount),
      Status: FUEL_STATUS_META[v.status]?.label ?? v.status,
      "Approved on": v.approved_at ? format(new Date(v.approved_at), "yyyy-MM-dd") : "",
    }))), "Vouchers");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(monthly.map((m) => ({ Month: m.label, Trips: m.trips, Km: Math.round(m.km * 10) / 10, Claimed: m.claimed, Approved: m.approved }))), "By month");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byStaff.map((a) => ({ Staff: a.name, Detail: a.sub ?? "", Trips: a.trips, Km: Math.round(a.km * 10) / 10, Claimed: a.claimed, Approved: a.approved }))), "By staff");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byDestination.map((a) => ({ Destination: a.name, Trips: a.trips, Km: Math.round(a.km * 10) / 10, Claimed: a.claimed, Approved: a.approved }))), "By destination");
    if (scope === "accounting" && fuelRecon.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(fuelRecon.map((r) => ({
        Account: r.expense_account_code ? `${r.expense_account_code} ${r.expense_account_name}` : "Not linked",
        Month: monthLabel(monthKey(r.month)),
        "Approved vouchers": r.source_amount,
        Ledger: r.gl_amount ?? "",
        Difference: r.difference ?? "",
        Status: STATUS_LABEL[r.status],
      }))), "Ledger check");
    }
    XLSX.writeFile(wb, `staff-trip-fuel-${range.from}-to-${range.to}.xlsx`);
  };

  const totalRow = (list: Agg[]) => ({
    trips: list.reduce((s, a) => s + a.trips, 0),
    km: list.reduce((s, a) => s + a.km, 0),
    claimed: list.reduce((s, a) => s + a.claimed, 0),
    approved: list.reduce((s, a) => s + a.approved, 0),
  });

  const aggTable = (title: string, first: string, list: Agg[]) => {
    const t = totalRow(list);
    return (
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[420px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{first}</TableHead>
                  <TableHead className="text-right">Trips</TableHead>
                  <TableHead className="text-right">Km</TableHead>
                  <TableHead className="text-right">Claimed</TableHead>
                  <TableHead className="text-right">Approved</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No trips</TableCell></TableRow>
                ) : list.map((a) => (
                  <TableRow key={a.name + (a.sub ?? "")}>
                    <TableCell className="font-medium">{a.name}{a.sub && <div className="text-[11px] text-muted-foreground font-normal">{a.sub}</div>}</TableCell>
                    <TableCell className="text-right">{a.trips}</TableCell>
                    <TableCell className="text-right">{fmtKm(a.km)}</TableCell>
                    <TableCell className="text-right">{fmtRs(a.claimed)}</TableCell>
                    <TableCell className="text-right">{fmtRs(a.approved)}</TableCell>
                  </TableRow>
                ))}
                {list.length > 0 && (
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right">{t.trips}</TableCell>
                    <TableCell className="text-right">{fmtKm(t.km)}</TableCell>
                    <TableCell className="text-right">{fmtRs(t.claimed)}</TableCell>
                    <TableCell className="text-right">{fmtRs(t.approved)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <div className="text-xs text-muted-foreground mb-1">Period (trip date)</div>
          <Select value={preset} onValueChange={chooseDates}>
            <SelectTrigger className="w-[150px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>{PRESETS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">From</div>
          <Input type="date" className="h-9 w-40" value={range.from} onChange={(e) => { setPreset("custom"); setRange((r) => ({ ...r, from: e.target.value })); }} />
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">To</div>
          <Input type="date" className="h-9 w-40" value={range.to} onChange={(e) => { setPreset("custom"); setRange((r) => ({ ...r, to: e.target.value })); }} />
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">Staff</div>
          <Select value={staff} onValueChange={setStaff}>
            <SelectTrigger className="w-[210px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All staff</SelectItem>
              {staffOptions.map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">Department</div>
          <Select value={dept} onValueChange={setDept}>
            <SelectTrigger className="w-[170px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {deptOptions.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">Status</div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[190px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="live">Awaiting HR and approved</SelectItem>
              <SelectItem value="all">Everything</SelectItem>
              {FUEL_FILTER_STATUSES.map((k) => <SelectItem key={k} value={k}>{FUEL_STATUS_META[k].label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" className="h-9" disabled={!rows.length} onClick={exportXlsx}><Download className="h-4 w-4 mr-1" /> Excel</Button>
      </div>

      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">Could not load trip fuel: {(error as { message?: string }).message}</div>}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard title="Trips" value={String(kpi.trips)} icon={RouteIcon} description={`${fmtRs(kpi.avgTrip)} per trip`} />
        <MetricCard title="Distance" value={fmtKm(kpi.km)} icon={Gauge} description="travelled" />
        <MetricCard title="Claimed" value={fmtRs(kpi.claimed)} icon={Fuel} description="awaiting HR and approved" />
        <MetricCard title="Approved" value={fmtRs(kpi.approved)} icon={ThumbsUp} description="cash payable by the cashier" />
        <MetricCard title="Awaiting HR" value={fmtRs(kpi.awaiting)} icon={Hourglass} description={`${kpi.awaitingCount} claim${kpi.awaitingCount === 1 ? "" : "s"}`} />
        <MetricCard title="Cost per km" value={kpi.perKm ? `Rs ${kpi.perKm.toFixed(2)}` : "—"} icon={Gauge} description="claimed ÷ km" />
      </div>

      {scope === "accounting" && (
        <Card className={cn(hasLink && fuelGroups.some((g) => g.status === "warning") && "border-amber-300")}>
          <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Ledger check</CardTitle>
            <Button variant="outline" size="sm" asChild><Link to="/accounting/expense-links"><Link2 className="h-4 w-4 mr-1" /> Account links</Link></Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {recon.isLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : !hasLink ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex gap-2">
                <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" />
                <div>Staff trip fuel is not linked to an expense account{unlinkedAmount ? `, and ${fmtRs(unlinkedAmount)} was approved in this period` : ""}. <Link className="underline" to="/accounting/expense-links">Link it</Link> to check it against the ledger.</div>
              </div>
            ) : fuelGroups.filter((g) => g.kind === "linked").map((g) => (
              <div key={g.key} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <b>{g.accountCode} · {g.accountName}</b>
                  {g.fundingCode && <span className="text-muted-foreground">against {g.fundingCode}</span>}
                  <Badge variant={g.status === "warning" ? "warning" : "success"} className="gap-1">
                    {g.status === "warning" ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                    {g.status === "warning" ? `${g.warningMonths} month${g.warningMonths > 1 ? "s" : ""} off` : "Matched"}
                  </Badge>
                  {g.labels.length > 1 && <span className="text-xs text-muted-foreground">compared together with {g.labels.filter((l) => l !== "Staff Trip Fuel").join(", ")}</span>}
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Month</TableHead>
                      <TableHead className="text-right">Approved vouchers{g.labels.length > 1 ? " + others" : ""}</TableHead>
                      <TableHead className="text-right">Ledger</TableHead>
                      <TableHead className="text-right">Difference</TableHead>
                      <TableHead>What it means</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.months.map((m) => (
                      <TableRow key={m.month}>
                        <TableCell>{monthLabel(monthKey(m.month))}</TableCell>
                        <TableCell className="text-right">{fmtRs(m.source_amount)}</TableCell>
                        <TableCell className="text-right">{fmtRs(m.gl_amount)}</TableCell>
                        <TableCell className={cn("text-right", m.status === "warning" && "text-amber-700 font-medium")}>{signed(m.difference ?? 0)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{m.status === "matched" ? "Matched" : differenceText(m.difference, m.tolerance)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              The ledger check counts approved vouchers by the day HR approved them, and only from the compare-from date of the link. The tables on this page are by trip date.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Month by month</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[300px]">
            {isLoading ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Loading…</div>
            ) : monthly.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No trip fuel in this period</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="rs" tick={{ fontSize: 11 }} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))} />
                  <YAxis yAxisId="km" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value: number, name) => [name === "Km" ? fmtKm(value) : fmtRs(value), name]} />
                  <Legend />
                  <Bar yAxisId="rs" dataKey="claimed" name="Claimed" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
                  <Bar yAxisId="rs" dataKey="approved" name="Approved" fill="#10b981" radius={[2, 2, 0, 0]} />
                  <Line yAxisId="km" type="monotone" dataKey="km" name="Km" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {aggTable("By staff", "Staff", byStaff)}
        {aggTable("By destination", "Destination", byDestination)}
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Monthly summary</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Trips</TableHead>
                  <TableHead className="text-right">Km</TableHead>
                  <TableHead className="text-right">Claimed</TableHead>
                  <TableHead className="text-right">Approved</TableHead>
                  <TableHead className="text-right">Awaiting HR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthly.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No trips</TableCell></TableRow>
                ) : monthly.map((m) => (
                  <TableRow key={m.key}>
                    <TableCell className="font-medium">{m.label}</TableCell>
                    <TableCell className="text-right">{m.trips}</TableCell>
                    <TableCell className="text-right">{fmtKm(m.km)}</TableCell>
                    <TableCell className="text-right">{fmtRs(m.claimed)}</TableCell>
                    <TableCell className="text-right">{fmtRs(m.approved)}</TableCell>
                    <TableCell className="text-right">{fmtRs(m.claimed - m.approved)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Claimed counts vouchers that are awaiting approval or approved. Rejected and cancelled vouchers are left out unless the status filter asks for them.
        {scope === "hr" && " The accounting side of this fuel is checked in the Accounting module."}
      </p>
    </div>
  );
}
