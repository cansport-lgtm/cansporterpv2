import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Workflow, AlertTriangle, CheckCircle2, RefreshCw, Settings2, ClipboardList, TrendingUp } from "lucide-react";
import { format, subDays, parseISO } from "date-fns";
import { Link } from "react-router-dom";
import {
  fetchStages, fetchThresholds, fetchEntriesAsOf,
  fmtNum, statusFromUtil, latestPerStage,
} from "./wipShared";

export default function WIPMonitorDashboard() {
  const today = new Date();
  const [asOfDate, setAsOfDate] = useState(format(today, "yyyy-MM-dd"));

  const { data: stages = [] } = useQuery({ queryKey: ["wip-stages"], queryFn: () => fetchStages(true) });
  const { data: thresholds = [], refetch: refetchTh } = useQuery({ queryKey: ["wip-thresholds"], queryFn: fetchThresholds });
  const { data: entries = [], refetch: refetchEntries } = useQuery({
    queryKey: ["wip-entries-asof", asOfDate],
    queryFn: () => fetchEntriesAsOf(asOfDate),
  });

  const thresholdMap = useMemo(() => new Map(thresholds.map(t => [t.stage_id, t])), [thresholds]);
  const latestMap = useMemo(() => latestPerStage(entries), [entries]);

  // 7-day per stage trend: latest entry per day for last 7 days
  const trendByStage = useMemo(() => {
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) days.push(format(subDays(parseISO(asOfDate), i), "yyyy-MM-dd"));
    const map = new Map<string, number[]>();
    for (const s of stages) {
      const arr: number[] = [];
      for (const d of days) {
        // entries are sorted desc by date,time — find first whose date == d
        const e = entries.find(en => en.stage_id === s.id && en.entry_date === d);
        arr.push(e ? Number(e.quantity) : 0);
      }
      map.set(s.id, arr);
    }
    return map;
  }, [stages, entries, asOfDate]);

  const stageRows = useMemo(() => {
    return stages.map(s => {
      const latest = latestMap.get(s.id);
      const wip = latest ? Number(latest.quantity) : 0;
      const th = thresholdMap.get(s.id);
      const threshold = th ? Number(th.max_threshold) : 0;
      const unit = th?.unit || s.unit || "dozens";
      const util = threshold > 0 ? (wip / threshold) * 100 : 0;
      const st = statusFromUtil(util);
      const trend = trendByStage.get(s.id) || [];
      const maxTrend = Math.max(...trend, 1);
      return { s, latest, wip, threshold, unit, util, st, trend, maxTrend, hasThreshold: !!th, hasEntry: !!latest };
    });
  }, [stages, latestMap, thresholdMap, trendByStage]);

  const kpi = useMemo(() => {
    let healthy = 0, warning = 0, bottleneck = 0, total = 0;
    for (const r of stageRows) {
      total += r.wip;
      if (!r.hasThreshold) continue;
      if (r.util > 100) bottleneck++;
      else if (r.util >= 75) warning++;
      else healthy++;
    }
    return { healthy, warning, bottleneck, total, stages: stageRows.length };
  }, [stageRows]);

  const bottlenecks = stageRows.filter(r => r.hasThreshold && r.util > 100);

  return (
    <ERPLayout>
      <div className="space-y-4 p-2 sm:p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <PageHeader
            title="WIP Monitor"
            description="Live WIP load per stage from manual stock entries. Stages exceeding their threshold are flagged."
            icon={Workflow}
            iconColor="bg-amber-500/10 text-amber-500"
          />
          <div className="flex gap-2 items-end flex-wrap">
            <div>
              <Label className="text-xs">As of date</Label>
              <Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="h-9 w-[160px]" />
            </div>
            <Button variant="outline" size="sm" onClick={() => { refetchTh(); refetchEntries(); }}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/wip/entries"><ClipboardList className="h-4 w-4 mr-1" /> Stock Entry</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/wip/thresholds"><Settings2 className="h-4 w-4 mr-1" /> Thresholds</Link>
            </Button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Stages</div><div className="text-2xl font-bold">{kpi.stages}</div></CardContent></Card>
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Healthy</div><div className="text-2xl font-bold text-green-600">{kpi.healthy}</div></CardContent></Card>
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Warning</div><div className="text-2xl font-bold text-amber-600">{kpi.warning}</div></CardContent></Card>
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Bottleneck</div><div className="text-2xl font-bold text-red-600">{kpi.bottleneck}</div></CardContent></Card>
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Total WIP</div><div className="text-2xl font-bold">{fmtNum(kpi.total)}</div></CardContent></Card>
        </div>

        {bottlenecks.length > 0 && (
          <Card className="border-red-500/40 bg-red-500/5">
            <CardHeader className="p-3">
              <CardTitle className="text-base flex items-center gap-2 text-red-600">
                <AlertTriangle className="h-4 w-4" /> Bottleneck Alerts ({bottlenecks.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 space-y-2">
              {bottlenecks.map(b => (
                <div key={b.s.id} className="flex justify-between items-center text-sm">
                  <span className="font-medium">{b.s.sequence_order}. {b.s.name}</span>
                  <span className="text-red-600 font-semibold">{fmtNum(b.wip)} / {fmtNum(b.threshold)} {b.unit} ({b.util.toFixed(0)}%)</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {stages.length === 0 && (
          <Card><CardContent className="p-8 text-center text-muted-foreground">
            No WIP stages yet. Go to <Link to="/wip/stages" className="text-primary underline">WIP Stages</Link> to add some.
          </CardContent></Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {stageRows.map(r => (
            <Card key={r.s.id} className={`border-2 ${r.hasThreshold ? r.st.border : "border-border"}`}>
              <CardHeader className={`p-3 ${r.hasThreshold ? r.st.bg : ""}`}>
                <CardTitle className="text-sm flex items-center justify-between gap-2">
                  <span className="truncate">{r.s.sequence_order}. {r.s.name}</span>
                  {r.hasThreshold ? (
                    <Badge variant="outline" className={r.st.color}>
                      {r.st.label === "Healthy" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                      {r.st.label !== "Healthy" && <AlertTriangle className="h-3 w-3 mr-1" />}
                      {r.st.label}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground text-[10px]">No threshold</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 space-y-3">
                <div className="flex justify-between items-baseline">
                  <div>
                    <div className="text-xs text-muted-foreground">Current WIP</div>
                    <div className="text-2xl font-bold">{r.hasEntry ? fmtNum(r.wip) : "—"}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {r.unit}{r.latest ? ` • ${r.latest.entry_date} ${r.latest.entry_time?.slice(0,5)}` : " • no entry yet"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Threshold</div>
                    <div className="text-lg font-semibold">{r.hasThreshold ? fmtNum(r.threshold) : "—"}</div>
                    <div className={`text-[10px] font-medium ${r.hasThreshold ? r.st.color : "text-muted-foreground"}`}>
                      {r.hasThreshold ? `${r.util.toFixed(0)}% utilised` : "Set threshold"}
                    </div>
                  </div>
                </div>
                {r.hasThreshold && <Progress value={Math.min(r.util, 100)} className="h-2" />}
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Last 7 days (latest reading per day)</div>
                  <div className="flex items-end gap-1 h-10">
                    {r.trend.map((v, i) => (
                      <div key={i} className="flex-1 bg-primary/30 rounded-sm" style={{ height: `${(v / r.maxTrend) * 100}%`, minHeight: v > 0 ? "4px" : "1px" }} title={fmtNum(v)} />
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </ERPLayout>
  );
}
