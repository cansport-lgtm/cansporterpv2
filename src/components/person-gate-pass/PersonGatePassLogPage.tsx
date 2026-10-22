import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Download, History, Search } from "lucide-react";
import * as XLSX from "xlsx";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  EVENT_LABEL, eventLabel, passKeys, passKindMeta, passKinds, ppDb, todayPk, type PersonPassVariant,
} from "@/lib/personGatePass";

type LogRow = {
  id: string;
  event: string;
  message: string | null;
  created_at: string;
  actor: { full_name: string | null } | null;
  pass: {
    id: string;
    pass_number: string;
    pass_kind: string;
    pass_date: string;
    person: { employee_code: string; full_name: string; production_departments?: { name: string } | null } | null;
  } | null;
};

/** Event groups offered as quick filters, besides each single event. */
const GROUPS: Record<string, { label: string; events: string[] }> = {
  decisions: { label: "Approvals, rejections, cancellations", events: ["approved", "rejected", "cancelled"] },
  gate: { label: "Gate scans", events: ["out", "in", "rescan_attempt"] },
  exceptions: {
    label: "Exceptions",
    events: ["overdue", "threshold", "half_day_marked", "absent_marked", "half_day_removed", "not_returned", "expired", "rescan_attempt"],
  },
};

const PAGE = 500;

const EXCEPTION_EVENTS = new Set(GROUPS.exceptions.events);

/** Who did it; events written by the five-minute tick carry no user. */
const actorName = (r: LogRow) => r.actor?.full_name ?? "System";

