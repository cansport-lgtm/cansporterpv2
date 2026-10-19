import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format, startOfMonth } from "date-fns";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Download, Search, Users } from "lucide-react";
import * as XLSX from "xlsx";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  WORKER_PASS, fmtTime, marksAbsent, marksHalfDay, minutesOutside, passKeys, passKindMeta, passKinds, personSelect, ppDb,
  statusMeta, todayPk, type PersonGatePass,
} from "@/lib/personGatePass";

type Row = Pick<PersonGatePass,
  "id" | "pass_number" | "pass_kind" | "status" | "pass_date" | "reason" | "expected_minutes" | "gate_out_at" |
  "expected_back_at" | "gate_in_at" | "minutes_outside" | "created_at" | "employee_id" | "person" | "attendance_effect">;

type Worker = {
  id: string;
  code: string;
  name: string;
  dept: string;
  category: string;
  total: number;
  halfDays: number;
  absents: number;
  shortLeaves: number;
  official: number;
  minutes: number;
  pending: number;
  rejected: number;
  outNow: boolean;
  lastDate: string;
  passes: Row[];
};

type SortKey = "name" | "total" | "halfDays" | "shortLeaves" | "official" | "minutes" | "pending" | "rejected" | "lastDate";

const variant = WORKER_PASS;
const CLOSED = ["rejected", "cancelled", "expired"];
const USED = ["out", "returned", "not_returned"];

const gateText = (r: Row) => {
  if (r.status === "out") return r.pass_kind === "half_day" ? `Out ${fmtTime(r.gate_out_at)}` : `Out ${fmtTime(r.gate_out_at)} · due ${fmtTime(r.expected_back_at)}`;
  if (r.status === "returned") return `Out ${fmtTime(r.gate_out_at)} → In ${fmtTime(r.gate_in_at)} · ${r.minutes_outside ?? 0} min`;
  if (r.status === "not_returned") return `Out ${fmtTime(r.gate_out_at)} · never scanned in`;
  return "";
};

