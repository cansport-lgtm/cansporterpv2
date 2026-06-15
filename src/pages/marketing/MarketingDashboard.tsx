import { useEffect, useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Megaphone, ListTodo, AlertTriangle, CheckCircle2, Calendar as CalendarIcon, Users } from "lucide-react";
import { format, differenceInDays, parseISO } from "date-fns";
import { Link } from "react-router-dom";
import { STATUS_COLORS } from "./constants";

export default function MarketingDashboard() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    activeCampaigns: 0,
    deliverablesOpen: 0,
    dueThisWeek: 0,
    overdue: 0,
    publishedThisMonth: 0,
    upcomingEvents: 0,
  });
  const [byStatus, setByStatus] = useState<Record<string, number>>({});
  const [upcoming, setUpcoming] = useState<any[]>([]);
  const [overdueList, setOverdueList] = useState<any[]>([]);

  useEffect(() => { load(); }, []);

  const load = async () => {
    const today = new Date();
    const weekAhead = new Date(); weekAhead.setDate(weekAhead.getDate() + 7);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const [campaignsRes, delivsRes, eventsRes] = await Promise.all([
      supabase.from("marketing_campaigns").select("*"),
      supabase.from("marketing_deliverables").select("*"),
      supabase.from("marketing_events").select("*"),
    ]);

    const camps = campaignsRes.data || [];
    const delivs = delivsRes.data || [];
    const events = eventsRes.data || [];

    const active = camps.filter(c => !["Closed","Rejected"].includes(c.status)).length;
    const open = delivs.filter(d => !["Published","Closed","Rejected"].includes(d.status)).length;
    const due = delivs.filter(d => d.planned_end && parseISO(d.planned_end) <= weekAhead && parseISO(d.planned_end) >= today && !["Published","Closed","Rejected"].includes(d.status)).length;
    const od = delivs.filter(d => d.planned_end && parseISO(d.planned_end) < today && !["Published","Closed","Rejected"].includes(d.status));
    const pub = delivs.filter(d => d.status === "Published" && d.actual_end && parseISO(d.actual_end) >= monthStart).length;
    const upEv = events.filter(e => e.planned_start && parseISO(e.planned_start) >= today).length;

    const grouped: Record<string, number> = {};
    delivs.forEach(d => { grouped[d.status] = (grouped[d.status] || 0) + 1; });

    setStats({ activeCampaigns: active, deliverablesOpen: open, dueThisWeek: due, overdue: od.length, publishedThisMonth: pub, upcomingEvents: upEv });
    setByStatus(grouped);
    setUpcoming(delivs.filter(d => d.planned_end && parseISO(d.planned_end) >= today && !["Published","Closed","Rejected"].includes(d.status)).sort((a,b)=>a.planned_end.localeCompare(b.planned_end)).slice(0,8));
    setOverdueList(od.sort((a,b)=>a.planned_end.localeCompare(b.planned_end)).slice(0,8));
    setLoading(false);
  };

  return (
    <ERPLayout>
      <PageHeader title="Marketing Dashboard" description="Department deliverables, executions & timelines" icon={Megaphone} iconColor="bg-pink-500 text-white" />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <MetricCard title="Active Campaigns" value={stats.activeCampaigns} icon={Megaphone} iconColor="text-pink-600" />
        <MetricCard title="Open Deliverables" value={stats.deliverablesOpen} icon={ListTodo} iconColor="text-blue-600" />
        <MetricCard title="Due This Week" value={stats.dueThisWeek} icon={CalendarIcon} iconColor="text-amber-600" />
        <MetricCard title="Overdue" value={stats.overdue} icon={AlertTriangle} iconColor="text-red-600" />
        <MetricCard title="Published (Month)" value={stats.publishedThisMonth} icon={CheckCircle2} iconColor="text-emerald-600" />
        <MetricCard title="Upcoming Events" value={stats.upcomingEvents} icon={Users} iconColor="text-purple-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">By Status</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {Object.keys(STATUS_COLORS).map(s => (
              <div key={s} className="flex items-center justify-between text-sm">
                <Badge variant="outline" className={STATUS_COLORS[s]}>{s}</Badge>
                <span className="font-semibold">{byStatus[s] || 0}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Upcoming Deliverables</CardTitle></CardHeader>
          <CardContent>
            {upcoming.length === 0 ? <p className="text-sm text-muted-foreground">Nothing upcoming.</p> :
              <ul className="space-y-2 text-sm">
                {upcoming.map(d => (
                  <li key={d.id} className="flex justify-between items-center border-b pb-1.5">
                    <Link to="/marketing/deliverables" className="hover:underline truncate flex-1 mr-2">{d.title}</Link>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{format(parseISO(d.planned_end), "dd MMM")}</span>
                  </li>
                ))}
              </ul>
            }
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base text-red-700">Overdue</CardTitle></CardHeader>
          <CardContent>
            {overdueList.length === 0 ? <p className="text-sm text-muted-foreground">No overdue items 🎉</p> :
              <ul className="space-y-2 text-sm">
                {overdueList.map(d => {
                  const days = differenceInDays(new Date(), parseISO(d.planned_end));
                  return (
                    <li key={d.id} className="flex justify-between items-center border-b pb-1.5">
                      <Link to="/marketing/deliverables" className="hover:underline truncate flex-1 mr-2">{d.title}</Link>
                      <span className="text-xs text-red-600 whitespace-nowrap">{days}d late</span>
                    </li>
                  );
                })}
              </ul>
            }
          </CardContent>
        </Card>
      </div>

      {loading && <p className="text-sm text-muted-foreground mt-4">Loading...</p>}
    </ERPLayout>
  );
}