/** Every event on every worker or staff pass, newest first: the approvers' log. */
export function PersonGatePassLogPage({ variant }: { variant: PersonPassVariant }) {
  const today = todayPk();
  const [fromDate, setFromDate] = useState(`${today.slice(0, 8)}01`);
  const [toDate, setToDate] = useState(today);
  const [eventFilter, setEventFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [actorFilter, setActorFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const kinds = passKinds(variant);

  // A new filter starts again from the first page.
  useEffect(() => setLimit(PAGE), [fromDate, toDate, eventFilter, kindFilter]);

  const events = eventFilter === "all" ? null : GROUPS[eventFilter]?.events ?? [eventFilter];

  const { data: rows = [], isLoading, isFetching } = useQuery<LogRow[]>({
    queryKey: [passKeys(variant).log, fromDate, toDate, eventFilter, kindFilter, limit],
    enabled: Boolean(fromDate && toDate),
    queryFn: async () => {
      let q = ppDb
        .from(variant.eventsTable)
        .select(
          "id, event, message, created_at," +
          `actor:app_users!${variant.eventsTable}_created_by_fkey(full_name),` +
          `pass:${variant.table}!inner(id, pass_number, pass_kind, pass_date, person:${variant.employeeTable}(employee_code, full_name, production_departments(name)))`,
        )
        // Days are the factory's (Asia/Karachi, UTC+5 all year).
        .gte("created_at", `${fromDate}T00:00:00+05:00`)
        .lte("created_at", `${toDate}T23:59:59.999+05:00`);
      if (events) q = q.in("event", events);
      if (kindFilter !== "all") q = q.eq("pass.pass_kind", kindFilter);
      const { data, error } = await q.order("created_at", { ascending: false }).range(0, limit - 1);
      if (error) throw error;
      return data ?? [];
    },
  });

  const hasMore = rows.length === limit;

  const actors = useMemo(
    () => [...new Set(rows.map(actorName))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (actorFilter !== "all" && actorName(r) !== actorFilter) return false;
      if (!q) return true;
      return [r.pass?.pass_number, r.pass?.person?.employee_code, r.pass?.person?.full_name, r.message, actorName(r)]
        .some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [rows, actorFilter, search]);

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filtered.map((r) => ({
      Time: format(new Date(r.created_at), "dd MMM yyyy HH:mm"),
      Pass: r.pass?.pass_number ?? "",
      "Pass date": r.pass?.pass_date ?? "",
      Code: r.pass?.person?.employee_code ?? "",
      Name: r.pass?.person?.full_name ?? "",
      Department: r.pass?.person?.production_departments?.name ?? "",
      Kind: r.pass ? passKindMeta(r.pass.pass_kind).label : "",
      Event: eventLabel(r.event),
      Details: r.message ?? "",
      By: actorName(r),
    }))), "Log");
    XLSX.writeFile(wb, `${variant.key}-gate-pass-log-${fromDate}-to-${toDate}.xlsx`);
  };

  const idp = `${variant.prefix.toLowerCase()}-log-`;

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title={`${variant.label} Gate Pass Log`}
          description={`Everything that happened on every ${variant.noun} gate pass: applied, approved, rejected, cancelled, gate scans, late backs, half days and absents, old passes scanned again`}
          icon={History}
          iconColor={variant.iconColor}
        />

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
              <Label className="text-xs">Event</Label>
              <Select value={eventFilter} onValueChange={setEventFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All events</SelectItem>
                  {Object.entries(GROUPS).map(([v, g]) => <SelectItem key={v} value={v}>{g.label}</SelectItem>)}
                  {Object.entries(EVENT_LABEL).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
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
              <Label className="text-xs">Done by</Label>
              <Select value={actorFilter} onValueChange={setActorFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Anyone</SelectItem>
                  {actors.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor={`${idp}search`} className="text-xs">Search</Label>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input id={`${idp}search`} className="pl-8" placeholder={`Pass no., ${variant.noun} code, name`} value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs text-muted-foreground border-b">
              <span>
                <b className="text-foreground">{filtered.length}</b> events
                {hasMore && " · more are older, use Load more or narrow the dates"}
              </span>
              <Button variant="outline" size="sm" disabled={filtered.length === 0} onClick={exportExcel}>
                <Download className="h-4 w-4 mr-1" /> Export Excel
              </Button>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Pass</TableHead>
                    <TableHead>{variant.label}</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No events for this filter.</TableCell></TableRow>
                  ) : filtered.map((r) => {
                    const kind = r.pass ? passKindMeta(r.pass.pass_kind) : null;
                    return (
                      <TableRow key={r.id} className={cn(r.event === "rescan_attempt" && "bg-red-50/60")}>
                        <TableCell className="text-xs whitespace-nowrap">{format(new Date(r.created_at), "dd MMM yyyy, HH:mm")}</TableCell>
                        <TableCell className="font-mono font-semibold whitespace-nowrap">
                          {r.pass && <Link to={`${variant.basePath}/${r.pass.id}`} className="hover:underline">{r.pass.pass_number}</Link>}
                          {r.pass && <div className="text-xs font-sans font-normal text-muted-foreground">for {format(new Date(r.pass.pass_date), "dd MMM")}</div>}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{r.pass?.person?.full_name}</div>
                          <div className="text-xs text-muted-foreground">{r.pass?.person?.employee_code}{r.pass?.person?.production_departments?.name ? ` · ${r.pass.person.production_departments.name}` : ""}</div>
                        </TableCell>
                        <TableCell>
                          {kind && <span className={cn("text-xs font-semibold rounded-full px-2 py-0.5 ring-1 ring-inset whitespace-nowrap", kind.badgeClass)}>{kind.label}</span>}
                        </TableCell>
                        <TableCell className={cn("font-semibold whitespace-nowrap", EXCEPTION_EVENTS.has(r.event) && "text-red-700",
                          r.event === "approved" && "text-emerald-700")}>
                          {eventLabel(r.event)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[360px]" title={r.message ?? ""}>
                          <div className="line-clamp-2">{r.message}</div>
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{actorName(r)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {hasMore && (
              <div className="p-3 text-center border-t">
                <Button variant="outline" size="sm" disabled={isFetching} onClick={() => setLimit((n) => n + PAGE)}>
                  {isFetching ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
