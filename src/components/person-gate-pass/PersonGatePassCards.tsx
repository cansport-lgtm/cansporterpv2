import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { endOfMonth, format, startOfMonth, subDays } from "date-fns";
import { AlertTriangle, ClipboardCheck, DoorOpen, Siren, UserMinus } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtTime, overdueMinutes, passKeys, ppDb, todayPk, useLivePersonPasses, type PersonPassVariant } from "@/lib/personGatePass";

/** The four summary cards: approvals waiting, outside now, half days this month, old passes scanned again. */
export function PersonGatePassCards({ variant, compact = false }: { variant: PersonPassVariant; compact?: boolean }) {
  const keys = passKeys(variant);
  const { data: live = [] } = useLivePersonPasses(variant);
  const month = { start: format(startOfMonth(new Date()), "yyyy-MM-dd"), end: format(endOfMonth(new Date()), "yyyy-MM-dd") };

  const { data: halfDays = 0 } = useQuery<number>({
    queryKey: [keys.halfDaysCount, month.start],
    queryFn: async () => {
      const { count, error } = await ppDb
        .from(variant.halfDayView)
        .select("pass_id", { count: "exact", head: true })
        .gte("pass_date", month.start)
        .lte("pass_date", month.end);
      if (error) return 0;
      return count ?? 0;
    },
  });

  const { data: rescans = 0 } = useQuery<number>({
    queryKey: [keys.rescansCount],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count, error } = await ppDb
        .from(variant.eventsTable)
        .select("id", { count: "exact", head: true })
        .eq("event", "rescan_attempt")
        .gte("created_at", subDays(new Date(), 7).toISOString());
      if (error) return 0;
      return count ?? 0;
    },
  });

  const pending = live.filter((p) => p.status === "pending_approval").length;
  const outside = live.filter((p) => p.status === "out");
  const overdue = outside.filter((p) => overdueMinutes(p) > 0).length;
  const today = todayPk();
  const approvedToday = live.filter((p) => p.status === "approved" && p.pass_date === today).length;
  const base = variant.basePath;

  const cards = [
    { title: "Waiting for approval", value: pending, icon: ClipboardCheck, to: `${base}/approvals`, tone: pending ? "text-amber-700" : "", sub: approvedToday ? `${approvedToday} approved for today` : "" },
    { title: "Outside now", value: outside.length, icon: DoorOpen, to: `${base}?status=out`, tone: overdue ? "text-red-700" : "", sub: overdue ? `${overdue} overdue` : outside.length ? "on short leave / half day" : "" },
    { title: variant.attendanceEffects ? "Half days / absents by gate pass" : "Half days by gate pass", value: halfDays, icon: UserMinus, to: `${base}?from=${month.start}&to=${month.end}&status=half_days`, tone: "", sub: "this month" },
    { title: "Old passes scanned again", value: rescans, icon: Siren, to: `${base}?rescans=1`, tone: rescans ? "text-red-700" : "", sub: "last 7 days" },
  ];

  return (
    <div className={cn("grid gap-3", compact ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4")}>
      {cards.map((c) => (
        <Link key={c.title} to={c.to} className="block">
          <Card className={cn("h-full hover:shadow-md transition-shadow", c.tone && "border-current/30")}>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <c.icon className={cn("h-4 w-4", c.tone)} /> {c.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={cn("text-3xl font-bold font-display", c.tone)}>{c.value}</div>
              {c.sub && <div className="text-xs text-muted-foreground mt-1">{c.sub}</div>}
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}

/** People outside right now, overdue first. Hidden when nobody is out. */
export function OutsideNowPanel({ variant }: { variant: PersonPassVariant }) {
  const { data: live = [] } = useLivePersonPasses(variant);
  const out = live
    .filter((p) => p.status === "out")
    .map((p) => ({ ...p, late: overdueMinutes(p) }))
    .sort((a, b) => b.late - a.late || (a.gate_out_at ?? "").localeCompare(b.gate_out_at ?? ""));
  if (out.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <DoorOpen className="h-4 w-4" /> Outside now · {out.length}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {out.map((p) => (
          <Link key={p.id} to={`${variant.basePath}/${p.id}`}
            className={cn("flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted/50",
              p.late > 0 && "border-red-300 bg-red-50/60")}>
            <div className="min-w-0">
              <span className="font-semibold">{p.person?.employee_code} · {p.person?.full_name}</span>
              <span className="text-muted-foreground"> · {p.pass_number}</span>
            </div>
            <div className={cn("text-xs flex items-center gap-1", p.late > 0 ? "text-red-700 font-semibold" : "text-muted-foreground")}>
              {p.late > 0 && <AlertTriangle className="h-3.5 w-3.5" />}
              {p.pass_kind === "half_day"
                ? `Half day · out ${fmtTime(p.gate_out_at)}`
                : p.late > 0 ? `${p.late} min overdue · due ${fmtTime(p.expected_back_at)}` : `Due back ${fmtTime(p.expected_back_at)}`}
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

type RescanRow = {
  id: string;
  message: string | null;
  created_at: string;
  actor: { full_name: string | null } | null;
  pass: { id: string; pass_number: string; person: { employee_code: string; full_name: string } | null } | null;
};

/** Old passes scanned again at the gate in the last `days` days. Hidden when there are none. */
export function PersonRescanAlerts({ variant, days = 7 }: { variant: PersonPassVariant; days?: number }) {
  const { data: rows = [] } = useQuery<RescanRow[]>({
    queryKey: [passKeys(variant).rescans, days],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await ppDb
        .from(variant.eventsTable)
        .select(`id, message, created_at, actor:app_users!${variant.eventsTable}_created_by_fkey(full_name), pass:${variant.table}(id, pass_number, person:${variant.employeeTable}(employee_code, full_name))`)
        .eq("event", "rescan_attempt")
        .gte("created_at", subDays(new Date(), days).toISOString())
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) return [];
      return data ?? [];
    },
  });
  if (rows.length === 0) return null;
  return (
    <Card className="border-red-300 bg-red-50/70">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 text-red-700">
          <Siren className="h-4 w-4" /> Old {variant.noun} passes scanned again at the gate · last {days} days · {rows.length}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="text-xs text-muted-foreground whitespace-nowrap">{format(new Date(r.created_at), "dd MMM HH:mm")}</span>
            {r.pass ? (
              <Link to={`${variant.basePath}/${r.pass.id}`} className="font-semibold text-red-800 hover:underline">
                {r.pass.pass_number} · {r.pass.person?.employee_code} {r.pass.person?.full_name}
              </Link>
            ) : null}
            <span className="text-red-900">{r.message}</span>
            {r.actor?.full_name && <span className="text-xs text-muted-foreground">by {r.actor.full_name}</span>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
