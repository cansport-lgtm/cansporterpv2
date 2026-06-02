import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Target, Settings2 } from "lucide-react";
import { toast } from "sonner";

type KpiKey =
  | "new_leads" | "qualified_leads" | "qualification_rate" | "avg_leads_per_day"
  | "leads_converted" | "lead_to_deal_rate" | "avg_conversion_days" | "deals_created"
  | "pipeline_value" | "won_revenue" | "win_rate" | "loss_rate" | "avg_deal_size" | "avg_sales_cycle_days" | "open_pipeline_value"
  | "activities_logged" | "activities_completed" | "activity_completion_rate" | "campaigns_published" | "content_assets_created" | "customer_visits"
  | "competitor_updates" | "brand_positioning_updates";

interface KpiDef { key: KpiKey; label: string; group: "leads"|"conversion"|"pipeline"|"activity"|"brand"; format?: "num"|"pct"|"currency"|"days"; }

const KPI_DEFS: KpiDef[] = [
  { key: "new_leads", label: "New leads added", group: "leads", format: "num" },
  { key: "qualified_leads", label: "Qualified leads", group: "leads", format: "num" },
  { key: "qualification_rate", label: "Qualification rate", group: "leads", format: "pct" },
  { key: "avg_leads_per_day", label: "Avg leads / day", group: "leads", format: "num" },

  { key: "leads_converted", label: "Leads converted to deals", group: "conversion", format: "num" },
  { key: "lead_to_deal_rate", label: "Lead-to-deal conversion %", group: "conversion", format: "pct" },
  { key: "avg_conversion_days", label: "Avg time to convert (days)", group: "conversion", format: "days" },
  { key: "deals_created", label: "Deals created", group: "conversion", format: "num" },

  { key: "pipeline_value", label: "Pipeline value created", group: "pipeline", format: "currency" },
  { key: "won_revenue", label: "Won revenue", group: "pipeline", format: "currency" },
  { key: "win_rate", label: "Win rate", group: "pipeline", format: "pct" },
  { key: "loss_rate", label: "Loss rate", group: "pipeline", format: "pct" },
  { key: "avg_deal_size", label: "Average deal size", group: "pipeline", format: "currency" },
  { key: "avg_sales_cycle_days", label: "Avg sales cycle (days)", group: "pipeline", format: "days" },
  { key: "open_pipeline_value", label: "Open pipeline value (current)", group: "pipeline", format: "currency" },

  { key: "activities_logged", label: "Activities logged", group: "activity", format: "num" },
  { key: "activities_completed", label: "Activities completed", group: "activity", format: "num" },
  { key: "activity_completion_rate", label: "Activity completion rate", group: "activity", format: "pct" },
  { key: "campaigns_published", label: "Content campaigns published", group: "activity", format: "num" },
  { key: "content_assets_created", label: "Content assets created", group: "activity", format: "num" },
  { key: "customer_visits", label: "Customer visits", group: "activity", format: "num" },

  { key: "competitor_updates", label: "Competitor entries updated", group: "brand", format: "num" },
  { key: "brand_positioning_updates", label: "Brand positioning updates", group: "brand", format: "num" },
];

const fmtPKR = (n: number) => `Rs. ${Math.round(n).toLocaleString()}`;
const fmtVal = (n: number, fmt?: KpiDef["format"]) => {
  if (!isFinite(n)) return "—";
  if (fmt === "currency") return fmtPKR(n);
  if (fmt === "pct") return `${n.toFixed(1)}%`;
  if (fmt === "days") return `${n.toFixed(1)}d`;
  return Math.round(n).toLocaleString();
};

function firstOfMonthStr() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function monthOf(dateStr: string) {
  const d = new Date(dateStr);
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string) {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return ms / (1000 * 60 * 60 * 24);
}

interface TargetRow { id?: string; month: string; kpi_key: string; target_value: number; }

