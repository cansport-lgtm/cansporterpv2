import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Globe, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  EntryContextSection, useQsEntryContext,
} from "@/components/quality-score/EntryContextSection";
import {
  fmtScore, round2, useQsParameters, useQsSettings,
} from "@/components/quality-score/qsShared";

export default function BallQualityEntryPage() {
  const qc = useQueryClient();
  const { user, hasModulePermission, hasRole } = useAuth();
  const canSubmit = hasRole("super_admin") || hasModulePermission("quality_score", "create");
  const ctx = useQsEntryContext();
  const { data: settings } = useQsSettings();
  const { data: parameters = [] } = useQsParameters("ball");
  const activeParams = useMemo(() => parameters.filter((p) => p.is_active), [parameters]);

  const [scores, setScores] = useState<Record<string, string>>({});

  const myScore = useMemo(
    () => ctx.entry?.ball_scores?.find((s) => s.inspector_id === user?.id),
    [ctx.entry, user?.id],
  );

  // Prefill from an earlier submission for this context (resubmitting overwrites it)
  useEffect(() => {
    if (myScore?.params?.length) {
      setScores(Object.fromEntries(myScore.params.map((p) => [p.parameter_id, String(p.score)])));
    } else {
      setScores({});
    }
  }, [myScore?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = activeParams.map((p) => ({ param: p, value: parseFloat(scores[p.id] ?? "") }));
  const allValid = parsed.length > 0 && parsed.every(
    ({ value }) => !Number.isNaN(value) && value >= 0 && value <= 10,
  );
  const totalWeight = round2(activeParams.reduce((sum, p) => sum + Number(p.weight), 0));
  const preview = allValid && totalWeight === 100
    ? round2(parsed.reduce((sum, { param, value }) => sum + value * Number(param.weight), 0) / 100)
    : null;

  const submit = useMutation({
    mutationFn: async () => {
      if (!ctx.ready) throw new Error("Pick a date and department first");
      if (!allValid) throw new Error("Every parameter needs a score between 0 and 10");
      const entryId = await ctx.findOrCreateEntry();
      const { data, error } = await (supabase as any).rpc("qs_submit_ball_score", {
        p_entry_id: entryId,
        p_inspector_id: user!.id,
        p_scores: parsed.map(({ param, value }) => ({ parameter_id: param.id, score: value })),
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (weighted) => {
      toast.success(`Ball Quality score submitted — ${fmtScore(Number(weighted))} / 10`);
      qc.invalidateQueries({ queryKey: ["qs-entry-context"] });
      qc.invalidateQueries({ queryKey: ["qs-entries"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const submitted = ctx.entry?.ball_scores ?? [];
  const target = settings?.ball_inspector_count ?? 3;

  return (
    <ERPLayout>
      <div className="w-full max-w-3xl space-y-4">
        <PageHeader
          title="Ball Quality — Inspector Entry"
          description="Rate the parameters; the weighted score is calculated automatically"
          icon={Globe}
        />

        <EntryContextSection ctx={ctx} />

        {ctx.ready && (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-2 p-4 text-sm">
              <Badge variant={submitted.length >= target ? "success" : "warning"}>
                {submitted.length} of {target} inspectors submitted
              </Badge>
              {submitted.map((s) => (
                <Badge key={s.id} variant="secondary">
                  {s.inspector?.full_name ?? "Inspector"} · {fmtScore(Number(s.weighted_score))}
                </Badge>
              ))}
              {myScore && (
                <span className="text-xs text-muted-foreground">
                  You already submitted — saving again updates your score.
                </span>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="space-y-5 p-6">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold">Parameter Scores</h3>
              <span className="text-xs text-muted-foreground">0–10 scale</span>
            </div>
            {totalWeight !== 100 && (
              <div className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
                Active ball parameter weights total {totalWeight}% — a manager must fix the
                Parameters Master before scores can be submitted.
              </div>
            )}
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
                  value={scores[p.id] ?? ""}
                  onChange={(e) => setScores((s) => ({ ...s, [p.id]: e.target.value }))}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-brand-gradient-soft">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">
                Your weighted Ball Quality score
              </div>
              <div className="text-xs text-muted-foreground">
                Computed server-side from the master weights on submit
              </div>
            </div>
            <div className="font-display text-3xl font-bold text-primary">
              {fmtScore(preview)}
              <span className="text-base text-muted-foreground"> / 10</span>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button
            onClick={() => submit.mutate()}
            disabled={!canSubmit || !ctx.ready || !allValid || totalWeight !== 100 || submit.isPending}
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            {myScore ? "Update My Score" : "Submit Score"}
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
