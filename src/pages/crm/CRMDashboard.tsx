import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Users, Target, TrendingUp, Trophy, ArrowRight, Activity } from "lucide-react";
import { format } from "date-fns";

const STAGES = ["prospecting", "qualification", "proposal", "negotiation", "won", "lost"];
const STAGE_LABELS: Record<string, string> = {
  prospecting: "Prospecting",
  qualification: "Qualification",
  proposal: "Proposal",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
};
const STAGE_COLORS: Record<string, string> = {
  prospecting: "bg-blue-500",
  qualification: "bg-cyan-500",
  proposal: "bg-amber-500",
  negotiation: "bg-orange-500",
  won: "bg-green-500",
  lost: "bg-red-500",
};

export default function CRMDashboard() {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [lRes, dRes, aRes] = await Promise.all([
      supabase.from("crm_leads").select("*").order("created_at", { ascending: false }),
      supabase.from("crm_deals").select("*").order("created_at", { ascending: false }),
      supabase
        .from("crm_activities")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
    setLeads(lRes.data || []);
    setDeals(dRes.data || []);
    setActivities(aRes.data || []);
  };

  const openLeads = leads.filter((l) => !["converted", "unqualified"].includes(l.status));
  const pipelineDeals = deals.filter((d) => !["won", "lost"].includes(d.stage));
  const pipelineValue = pipelineDeals.reduce((s, d) => s + Number(d.value || 0), 0);
  const wonThisMonth = deals.filter((d) => {
    if (d.stage !== "won" || !d.won_at) return false;
    const w = new Date(d.won_at);
    const n = new Date();
    return w.getMonth() === n.getMonth() && w.getFullYear() === n.getFullYear();
  });
  const wonValue = wonThisMonth.reduce((s, d) => s + Number(d.value || 0), 0);
  const totalClosed = deals.filter((d) => ["won", "lost"].includes(d.stage)).length;
  const conversionRate =
    totalClosed > 0
      ? Math.round((deals.filter((d) => d.stage === "won").length / totalClosed) * 100)
      : 0;

  const stageCounts = STAGES.map((s) => ({
    stage: s,
    count: deals.filter((d) => d.stage === s).length,
    value: deals
      .filter((d) => d.stage === s)
      .reduce((sum, d) => sum + Number(d.value || 0), 0),
  }));
  const maxCount = Math.max(...stageCounts.map((s) => s.count), 1);

  const topDeals = [...pipelineDeals]
    .sort((a, b) => Number(b.value || 0) - Number(a.value || 0))
    .slice(0, 5);

  const fmt = (n: number) =>
    `Rs. ${new Intl.NumberFormat("en-PK").format(Math.round(n))}`;

  return (
    <ERPLayout>
      <PageHeader
        title="CRM Dashboard"
        description="Leads, deals pipeline & sales activities"
        icon={Target}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MetricCard title="Open Leads" value={openLeads.length} icon={Users} iconColor="text-blue-500" />
        <MetricCard
          title="Pipeline Value"
          value={fmt(pipelineValue)}
          icon={TrendingUp}
          iconColor="text-amber-500"
          description={`${pipelineDeals.length} active deals`}
        />
        <MetricCard
          title="Won This Month"
          value={fmt(wonValue)}
          icon={Trophy}
          iconColor="text-green-500"
          description={`${wonThisMonth.length} deals`}
        />
        <MetricCard
          title="Conversion Rate"
          value={`${conversionRate}%`}
          icon={Activity}
          iconColor="text-fuchsia-500"
          description={`${totalClosed} closed`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Pipeline Funnel</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/crm/deals")}>
              View Pipeline <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stageCounts.map((s) => (
                <div key={s.stage} className="flex items-center gap-3">
                  <div className="w-28 text-xs font-medium">{STAGE_LABELS[s.stage]}</div>
                  <div className="flex-1 bg-muted rounded h-7 relative overflow-hidden">
                    <div
                      className={`absolute inset-y-0 left-0 ${STAGE_COLORS[s.stage]} opacity-80 transition-all`}
                      style={{ width: `${(s.count / maxCount) * 100}%` }}
                    />
                    <div className="absolute inset-0 flex items-center justify-between px-2 text-xs font-semibold">
                      <span>{s.count} deals</span>
                      <span className="text-muted-foreground">{fmt(s.value)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Top Pipeline Deals</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/crm/deals")}>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {topDeals.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No deals yet</p>
            ) : (
              <div className="space-y-2">
                {topDeals.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between p-2 rounded border bg-card text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{d.title}</p>
                      <p className="text-xs text-muted-foreground">{d.deal_number}</p>
                    </div>
                    <div className="text-right ml-2">
                      <p className="font-semibold">{fmt(Number(d.value || 0))}</p>
                      <Badge variant="secondary" className="text-[10px]">
                        {STAGE_LABELS[d.stage] || d.stage}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Recent Activities</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => navigate("/crm/activities")}>
            View All <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </CardHeader>
        <CardContent>
          {activities.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No activities logged yet
            </p>
          ) : (
            <div className="space-y-2">
              {activities.map((a) => (
                <div
                  key={a.id}
                  className="flex items-start gap-3 p-2 rounded border bg-card text-sm"
                >
                  <Badge variant="outline" className="text-[10px] mt-0.5 capitalize">
                    {a.activity_type}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{a.subject}</p>
                    {a.description && (
                      <p className="text-xs text-muted-foreground truncate">
                        {a.description}
                      </p>
                    )}
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    {a.due_date ? format(new Date(a.due_date), "dd MMM") : "—"}
                    {a.completed && (
                      <Badge className="ml-2 bg-green-100 text-green-700 text-[10px]">
                        Done
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </ERPLayout>
  );
}
