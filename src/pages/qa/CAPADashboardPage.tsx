import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { 
  Shield, 
  AlertTriangle, 
  Clock, 
  CheckCircle2, 
  TrendingUp,
  Calendar,
  Users
} from "lucide-react";
import { format, differenceInDays, parseISO, startOfMonth, subMonths } from "date-fns";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

export default function CAPADashboardPage() {
  // Fetch CAPAs
  const { data: capas = [] } = useQuery({
    queryKey: ["capa-dashboard"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_capa")
        .select(`
          *,
          qa_ncr(ncr_number, description, severity, department_id, production_departments(name)),
          responsible:app_users!qa_capa_responsible_person_fkey(full_name)
        `)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Fetch NCRs for additional metrics
  const { data: ncrs = [] } = useQuery({
    queryKey: ["ncr-dashboard"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_ncr")
        .select(`
          *,
          production_departments(name)
        `)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Calculate metrics
  const totalCAPAs = capas.length;
  const openCAPAs = capas.filter((c: any) => c.status !== 'closed' && c.status !== 'completed').length;
  const overdueCAPAs = capas.filter((c: any) => {
    if (!c.target_date || c.status === 'closed' || c.status === 'completed') return false;
    return differenceInDays(new Date(), parseISO(c.target_date)) > 0;
  }).length;
  const closedThisMonth = capas.filter((c: any) => {
    if (c.status !== 'closed' && c.status !== 'completed') return false;
    const closedDate = c.completed_at ? parseISO(c.completed_at) : parseISO(c.updated_at);
    const now = new Date();
    return closedDate.getMonth() === now.getMonth() && closedDate.getFullYear() === now.getFullYear();
  }).length;

  // Status distribution
  const statusCounts = capas.reduce((acc: any, c: any) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, {});

  const statusData = Object.entries(statusCounts).map(([status, count]) => ({
    name: status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' '),
    value: count as number,
  }));

  // Type distribution (corrective vs preventive)
  const typeCounts = capas.reduce((acc: any, c: any) => {
    acc[c.capa_type] = (acc[c.capa_type] || 0) + 1;
    return acc;
  }, {});

  const typeData = Object.entries(typeCounts).map(([type, count]) => ({
    name: type.charAt(0).toUpperCase() + type.slice(1),
    value: count as number,
  }));

  // NCR severity distribution
  const severityCounts = ncrs.reduce((acc: any, n: any) => {
    acc[n.severity] = (acc[n.severity] || 0) + 1;
    return acc;
  }, {});

  const severityData = Object.entries(severityCounts).map(([severity, count]) => ({
    name: severity.charAt(0).toUpperCase() + severity.slice(1),
    value: count as number,
    fill: severity === 'critical' ? '#ef4444' : 
          severity === 'high' ? '#f59e0b' : 
          severity === 'medium' ? '#3b82f6' : '#10b981'
  }));

  // Recent CAPAs
  const recentCAPAs = capas.slice(0, 5);

  // Overdue CAPAs list
  const overdueList = capas
    .filter((c: any) => {
      if (!c.target_date || c.status === 'closed' || c.status === 'completed') return false;
      return differenceInDays(new Date(), parseISO(c.target_date)) > 0;
    })
    .slice(0, 5);

  // Severity multipliers for weighted scoring
  const getSeverityMultiplier = (severity: string | null): number => {
    switch (severity) {
      case 'critical': return 30;
      case 'high': return 20;
      case 'medium': return 12;
      case 'low': return 10;
      default: return 10;
    }
  };

  // Month-wise CAPAs by Responsible Person (last 6 months) with severity-weighted scores
  const monthlyResponsibleData = (() => {
    const now = new Date();
    const months: { month: string; monthKey: string }[] = [];
    
    // Generate last 6 months
    for (let i = 5; i >= 0; i--) {
      const monthDate = subMonths(startOfMonth(now), i);
      months.push({
        month: format(monthDate, 'MMM yyyy'),
        monthKey: format(monthDate, 'yyyy-MM'),
      });
    }

    // Get unique responsible persons
    const responsiblePersons = new Set<string>();
    capas.forEach((c: any) => {
      if (c.responsible?.full_name) {
        responsiblePersons.add(c.responsible.full_name);
      }
    });

    // Build data for each month with severity-weighted scores
    const data = months.map(({ month, monthKey }) => {
      const monthData: any = { month };
      
      responsiblePersons.forEach((person) => {
        const personCAPAs = capas.filter((c: any) => {
          const capaMonth = format(parseISO(c.created_at), 'yyyy-MM');
          return capaMonth === monthKey && c.responsible?.full_name === person;
        });
        
        // Calculate weighted score based on NCR severity
        const weightedScore = personCAPAs.reduce((sum: number, c: any) => {
          const severity = c.qa_ncr?.severity || 'low';
          return sum + getSeverityMultiplier(severity);
        }, 0);
        
        monthData[person] = weightedScore;
      });
      
      return monthData;
    });

    return { data, persons: Array.from(responsiblePersons) };
  })();

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="CAPA Dashboard"
          description="Corrective and Preventive Action Overview"
        />

        {/* Metric Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Total CAPAs"
            value={totalCAPAs}
            icon={Shield}
            iconColor="text-blue-500"
          />
          <MetricCard
            title="Open CAPAs"
            value={openCAPAs}
            icon={Clock}
            iconColor="text-amber-500"
          />
          <MetricCard
            title="Overdue"
            value={overdueCAPAs}
            icon={AlertTriangle}
            iconColor="text-red-500"
          />
          <MetricCard
            title="Closed This Month"
            value={closedThisMonth}
            icon={CheckCircle2}
            iconColor="text-green-500"
          />
        </div>

        {/* Charts Row */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {/* Status Distribution */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">CAPA Status Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              {statusData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={statusData}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={2}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}
                      labelLine={false}
                    >
                      {statusData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                  No CAPA data
                </div>
              )}
            </CardContent>
          </Card>

          {/* Type Distribution */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">CAPA Type</CardTitle>
            </CardHeader>
            <CardContent>
              {typeData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={typeData}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={2}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}
                      labelLine={false}
                    >
                      <Cell fill="#3b82f6" />
                      <Cell fill="#8b5cf6" />
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                  No CAPA data
                </div>
              )}
            </CardContent>
          </Card>

          {/* NCR Severity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">NCR Severity Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              {severityData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={severityData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" />
                    <YAxis type="category" dataKey="name" width={70} />
                    <Tooltip />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {severityData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                  No NCR data
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Month-wise Responsible Person Chart with Severity Weighting */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4" />
              Month-wise Weighted Score by Responsible Person
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Severity multipliers: Critical (30x), High (20x), Medium (12x), Low (10x)
            </p>
          </CardHeader>
          <CardContent>
            {monthlyResponsibleData.data.length > 0 && monthlyResponsibleData.persons.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthlyResponsibleData.data}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip 
                    formatter={(value: number, name: string) => [`${value} pts`, name]}
                    labelFormatter={(label) => `Month: ${label}`}
                  />
                  <Legend />
                  {monthlyResponsibleData.persons.map((person, index) => (
                    <Bar 
                      key={person} 
                      dataKey={person} 
                      stackId="a"
                      fill={COLORS[index % COLORS.length]} 
                      radius={index === monthlyResponsibleData.persons.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                No CAPA data with responsible persons
              </div>
            )}
          </CardContent>
        </Card>

        {/* Lists Row */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Recent CAPAs */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Recent CAPAs
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentCAPAs.length > 0 ? (
                <div className="space-y-3">
                  {recentCAPAs.map((capa: any) => (
                    <div key={capa.id} className="flex items-start justify-between p-3 rounded-lg border bg-card">
                      <div className="space-y-1">
                        <div className="font-medium text-sm">{capa.capa_number}</div>
                        <div className="text-xs text-muted-foreground line-clamp-1">
                          {capa.description}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {capa.target_date ? format(parseISO(capa.target_date), 'dd MMM yyyy') : 'No target'}
                        </div>
                      </div>
                      <StatusBadge status={capa.status} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No CAPAs found
                </div>
              )}
            </CardContent>
          </Card>

          {/* Overdue CAPAs */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium flex items-center gap-2 text-red-600">
                <AlertTriangle className="h-4 w-4" />
                Overdue CAPAs
              </CardTitle>
            </CardHeader>
            <CardContent>
              {overdueList.length > 0 ? (
                <div className="space-y-3">
                  {overdueList.map((capa: any) => {
                    const daysOverdue = differenceInDays(new Date(), parseISO(capa.target_date));
                    return (
                      <div key={capa.id} className="flex items-start justify-between p-3 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900">
                        <div className="space-y-1">
                          <div className="font-medium text-sm">{capa.capa_number}</div>
                          <div className="text-xs text-muted-foreground line-clamp-1">
                            {capa.description}
                          </div>
                          <div className="text-xs font-medium text-red-600">
                            {daysOverdue} day{daysOverdue !== 1 ? 's' : ''} overdue
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground">
                            {capa.responsible?.full_name || 'Unassigned'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-green-600">
                  <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  No overdue CAPAs
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </ERPLayout>
  );
}
