import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { format } from "date-fns";
import { ArrowLeft, History, Printer } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  SEVERITY_TONE, dpDb, flagMeta, fmtDay, fmtQty, groupLoads, printLoadingSuggestions, statusMeta, sum,
  type PlannerVersion, type PlannerVersionLine, type SuggestRow,
} from "@/lib/dispatchPlanner";

/** A saved line in the shape the board and the print helper use. */
const asSuggestRow = (l: PlannerVersionLine): SuggestRow => ({
  line_key: l.id,
  order_item_id: l.order_item_id ?? l.id,
  part: l.part,
  order_id: l.order_id ?? "",
  order_number: l.order_number ?? "",
  order_date: "",
  customer_id: "",
  customer_name: l.customer_name ?? "",
  city: l.city,
  product_id: l.product_id,
  product_code: l.product_code,
  product_name: l.product_name,
  grade_id: null,
  grade_name: l.grade_name,
  planning_item_id: l.planning_item_id,
  planning_item_name: null,
  packing_type: l.packing_type,
  packing_dozens: null,
  pending_dozens: Number(l.suggested_dozens),
  suggested_dozens: Number(l.suggested_dozens),
  cartons: l.cartons,
  deadline: l.deadline,
  stock_closing: null,
  stock_closing_date: null,
  status: l.status_at_save,
  suggested_date: l.plan_date,
  load_no: l.load_no,
  vehicle_id: l.vehicle_id,
  vehicle_reg: l.vehicle_reg,
  flags: l.flags ?? [],
  reason: l.reason,
  pinned: l.pinned,
  pinned_date: null,
  urgent: l.urgent,
  pin_note: null,
});

export default function DispatchPlannerVersionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: version } = useQuery<PlannerVersion | null>({
    queryKey: ["dp-versions", id],
    queryFn: async () => {
      const { data, error } = await dpDb
        .from("dispatch_planner_versions")
        .select("*, creator:app_users!dispatch_planner_versions_created_by_fkey(full_name)")
        .eq("id", id)
        .is("archived_at", null)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
  const { data: lines = [], isLoading } = useQuery<PlannerVersionLine[]>({
    queryKey: ["dp-version-lines", id],
    queryFn: async () => {
      const { data, error } = await dpDb
        .from("dispatch_planner_version_lines")
        .select("*")
        .eq("version_id", id)
        .order("plan_date").order("load_no").order("city").order("customer_name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!id,
  });

  const rows = lines.map(asSuggestRow);
  const days = [...new Set(rows.map((r) => r.suggested_date))].sort();

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title={version ? `${version.version_number}${version.label ? ` · ${version.label}` : ""}` : "Saved version"}
          description={version ? `Saved ${format(new Date(version.created_at), "dd MMM yyyy, HH:mm")} by ${version.creator?.full_name ?? "—"} · ${fmtDay(version.horizon_from, "dd MMM")} – ${fmtDay(version.horizon_to, "dd MMM")} · lead time ${version.params?.lead_time_days ?? "—"} working days · fleet ${version.params?.fleet_cartons ?? "—"} ctn/day` : ""}
          icon={History}
        >
          <Button variant="outline" size="sm" asChild><Link to="/dispatch-planner/versions"><ArrowLeft className="h-4 w-4 mr-1" /> All versions</Link></Button>
        </PageHeader>

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && version && lines.length === 0 && <Card><CardContent className="p-6 text-center text-muted-foreground">This version has no lines.</CardContent></Card>}

        {days.map((day) => {
          const dayRows = rows.filter((r) => r.suggested_date === day);
          return (
            <Card key={day}>
              <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">{fmtDay(day, "EEEE dd MMM yyyy")}
                  <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">{dayRows.length} line(s) · {fmtQty(sum(dayRows.map((r) => r.suggested_dozens)))} dz · {sum(dayRows.map((r) => r.cartons))} ctn</span>
                </CardTitle>
                <Button variant="outline" size="sm" onClick={() => printLoadingSuggestions(day, dayRows, { versionNumber: version?.version_number })}><Printer className="h-4 w-4 mr-1" /> Print</Button>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {groupLoads(dayRows).map((g) => (
                  <div key={g.load_no ?? 0} className="rounded-md border">
                    <div className="px-2 py-1 text-xs font-semibold flex items-center justify-between border-b bg-muted/40">
                      <span>Load {g.load_no ?? "—"} · {g.vehicle_reg ?? "no vehicle"}</span>
                      <span className="tabular-nums">{fmtQty(g.dozens)} dz · {g.cartons} ctn</span>
                    </div>
                    <div className="divide-y">
                      {g.rows.map((r) => {
                        const m = statusMeta(r.status);
                        return (
                          <div key={r.line_key} className="p-2 text-xs" title={r.reason ?? ""}>
                            <div className="flex justify-between gap-2">
                              <span className="font-semibold truncate">{r.customer_name}</span>
                              <span className="tabular-nums whitespace-nowrap">{fmtQty(r.suggested_dozens)} dz · {r.cartons} ctn</span>
                            </div>
                            <div className="text-muted-foreground truncate">{r.order_number}{r.part > 1 ? " · part 2" : ""} · {r.product_code} {r.product_name}{r.grade_name ? ` · ${r.grade_name}` : ""} · due {fmtDay(r.deadline, "dd MMM")}</div>
                            <div className="flex flex-wrap gap-1 mt-1">
                              <span className={cn("inline-flex rounded-full px-1.5 text-[10px] font-semibold ring-1 ring-inset", m.tone)}>{m.short}</span>
                              {r.flags.filter((f) => flagMeta(f).severity !== "info").map((f) => <span key={f} className={cn("inline-flex rounded-full px-1.5 text-[10px] font-semibold ring-1 ring-inset", SEVERITY_TONE[flagMeta(f).severity])}>{flagMeta(f).label}</span>)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </ERPLayout>
  );
}
