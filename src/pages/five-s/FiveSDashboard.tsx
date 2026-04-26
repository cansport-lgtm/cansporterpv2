import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from "recharts";
import { ClipboardCheck, TrendingUp, AlertTriangle, Clock } from "lucide-react";
import { format, subMonths, parseISO } from "date-fns";

const S_CATEGORIES = ['Sort', 'Set in Order', 'Shine', 'Standardize', 'Sustain'];
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'];

export default function FiveSDashboard() {
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");

  const { data: departments = [] } = useQuery({
    queryKey: ['five-s-departments'],
    queryFn: async () => {
      const { data } = await supabase.from('five_s_departments').select('id, name').eq('is_active', true).order('name');
      return data || [];
    },
  });

  const { data: audits = [] } = useQuery({
    queryKey: ['five-s-audits-dashboard', departmentFilter],
    queryFn: async () => {
      let query = supabase.from('five_s_audits').select(`
        *, 
        five_s_departments(name),
        app_users!five_s_audits_auditor_id_fkey(full_name)
      `).order('audit_date', { ascending: false });
      if (departmentFilter !== 'all') query = query.eq('department_id', departmentFilter);
      const { data } = await query;
      return data || [];
    },
  });

  const { data: responses = [] } = useQuery({
    queryKey: ['five-s-responses-dashboard', departmentFilter],
    queryFn: async () => {
      let query = supabase.from('five_s_audit_responses').select(`
        *,
        five_s_checkpoints(category),
        five_s_audits!inner(department_id, audit_date, status)
      `).eq('five_s_audits.status', 'completed');
      if (departmentFilter !== 'all') query = query.eq('five_s_audits.department_id', departmentFilter);
      const { data } = await query;
      return data || [];
    },
  });

  const { data: actionItems = [] } = useQuery({
    queryKey: ['five-s-actions-dashboard', departmentFilter],
    queryFn: async () => {
      let query = supabase.from('five_s_action_items').select('*');
      if (departmentFilter !== 'all') query = query.eq('department_id', departmentFilter);
      const { data } = await query;
      return data || [];
    },
  });

  const completedAudits = audits.filter(a => a.status === 'completed');
  const avgScore = completedAudits.length > 0
    ? (completedAudits.reduce((sum, a) => sum + Number(a.overall_score || 0), 0) / completedAudits.length).toFixed(1)
    : '0';

  const openActions = actionItems.filter(a => a.status === 'open' || a.status === 'in_progress').length;
  const overdueActions = actionItems.filter(a => a.status === 'overdue' || (a.due_date && new Date(a.due_date) < new Date() && a.status !== 'completed')).length;

  // Category-wise compliance from completed audits
  const categoryData = useMemo(() => {
    return S_CATEGORIES.map(cat => {
      const catResponses = responses.filter(r => r.five_s_checkpoints?.category === cat);
      const total = catResponses.length;
      const yes = catResponses.filter(r => r.response === 'yes').length;
      const partial = catResponses.filter(r => r.response === 'partial').length;
      const no = catResponses.filter(r => r.response === 'no').length;
      const score = total > 0 ? Math.round(((yes + partial * 0.5) / total) * 100) : 0;
      return { name: cat, score, yes, partial, no, total };
    });
  }, [responses]);

  // Trend data (last 6 months)
  const trendData = useMemo(() => {
    const months: { month: string; score: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = subMonths(new Date(), i);
      const monthStr = format(d, 'yyyy-MM');
      const monthAudits = completedAudits.filter(a => format(parseISO(a.audit_date), 'yyyy-MM') === monthStr);
      const avgMonthScore = monthAudits.length > 0
        ? monthAudits.reduce((sum, a) => sum + Number(a.overall_score || 0), 0) / monthAudits.length
        : 0;
      months.push({ month: format(d, 'MMM yy'), score: Math.round(avgMonthScore) });
    }
    return months;
  }, [completedAudits]);

  // Action items by status for pie chart
  const actionStatusData = useMemo(() => {
    const statuses = ['open', 'in_progress', 'completed', 'overdue'];
    return statuses.map(s => ({
      name: s.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
      value: actionItems.filter(a => a.status === s).length,
    })).filter(d => d.value > 0);
  }, [actionItems]);

  const PIE_COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444'];

  return (
    <ERPLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <PageHeader title="5S Dashboard" description="5S Implementation & Audit Overview" />
          <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All Departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map(d => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Metric Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard title="Total Audits" value={audits.length} icon={ClipboardCheck} />
          <MetricCard title="Avg. Compliance" value={`${avgScore}%`} icon={TrendingUp} />
          <MetricCard title="Open Actions" value={openActions} icon={Clock} />
          <MetricCard title="Overdue Actions" value={overdueActions} icon={AlertTriangle} />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Category-wise Scores */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Category-wise Compliance (%)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={categoryData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <Bar dataKey="score" fill="hsl(var(--primary))">
                    {categoryData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Trend Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Compliance Trend (6 Months)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <Line type="monotone" dataKey="score" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Bottom Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Action Items Pie */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Action Items Status</CardTitle>
            </CardHeader>
            <CardContent>
              {actionStatusData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={actionStatusData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                      {actionStatusData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-center text-muted-foreground py-10">No action items yet</p>
              )}
            </CardContent>
          </Card>

          {/* Recent Audits */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Audits</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 max-h-[250px] overflow-y-auto">
                {audits.slice(0, 8).map(audit => (
                  <div key={audit.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div>
                      <p className="text-sm font-medium">{audit.audit_number}</p>
                      <p className="text-xs text-muted-foreground">
                        {(audit as any).five_s_departments?.name} • {format(parseISO(audit.audit_date), 'dd MMM yyyy')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={audit.status === 'completed' ? 'default' : audit.status === 'in_progress' ? 'secondary' : 'outline'}>
                        {audit.status}
                      </Badge>
                      {audit.status === 'completed' && (
                        <span className="text-sm font-semibold">{Number(audit.overall_score).toFixed(0)}%</span>
                      )}
                    </div>
                  </div>
                ))}
                {audits.length === 0 && (
                  <p className="text-center text-muted-foreground py-4">No audits conducted yet</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </ERPLayout>
  );
}
