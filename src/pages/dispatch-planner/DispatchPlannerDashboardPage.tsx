import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { LayoutDashboard } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  SEVERITY_TONE, addDaysIso, daysFromToday, dayTotals, dpDb, fetchSettings, fetchSuggest, fetchVehicles, flagMeta,
  fmtDay, fmtQty, groupLoads, statusMeta, suggestErrorHint, sum, todayPk,
  type PlannerVersion, type SuggestRow,
} from "@/lib/dispatchPlanner";

export default function DispatchPlannerDashboardPage() {
  const today = todayPk();
  const { data: settings } = useQuery({ queryKey: ["dp-settings"], queryFn: fetchSettings });
  const horizon = settings?.horizon_days ?? 14;
  const to = addDaysIso(today, horizon);

  const { data: rows = [], isLoading, isError, error } = useQuery<SuggestRow[]>({
    queryKey: ["dp-suggest", today, to],
    queryFn: () => fetchSuggest(today, to),
    enabled: !!settings,
    retry: false,
  });
  const { data: vehicles = [] } = useQuery({ queryKey: ["dp-vehicles", "active"], queryFn: () => fetchVehicles(true) });
  const { data: lastVersion } = useQuery<PlannerVersion | null>({
    queryKey: ["dp-versions", "last"],
    queryFn: async () => {
      const { data, error } = await dpDb
        .from("dispatch_planner_versions")
        .select("*, creator:app_users!dispatch_planner_versions_created_by_fkey(full_name)")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return data as PlannerVersion | null;
    },
  });

  const fleet = sum(vehicles.map((v) => v.carton_capacity));
  const lines = new Set(rows.map((r) => r.order_item_id)).size;
  const pendingDz = sum(rows.map((r) => r.suggested_dozens));
  const pendingCtn = sum(rows.map((r) => r.cartons));
  const overdue = rows.filter((r) => r.flags.includes("overdue"));
  const dueSoon = rows.filter((r) => { const d = daysFromToday(r.deadline); return d !== null && d >= 0 && d <= 3; });
  const dueWeek = rows.filter((r) => { const d = daysFromToday(r.deadline); return d !== null && d >= 0 && d <= 7; });
  const byStatus = (s: string) => rows.filter((r) => r.status === s);
  const late = rows.filter((r) => r.flags.includes("will_be_late"));
  const todayRows = rows.filter((r) => r.suggested_date === today);
  const todayT = dayTotals(todayRows);
  const highRows = rows
    .filter((r) => r.flags.some((f) => flagMeta(f).severity === "high"))
    .sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));

  // Needs-production dozens per planning item (the phase-2 shortage board in miniature).
  const shortByItem = new Map<string, { name: string; dozens: number; lines: number; needed: string }>();
  byStatus("needs_production").forEach((r) => {
    const key = r.planning_item_id ?? r.product_id ?? r.line_key;
    const g = shortByItem.get(key) ?? { name: r.planning_item_name ?? r.product_name ?? "—", dozens: 0, lines: 0, needed: r.deadline ?? "" };
    g.dozens += Number(r.suggested_dozens);
    g.lines += 1;
    if (r.deadline && (!g.needed || r.deadline < g.needed)) g.needed = r.deadline;
    shortByItem.set(key, g);
  });
  const shortages = [...shortByItem.values()].sort((a, b) => (a.needed || "9999").localeCompare(b.needed || "9999"));

  const kpis = [
    { label: "Pending order lines", value: lines, sub: `${fmtQty(pendingDz)} dz · ${pendingCtn} ctn`, href: "/dispatch-planner/pending", tone: "" },
    { label: "Overdue", value: overdue.length, sub: "deadline passed, still pending", href: "/dispatch-planner/pending?flag=overdue", tone: overdue.length ? "text-red-700" : "" },
    { label: "Due in 3 days", value: dueSoon.length, sub: `${dueWeek.length} due in 7 days`, href: "/dispatch-planner/board", tone: dueSoon.length ? "text-amber-700" : "" },
    { label: "From stock", value: byStatus("dispatchable").length, sub: `${byStatus("partial").length} partial`, href: "/dispatch-planner/pending?status=dispatchable", tone: "text-emerald-700" },
    { label: "Need production", value: byStatus("needs_production").length, sub: late.length ? `${late.length} will miss the deadline` : "within lead time", href: "/dispatch-planner/pending?status=needs_production", tone: late.length ? "text-red-700" : "" },
    { label: "Suggested today", value: `${todayT.cartons} ctn`, sub: fleet ? `fleet ${fleet} ctn · ${todayT.loads} load(s)` : "no vehicles in the fleet yet", href: "/dispatch-planner/board", tone: fleet && todayT.cartons > fleet ? "text-red-700" : "" },
    { label: "Last saved version", value: lastVersion?.version_number ?? "—", sub: lastVersion ? format(new Date(lastVersion.created_at), "dd MMM HH:mm") : "nothing saved yet", href: lastVersion ? `/dispatch-planner/versions/${lastVersion.id}` : "/dispatch-planner/versions", tone: "" },
  ];

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title="Dispatch Planner"
          description={`Suggestions only — nothing here is dispatched, reserved or booked. Horizon: today to ${fmtDay(to, "dd MMM")}.`}
          icon={LayoutDashboard}
        />

        {isError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{suggestErrorHint(error)}</div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
          {kpis.map((k) => (
            <Link key={k.label} to={k.href}>
              <Card className="hover:border-primary/40 transition-colors h-full">
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">{k.label}</div>
                  <div className={cn("text-2xl font-display font-bold mt-1 tabular-nums", k.tone)}>{isLoading ? "…" : k.value}</div>
                  {k.sub && <div className="text-xs text-muted-foreground mt-0.5">{k.sub}</div>}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Suggested for today · {fmtDay(today)}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {todayRows.length === 0 && <p className="text-sm text-muted-foreground">Nothing is suggested for today.</p>}
              {groupLoads(todayRows).map((g) => (
                <Link key={g.load_no ?? 0} to="/dispatch-planner/board" className="block rounded-lg border p-2 text-sm hover:bg-muted/50">
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold">Load {g.load_no ?? "—"} · {g.vehicle_reg ?? "vehicle to assign"}</span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{fmtQty(g.dozens)} dz · {g.cartons} ctn</span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{g.cities.join(", ") || "—"} · {new Set(g.rows.map((r) => r.customer_name)).size} customer(s) · {g.rows.length} line(s)</div>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base text-red-700">Needs attention</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {highRows.length === 0 && <p className="text-sm text-muted-foreground">No overdue or late lines. Every pending line fits before its deadline.</p>}
              {highRows.slice(0, 8).map((r) => (
                <Link key={r.line_key} to="/dispatch-planner/board" className="block rounded-lg border border-red-200 bg-red-50/60 p-2 text-sm hover:bg-red-50">
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold">{r.order_number} · {r.customer_name}</span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">deadline {fmtDay(r.deadline, "dd MMM")}</span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{r.product_code} {r.product_name} · {fmtQty(r.suggested_dozens)} dz · suggested {fmtDay(r.suggested_date, "dd MMM")}</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {r.flags.filter((f) => flagMeta(f).severity !== "info").map((f) => (
                      <span key={f} className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", SEVERITY_TONE[flagMeta(f).severity])}>{flagMeta(f).label}</span>
                    ))}
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Short of stock · by planning item</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {shortages.length === 0 && <p className="text-sm text-muted-foreground">Stock covers every pending line in the horizon.</p>}
              {shortages.slice(0, 8).map((s) => (
                <div key={s.name} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{s.name}</div>
                    <div className="text-xs text-muted-foreground">{s.lines} line(s) · needed by {s.needed ? fmtDay(s.needed, "dd MMM") : "—"}</div>
                  </div>
                  <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset whitespace-nowrap", statusMeta("needs_production").tone)}>{fmtQty(s.dozens)} dz</span>
                </div>
              ))}
              {shortages.length > 0 && <p className="text-xs text-muted-foreground pt-1">The full shortage board with suggested job orders comes in phase 2.</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </ERPLayout>
  );
}
