import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { History, AlertTriangle } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ScoreDrillDownDialog } from "@/components/quality-score/ScoreDrillDownDialog";
import {
  QS_ENTRY_SELECT, QsEntry, entryAverages, entryMaxDelta, fmtScore, useQsSettings,
} from "@/components/quality-score/qsShared";

export default function ScoreHistoryPage() {
  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [departmentId, setDepartmentId] = useState("all");
  const [selected, setSelected] = useState<QsEntry | null>(null);

  const { data: settings } = useQsSettings();

  const { data: departments = [] } = useQuery({
    queryKey: ["qs-lookup-departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments").select("id, name").eq("is_active", true).order("name");
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
  });

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["qs-entries", "history", fromDate, toDate, departmentId],
    queryFn: async () => {
      let q = (supabase as any)
        .from("qs_score_entries")
        .select(QS_ENTRY_SELECT)
        .gte("entry_date", fromDate)
        .lte("entry_date", toDate)
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200);
      if (departmentId !== "all") q = q.eq("department_id", departmentId);
      const { data, error } = await q;
      if (error) throw error;
      return data as QsEntry[];
    },
  });

  const threshold = settings ? Number(settings.disagreement_threshold) : 1.5;

  return (
    <ERPLayout>
      <div className="w-full max-w-full space-y-4 overflow-x-hidden">
        <PageHeader
          title="Quality Score History"
          description="Every score entry with sub-module averages and inspector drill-down"
          icon={History}
        />

        <div className="filter-bar">
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" />
          </div>
          <div>
            <Label className="text-xs">Department</Label>
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Loading</div>
            ) : entries.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No score entries in this period
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[900px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Product / Grade</TableHead>
                      <TableHead className="text-right">Ball</TableHead>
                      <TableHead className="text-right">Process</TableHead>
                      <TableHead className="text-right">Overall</TableHead>
                      <TableHead>Submissions</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((e) => {
                      const { ball, process, overall } = entryAverages(e, settings);
                      const delta = entryMaxDelta(e);
                      const flagged = delta !== null && delta.delta > threshold;
                      return (
                        <TableRow
                          key={e.id}
                          className="cursor-pointer"
                          onClick={() => setSelected(e)}
                        >
                          <TableCell>{format(new Date(e.entry_date), "dd MMM yyyy")}</TableCell>
                          <TableCell>{e.department?.name ?? "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {[e.product?.name, e.grade?.name].filter(Boolean).join(" · ") || "—"}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{fmtScore(ball)}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{fmtScore(process)}</TableCell>
                          <TableCell className="text-right font-display font-bold tabular-nums text-primary">
                            {fmtScore(overall)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {e.ball_scores?.length ?? 0}/{settings?.ball_inspector_count ?? 3} ball
                            {" · "}
                            {e.process_scores?.length ?? 0}/{settings?.process_inspector_count ?? 2} process
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <Badge variant={e.status === "complete" ? "success" : "warning"}>
                                {e.status === "complete" ? "Complete" : "Awaiting scores"}
                              </Badge>
                              {flagged && delta && (
                                <Badge variant="destructive">
                                  <AlertTriangle className="mr-1 h-3 w-3" />
                                  Δ {delta.delta.toFixed(1)}
                                </Badge>
                              )}
                            </div>
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
