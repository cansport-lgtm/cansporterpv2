import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { format, startOfMonth } from "date-fns";
import { Briefcase, DoorOpen, Download, Plus, Search } from "lucide-react";
import * as XLSX from "xlsx";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { OutsideNowPanel, PersonGatePassCards, PersonRescanAlerts } from "@/components/person-gate-pass/PersonGatePassCards";
import {
  STATUS_META, fmtTime, hasAnyRole, isOfficialDuty, marksHalfDay, minutesOutside, overdueMinutes, passKeys, passKindMeta, passKinds,
  personSelect, ppDb, statusMeta, todayPk, useMyEmployee, type PersonGatePass, type PersonPassVariant,
} from "@/lib/personGatePass";

type Row = Pick<PersonGatePass,
  "id" | "pass_number" | "pass_kind" | "status" | "pass_date" | "reason" | "destination" | "expected_minutes" | "gate_out_at" |
  "expected_back_at" | "gate_in_at" | "minutes_outside" | "half_day_rows" | "created_at" | "employee_id" | "person" | "creator">;

const timeline = (r: Row) => {
  if (r.status === "out") {
    const late = overdueMinutes(r);
    if (r.pass_kind === "half_day") return `Out ${fmtTime(r.gate_out_at)}`;
    return late > 0 ? `Out ${fmtTime(r.gate_out_at)} · ${late} min overdue` : `Out ${fmtTime(r.gate_out_at)} · due ${fmtTime(r.expected_back_at)}`;
  }
  if (r.status === "returned") return `Out ${fmtTime(r.gate_out_at)} → In ${fmtTime(r.gate_in_at)} · ${r.minutes_outside ?? 0} min`;
  if (r.status === "not_returned") return `Out ${fmtTime(r.gate_out_at)} · never scanned in`;
  return "";
};

