import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity, AlertTriangle } from "lucide-react";
import { format, startOfMonth } from "date-fns";
import { fetchStages, fetchThresholds, fetchEntriesInRange, fmtNum } from "./wipShared";

export default function WIPFlowAnalysisPage() {
  const today = new Date();
  const [fromDate, setFromDate] = useState(format(startOfMonth(today), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(today, "yyyy-MM-dd"));

  const { data: stages = [] } = useQuery({ queryKey: ["wip-stages"], queryFn: () => fetchStages(true) });
  const { data: thresholds = [] } = useQuery({ queryKey: ["wip-thresholds"], queryFn: fetchThresholds });
  const { data: entries = [] } = useQuery({
    queryKey: ["wip-entries-range", fromDate, toDate],
    queryFn: () => fetchEntriesInRange(fromDate, toDate),
  });

  const thMap = useMemo(() => new Map(thresholds.map(t => [t.stage_id, t])), [thresholds]);

  const rows = useMemo(() => {
    return stages.map(s => {
      // entries sorted by date desc, time desc
      const stageEntries = entries.filter(e => e.stage_id === s.id);
      if (stageEntries.length === 0) {
        return { s, opening: 0, closing: 0, min: 0, max: 0, avg: 0, count: 0, hasData: false };
      }
      const quantities = stageEntries.map(e => Number(e.quantity));
      const first = stageEntries[stageEntries.length - 1]; // oldest
      const last = stageEntries[0]; // newest
      const sum = quantities.reduce((a, b) => a + b, 0);
      return {
        s,
        opening: Number(first.quantity),
        closing: Number(last.quantity),
        min: Math.min(...quantities),
        max: Math.max(...quantities),
        avg: sum / quantities.length,
        count: quantities.length,
        hasData: true,
      };
    });
  }, [stages, entries]);

  return (
    <ERPLayout>
      <div className="space-y-4 p-2 sm:p-4">
        <PageHeader
          title="WIP Flow Analysis"
          description="Per-stage min, max, average and trend over a date range, computed from manual stock entries."
          icon={Activity}
          iconColor="bg-amber-500/10 text-amber-500"
        />

        <Card>
          <CardContent className="p-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><Label className="text-xs">From</Label><Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="h-9" /></div>
            <div><Label className="text-xs">To</Label><Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="h-9" /></div>
            <div className="flex items-end text-xs text-muted-foreground">{entries.length} entries in range</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Order</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">Opening</TableHead>
                  <TableHead className="text-right">Closing</TableHead>
                  <TableHead className="text-right">Min</TableHead>
                  <TableHead className="text-right">Max</TableHead>
                  <TableHead className="text-right">Average</TableHead>
                  <TableHead className="text-right">Readings</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No WIP stages configured.</TableCell></TableRow>
                ) : rows.map(r => {
                  const th = thMap.get(r.s.id);
                  const overThreshold = th && r.closing > Number(th.max_threshold);
                  return (
                    <TableRow key={r.s.id} className={overThreshold ? "bg-red-500/5" : ""}>
                      <TableCell className="font-medium">{r.s.sequence_order}</TableCell>
                      <TableCell>{r.s.name}</TableCell>
                      <TableCell className="text-right">{r.hasData ? fmtNum(r.opening) : "—"}</TableCell>
                      <TableCell className="text-right font-semibold">{r.hasData ? fmtNum(r.closing) : "—"}</TableCell>
                      <TableCell className="text-right">{r.hasData ? fmtNum(r.min) : "—"}</TableCell>
                      <TableCell className="text-right">{r.hasData ? fmtNum(r.max) : "—"}</TableCell>
                      <TableCell className="text-right">{r.hasData ? fmtNum(r.avg) : "—"}</TableCell>
                      <TableCell className="text-right">{r.count}</TableCell>
                      <TableCell>
                        {!r.hasData ? <span className="text-xs text-muted-foreground">No data</span>
                          : overThreshold ? <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Over threshold</Badge>
                          : <Badge variant="outline" className="text-green-600 border-green-500/40">OK</Badge>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
