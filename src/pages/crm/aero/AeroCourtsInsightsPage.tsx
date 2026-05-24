import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  PIPELINE_STAGES, STAGE_LABEL, PadelCourt, PadelDemo, PadelAgreement, fmtPKR,
} from "./types";

export default function AeroCourtsInsightsPage() {
  const [courts, setCourts] = useState<PadelCourt[]>([]);
  const [demos, setDemos] = useState<PadelDemo[]>([]);
  const [agreements, setAgreements] = useState<PadelAgreement[]>([]);

  useEffect(() => {
    (async () => {
      const [c, d, a] = await Promise.all([
        supabase.from("padel_courts").select("*"),
        supabase.from("padel_demo_sessions").select("*"),
        supabase.from("padel_supply_agreements").select("*"),
      ]);
      setCourts((c.data ?? []) as PadelCourt[]);
      setDemos((d.data ?? []) as PadelDemo[]);
      setAgreements((a.data ?? []) as PadelAgreement[]);
    })();
  }, []);

  const stageCounts = useMemo(() => {
    const m: Record<string, number> = {};
    PIPELINE_STAGES.forEach(s => (m[s] = 0));
    courts.forEach(c => { m[c.pipeline_stage] = (m[c.pipeline_stage] ?? 0) + 1; });
    return m;
  }, [courts]);

  const max = Math.max(1, ...Object.values(stageCounts));

  const ninetyAgo = useMemo(() => Date.now() - 90 * 86400_000, []);
  const completedDemos = demos.filter(d => d.completed_at);
  const recentDemos = completedDemos.filter(d => new Date(d.completed_at!).getTime() >= ninetyAgo);

  const avg = (nums: (number | null)[]) => {
    const arr = nums.filter((n): n is number => typeof n === "number");
    return arr.length ? (arr.reduce((s, n) => s + n, 0) / arr.length).toFixed(1) : "—";
  };

  const trialCount = courts.filter(c => c.pipeline_stage === "trial_supply").length;
  const houseCount = courts.filter(c => c.pipeline_stage === "house_ball").length;
  const demoToTrial = completedDemos.length ? Math.round((trialCount / completedDemos.length) * 100) : 0;
  const trialToHouse = trialCount + houseCount > 0 ? Math.round((houseCount / (trialCount + houseCount)) * 100) : 0;

  const activeAgreements = agreements.filter(a => a.status !== "Closed" && a.status !== "Rejected");
  const totalMonthly = activeAgreements.reduce((s, a) => s + Number(a.monthly_volume ?? 0), 0);

  const in30 = Date.now() + 30 * 86400_000;
  const renewals = activeAgreements.filter(a => a.end_date && new Date(a.end_date).getTime() <= in30);

  return (
    <ERPLayout>
      <PageHeader title="Aero Courts Insights" description="Pipeline analytics & supply performance">
        <Button asChild variant="outline" size="sm">
          <Link to="/crm/aero-courts"><ArrowLeft className="h-4 w-4 mr-1" />Back to Pipeline</Link>
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <KPI label="Total Courts" value={String(courts.length)} />
        <KPI label="Active Agreements" value={String(activeAgreements.length)} />
        <KPI label="Total Monthly Volume" value={totalMonthly.toLocaleString()} />
        <KPI label="Renewals in 30d" value={String(renewals.length)} />
      </div>

      <Card className="mb-4">
        <CardHeader><CardTitle className="text-base">Pipeline Funnel</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {PIPELINE_STAGES.map(s => (
            <div key={s} className="flex items-center gap-3">
              <div className="w-32 text-xs text-muted-foreground">{STAGE_LABEL[s]}</div>
              <div className="flex-1 h-6 bg-muted rounded">
                <div className="h-6 bg-primary rounded" style={{ width: `${(stageCounts[s] / max) * 100}%` }} />
              </div>
              <div className="w-10 text-right text-sm font-medium">{stageCounts[s]}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Conversion</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span>Demo Completed → Trial Supply</span><span className="font-semibold">{demoToTrial}%</span></div>
            <div className="flex justify-between"><span>Trial Supply → House Ball</span><span className="font-semibold">{trialToHouse}%</span></div>
            <div className="flex justify-between"><span>Demos completed (last 90d)</span><span>{recentDemos.length}</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Avg Demo Ratings (last 90d)</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span>Performance</span><span className="font-semibold">{avg(recentDemos.map(d => d.performance_rating))}</span></div>
            <div className="flex justify-between"><span>Pressure retention</span><span className="font-semibold">{avg(recentDemos.map(d => d.pressure_retention_rating))}</span></div>
            <div className="flex justify-between"><span>Durability</span><span className="font-semibold">{avg(recentDemos.map(d => d.durability_rating))}</span></div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Renewals due in 30 days</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Agreement</TableHead><TableHead>Type</TableHead>
              <TableHead className="text-right">Monthly Vol.</TableHead>
              <TableHead className="text-right">Unit Price</TableHead>
              <TableHead>End Date</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {renewals.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-4">None</TableCell></TableRow>
              )}
              {renewals.map(a => (
                <TableRow key={a.id}>
                  <TableCell className="text-xs">{a.agreement_number}</TableCell>
                  <TableCell className="text-xs capitalize">{a.type}</TableCell>
                  <TableCell className="text-xs text-right">{Number(a.monthly_volume ?? 0).toLocaleString()}</TableCell>
                  <TableCell className="text-xs text-right">{fmtPKR(a.unit_price)}</TableCell>
                  <TableCell className="text-xs">{a.end_date}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </ERPLayout>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <Card><CardContent className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </CardContent></Card>
  );
}
