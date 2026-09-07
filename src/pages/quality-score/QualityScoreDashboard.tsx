import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { Link } from "react-router-dom";
import { Target, Globe, ClipboardList, Clock, Plus, AlertTriangle } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ScoreDrillDownDialog } from "@/components/quality-score/ScoreDrillDownDialog";
import {
  QS_ENTRY_SELECT, QsEntry, avg, entryAverages, entryMaxDelta, fmtScore, round2,
  useQsParameters, useQsSettings,
} from "@/components/quality-score/qsShared";

const CHART_COLORS = { overall: "#4b4ee7", ball: "#1fa365", process: "#8f52ea" };

export default function QualityScoreDashboard() {
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [departmentId, setDepartmentId] = useState("all");
  const [selected, setSelected] = useState<QsEntry | null>(null);

  const { data: settings } = useQsSettings();
  const { data: ballParams = [] } = useQsParameters("ball");

  const { data: departments = [] } = useQuery({
    queryKey: ["qs-lookup-departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments").select("id, name").eq("is_active", true).order("name");
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
  });

  // 14-day window ending on the selected date; refreshed every 30s so submitted
  // scores show up without a reload.
  const trendFrom = format(subDays(new Date(date), 13), "yyyy-MM-dd");
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["qs-entries", "dashboard", trendFrom, date, departmentId],
    refetchInterval: 30_000,
    queryFn: async () => {
      let q = (supabase as any)
        .from("qs_score_entries")
        .select(QS_ENTRY_SELECT)
        .gte("entry_date", trendFrom)
        .lte("entry_date", date)
        .order("entry_date", { ascending: false });
      if (departmentId !== "all") q = q.eq("department_id", departmentId);
      const { data, error } = await q;
      if (error) throw error;
      return data as QsEntry[];
    },
  });

  const dayEntries = useMemo(
    () => entries.filter((e) => e.entry_date === date),
    [entries, date],
  );

  const ballTarget = settings?.ball_inspector_count ?? 3;
  const processTarget = settings?.process_inspector_count ?? 2;
  const threshold = settings ? Number(settings.disagreement_threshold) : 1.5;

  const kpis = useMemo(() => {
    const perEntry = dayEntries.map((e) => entryAverages(e, settings));
    const ball = avg(perEntry.map((a) => a.ball).filter((v): v is number => v !== null));
    const process = avg(perEntry.map((a) => a.process).filter((v): v is number => v !== null));
    const overall = avg(perEntry.map((a) => a.overall).filter((v): v is number => v !== null));
    const pending = dayEntries.reduce(
      (sum, e) =>
        sum
        + Math.max(0, ballTarget - (e.ball_scores?.length ?? 0))
        + Math.max(0, processTarget - (e.process_scores?.length ?? 0)),
      0,
    );
    return { ball, process, overall, pending };
  }, [dayEntries, settings, ballTarget, processTarget]);

  // Average per ball parameter across the day, from the snapshots on each score
  const paramBreakdown = useMemo(() => {
    const byName: Record<string, { weight: number; scores: number[] }> = {};
    for (const e of dayEntries) {
      for (const s of e.ball_scores ?? []) {
        for (const p of s.params ?? []) {
          byName[p.parameter_name] ??= { weight: Number(p.weight), scores: [] };
          byName[p.parameter_name].scores.push(Number(p.score));
        }
      }
    }
    const order = ballParams.map((p) => p.name);
    return Object.entries(byName)
      .map(([name, v]) => ({ name, weight: v.weight, avg: avg(v.scores) ?? 0 }))
      .sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  }, [dayEntries, ballParams]);

  const trend = useMemo(() => {
    const byDate: Record<string, QsEntry[]> = {};
    for (const e of entries) (byDate[e.entry_date] ??= []).push(e);
    return Object.keys(byDate).sort().map((d) => {
      const per = byDate[d].map((e) => entryAverages(e, settings));
      return {
        date: format(new Date(d), "dd MMM"),
        ball: avg(per.map((a) => a.ball).filter((v): v is number => v !== null)),
        process: avg(per.map((a) => a.process).filter((v): v is number => v !== null)),
        overall: avg(per.map((a) => a.overall).filter((v): v is number => v !== null)),
      };
    });
  }, [entries, settings]);

  return (
    <ERPLayout>
      <div className="w-full max-w-full space-y-4 overflow-x-hidden">
        <PageHeader
          title="Quality Score"
          description="Ball & process quality scoring, averaged across inspectors"
          icon={Target}
        >
          <Button asChild>
            <Link to="/quality-score/ball-entry">
              <Plus className="mr-2 h-4 w-4" /> New Score Entry
            </Link>
          </Button>
        </PageHeader>

        <div className="filter-bar">
          <Input
            type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40"
          />
          <Select value={departmentId} onValueChange={setDepartmentId}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            Overall = Ball × {settings ? round2(Number(settings.ball_weight)) : 50}% + Process × {settings ? round2(Number(settings.process_weight)) : 50}%
          </span>
        </div>

        <div className="dashboard-grid">
          <MetricCard
            title="Overall Quality Score"
            value={fmtScore(kpis.overall)}
            icon={Target}
            description={`${dayEntries.length} entr${dayEntries.length === 1 ? "y" : "ies"} on ${format(new Date(date), "dd MMM")}`}
          />
          <MetricCard
            title="Ball Quality"
            value={fmtScore(kpis.ball)}
            icon={Globe}
            description={`avg of up to ${ballTarget} inspectors per entry`}
          />
          <MetricCard
            title="Process Quality"
            value={fmtScore(kpis.process)}
            icon={ClipboardList}
            description={`avg of up to ${processTarget} inspectors per entry`}
          />
          <MetricCard
            title="Awaiting Submissions"
            value={kpis.pending}
            icon={Clock}
            description="inspector scores still pending"
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-bold">Ball Quality — Parameter Breakdown</h3>
                <span className="text-xs text-muted-foreground">day average · weighted</span>
              </div>
              {paramBreakdown.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No ball quality scores for this day yet
                </div>
              ) : (
                paramBreakdown.map((p) => (
                  <div key={p.name} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 font-medium">
                        {p.name}
                        <Badge variant="secondary">{round2(p.weight)}%</Badge>
                      </div>
                      <span className="font-display font-bold">{fmtScore(p.avg)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-2 rounded-full bg-brand-gradient"
                        style={{ width: `${Math.min(100, (p.avg / 10) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-6">
              <h3 className="font-display text-base font-bold">Inspector Scores — {format(new Date(date), "dd MMM")}</h3>
              {dayEntries.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No score entries for this day yet
                </div>
              ) : (
                dayEntries.map((e) => {
                  const delta = entryMaxDelta(e);
                  const flagged = delta !== null && delta.delta > threshold;
                  return (
                    <div
                      key={e.id}
                      className="cursor-pointer rounded-xl border p-3 transition-colors hover:border-primary/40"
                      onClick={() => setSelected(e)}
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold">
                          {e.department?.name ?? "—"} · <span className="capitalize">{e.shift}</span>
                          {e.product?.name ? ` · ${e.product.name}` : ""}
                        </span>
                        {flagged && delta ? (
                          <Badge variant="warning">
                            <AlertTriangle className="mr-1 h-3 w-3" />
                            {delta.label} Δ {delta.delta.toFixed(1)}
                          </Badge>
                        ) : (
                          <Badge variant={e.status === "complete" ? "success" : "secondary"}>
                            {e.ball_scores?.length ?? 0}/{ballTarget} · {e.process_scores?.length ?? 0}/{processTarget}
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(e.ball_scores ?? []).map((s) => (
                          <Badge key={s.id} variant="secondary">
                            Ball · {s.inspector?.full_name ?? "Inspector"} {fmtScore(Number(s.weighted_score))}
                          </Badge>
                        ))}
                        {(e.process_scores ?? []).map((s) => (
                          <Badge key={s.id} variant="secondary">
                            Process · {s.inspector?.full_name ?? "Inspector"} {fmtScore(Number(s.score))}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-6">
            <h3 className="mb-4 font-display text-base font-bold">Score Trend — Last 14 Days</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 10]} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="overall" name="Overall" stroke={CHART_COLORS.overall} strokeWidth={2.5} dot={false} connectNulls />
                  <Line type="monotone" dataKey="ball" name="Ball Quality" stroke={CHART_COLORS.ball} strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="process" name="Process Quality" stroke={CHART_COLORS.process} strokeWidth={2} dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between p-6 pb-3">
              <h3 className="font-display text-base font-bold">Entries — {format(new Date(date), "dd MMM yyyy")}</h3>
              <Button variant="link" asChild className="h-auto p-0">
                <Link to="/quality-score/history">View all history</Link>
              </Button>
            </div>
            {isLoading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Loading</div>
            ) : dayEntries.length === 0 ? (
              <div className="py-10 pb-12 text-center text-sm text-muted-foreground">
                No score entries yet — inspectors submit from the Ball / Process entry pages
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[760px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Department</TableHead>
                      <TableHead>Shift</TableHead>
                      <TableHead>Product / Grade</TableHead>
                      <TableHead className="text-right">Ball</TableHead>
                      <TableHead className="text-right">Process</TableHead>
                      <TableHead className="text-right">Overall</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dayEntries.map((e) => {
                      const { ball, process, overall } = entryAverages(e, settings);
                      return (
                        <TableRow key={e.id} className="cursor-pointer" onClick={() => setSelected(e)}>
                          <TableCell className="font-medium">{e.department?.name ?? "—"}</TableCell>
                          <TableCell className="capitalize">{e.shift}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {[e.product?.name, e.grade?.name].filter(Boolean).join(" · ") || "—"}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{fmtScore(ball)}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{fmtScore(process)}</TableCell>
                          <TableCell className="text-right font-display font-bold tabular-nums text-primary">
                            {fmtScore(overall)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={e.status === "complete" ? "success" : "warning"}>
                              {e.status === "complete" ? "Complete" : "Awaiting scores"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <ScoreDrillDownDialog entry={selected} settings={settings} onClose={() => setSelected(null)} />
      </div>
    </ERPLayout>
  );
}