const fmtMinutes = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`);

/** Worker-wise view of the worker gate passes (LGP-…): who had passes in the dates, how many and of what kind. */
export default function LabourGatePassWorkersPage() {
  const today = todayPk();
  const [fromDate, setFromDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(today);
  const [deptFilter, setDeptFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "total", desc: true });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const kinds = passKinds(variant);

  const listSelect =
    "id, pass_number, pass_kind, status, pass_date, reason, expected_minutes, gate_out_at, expected_back_at, gate_in_at, minutes_outside, created_at, employee_id, attendance_effect," +
    personSelect(variant);

  const { data: rows = [], isLoading } = useQuery<Row[]>({
    queryKey: [passKeys(variant).list, "workers", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await ppDb
        .from(variant.table)
        .select(listSelect)
        .gte("pass_date", fromDate)
        .lte("pass_date", toDate)
        .order("pass_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const departments = useMemo(
    () => [...new Set(rows.map((r) => r.person?.production_departments?.name).filter(Boolean) as string[])].sort(),
    [rows],
  );

  const workers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, Worker>();
    rows.forEach((r) => {
      if (kindFilter !== "all" && r.pass_kind !== kindFilter) return;
      const dept = r.person?.production_departments?.name ?? "";
      if (deptFilter !== "all" && dept !== deptFilter) return;
      if (q && ![r.person?.employee_code, r.person?.full_name].some((v) => (v ?? "").toLowerCase().includes(q))) return;
      const w = map.get(r.employee_id) ?? {
        id: r.employee_id, code: r.person?.employee_code ?? "", name: r.person?.full_name ?? "", dept, category: variant.personSubline(r.person ?? null),
        total: 0, halfDays: 0, absents: 0, shortLeaves: 0, official: 0, minutes: 0, pending: 0, rejected: 0, outNow: false, lastDate: r.pass_date, passes: [],
      };
      w.total += 1;
      w.passes.push(r);
      if (r.pass_date > w.lastDate) w.lastDate = r.pass_date;
      if (r.status === "pending_approval") w.pending += 1;
      if (r.status === "rejected" || r.status === "cancelled") w.rejected += 1;
      if (r.status === "out") w.outNow = true;
      if (!CLOSED.includes(r.status)) {
        if (r.pass_kind === "half_day") w.halfDays += 1;
        if (r.pass_kind === "short_leave") w.shortLeaves += 1;
        if (r.pass_kind === "official_duty") w.official += 1;
      }
      if (r.pass_kind === "short_leave" && marksHalfDay(r)) w.halfDays += 1;
      if (marksAbsent(r)) w.absents += 1;
      if (r.pass_kind === "short_leave" && USED.includes(r.status)) w.minutes += minutesOutside(r);
      map.set(r.employee_id, w);
    });
    const list = [...map.values()];
    const dir = sort.desc ? -1 : 1;
    list.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      const c = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return c * dir || a.name.localeCompare(b.name);
    });
    return list;
  }, [rows, kindFilter, deptFilter, search, sort]);

  const totals = useMemo(() => ({
    workers: workers.length,
    passes: workers.reduce((s, w) => s + w.total, 0),
    halfDays: workers.reduce((s, w) => s + w.halfDays, 0),
    absents: workers.reduce((s, w) => s + w.absents, 0),
    shortLeaves: workers.reduce((s, w) => s + w.shortLeaves, 0),
    minutes: workers.reduce((s, w) => s + w.minutes, 0),
    pending: workers.reduce((s, w) => s + w.pending, 0),
    outNow: workers.filter((w) => w.outNow).length,
  }), [workers]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" }));

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(workers.map((w) => ({
      Code: w.code, Name: w.name, Department: w.dept, Category: w.category, "Total passes": w.total, "Half days": w.halfDays, Absent: w.absents,
      "Short leaves": w.shortLeaves, "Company work": w.official, "Short leave minutes outside": w.minutes, Pending: w.pending,
      "Rejected / cancelled": w.rejected, "Out now": w.outNow ? "Yes" : "", "Last pass": w.lastDate,
    }))), "Workers");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(workers.flatMap((w) => w.passes.map((r) => ({
      Code: w.code, Name: w.name, Department: w.dept, Pass: r.pass_number, Date: r.pass_date, Kind: passKindMeta(r.pass_kind).label,
      Reason: r.reason, Status: statusMeta(r.status, r.pass_kind).label,
      Out: r.gate_out_at ? format(new Date(r.gate_out_at), "dd MMM yyyy HH:mm") : "", In: r.gate_in_at ? format(new Date(r.gate_in_at), "dd MMM yyyy HH:mm") : "",
      "Minutes outside": minutesOutside(r),
    })))), "Passes");
    XLSX.writeFile(wb, `workers-gate-passes-${fromDate}-to-${toDate}.xlsx`);
  };

  const SortHead = ({ k, label, right }: { k: SortKey; label: string; right?: boolean }) => (
    <TableHead className={cn(right && "text-right")}>
      <button type="button" onClick={() => sortBy(k)} className={cn("inline-flex items-center gap-1 hover:text-foreground", sort.key === k && "text-foreground font-semibold")}>
        {label}
        {sort.key === k && (sort.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </TableHead>
  );

  const tile = (label: string, value: ReactNode, cls = "") => (
    <Card className={cls}><CardContent className="p-3 sm:p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </CardContent></Card>
  );

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title="Workers with Gate Passes"
          description="Every worker who had a gate pass in the selected dates, with their pass history"
          icon={Users}
          iconColor={variant.iconColor}
        />

        <Card>
          <CardContent className="p-3 sm:p-4 grid grid-cols-2 md:grid-cols-6 gap-3">
            <div>
              <Label htmlFor="lgpw-from" className="text-xs">From</Label>
              <Input id="lgpw-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="lgpw-to" className="text-xs">To</Label>
              <Input id="lgpw-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Department</Label>
              <Select value={deptFilter} onValueChange={setDeptFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All departments</SelectItem>
                  {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Pass kind</Label>
              <Select value={kindFilter} onValueChange={setKindFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All kinds</SelectItem>
                  {kinds.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label htmlFor="lgpw-search" className="text-xs">Search</Label>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input id="lgpw-search" className="pl-8" placeholder="Worker code or name" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {tile("Workers with passes", totals.workers)}
          {tile("Total passes", totals.passes)}
          {tile("Half days", <>{totals.halfDays}{totals.absents ? <span className="text-sm font-medium text-red-700"> · {totals.absents} absent</span> : null}</>, "border-amber-200 bg-amber-50/60")}
          {tile("Short leaves", <>{totals.shortLeaves} <span className="text-sm font-medium text-muted-foreground">· {fmtMinutes(totals.minutes)} out</span></>, "border-sky-200 bg-sky-50/60")}
          {tile("Pending approval", totals.pending)}
          {tile("Out right now", totals.outNow, "border-red-200 bg-red-50/60")}
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b">
              <span className="text-xs text-muted-foreground">Click a worker to see their passes · click a column to sort</span>
              <Button variant="outline" size="sm" onClick={exportExcel} disabled={workers.length === 0}>
                <Download className="h-4 w-4 mr-1" /> Export Excel
              </Button>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHead k="name" label="Worker" />
                    <SortHead k="total" label="Total" right />
                    <SortHead k="halfDays" label="Half days" right />
                    <SortHead k="shortLeaves" label="Short leaves" right />
                    <SortHead k="official" label="Company work" right />
                    <SortHead k="minutes" label="Min outside" right />
                    <SortHead k="pending" label="Pending" right />
                    <SortHead k="rejected" label="Rejected / cancelled" right />
                    <TableHead>Now</TableHead>
                    <SortHead k="lastDate" label="Last pass" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                  ) : workers.length === 0 ? (
                    <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">No workers had gate passes for this filter.</TableCell></TableRow>
                  ) : workers.map((w) => {
                    const isOpen = open.has(w.id);
                    return (
                      <Fragment key={w.id}>
                        <TableRow className={cn("cursor-pointer", isOpen && "bg-muted/40")} onClick={() => toggle(w.id)}>
                          <TableCell>
                            <button type="button" aria-expanded={isOpen} onClick={(e) => { e.stopPropagation(); toggle(w.id); }} className="flex items-center gap-2 text-left">
                              {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                              <span>
                                <span className="block font-medium">{w.name}</span>
                                <span className="block text-xs text-muted-foreground">{w.code}{w.dept ? ` · ${w.dept}` : ""}{w.category ? ` · ${w.category}` : ""}</span>
                              </span>
                            </button>
                          </TableCell>
                          <TableCell className="text-right font-bold">{w.total}</TableCell>
                          <TableCell className="text-right text-amber-800">{w.halfDays || ""}{w.absents ? <span className="text-xs text-red-700"> +{w.absents} absent</span> : null}</TableCell>
                          <TableCell className="text-right text-sky-800">{w.shortLeaves || ""}</TableCell>
                          <TableCell className="text-right text-indigo-700">{w.official || ""}</TableCell>
                          <TableCell className="text-right whitespace-nowrap">{w.minutes ? fmtMinutes(w.minutes) : ""}</TableCell>
                          <TableCell className={cn("text-right", w.pending && "text-amber-700 font-semibold")}>{w.pending || ""}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{w.rejected || ""}</TableCell>
                          <TableCell>{w.outNow && <Badge variant="destructive" className="whitespace-nowrap">Out now</Badge>}</TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{format(new Date(w.lastDate), "dd MMM")}</TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow className="bg-muted/20 hover:bg-muted/20">
                            <TableCell colSpan={10} className="pl-10 pr-4 pt-1 pb-3">
                              <div className="rounded-md border bg-background overflow-x-auto">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Pass</TableHead>
                                      <TableHead>Date</TableHead>
                                      <TableHead>Kind</TableHead>
                                      <TableHead>Reason</TableHead>
                                      <TableHead>Status</TableHead>
                                      <TableHead>Gate</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {w.passes.map((r) => {
                                      const status = statusMeta(r.status, r.pass_kind);
                                      return (
                                        <TableRow key={r.id}>
                                          <TableCell className="font-mono font-semibold">
                                            <Link to={`${variant.basePath}/${r.id}`} className="text-primary hover:underline">{r.pass_number}</Link>
                                          </TableCell>
                                          <TableCell className="whitespace-nowrap">{format(new Date(r.pass_date), "dd MMM")}</TableCell>
                                          <TableCell>
                                            <span className={cn("text-xs font-semibold rounded-full px-2 py-0.5 ring-1 ring-inset whitespace-nowrap", passKindMeta(r.pass_kind).badgeClass)}>
                                              {passKindMeta(r.pass_kind).label}{r.pass_kind !== "half_day" && r.expected_minutes ? ` · ${r.expected_minutes} min` : ""}
                                            </span>
                                          </TableCell>
                                          <TableCell className="max-w-[280px] truncate" title={r.reason}>{r.reason}</TableCell>
                                          <TableCell>
                                            <Badge variant={status.variant}>{status.label}</Badge>
                                            {marksAbsent(r) ? <span className="ml-1 text-xs font-semibold text-red-700">ABSENT</span> : r.pass_kind === "short_leave" && marksHalfDay(r) ? <span className="ml-1 text-xs font-semibold text-amber-700">½ day</span> : null}
                                          </TableCell>
                                          <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{gateText(r)}</TableCell>
                                        </TableRow>
                                      );
                                    })}
                                  </TableBody>
                                </Table>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
