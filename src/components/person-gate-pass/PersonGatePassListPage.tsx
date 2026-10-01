import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { DoorOpen, Plus, Search } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
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
  STATUS_META, fmtTime, hasAnyRole, overdueMinutes, passKeys, passKindMeta, passKinds, personSelect, ppDb, statusMeta, todayPk,
  type PersonGatePass, type PersonPassVariant,
} from "@/lib/personGatePass";

type Row = Pick<PersonGatePass,
  "id" | "pass_number" | "pass_kind" | "status" | "pass_date" | "reason" | "expected_minutes" | "gate_out_at" |
  "expected_back_at" | "gate_in_at" | "minutes_outside" | "half_day_rows" | "created_at" | "person" | "creator">;

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

/** Register of worker or staff gate passes with the summary cards and filters. */
export function PersonGatePassListPage({ variant }: { variant: PersonPassVariant }) {
  const navigate = useNavigate();
  const { roles } = useAuth();
  const [params] = useSearchParams();
  const canApply = hasAnyRole(roles, variant.applyRoles);
  const today = todayPk();
  const [fromDate, setFromDate] = useState(params.get("from") ?? today);
  const [toDate, setToDate] = useState(params.get("to") ?? today);
  const [kindFilter, setKindFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState(params.get("status") ?? "all");
  const [search, setSearch] = useState("");
  const kinds = passKinds(variant);

  const listSelect =
    "id, pass_number, pass_kind, status, pass_date, reason, expected_minutes, gate_out_at, expected_back_at, gate_in_at, minutes_outside, half_day_rows, created_at," +
    `${personSelect(variant, false)},` +
    `creator:app_users!${variant.table}_created_by_fkey(full_name)`;

  const { data: rows = [], isLoading } = useQuery<Row[]>({
    queryKey: [passKeys(variant).list, fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await ppDb
        .from(variant.table)
        .select(listSelect)
        .gte("pass_date", fromDate)
        .lte("pass_date", toDate)
        .order("pass_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (kindFilter !== "all" && r.pass_kind !== kindFilter) return false;
      if (statusFilter === "half_days") {
        if (!((r.pass_kind === "half_day" && r.status === "out") || r.status === "not_returned")) return false;
      } else if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!q) return true;
      return [r.pass_number, r.person?.employee_code, r.person?.full_name, r.reason, r.creator?.full_name]
        .some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [rows, kindFilter, statusFilter, search]);

  const totals = useMemo(() => ({
    halfDays: filtered.filter((r) => (r.pass_kind === "half_day" && r.status === "out") || r.status === "not_returned").length,
    shortLeaves: filtered.filter((r) => r.pass_kind === "short_leave" && ["out", "returned", "not_returned"].includes(r.status)).length,
    minutes: filtered.reduce((s, r) => s + Number(r.minutes_outside ?? 0), 0),
  }), [filtered]);

  const idp = `${variant.prefix.toLowerCase()}-`;

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title={variant.listTitle}
          description={variant.listDescription}
          icon={DoorOpen}
          iconColor={variant.iconColor}
          action={canApply ? { label: "New Gate Pass", onClick: () => navigate(`${variant.basePath}/new`), icon: Plus } : undefined}
        />

        <PersonGatePassCards variant={variant} />
        <PersonRescanAlerts variant={variant} />
        <OutsideNowPanel variant={variant} />

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
                  <SelectItem value="half_days">Marked half day</SelectItem>
                  {Object.entries(STATUS_META).map(([v, m]) => <SelectItem key={v} value={v}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label htmlFor={`${idp}search`} className="text-xs">Search</Label>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input id={`${idp}search`} className="pl-8" placeholder={`Pass no., ${variant.noun} code, name, reason`} value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 text-xs text-muted-foreground border-b">
              <span><b className="text-foreground">{filtered.length}</b> passes</span>
              <span><b className="text-foreground">{totals.halfDays}</b> half days</span>
              <span><b className="text-foreground">{totals.shortLeaves}</b> short leaves · <b className="text-foreground">{totals.minutes}</b> min outside</span>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pass</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>{variant.label}</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Gate</TableHead>
                    <TableHead>Applied by</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No {variant.noun} gate passes for this filter.</TableCell></TableRow>
                  ) : filtered.map((r) => {
                    const late = overdueMinutes(r);
                    return (
                      <TableRow key={r.id} className={cn("cursor-pointer", late > 0 && "bg-red-50/60")} onClick={() => navigate(`${variant.basePath}/${r.id}`)}>
                        <TableCell className="font-mono font-semibold">
                          <Link to={`${variant.basePath}/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.pass_number}</Link>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{format(new Date(r.pass_date), "dd MMM")}</TableCell>
                        <TableCell>
                          <div className="font-medium">{r.person?.full_name}</div>
                          <div className="text-xs text-muted-foreground">{r.person?.employee_code}{r.person?.production_departments?.name ? ` · ${r.person.production_departments.name}` : ""}</div>
                        </TableCell>
                        <TableCell>
                          <span className={cn("text-xs font-semibold rounded-full px-2 py-0.5 ring-1 ring-inset whitespace-nowrap", passKindMeta(r.pass_kind).badgeClass)}>
                            {passKindMeta(r.pass_kind).label}{r.pass_kind === "short_leave" && r.expected_minutes ? ` · ${r.expected_minutes} min` : ""}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[240px] truncate" title={r.reason}>{r.reason}</TableCell>
                        <TableCell><Badge variant={statusMeta(r.status).variant}>{statusMeta(r.status).label}</Badge></TableCell>
                        <TableCell className={cn("text-xs whitespace-nowrap", late > 0 && "text-red-700 font-semibold")}>{timeline(r)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.creator?.full_name ?? ""}</TableCell>
                      </TableRow>
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