export default function CRMMarketingKPIsPage() {
  const [from, setFrom] = useState(firstOfMonthStr());
  const [to, setTo] = useState(todayStr());
  const [loading, setLoading] = useState(false);
  const [actuals, setActuals] = useState<Record<string, number>>({});
  const [bySource, setBySource] = useState<Array<{ source: string; count: number }>>([]);
  const [stageFunnel, setStageFunnel] = useState<Array<{ stage: string; count: number; value: number }>>([]);
  const [topLost, setTopLost] = useState<Array<{ reason: string; count: number }>>([]);
  const [targets, setTargets] = useState<Record<string, number>>({});
  const [targetMonth, setTargetMonth] = useState(firstOfMonthStr());
  const [setOpen, setSetOpen] = useState(false);
  const [editTargets, setEditTargets] = useState<Record<string, string>>({});

  const compute = async () => {
    setLoading(true);
    try {
      const fromIso = `${from}T00:00:00.000Z`;
      const toIso = `${to}T23:59:59.999Z`;

      const [leadsRes, dealsRes, actsRes, campRes, assetsRes, visitsRes, compRes, brandRes, openDealsRes] = await Promise.all([
        supabase.from("crm_leads").select("id,status,source,created_at,converted_deal_id,updated_at").gte("created_at", fromIso).lte("created_at", toIso),
        supabase.from("crm_deals").select("id,stage,value,created_at,won_at,lost_reason").gte("created_at", fromIso).lte("created_at", toIso),
        supabase.from("crm_activities").select("id,completed,created_at").gte("created_at", fromIso).lte("created_at", toIso),
        supabase.from("crm_content_campaigns").select("id,created_at,status").gte("created_at", fromIso).lte("created_at", toIso),
        supabase.from("crm_content_assets").select("id,created_at").gte("created_at", fromIso).lte("created_at", toIso),
        supabase.from("customer_visits").select("id,visit_date").gte("visit_date", from).lte("visit_date", to),
        supabase.from("crm_competitors").select("id,updated_at").gte("updated_at", fromIso).lte("updated_at", toIso),
        supabase.from("crm_brand_positioning").select("id,updated_at").gte("updated_at", fromIso).lte("updated_at", toIso),
        supabase.from("crm_deals").select("id,value,stage").not("stage", "in", "(won,lost)"),
      ]);

      // Won deals (closed in range) — separate query for won_at filter
      const wonRes = await supabase.from("crm_deals").select("id,value,created_at,won_at").gte("won_at", fromIso).lte("won_at", toIso);

      const leads = leadsRes.data || [];
      const deals = dealsRes.data || [];
      const acts = actsRes.data || [];
      const camps = campRes.data || [];
      const assets = assetsRes.data || [];
      const visits = visitsRes.data || [];
      const comps = compRes.data || [];
      const brand = brandRes.data || [];
      const openDeals = openDealsRes.data || [];
      const wonDeals = wonRes.data || [];

      // Leads
      const newLeads = leads.length;
      const qualified = leads.filter((l: any) => !["new", "lost", "unqualified"].includes((l.status || "").toLowerCase())).length;
      const qualRate = newLeads > 0 ? (qualified / newLeads) * 100 : 0;
      const periodDays = Math.max(1, daysBetween(from, to) + 1);
      const avgPerDay = newLeads / periodDays;

      const sourceMap = new Map<string, number>();
      leads.forEach((l: any) => { const s = l.source || "(unspecified)"; sourceMap.set(s, (sourceMap.get(s) || 0) + 1); });
      const bySrc = Array.from(sourceMap.entries()).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count);

      // Conversion
      const converted = leads.filter((l: any) => !!l.converted_deal_id);
      const leadsConverted = converted.length;
      const leadToDealRate = newLeads > 0 ? (leadsConverted / newLeads) * 100 : 0;
      const convDays = converted
        .map((l: any) => daysBetween(l.created_at, l.updated_at))
        .filter((d: number) => isFinite(d) && d >= 0);
      const avgConvDays = convDays.length ? convDays.reduce((a, b) => a + b, 0) / convDays.length : 0;
      const dealsCreated = deals.length;

      // Pipeline & revenue
      const pipelineValue = deals.reduce((s: number, d: any) => s + Number(d.value || 0), 0);
      const wonRevenue = wonDeals.reduce((s: number, d: any) => s + Number(d.value || 0), 0);
      const wonInPeriod = wonDeals.length;
      const lostInPeriod = deals.filter((d: any) => (d.stage || "").toLowerCase() === "lost").length;
      const closed = wonInPeriod + lostInPeriod;
      const winRate = closed > 0 ? (wonInPeriod / closed) * 100 : 0;
      const lossRate = closed > 0 ? (lostInPeriod / closed) * 100 : 0;
      const avgDealSize = wonInPeriod > 0 ? wonRevenue / wonInPeriod : 0;
      const cycleDays = wonDeals
        .map((d: any) => d.won_at && d.created_at ? daysBetween(d.created_at, d.won_at) : NaN)
        .filter((x: number) => isFinite(x) && x >= 0);
      const avgCycle = cycleDays.length ? cycleDays.reduce((a, b) => a + b, 0) / cycleDays.length : 0;
      const openValue = openDeals.reduce((s: number, d: any) => s + Number(d.value || 0), 0);

      const stageMap = new Map<string, { count: number; value: number }>();
      [...openDeals, ...deals].forEach((d: any) => {
        const k = d.stage || "—";
        const cur = stageMap.get(k) || { count: 0, value: 0 };
        stageMap.set(k, { count: cur.count + 1, value: cur.value + Number(d.value || 0) });
      });
      const funnel = Array.from(stageMap.entries()).map(([stage, v]) => ({ stage, ...v }));

      const lostMap = new Map<string, number>();
      deals.filter((d: any) => (d.stage || "").toLowerCase() === "lost" && d.lost_reason).forEach((d: any) => {
        lostMap.set(d.lost_reason, (lostMap.get(d.lost_reason) || 0) + 1);
      });
      const lostTop = Array.from(lostMap.entries()).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 5);

      // Activity
      const actsLogged = acts.length;
      const actsCompleted = acts.filter((a: any) => a.completed).length;
      const actCompRate = actsLogged > 0 ? (actsCompleted / actsLogged) * 100 : 0;
      const campsPublished = camps.filter((c: any) => (c.status || "").toLowerCase() === "published" || (c.status || "").toLowerCase() === "live").length || camps.length;
      const assetsCreated = assets.length;
      const visitCount = visits.length;

      const a: Record<string, number> = {
        new_leads: newLeads, qualified_leads: qualified, qualification_rate: qualRate, avg_leads_per_day: avgPerDay,
        leads_converted: leadsConverted, lead_to_deal_rate: leadToDealRate, avg_conversion_days: avgConvDays, deals_created: dealsCreated,
        pipeline_value: pipelineValue, won_revenue: wonRevenue, win_rate: winRate, loss_rate: lossRate,
        avg_deal_size: avgDealSize, avg_sales_cycle_days: avgCycle, open_pipeline_value: openValue,
        activities_logged: actsLogged, activities_completed: actsCompleted, activity_completion_rate: actCompRate,
        campaigns_published: campsPublished, content_assets_created: assetsCreated, customer_visits: visitCount,
        competitor_updates: comps.length, brand_positioning_updates: brand.length,
      };

      setActuals(a);
      setBySource(bySrc);
      setStageFunnel(funnel);
      setTopLost(lostTop);
    } catch (e: any) {
      toast.error(e.message || "Failed to compute KPIs");
    } finally {
      setLoading(false);
    }
  };

  const fetchTargets = async () => {
    const month = monthOf(from);
    const { data, error } = await supabase
      .from("crm_marketing_kpi_targets")
      .select("kpi_key,target_value,month")
      .eq("month", month);
    if (error) { toast.error(error.message); return; }
    const t: Record<string, number> = {};
    (data || []).forEach((r: any) => { t[r.kpi_key] = Number(r.target_value || 0); });
    setTargets(t);
  };

  useEffect(() => { compute(); fetchTargets(); /* eslint-disable-next-line */ }, []);

  const onApply = async () => { await Promise.all([compute(), fetchTargets()]); };

  const openSetTargets = async () => {
    setTargetMonth(monthOf(from));
    const { data } = await supabase
      .from("crm_marketing_kpi_targets")
      .select("kpi_key,target_value")
      .eq("month", monthOf(from));
    const seed: Record<string, string> = {};
    KPI_DEFS.forEach(k => { seed[k.key] = ""; });
    (data || []).forEach((r: any) => { seed[r.kpi_key] = String(r.target_value); });
    setEditTargets(seed);
    setSetOpen(true);
  };

  const saveTargets = async () => {
    const rows = KPI_DEFS
      .filter(k => editTargets[k.key] !== "" && !isNaN(Number(editTargets[k.key])))
      .map(k => ({ month: targetMonth, kpi_key: k.key, target_value: Number(editTargets[k.key]) }));
    if (!rows.length) { setSetOpen(false); return; }
    const { error } = await supabase
      .from("crm_marketing_kpi_targets")
      .upsert(rows, { onConflict: "month,kpi_key" });
    if (error) { toast.error(error.message); return; }
    toast.success("Targets saved");
    setSetOpen(false);
    fetchTargets();
  };

  const groups = useMemo(() => ({
    leads: KPI_DEFS.filter(k => k.group === "leads"),
    conversion: KPI_DEFS.filter(k => k.group === "conversion"),
    pipeline: KPI_DEFS.filter(k => k.group === "pipeline"),
    activity: KPI_DEFS.filter(k => k.group === "activity"),
    brand: KPI_DEFS.filter(k => k.group === "brand"),
  }), []);

  const renderKpiTable = (defs: KpiDef[]) => (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>KPI</TableHead>
              <TableHead className="text-right">Target</TableHead>
              <TableHead className="text-right">Actual</TableHead>
              <TableHead className="text-right">Achievement</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {defs.map(def => {
              const actual = Number(actuals[def.key] || 0);
              const target = Number(targets[def.key] || 0);
              const ach = target > 0 ? (actual / target) * 100 : 0;
              const display = Math.min(ach, 200);
              const variant: "default" | "secondary" | "destructive" = ach >= 90 ? "default" : ach >= 60 ? "secondary" : "destructive";
              const label = target > 0 ? `${display.toFixed(0)}%` : "—";
              return (
                <TableRow key={def.key}>
                  <TableCell className="font-medium">{def.label}</TableCell>
                  <TableCell className="text-right">{target > 0 ? fmtVal(target, def.format) : <span className="text-muted-foreground">not set</span>}</TableCell>
                  <TableCell className="text-right">{fmtVal(actual, def.format)}</TableCell>
                  <TableCell className="text-right">{label}</TableCell>
                  <TableCell>{target > 0 ? <Badge variant={variant}>{ach >= 90 ? "On track" : ach >= 60 ? "At risk" : "Behind"}</Badge> : <span className="text-muted-foreground text-xs">—</span>}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  return (
    <ERPLayout>
      <PageHeader
        title="Marketing KPIs"
        description="Marketing Manager scorecard — targets vs actuals across CRM"
        icon={Target}
      />

      <Card className="mb-4">
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div>
            <Label>From</Label>
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-44" />
          </div>
          <div>
            <Label>To</Label>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-44" />
          </div>
          <Button onClick={onApply} disabled={loading}>{loading ? "Loading..." : "Apply"}</Button>
          <Button variant="outline" onClick={openSetTargets}><Settings2 className="h-4 w-4 mr-2" />Set Monthly Targets</Button>
          <div className="ml-auto text-sm text-muted-foreground">
            Targets month: <span className="font-medium">{monthOf(from)}</span>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="leads">
        <TabsList>
          <TabsTrigger value="leads">Leads</TabsTrigger>
          <TabsTrigger value="conversion">Conversion</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline & Revenue</TabsTrigger>
          <TabsTrigger value="activity">Activity & Content</TabsTrigger>
          <TabsTrigger value="brand">Brand</TabsTrigger>
        </TabsList>

        <TabsContent value="leads" className="space-y-4">
          {renderKpiTable(groups.leads)}
          <Card>
            <CardHeader><CardTitle className="text-base">Leads by source</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Source</TableHead><TableHead className="text-right">Leads</TableHead></TableRow></TableHeader>
                <TableBody>
                  {bySource.length === 0 && <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">No leads in range</TableCell></TableRow>}
                  {bySource.map(r => <TableRow key={r.source}><TableCell>{r.source}</TableCell><TableCell className="text-right">{r.count}</TableCell></TableRow>)}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="conversion" className="space-y-4">
          {renderKpiTable(groups.conversion)}
        </TabsContent>

        <TabsContent value="pipeline" className="space-y-4">
          {renderKpiTable(groups.pipeline)}
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Stage funnel</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>Stage</TableHead><TableHead className="text-right">Deals</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {stageFunnel.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No deals</TableCell></TableRow>}
                    {stageFunnel.map(s => <TableRow key={s.stage}><TableCell>{s.stage}</TableCell><TableCell className="text-right">{s.count}</TableCell><TableCell className="text-right">{fmtPKR(s.value)}</TableCell></TableRow>)}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Top lost reasons</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>Reason</TableHead><TableHead className="text-right">Count</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {topLost.length === 0 && <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">No lost deals</TableCell></TableRow>}
                    {topLost.map(r => <TableRow key={r.reason}><TableCell>{r.reason}</TableCell><TableCell className="text-right">{r.count}</TableCell></TableRow>)}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="activity" className="space-y-4">{renderKpiTable(groups.activity)}</TabsContent>
        <TabsContent value="brand" className="space-y-4">{renderKpiTable(groups.brand)}</TabsContent>
      </Tabs>

      <Dialog open={setOpen} onOpenChange={setSetOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Set Monthly Targets</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Month</Label>
              <Input type="month" value={targetMonth.slice(0, 7)} onChange={e => setTargetMonth(`${e.target.value}-01`)} className="w-44" />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {KPI_DEFS.map(k => (
                <div key={k.key}>
                  <Label className="text-xs">{k.label}</Label>
                  <Input
                    type="number"
                    value={editTargets[k.key] ?? ""}
                    onChange={e => setEditTargets(prev => ({ ...prev, [k.key]: e.target.value }))}
                    placeholder="0"
                  />
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSetOpen(false)}>Cancel</Button>
            <Button onClick={saveTargets}>Save Targets</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
