import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format, subDays } from "date-fns";
import { Building2, Cctv, ClipboardCheck, Package, Smartphone, Wrench } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fcDb, fmtDate, fmtMoney, todayPk } from "@/lib/facilities";
import { CHECK_SELECT, cameraResultLabel, type CameraCheck } from "@/lib/facilitiesCameras";

type Tone = "ok" | "warn" | "bad" | "none";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any;
type Row = Record<string, string | number | null>;
const TONE: Record<Tone, string> = {
  ok: "border-l-4 border-l-emerald-500",
  warn: "border-l-4 border-l-amber-500",
  bad: "border-l-4 border-l-red-500",
  none: "",
};

/** A query that must never break the dashboard: a missing table counts as nothing. */
async function count(table: string, build: (q: Q) => Q): Promise<number | null> {
  try {
    const { count: n, error } = await build(fcDb.from(table).select("*", { count: "exact", head: true }));
    if (error) return null;
    return n ?? 0;
  } catch {
    return null;
  }
}
async function rows<T = Row>(table: string, build: (q: Q) => Q): Promise<T[]> {
  try {
    const { data, error } = await build(fcDb.from(table).select("*"));
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}

const n = (v: number | null | undefined) => (v === null || v === undefined ? "—" : String(v));

/** Admin & Facilities: what needs attention today. */
export default function FacilitiesDashboardPage() {
  const today = todayPk();
  const { data } = useQuery({
    queryKey: ["facilities-dashboard", today],
    refetchInterval: 60_000,
    queryFn: async () => {
      const [todayCheck] = await Promise.all([
        fcDb.from("facilities_camera_checks").select(CHECK_SELECT).eq("check_date", today).maybeSingle().then((r: { data: CameraCheck | null }) => r.data),
      ]);
      const faultLines = todayCheck
        ? await rows("facilities_camera_check_lines", (q) => q.eq("check_id", todayCheck.id).neq("result", "ok").not("result", "is", null)).catch(() => [])
        : [];
      const cameras = faultLines.length ? await rows("facilities_cameras", (q) => q.in("id", faultLines.map((l) => l.camera_id))) : [];
      const [
        areas, inspectionsToday, actionsOpen, actionsOverdue, areasOverdue,
        srToApprove, srToIssue, shortage,
        ticketsOpen, ticketsHigh, equipmentDue, amcExpiring,
        simsOver, simsIssued,
      ] = await Promise.all([
        count("facilities_areas", (q) => q.eq("is_active", true)),
        count("facilities_inspections", (q) => q.eq("inspection_date", today).eq("status", "submitted")),
        count("facilities_cleaning_actions", (q) => q.eq("status", "open")),
        count("facilities_cleaning_actions", (q) => q.eq("status", "open").lt("due_date", today)),
        fcDb.rpc("facilities_cleaning_overdue_count", { p_date: today }).then((r: { error: unknown; data: unknown }) => (r.error ? null : Number(r.data ?? 0))).catch(() => null),
        count("facilities_supply_requests", (q) => q.eq("status", "pending_hod")),
        count("facilities_supply_requests", (q) => q.eq("status", "approved")),
        count("v_facilities_store_shortage", (q) => q),
        count("facilities_tickets", (q) => q.in("status", ["open", "assigned", "in_progress"])),
        rows("facilities_tickets", (q) => q.in("status", ["open", "assigned", "in_progress"]).eq("priority", "high").order("created_at").limit(5)),
        count("v_facilities_equipment_due", (q) => q.in("due_state", ["due_soon", "overdue"])),
        rows("v_facilities_equipment_due", (q) => q.in("amc_state", ["expiring", "expired"]).limit(5)),
        rows("v_facilities_sim_over_limit", (q) => q.gt("last_month_over", 0)),
        count("facilities_sims", (q) => q.eq("status", "issued")),
      ]);
      const recentChecks = await rows<CameraCheck>("facilities_camera_checks", (q) =>
        q.gte("check_date", format(subDays(new Date(today), 13), "yyyy-MM-dd")).lte("check_date", today));
      return {
        todayCheck, faultLines, cameras, areas, inspectionsToday, actionsOpen, actionsOverdue, areasOverdue,
        srToApprove, srToIssue, shortage, ticketsOpen, ticketsHigh, equipmentDue, amcExpiring, simsOver, simsIssued, recentChecks,
      };
    },
  });

  const d = data;
  const checkTone: Tone = !d ? "none" : !d.todayCheck ? "bad" : d.todayCheck.status === "draft" ? "warn" : d.todayCheck.fault_count > 0 ? "warn" : "ok";
  const cleanTone: Tone = !d || d.areas === null ? "none" : (d.areasOverdue ?? 0) > 0 || (d.actionsOverdue ?? 0) > 0 ? "bad" : (d.inspectionsToday ?? 0) < (d.areas ?? 0) ? "warn" : "ok";
  const ticketTone: Tone = !d || d.ticketsOpen === null ? "none" : d.ticketsHigh.length > 0 ? "bad" : (d.ticketsOpen ?? 0) > 0 ? "warn" : "ok";
  const simOverTotal = d?.simsOver.reduce((s: number, r) => s + Number(r.last_month_over ?? 0), 0) ?? 0;

  const tiles: { title: string; value: string; sub: string; href: string; tone: Tone; icon: typeof Cctv }[] = [
    {
      title: "Camera check", icon: Cctv, href: d?.todayCheck ? `/facilities/cameras/checks/${d.todayCheck.id}` : "/facilities/cameras/checks", tone: checkTone,
      value: !d ? "…" : !d.todayCheck ? "Not done" : d.todayCheck.status === "draft" ? "In progress" : `${d.todayCheck.fault_count} fault(s)`,
      sub: !d?.todayCheck ? "Today's check has not been started" : d.todayCheck.status === "draft" ? `${d.todayCheck.check_number} · draft` : `${d.todayCheck.ok_count} of ${d.todayCheck.camera_count} ok`,
    },
    {
      title: "Cleaning today", icon: ClipboardCheck, href: "/facilities/cleaning", tone: cleanTone,
      value: d ? `${n(d.inspectionsToday)} / ${n(d.areas)}` : "…",
      sub: d ? `${n(d.areasOverdue)} area(s) overdue · ${n(d.actionsOpen)} action item(s) open, ${n(d.actionsOverdue)} overdue` : "",
    },
    {
      title: "Supply requests", icon: Package, href: "/facilities/supplies", tone: (d?.srToApprove ?? 0) + (d?.srToIssue ?? 0) > 0 ? "warn" : "ok",
      value: d ? n((d.srToApprove ?? 0) + (d.srToIssue ?? 0)) : "…",
      sub: d ? `${n(d.srToApprove)} to approve · ${n(d.srToIssue)} to issue · ${n(d.shortage)} item(s) below reorder` : "",
    },
    {
      title: "Equipment tickets", icon: Wrench, href: "/facilities/equipment/tickets", tone: ticketTone,
      value: d ? `${n(d.ticketsOpen)} open` : "…",
      sub: d ? `${d.ticketsHigh.length} high priority · ${n(d.equipmentDue)} service due · ${d.amcExpiring.length} AMC expiring` : "",
    },
    {
      title: "SIMs over limit", icon: Smartphone, href: "/facilities/sims/bills", tone: simOverTotal > 0 ? "warn" : "ok",
      value: d ? String(d.simsOver.length) : "…",
      sub: d ? `Last month · PKR ${fmtMoney(simOverTotal)} borne by company · ${n(d.simsIssued)} SIMs issued` : "",
    },
  ];

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title="Admin & Facilities" description={`What needs attention · ${fmtDate(today)}`} icon={Building2} />

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
          {tiles.map((t) => (
            <Link key={t.title} to={t.href}>
              <Card className={cn("h-full hover:bg-muted/40 transition-colors", TONE[t.tone])}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground"><span>{t.title}</span><t.icon className="h-4 w-4" /></div>
                  <div className="text-2xl font-semibold mt-1 tabular-nums">{t.value}</div>
                  <div className="text-xs text-muted-foreground mt-1">{t.sub}</div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Needs attention</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {d?.faultLines.map((l) => {
                  const cam = d.cameras.find((c) => c.id === l.camera_id);
                  return (
                    <li key={String(l.id)} className="flex flex-wrap gap-2 items-center">
                      <Badge variant="destructive">camera</Badge>
                      <span>{cam?.code} {cam?.name} · {cameraResultLabel(l.result as string)}{l.remark ? ` · ${l.remark}` : ""}</span>
                      {l.ticket_id && <Link className="text-primary underline text-xs" to={`/facilities/equipment/tickets/${l.ticket_id}`}>ticket</Link>}
                    </li>
                  );
                })}
                {d?.ticketsHigh.map((t) => (
                  <li key={String(t.id)} className="flex flex-wrap gap-2 items-center">
                    <Badge variant="warning">high</Badge>
                    <Link className="hover:underline" to={`/facilities/equipment/tickets/${t.id}`}>{t.ticket_number} · {t.title}</Link>
                    <span className="text-muted-foreground">since {fmtDate(t.created_at as string)}</span>
                  </li>
                ))}
                {d?.amcExpiring.map((e) => (
                  <li key={String(e.id)} className="flex flex-wrap gap-2 items-center">
                    <Badge variant="info">AMC</Badge>
                    <span>{e.code} {e.name} · {e.amc_state === "expired" ? "expired" : "expires"} {fmtDate(e.amc_expiry as string)}</span>
                  </li>
                ))}
                {d && d.faultLines.length === 0 && d.ticketsHigh.length === 0 && d.amcExpiring.length === 0 && (
                  <li className="text-muted-foreground">Nothing urgent right now.</li>
                )}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Camera checks · last 14 days</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: 14 }).map((_, i) => {
                  const day = format(subDays(new Date(today), 13 - i), "yyyy-MM-dd");
                  const c = d?.recentChecks.find((x) => x.check_date === day);
                  const tone = !c ? (day < today ? "bg-red-100 text-red-800" : "bg-muted text-muted-foreground")
                    : c.status === "draft" ? "bg-sky-100 text-sky-800"
                    : c.fault_count > 0 || c.recorder_fault_count > 0 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800";
                  const cell = <div className={cn("w-10 h-10 rounded-md flex items-center justify-center text-xs tabular-nums", tone)} title={day}>{format(new Date(day), "d")}</div>;
                  return c ? <Link key={day} to={`/facilities/cameras/checks/${c.id}`}>{cell}</Link> : <div key={day}>{cell}</div>;
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-2">Green all ok · amber faults · blue draft · red missed</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </ERPLayout>
  );
}