const fmtHours = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`);

/** Register of worker or staff gate passes with the summary cards, filters and the company work summary. */
export function PersonGatePassListPage({ variant }: { variant: PersonPassVariant }) {
  const navigate = useNavigate();
  const { user, roles } = useAuth();
  const [params] = useSearchParams();
  const self = Boolean(variant.selfService);
  const { data: me, isLoading: meLoading } = useMyEmployee(self ? user?.id : null);
  const canApply = self ? Boolean(me) : hasAnyRole(roles, variant.applyRoles);
  const today = todayPk();
  const [fromDate, setFromDate] = useState(params.get("from") ?? (self ? format(startOfMonth(new Date()), "yyyy-MM-dd") : today));
  const [toDate, setToDate] = useState(params.get("to") ?? today);
  const [kindFilter, setKindFilter] = useState(params.get("kind") ?? "all");
  const [statusFilter, setStatusFilter] = useState(params.get("status") ?? "all");
  const [search, setSearch] = useState("");
  const kinds = passKinds(variant);
  const hasOfficial = variant.kinds.includes("official_duty");

  const listSelect =
    "id, pass_number, pass_kind, status, pass_date, reason, expected_minutes, gate_out_at, expected_back_at, gate_in_at, minutes_outside, half_day_rows, created_at, employee_id," +
    (variant.key === "staff" ? "destination," : "") +
    `${personSelect(variant, false)},` +
    `creator:app_users!${variant.table}_created_by_fkey(full_name)`;

  const { data: rows = [], isLoading } = useQuery<Row[]>({
    queryKey: [passKeys(variant).list, fromDate, toDate, self ? me?.id ?? "none" : "all"],
    enabled: !self || Boolean(me),
    queryFn: async () => {
      let q = ppDb
        .from(variant.table)
        .select(listSelect)
        .gte("pass_date", fromDate)
        .lte("pass_date", toDate);
      if (self && me) q = q.eq("employee_id", me.id);
      const { data, error } = await q
        .order("pass_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []).map((r: Row) => ({ destination: null, ...r }));
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (kindFilter !== "all" && r.pass_kind !== kindFilter) return false;
      if (statusFilter === "half_days") {
        if (!marksHalfDay(r)) return false;
      } else if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!q) return true;
      return [r.pass_number, r.person?.employee_code, r.person?.full_name, r.reason, r.destination, r.creator?.full_name]
        .some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [rows, kindFilter, statusFilter, search]);

  const totals = useMemo(() => {
    const used = (r: Row) => ["out", "returned", "not_returned"].includes(r.status);
    return {
      halfDays: filtered.filter(marksHalfDay).length,
      shortLeaves: filtered.filter((r) => r.pass_kind === "short_leave" && used(r)).length,
      shortMinutes: filtered.filter((r) => r.pass_kind === "short_leave").reduce((s, r) => s + Number(r.minutes_outside ?? 0), 0),
      official: filtered.filter((r) => isOfficialDuty(r.pass_kind) && used(r)).length,
      officialMinutes: filtered.filter((r) => isOfficialDuty(r.pass_kind) && used(r)).reduce((s, r) => s + minutesOutside(r), 0),
    };
  }, [filtered]);

  // Company work summary per person for the selected dates (official duty passes that went out).
  const officialSummary = useMemo(() => {
    const map = new Map<string, { code: string; name: string; dept: string; trips: number; minutes: number; notScannedIn: number; stillOut: number; destinations: Set<string> }>();
    rows.forEach((r) => {
      if (!isOfficialDuty(r.pass_kind) || !["out", "returned", "not_returned"].includes(r.status)) return;
      const key = r.employee_id;
      const e = map.get(key) ?? { code: r.person?.employee_code ?? "", name: r.person?.full_name ?? "", dept: r.person?.production_departments?.name ?? "", trips: 0, minutes: 0, notScannedIn: 0, stillOut: 0, destinations: new Set<string>() };
      e.trips += 1;
      e.minutes += minutesOutside(r);
      if (r.status === "not_returned") e.notScannedIn += 1;
      if (r.status === "out") e.stillOut += 1;
      if (r.destination) e.destinations.add(r.destination);
      map.set(key, e);
    });
    return [...map.values()].sort((a, b) => b.minutes - a.minutes);
  }, [rows]);

  const exportSummary = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(officialSummary.map((e) => ({
      Code: e.code, Name: e.name, Department: e.dept, Trips: e.trips, "Minutes outside": e.minutes, "Hours outside": Math.round((e.minutes / 60) * 100) / 100,
      "Not scanned in": e.notScannedIn, "Still out": e.stillOut, Destinations: [...e.destinations].join("; "),
    }))), "Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.filter((r) => isOfficialDuty(r.pass_kind)).map((r) => ({
      Pass: r.pass_number, Date: r.pass_date, Code: r.person?.employee_code ?? "", Name: r.person?.full_name ?? "", Department: r.person?.production_departments?.name ?? "",
      Destination: r.destination ?? "", Purpose: r.reason, Status: statusMeta(r.status, r.pass_kind).label,
      Out: r.gate_out_at ? format(new Date(r.gate_out_at), "dd MMM yyyy HH:mm") : "", In: r.gate_in_at ? format(new Date(r.gate_in_at), "dd MMM yyyy HH:mm") : "",
      "Minutes outside": minutesOutside(r), "Raised by": r.creator?.full_name ?? "",
    }))), "Trips");
    XLSX.writeFile(wb, `company-work-${fromDate}-to-${toDate}.xlsx`);
  };

  const idp = `${variant.prefix.toLowerCase()}-`;

  if (self && !meLoading && !me) {
    return (
      <ERPLayout>
        <div className="w-full max-w-2xl space-y-4">
          <PageHeader title={variant.listTitle} description={variant.listDescription} icon={DoorOpen} iconColor={variant.iconColor} />
          <Card><CardContent className="p-6 text-center text-muted-foreground">
            Your login is not linked to a staff record yet, so there is nothing to show here. Ask HR to link your login on the Employees page; after that you can raise company work passes for yourself.
          </CardContent></Card>
        </div>
      </ERPLayout>
    );
  }

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title={variant.listTitle}
          description={variant.listDescription}
          icon={DoorOpen}
          iconColor={variant.iconColor}
          action={canApply ? { label: self ? "Go out on company work" : "New Gate Pass", onClick: () => navigate(`${variant.basePath}/new`), icon: Plus } : undefined}
        />

        {!self && (
          <>
            <PersonGatePassCards variant={variant} />
            <PersonRescanAlerts variant={variant} />
            <OutsideNowPanel variant={variant} />
          </>
        )}

        <Card>
          <CardContent className="p-3 sm:p-4 grid grid-cols-2 md:grid-cols-6 gap-3">
            <div>
              <Label htmlFor={`${idp}from`} className="text-xs">From</Label>
              <Input id={`${idp}from`} type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor={`${idp}to`} className="text-xs">To</Label>
              <Input id={`${idp}to`} type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Kind</Label>
              <Select value={kindFilter} onValueChange={setKindFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All kinds</SelectItem>
                  {kinds.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {!self && <SelectItem value="half_days">Marked half day</SelectItem>}
                  {Object.entries(STATUS_META).map(([v, m]) => <SelectItem key={v} value={v}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label htmlFor={`${idp}search`} className="text-xs">Search</Label>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input id={`${idp}search`} className="pl-8" placeholder={self ? "Pass no., destination, purpose" : `Pass no., ${variant.noun} code, name, reason${hasOfficial ? ", destination" : ""}`} value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 text-xs text-muted-foreground border-b">
              <span><b className="text-foreground">{filtered.length}</b> passes</span>
              {!self && <span><b className="text-foreground">{totals.halfDays}</b> half days</span>}
              {!self && <span><b className="text-foreground">{totals.shortLeaves}</b> short leaves · <b className="text-foreground">{totals.shortMinutes}</b> min outside</span>}
              {hasOfficial && <span><b className="text-foreground">{totals.official}</b> company work trips · <b className="text-foreground">{fmtHours(totals.officialMinutes)}</b> outside</span>}
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pass</TableHead>
                    <TableHead>Date</TableHead>
                    {!self && <TableHead>{variant.label}</TableHead>}
                    <TableHead>Kind</TableHead>
                    <TableHead>{hasOfficial ? "Reason / destination" : "Reason"}</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Gate</TableHead>
                    {!self && <TableHead>Applied by</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading || (self && meLoading) ? (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No {self ? "" : `${variant.noun} `}gate passes for this filter.</TableCell></TableRow>
                  ) : filtered.map((r) => {
                    const late = overdueMinutes(r);
                    const official = isOfficialDuty(r.pass_kind);
                    const status = statusMeta(r.status, r.pass_kind);
                    return (
                      <TableRow key={r.id} className={cn("cursor-pointer", late > 0 && !official && "bg-red-50/60")} onClick={() => navigate(`${variant.basePath}/${r.id}`)}>
                        <TableCell className="font-mono font-semibold">
                          <Link to={`${variant.basePath}/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.pass_number}</Link>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{format(new Date(r.pass_date), "dd MMM")}</TableCell>
                        {!self && (
                          <TableCell>
                            <div className="font-medium">{r.person?.full_name}</div>
                            <div className="text-xs text-muted-foreground">{r.person?.employee_code}{r.person?.production_departments?.name ? ` · ${r.person.production_departments.name}` : ""}</div>
                          </TableCell>
                        )}
                        <TableCell>
                          <span className={cn("text-xs font-semibold rounded-full px-2 py-0.5 ring-1 ring-inset whitespace-nowrap", passKindMeta(r.pass_kind).badgeClass)}>
                            {passKindMeta(r.pass_kind).label}{r.pass_kind !== "half_day" && r.expected_minutes ? ` · ${r.expected_minutes} min` : ""}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[260px]" title={r.reason}>
                          {r.destination && <div className="font-medium truncate">{r.destination}</div>}
                          <div className={cn("truncate", r.destination && "text-xs text-muted-foreground")}>{r.reason}</div>
                        </TableCell>
                        <TableCell><Badge variant={status.variant}>{status.label}</Badge></TableCell>
                        <TableCell className={cn("text-xs whitespace-nowrap", late > 0 && (official ? "text-amber-700 font-semibold" : "text-red-700 font-semibold"))}>{timeline(r)}</TableCell>
                        {!self && <TableCell className="text-xs text-muted-foreground">{r.creator?.full_name ?? ""}</TableCell>}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {hasOfficial && !self && officialSummary.length > 0 && (
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base flex items-center gap-2">
                <Briefcase className="h-4 w-4" /> Company work · {format(new Date(fromDate), "dd MMM")} – {format(new Date(toDate), "dd MMM yyyy")}
              </CardTitle>
              <Button variant="outline" size="sm" onClick={exportSummary}><Download className="h-4 w-4 mr-1" /> Export Excel</Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 text-xs text-muted-foreground border-b">
                <span><b className="text-foreground">{officialSummary.length}</b> {variant.noun}s</span>
                <span><b className="text-foreground">{officialSummary.reduce((s, e) => s + e.trips, 0)}</b> trips</span>
                <span><b className="text-foreground">{fmtHours(officialSummary.reduce((s, e) => s + e.minutes, 0))}</b> outside in total</span>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Staff</TableHead>
                      <TableHead className="text-right">Trips</TableHead>
                      <TableHead className="text-right">Time outside</TableHead>
                      <TableHead className="text-right">Not scanned in</TableHead>
                      <TableHead>Destinations</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {officialSummary.map((e) => (
                      <TableRow key={e.code + e.name}>
                        <TableCell>
                          <div className="font-medium">{e.name}</div>
                          <div className="text-xs text-muted-foreground">{e.code}{e.dept ? ` · ${e.dept}` : ""}</div>
                        </TableCell>
                        <TableCell className="text-right">{e.trips}{e.stillOut ? <span className="text-xs text-muted-foreground"> ({e.stillOut} out now)</span> : null}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">{fmtHours(e.minutes)}</TableCell>
                        <TableCell className={cn("text-right", e.notScannedIn && "text-amber-700 font-semibold")}>{e.notScannedIn || ""}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[320px] truncate" title={[...e.destinations].join(", ")}>{[...e.destinations].join(", ")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ERPLayout>
  );
}
