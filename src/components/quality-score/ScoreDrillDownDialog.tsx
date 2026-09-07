import { useMemo } from "react";
import { format } from "date-fns";
import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  QsEntry, QsSettings, avg, entryAverages, entryMaxDelta, fmtScore, round2,
} from "./qsShared";

interface Props {
  entry: QsEntry | null;
  settings?: QsSettings;
  onClose: () => void;
}

// Inspector × parameter matrix for one score entry — lets supervisors see where
// inspectors disagree, not just the averages.
export function ScoreDrillDownDialog({ entry, settings, onClose }: Props) {
  const matrix = useMemo(() => {
    if (!entry) return [];
    const rows: Record<string, { name: string; weight: number; byInspector: Record<string, number> }> = {};
    for (const s of entry.ball_scores ?? []) {
      for (const p of s.params ?? []) {
        rows[p.parameter_name] ??= { name: p.parameter_name, weight: Number(p.weight), byInspector: {} };
        rows[p.parameter_name].byInspector[s.inspector_id] = Number(p.score);
      }
    }
    return Object.values(rows);
  }, [entry]);

  if (!entry) return null;

  const ballScores = entry.ball_scores ?? [];
  const processScores = entry.process_scores ?? [];
  const { ball, process, overall } = entryAverages(entry, settings);
  const delta = entryMaxDelta(entry);
  const threshold = settings ? Number(settings.disagreement_threshold) : 1.5;
  const flagged = delta !== null && delta.delta > threshold;

  return (
    <Dialog open={!!entry} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            Score Drill-down
            <span className="text-sm font-normal text-muted-foreground">
              {format(new Date(entry.entry_date), "dd MMM yyyy")} · {entry.department?.name ?? "—"} · {entry.shift}
              {entry.product?.name ? ` · ${entry.product.name}` : ""}
              {entry.grade?.name ? ` · ${entry.grade.name}` : ""}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {flagged && delta && (
            <div className="flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
              <AlertTriangle className="h-4 w-4 text-warning" />
              {delta.label}: Δ {delta.delta.toFixed(1)} between inspectors — above the {threshold} tolerance
            </div>
          )}

          <div>
            <div className="mb-2 text-sm font-semibold">
              Ball Quality — inspector × parameter
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {ballScores.length} inspector{ballScores.length === 1 ? "" : "s"} submitted
              </span>
            </div>
            {ballScores.length === 0 ? (
              <div className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
                No ball quality scores yet
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Parameter</TableHead>
                      <TableHead>Weight</TableHead>
                      {ballScores.map((s) => (
                        <TableHead key={s.id} className="text-right">
                          {s.inspector?.full_name ?? "Inspector"}
                        </TableHead>
                      ))}
                      <TableHead className="text-right">Average</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {matrix.map((row) => (
                      <TableRow key={row.name}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{round2(row.weight)}%</Badge>
                        </TableCell>
                        {ballScores.map((s) => (
                          <TableCell key={s.id} className="text-right tabular-nums">
                            {fmtScore(row.byInspector[s.inspector_id])}
                          </TableCell>
                        ))}
                        <TableCell className="text-right font-semibold tabular-nums">
                          {fmtScore(avg(Object.values(row.byInspector)))}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell className="font-bold">Weighted score</TableCell>
                      <TableCell />
                      {ballScores.map((s) => (
                        <TableCell key={s.id} className="text-right font-bold tabular-nums">
                          {fmtScore(Number(s.weighted_score))}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-bold tabular-nums text-primary">
                        {fmtScore(ball)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <div>
            <div className="mb-2 text-sm font-semibold">
              Process Quality
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {processScores.length} inspector{processScores.length === 1 ? "" : "s"} submitted
              </span>
            </div>
            {processScores.length === 0 ? (
              <div className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
                No process quality scores yet
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {processScores.map((s) => (
                  <div key={s.id} className="rounded-xl border p-3">
                    <div className="text-xs text-muted-foreground">{s.inspector?.full_name ?? "Inspector"}</div>
                    <div className="font-display text-xl font-bold">{fmtScore(Number(s.score))}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {s.process_name ? `${s.process_name} · ` : ""}
                      {s.mode === "holistic"
                        ? "Single holistic score"
                        : `${s.params?.length ?? 0} parameters`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between rounded-xl bg-brand-gradient-soft px-4 py-3">
            <div className="text-sm">
              <span className="font-semibold">Overall Quality Score</span>
              <span className="ml-2 text-xs text-muted-foreground">
                Ball {fmtScore(ball)} × {settings ? Number(settings.ball_weight) : 50}% + Process {fmtScore(process)} × {settings ? Number(settings.process_weight) : 50}%
              </span>
            </div>
            <div className="font-display text-2xl font-bold text-primary">{fmtScore(overall)}</div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
