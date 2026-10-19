import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format, parseISO, startOfMonth, endOfMonth, subMonths, subDays } from "date-fns";
import { AlertTriangle, CheckCircle2, Gauge, ListChecks, TrendingDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from "recharts";
import { fmtMph, round1 } from "@/lib/mphLoss";

// One hue for "MPH lost" everywhere on this page (single-series charts + matrix shading).
const LOSS_COLOR = "#dc2626";

interface ReportRow {
  id: string;
  report_number: string;
  report_date: string;
  status: "draft" | "submitted";
}

export default function MPHLossReasonAnalysisPage() {
  const today = new Date();
  const [range, setRange] = useState("month");
  const [customStart, setCustomStart] = useState(format(subDays(today, 30), "yyyy-MM-dd"));
  const [customEnd, setCustomEnd] = useState(format(today, "yyyy-MM-dd"));
  const [department, setDepartment] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const { start, end } = useMemo(() => {
    switch (range) {
      case "week":
        return { start: format(subDays(today, 7), "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") };
      case "lastMonth": {
        const lm = subMonths(today, 1);
        return { start: format(startOfMonth(lm), "yyyy-MM-dd"), end: format(endOfMonth(lm), "yyyy-MM-dd") };
      }
      case "custom":
        return { start: customStart, end: customEnd };
      default:
        return { start: format(startOfMonth(today), "yyyy-MM-dd"), end: format(endOfMonth(today), "yyyy-MM-dd") };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, customStart, customEnd]);

  const { data, isLoading } = useQuery({
    queryKey: ["mph-loss-analysis", start, end],
    queryFn: async () => {
      const { data: reports, error } = await (supabase as any)
        .from("mph_loss_reports")
        .select("id, report_number, report_date, status")
        .gte("report_date", start)
        .lte("report_date", end)
        .order("report_date");
      if (error) throw error;
      const ids = (reports || []).map((r: ReportRow) => r.id);
      if (ids.length === 0) return { reports: [] as ReportRow[], departments: [] as any[], lines: [] as any[] };
      const [deptRes, lineRes] = await Promise.all([
        (supabase as any).from("mph_loss_report_departments").select("*").in("report_id", ids).is("superseded_at", null),
        (supabase as any).from("mph_loss_report_lines").select("*").in("report_id", ids).is("superseded_at", null).order("sort_order"),
      ]);
      if (deptRes.error) throw deptRes.error;
      if (lineRes.error) throw lineRes.error;
      return { reports: (reports || []) as ReportRow[], departments: deptRes.data || [], lines: lineRes.data || [] };
    },
  });

  const analysis = useMemo(() => {
    const reports = (data?.reports ?? []).filter((r) => statusFilter === "all" || r.status === statusFilter);
    const reportById = Object.fromEntries(reports.map((r) => [r.id, r]));
    const depts = (data?.departments ?? []).filter(
      (d: any) => reportById[d.report_id] && Number(d.net_mph) < 0 && (department === "all" || d.department_id === department)
    );
    const lines = (data?.lines ?? []).filter(
      (l: any) => reportById[l.report_id] && (department === "all" || l.department_id === department)
    );

    const totalLoss = round1(depts.reduce((s: number, d: any) => s - Number(d.net_mph), 0));
    const explained = round1(lines.reduce((s: number, l: any) => s + Number(l.mph_lost), 0));

    const byReason: Record<string, { name: string; category: string | null; mph: number; count: number }> = {};
    lines.forEach((l: any) => {
      const b = (byReason[l.reason_id] ??= { name: l.reason_name, category: l.reason_category, mph: 0, count: 0 });
      b.mph += Number(l.mph_lost);
      b.count += 1;
    });
    const reasonRows = Object.entries(byReason)
      .map(([id, r]) => ({ id, ...r, mph: round1(r.mph), share: explained > 0 ? (r.mph / explained) * 100 : 0 }))
      .sort((a, b) => b.mph - a.mph);

    const deptNames: Record<string, string> = {};
    depts.forEach((d: any) => (deptNames[d.department_id] = d.department_name));
    const matrix: Record<string, Record<string, number>> = {};
    lines.forEach((l: any) => {
      const row = (matrix[l.department_id] ??= {});
      row[l.reason_id] = (row[l.reason_id] ?? 0) + Number(l.mph_lost);
    });
    const deptLoss: Record<string, number> = {};
    depts.forEach((d: any) => (deptLoss[d.department_id] = (deptLoss[d.department_id] ?? 0) - Number(d.net_mph)));
    const matrixRows = Object.keys(deptLoss)
      .map((id) => ({ id, name: deptNames[id] ?? "—", loss: round1(deptLoss[id]), cells: matrix[id] ?? {} }))
      .sort((a, b) => b.loss - a.loss);
    const matrixMax = Math.max(1, ...matrixRows.flatMap((r) => Object.values(r.cells)));

    const byDate: Record<string, number> = {};
    depts.forEach((d: any) => {
      const date = reportById[d.report_id].report_date;
      byDate[date] = (byDate[date] ?? 0) - Number(d.net_mph);
    });
    const trend = Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, mph]) => ({ date, label: format(parseISO(date), "dd MMM"), mph: round1(mph) }));

    const lineLog = lines
      .map((l: any) => ({
        ...l,
        report: reportById[l.report_id],
        department_name: deptNames[l.department_id] ?? "—",
      }))
      .sort((a: any, b: any) => b.report.report_date.localeCompare(a.report.report_date));

    return {
      totalLoss,
      explained,
      unexplained: round1(Math.max(totalLoss - explained, 0)),
      draftCount: reports.filter((r) => r.status === "draft").length,
      reportCount: reports.length,
      reasonRows,
      matrixRows,
      matrixMax,
      trend,
      lineLog,
    };
  }, [data, department, statusFilter]);

  const departmentOptions = useMemo(() => {
    const map: Record<string, string> = {};
    (data?.departments ?? []).forEach((d: any) => (map[d.department_id] = d.department_name));
    return Object.entries(map).sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const top = analysis.reasonRows[0];
  const chartReasons = analysis.reasonRows.map((r) => ({ name: r.name, mph: r.mph, share: `${r.share.toFixed(0)}%` }));

  return (
    <ERPLayout>
      <div className="space-y-6 p-4 md:p-6">
        <PageHeader
          title="MPH Loss Reason Analysis"
          description="Where MPH is lost and why — from the reasons the Production Coordinator gives"
          icon={Gauge}
          iconColor="bg-red-600 text-white"
        />

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <Label className="text-xs text-muted-foreground">Date range</Label>
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="week">Last 7 Days</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
                <SelectItem value="lastMonth">Last Month</SelectItem>
                <SelectItem value="custom">Custom Range</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {range === "custom" && (
            <>
              <div>
                <Label htmlFor="mla-from" className="text-xs text-muted-foreground">From</Label>
                <Input id="mla-from" type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="w-[160px]" />
              </div>
              <div>
                <Label htmlFor="mla-to" className="text-xs text-muted-foreground">To</Label>
                <Input id="mla-to" type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="w-[160px]" />
              </div>
            </>
          )}
          <div>
            <Label className="text-xs text-muted-foreground">Department</Label>
            <Select value={department} onValueChange={setDepartment}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departmentOptions.map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Report status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="MPH lost"
            value={fmtMph(analysis.totalLoss)}
            icon={TrendingDown}
            iconColor="text-red-600"
            description={`${analysis.reportCount} production days`}
          />
          <MetricCard
            title="Explained"
            value={`${analysis.totalLoss > 0 ? Math.round((analysis.explained / analysis.totalLoss) * 100) : 0}%`}
            icon={CheckCircle2}
            iconColor="text-green-600"
            description={`${fmtMph(analysis.explained)} MPH with a reason · ${fmtMph(analysis.unexplained)} without`}
          />
          <MetricCard
            title="Top reason"
            value={top ? top.name : "—"}
            icon={ListChecks}
            description={top ? `${fmtMph(top.mph)} MPH · ${top.share.toFixed(0)}% of explained loss` : "No reasons yet"}
          />
          <MetricCard
            title="Reports not submitted"
            value={String(analysis.draftCount)}
            icon={AlertTriangle}
            iconColor={analysis.draftCount > 0 ? "text-amber-600" : "text-green-600"}
            description="Production days still in draft"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">MPH lost by reason</CardTitle>
            </CardHeader>
            <CardContent>
              {chartReasons.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">No reasons recorded for this period</p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(220, chartReasons.length * 40 + 40)}>
                  <BarChart data={chartReasons} layout="vertical" margin={{ left: 8, right: 48 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={190} tick={{ fontSize: 11 }} />
                    <Tooltip
                      cursor={{ fill: "rgba(0,0,0,0.04)" }}
                      formatter={(v: number, _n, item: any) => [`${fmtMph(v)} MPH (${item.payload.share})`, "Lost"]}
                    />
                    <Bar dataKey="mph" fill={LOSS_COLOR} radius={[0, 4, 4, 0]} barSize={18}>
                      <LabelList dataKey="share" position="right" style={{ fontSize: 11, fill: "#374151" }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Daily MPH loss</CardTitle>
            </CardHeader>
            <CardContent>
              {analysis.trend.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">No MPH loss reports for this period</p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={analysis.trend}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} formatter={(v: number) => [`${fmtMph(v)} MPH`, "Lost"]} />
                    <Bar dataKey="mph" fill={LOSS_COLOR} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Department × reason (MPH lost)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs font-semibold">Department</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Total loss</TableHead>
                    {analysis.reasonRows.map((r) => (
                      <TableHead key={r.id} className="text-xs font-semibold text-right min-w-[110px]">{r.name}</TableHead>
                    ))}
                    <TableHead className="text-xs font-semibold text-right">Unexplained</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analysis.matrixRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={analysis.reasonRows.length + 3} className="text-center text-sm text-muted-foreground py-8">
                        No data for the selected period
                      </TableCell>
                    </TableRow>
                  ) : (
                    analysis.matrixRows.map((row) => {
                      const explained = Object.values(row.cells).reduce((s, v) => s + v, 0);
                      const unexplained = round1(Math.max(row.loss - explained, 0));
                      return (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium text-sm">{row.name}</TableCell>
                          <TableCell className="text-right text-sm font-semibold text-red-600">{fmtMph(row.loss)}</TableCell>
                          {analysis.reasonRows.map((r) => {
                            const v = row.cells[r.id] ?? 0;
                            const alpha = v > 0 ? 0.08 + (v / analysis.matrixMax) * 0.42 : 0;
                            return (
                              <TableCell
                                key={r.id}
                                className="text-right text-sm tabular-nums"
                                style={{ backgroundColor: alpha ? `rgba(220, 38, 38, ${alpha.toFixed(2)})` : undefined }}
                                title={v > 0 ? `${row.name} · ${r.name}: ${fmtMph(v)} MPH` : undefined}
                              >
                                {v > 0 ? fmtMph(v) : ""}
                              </TableCell>
                            );
                          })}
                          <TableCell className={`text-right text-sm ${unexplained > 0 ? "text-amber-700 font-medium" : "text-muted-foreground"}`}>
                            {unexplained > 0 ? fmtMph(unexplained) : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Reason log</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto max-h-[480px]">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs font-semibold">Date</TableHead>
                    <TableHead className="text-xs font-semibold">Department</TableHead>
                    <TableHead className="text-xs font-semibold">Reason</TableHead>
                    <TableHead className="text-xs font-semibold text-right">MPH lost</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Workers</TableHead>
                    <TableHead className="text-xs font-semibold">Remarks</TableHead>
                    <TableHead className="text-xs font-semibold">Report</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">Loading...</TableCell></TableRow>
                  ) : analysis.lineLog.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No reasons recorded for this period</TableCell></TableRow>
                  ) : (
                    analysis.lineLog.map((l: any) => (
                      <TableRow key={l.id}>
                        <TableCell className="text-sm whitespace-nowrap">{format(parseISO(l.report.report_date), "dd MMM yyyy")}</TableCell>
                        <TableCell className="text-sm">{l.department_name}</TableCell>
                        <TableCell className="text-sm">
                          {l.reason_name}
                          {l.reason_category && <span className="ml-2 text-xs text-muted-foreground">{l.reason_category}</span>}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{fmtMph(Number(l.mph_lost))}</TableCell>
                        <TableCell className="text-right text-sm">{l.workers_affected ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{l.remarks || "—"}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          <Link to={`/labour/mph-loss-reasons?date=${l.report.report_date}`} className="text-primary hover:underline">
                            {l.report.report_number}
                          </Link>
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            {l.report.status === "submitted" ? "Submitted" : "Draft"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
