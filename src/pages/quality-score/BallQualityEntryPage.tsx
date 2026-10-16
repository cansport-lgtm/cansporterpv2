import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, CheckCircle2, Plus, Trash2, Copy } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  EntryContextSection, useQsEntryContext, useQsGradeOptions,
} from "@/components/quality-score/EntryContextSection";
import {
  QS_ENTRY_SELECT, QsEntry, QsParameter, avg, fmtScore, round2, useQsParameters, useQsSettings,
} from "@/components/quality-score/qsShared";

// One ball being scored on this page. gradeId: "" = not picked yet, "none" = not specified.
interface BallDraft {
  key: number;
  gradeId: string;
  scores: Record<string, string>;
}

const parseBall = (ball: BallDraft, params: QsParameter[]) => {
  const parsed = params.map((p) => ({ param: p, value: parseFloat(ball.scores[p.id] ?? "") }));
  const allValid = parsed.length > 0 && parsed.every(
    ({ value }) => !Number.isNaN(value) && value >= 0 && value <= 10,
  );
  return { parsed, allValid };
};

export default function BallQualityEntryPage() {
  const qc = useQueryClient();
  const { user, hasModulePermission, hasRole } = useAuth();
  const canSubmit = hasRole("super_admin") || hasModulePermission("quality_score", "create");
  const ctx = useQsEntryContext();
  const { data: settings } = useQsSettings();
  const { data: parameters = [] } = useQsParameters("ball");
  const activeParams = useMemo(() => parameters.filter((p) => p.is_active), [parameters]);
  const gradeOptions = useQsGradeOptions();

  const productFilter = ctx.productId === "none" ? null : ctx.productId;

  // Every grade's entry for this date + department + product, so each ball card
  // can show who has scored that grade and prefill the inspector's earlier scores.
  const { data: entries = [], isLoading: entriesLoading } = useQuery({
    queryKey: ["qs-entry-context", "ball-multi", ctx.date, ctx.departmentId, productFilter],
    enabled: ctx.ready,
    queryFn: async () => {
      let q = (supabase as any)
        .from("qs_score_entries")
        .select(QS_ENTRY_SELECT)
        .eq("entry_date", ctx.date)
        .eq("department_id", ctx.departmentId);
      q = productFilter ? q.eq("product_id", productFilter) : q.is("product_id", null);
      const { data, error } = await q;
      if (error) throw error;
      return data as QsEntry[];
    },
  });

  const entryFor = (gradeId: string) =>
    entries.find((e) => (e.grade_id ?? "none") === gradeId) ?? null;
  const myScoreFor = (gradeId: string) =>
    entryFor(gradeId)?.ball_scores?.find((s) => s.inspector_id === user?.id) ?? null;
  const scoresFrom = (gradeId: string): Record<string, string> => {
    const mine = myScoreFor(gradeId);
    return mine?.params?.length
      ? Object.fromEntries(mine.params.map((p) => [p.parameter_id, String(p.score)]))
      : {};
  };

  const nextKey = useRef(1);
  const newBall = (gradeId = "", scores: Record<string, string> = {}): BallDraft =>
    ({ key: nextKey.current++, gradeId, scores });
  const [balls, setBalls] = useState<BallDraft[]>(() => [newBall()]);

  // When the date / department / product changes, start from the grades this
  // inspector already scored there (resubmitting overwrites them); otherwise keep what's typed.
  const contextKey = `${ctx.date}|${ctx.departmentId}|${productFilter}`;
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ctx.ready || entriesLoading || !user?.id || loadedFor.current === contextKey) return;
    loadedFor.current = contextKey;
    const mine = entries.filter((e) => e.ball_scores?.some((s) => s.inspector_id === user.id));
    if (mine.length) {
      setBalls(mine.map((e) => newBall(e.grade_id ?? "none", scoresFrom(e.grade_id ?? "none"))));
    }
  }, [contextKey, ctx.ready, entriesLoading, entries, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Grades from earlier submissions stay pickable even if the Selection Master changed since
  const gradeChoices = useMemo(() => {
    const list = [...gradeOptions];
    for (const e of entries) {
      if (e.grade_id && !list.some((g) => g.id === e.grade_id)) {
        list.push({ id: e.grade_id, name: e.grade?.name ?? "Grade" });
      }
    }
    return list;
  }, [gradeOptions, entries]);

  const updateBall = (key: number, patch: Partial<BallDraft>) =>
    setBalls((bs) => bs.map((b) => (b.key === key ? { ...b, ...patch } : b)));

  const changeGrade = (ball: BallDraft, gradeId: string) => {
    const earlier = scoresFrom(gradeId);
    updateBall(ball.key, {
      gradeId,
      scores: Object.keys(earlier).length ? earlier : ball.scores,
    });
  };

  const totalWeight = round2(activeParams.reduce((sum, p) => sum + Number(p.weight), 0));

  const ballStates = balls.map((ball) => {
    const { parsed, allValid } = parseBall(ball, activeParams);
    const preview = allValid && totalWeight === 100
      ? round2(parsed.reduce((sum, { param, value }) => sum + value * Number(param.weight), 0) / 100)
      : null;
    const duplicate = !!ball.gradeId
      && balls.filter((b) => b.gradeId === ball.gradeId).length > 1;
    return { ball, parsed, allValid, preview, duplicate, ok: !!ball.gradeId && allValid && !duplicate };
  });
  const allOk = ballStates.length > 0 && ballStates.every((s) => s.ok);
  const pageAvg = avg(ballStates.map((s) => s.preview).filter((v): v is number => v !== null));

  const findOrCreateEntry = async (gradeId: string): Promise<string> => {
    const existing = entryFor(gradeId);
    if (existing) return existing.id;
    const { data, error } = await (supabase as any)
      .from("qs_score_entries")
      .insert({
        entry_date: ctx.date,
        department_id: ctx.departmentId,
        product_id: productFilter,
        grade_id: gradeId !== "none" ? gradeId : null,
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  };

  const gradeName = (gradeId: string) =>
    gradeId === "none" ? "Not specified" : gradeChoices.find((g) => g.id === gradeId)?.name ?? "Grade";

  const submit = useMutation({
    mutationFn: async () => {
      if (!ctx.ready) throw new Error("Pick a date and department first");
      if (ballStates.some((s) => !s.ball.gradeId)) throw new Error("Pick a grade for every ball");
      if (ballStates.some((s) => s.duplicate)) throw new Error("Each grade can only be scored once per entry");
      if (ballStates.some((s) => !s.allValid)) throw new Error("Every parameter needs a score between 0 and 10");

      const failures: string[] = [];
      let saved = 0;
      for (const { ball, parsed } of ballStates) {
        try {
          const entryId = await findOrCreateEntry(ball.gradeId);
          const { error } = await (supabase as any).rpc("qs_submit_ball_score", {
            p_entry_id: entryId,
            p_inspector_id: user!.id,
            p_scores: parsed.map(({ param, value }) => ({ parameter_id: param.id, score: value })),
          });
          if (error) throw error;
          saved++;
        } catch (e: any) {
          failures.push(`${gradeName(ball.gradeId)}: ${e.message}`);
        }
      }
      return { saved, failures };
    },
    onSuccess: ({ saved, failures }) => {
      if (saved) toast.success(`Ball Quality scores submitted for ${saved} ball${saved === 1 ? "" : "s"}`);
      for (const f of failures) toast.error(f);
      qc.invalidateQueries({ queryKey: ["qs-entry-context"] });
      qc.invalidateQueries({ queryKey: ["qs-entries"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const target = settings?.ball_inspector_count ?? 3;
  const anyScoredBefore = ballStates.some((s) => s.ball.gradeId && myScoreFor(s.ball.gradeId));

  return (
    <ERPLayout>
      <div className="w-full max-w-3xl space-y-4">
        <PageHeader
          title="Ball Quality — Inspector Entry"
          description="Add a ball for each grade and rate its parameters; weighted scores are calculated automatically"
          icon={Globe}
        />

        <EntryContextSection ctx={ctx} hideGrade />

        {totalWeight !== 100 && (
          <div className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
            Active ball parameter weights total {totalWeight}% — a manager must fix the
            Parameters Master before scores can be submitted.
          </div>
        )}

        {ballStates.map(({ ball, preview, duplicate }, i) => {
          const entry = ball.gradeId ? entryFor(ball.gradeId) : null;
          const submitted = entry?.ball_scores ?? [];
          const mine = ball.gradeId ? myScoreFor(ball.gradeId) : null;
          return (
            <Card key={ball.key}>
              <CardContent className="space-y-5 p-6">
                <div className="flex flex-wrap items-end gap-3">
                  <h3 className="font-display text-base font-bold">Ball {i + 1}</h3>
                  <div className="min-w-[12rem] flex-1">
                    <Label className="text-xs">Grade</Label>
                    <Select value={ball.gradeId} onValueChange={(v) => changeGrade(ball, v)}>
                      <SelectTrigger><SelectValue placeholder="Select grade" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Not specified</SelectItem>
                        {gradeChoices.map((g) => (
                          <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Weighted</div>
                    <div className="font-display text-2xl font-bold text-primary">
                      {fmtScore(preview)}
                      <span className="text-sm text-muted-foreground"> / 10</span>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost" size="icon" title="Copy scores into a new ball"
                      onClick={() => setBalls((bs) => [...bs, newBall("", { ...ball.scores })])}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" title="Remove ball"
                      disabled={balls.length === 1}
                      onClick={() => setBalls((bs) => bs.filter((b) => b.key !== ball.key))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {duplicate && (
                  <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    This grade is already used by another ball — pick a different grade.
                  </div>
                )}

                {ctx.ready && ball.gradeId && (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant={submitted.length >= target ? "success" : "warning"}>
                      {submitted.length} of {target} inspectors submitted
                    </Badge>
                    {submitted.map((s) => (
                      <Badge key={s.id} variant="secondary">
                        {s.inspector?.full_name ?? "Inspector"} · {fmtScore(Number(s.weighted_score))}
                      </Badge>
                    ))}
                    {mine && (
                      <span className="text-xs text-muted-foreground">
                        You already scored this grade — saving again updates your score.
                      </span>
                    )}
                  </div>
                )}

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Parameter Scores
                    </span>
                    <span className="text-xs text-muted-foreground">0–10 scale</span>
                  </div>
                  {activeParams.map((p) => (
                    <div key={p.id} className="flex items-center gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{p.name}</span>
                          <Badge variant="secondary">{round2(Number(p.weight))}%</Badge>
                        </div>
                        {p.description && (
                          <p className="text-xs text-muted-foreground">{p.description}</p>
                        )}
                      </div>
                      <Input
                        type="number" min={0} max={10} step={0.1}
                        className="w-24 text-right font-display font-bold"
                        value={ball.scores[p.id] ?? ""}
                        onChange={(e) =>
                          updateBall(ball.key, { scores: { ...ball.scores, [p.id]: e.target.value } })}
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}

        <Button variant="outline" className="w-full" onClick={() => setBalls((bs) => [...bs, newBall()])}>
          <Plus className="mr-2 h-4 w-4" /> Add New Ball
        </Button>

        <Card className="bg-brand-gradient-soft">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">
                Average across {balls.length} ball{balls.length === 1 ? "" : "s"}
              </div>
              <div className="text-xs text-muted-foreground">
                Each grade is saved separately; scores are computed server-side from the master weights
              </div>
            </div>
            <div className="font-display text-3xl font-bold text-primary">
              {fmtScore(pageAvg)}
              <span className="text-base text-muted-foreground"> / 10</span>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button
            onClick={() => submit.mutate()}
            disabled={!canSubmit || !ctx.ready || !allOk || totalWeight !== 100 || submit.isPending}
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            {anyScoredBefore ? "Save All Scores" : "Submit All Scores"} ({balls.length})
          </Button>
        </div>
        {!canSubmit && (
          <p className="text-right text-xs text-muted-foreground">
            View only — you need create permission on the Quality Score module to submit.
          </p>
        )}
      </div>
    </ERPLayout>
  );
}
