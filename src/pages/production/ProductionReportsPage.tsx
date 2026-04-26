import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download, FileText, BarChart3, AlertTriangle } from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth } from "date-fns";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const COLORS = ['#3b82f6', '#22c55e', '#eab308', '#ef4444', '#8b5cf6', '#06b6d4'];

export default function ProductionReportsPage() {
  const [dateFrom, setDateFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [gradeFilter, setGradeFilter] = useState<string>("all");

  // Fetch departments
  const { data: departments } = useQuery({
    queryKey: ['production-departments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_departments')
        .select('*')
        .eq('is_active', true)
        .order('sequence_order');
      if (error) throw error;
      return data;
    },
  });

  // Fetch grades
  const { data: grades } = useQuery({
    queryKey: ['grades'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('grades')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  // Fetch production data for reports
  const { data: productionData, isLoading } = useQuery({
    queryKey: ['production-reports', dateFrom, dateTo, departmentFilter, gradeFilter],
    queryFn: async () => {
      let query = supabase
        .from('production_entries')
        .select(`
          *,
          production_departments(id, name, code),
          production_sub_departments(id, name, code),
          grades(id, name, code)
        `)
        .gte('entry_date', dateFrom)
        .lte('entry_date', dateTo);

      if (departmentFilter !== 'all') {
        query = query.eq('department_id', departmentFilter);
      }
      if (gradeFilter !== 'all') {
        query = query.eq('grade_id', gradeFilter);
      }

      const { data, error } = await query.order('entry_date');
      if (error) throw error;
      return data;
    },
  });

  // Fetch rejection details
  const { data: rejectionData } = useQuery({
    queryKey: ['rejection-reports', dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_rejections')
        .select(`
          *,
          defect_reasons(id, name, code, severity),
          production_entries!inner(entry_date, department_id)
        `)
        .gte('production_entries.entry_date', dateFrom)
        .lte('production_entries.entry_date', dateTo);
      if (error) throw error;
      return data;
    },
  });

  // Calculate summary statistics
  const summary = {
    totalProduced: productionData?.reduce((sum, e) => sum + Number(e.quantity_produced), 0) || 0,
    totalOk: productionData?.reduce((sum, e) => sum + Number(e.quantity_ok), 0) || 0,
    totalRejected: productionData?.reduce((sum, e) => sum + Number(e.quantity_rejected), 0) || 0,
    totalEntries: productionData?.length || 0,
  };

  const rejectionRate = summary.totalProduced > 0 
    ? ((summary.totalRejected / summary.totalProduced) * 100).toFixed(2)
    : '0';

  // Production by department
  const productionByDept = departments?.map(dept => {
    const deptData = productionData?.filter(e => e.department_id === dept.id) || [];
    return {
      name: dept.code,
      produced: deptData.reduce((sum, e) => sum + Number(e.quantity_produced), 0),
      ok: deptData.reduce((sum, e) => sum + Number(e.quantity_ok), 0),
      rejected: deptData.reduce((sum, e) => sum + Number(e.quantity_rejected), 0),
    };
  }) || [];

  // Production by grade
  const productionByGrade = grades?.map(grade => {
    const gradeData = productionData?.filter(e => e.grade_id === grade.id) || [];
    return {
      name: grade.code,
      value: gradeData.reduce((sum, e) => sum + Number(e.quantity_produced), 0),
    };
  }).filter(g => g.value > 0) || [];

  // Rejection by reason
  const rejectionByReason: Record<string, { name: string; quantity: number; severity: string }> = {};
  rejectionData?.forEach(rej => {
    const reasonId = rej.defect_reason_id;
    const reason = rej.defect_reasons as any;
    if (!rejectionByReason[reasonId]) {
      rejectionByReason[reasonId] = {
        name: reason?.name || 'Unknown',
        quantity: 0,
        severity: reason?.severity || 'Unknown',
      };
    }
    rejectionByReason[reasonId].quantity += Number(rej.quantity);
  });

  const rejectionReasonData = Object.values(rejectionByReason)
    .sort((a, b) => b.quantity - a.quantity);

  // Daily production trend
  const dailyTrend: Record<string, { date: string; produced: number; rejected: number }> = {};
  productionData?.forEach(entry => {
    const date = entry.entry_date;
    if (!dailyTrend[date]) {
      dailyTrend[date] = { date, produced: 0, rejected: 0 };
    }
    dailyTrend[date].produced += Number(entry.quantity_produced);
    dailyTrend[date].rejected += Number(entry.quantity_rejected);
  });
  const dailyTrendData = Object.values(dailyTrend).map(d => ({
    ...d,
    date: format(new Date(d.date), 'dd MMM'),
  }));

  return (
    <ERPLayout>
      <PageHeader
        title="Production Reports"
        description="Comprehensive production analytics and reports"
      />

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="min-w-[150px]">
              <Label>From Date</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="min-w-[150px]">
              <Label>To Date</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div className="min-w-[150px]">
              <Label>Department</Label>
              <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {departments?.map((dept) => (
                    <SelectItem key={dept.id} value={dept.id}>
                      {dept.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[150px]">
              <Label>Grade</Label>
              <Select value={gradeFilter} onValueChange={setGradeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Grades</SelectItem>
                  {grades?.map((grade) => (
                    <SelectItem key={grade.id} value={grade.id}>
                      {grade.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{summary.totalProduced.toLocaleString()}</div>
            <div className="text-sm text-muted-foreground">Total Produced</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-green-600">{summary.totalOk.toLocaleString()}</div>
            <div className="text-sm text-muted-foreground">Good Output</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-red-600">{summary.totalRejected.toLocaleString()}</div>
            <div className="text-sm text-muted-foreground">Total Rejected</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{rejectionRate}%</div>
            <div className="text-sm text-muted-foreground">Rejection Rate</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">
            <BarChart3 className="h-4 w-4 mr-2" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="details">
            <FileText className="h-4 w-4 mr-2" />
            Details
          </TabsTrigger>
          <TabsTrigger value="rejections">
            <AlertTriangle className="h-4 w-4 mr-2" />
            Rejections
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Daily Trend */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Daily Production Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyTrendData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                        }}
                      />
                      <Legend />
                      <Bar dataKey="produced" name="Produced" fill="hsl(var(--primary))" />
                      <Bar dataKey="rejected" name="Rejected" fill="hsl(var(--destructive))" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* By Grade */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Production by Grade</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={productionByGrade}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                        outerRadius={100}
                        dataKey="value"
                      >
                        {productionByGrade.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* By Department */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Production by Department</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={productionByDept} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis type="number" className="text-xs" />
                    <YAxis dataKey="name" type="category" className="text-xs" width={100} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend />
                    <Bar dataKey="ok" name="Good" fill="#22c55e" stackId="a" />
                    <Bar dataKey="rejected" name="Rejected" fill="#ef4444" stackId="a" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Details Tab */}
        <TabsContent value="details">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Production Details</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                     <TableHead>Date</TableHead>
                     <TableHead>Department</TableHead>
                     <TableHead>Sub-Dept</TableHead>
                     <TableHead>Grade</TableHead>
                     <TableHead>Shift</TableHead>
                     <TableHead className="text-right">Produced</TableHead>
                     <TableHead className="text-right">OK</TableHead>
                     <TableHead className="text-right">Rejected</TableHead>
                     <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {productionData?.slice(0, 50).map((entry) => (
                    <TableRow key={entry.id}>
                       <TableCell>{format(new Date(entry.entry_date), 'dd MMM yyyy')}</TableCell>
                       <TableCell>{(entry.production_departments as any)?.name}</TableCell>
                       <TableCell>{(entry.production_sub_departments as any)?.name || '-'}</TableCell>
                       <TableCell>
                        <Badge variant="outline">{(entry.grades as any)?.code}</Badge>
                      </TableCell>
                      <TableCell>{entry.shift}</TableCell>
                      <TableCell className="text-right">{Number(entry.quantity_produced).toLocaleString()}</TableCell>
                      <TableCell className="text-right text-green-600">{Number(entry.quantity_ok).toLocaleString()}</TableCell>
                      <TableCell className="text-right text-red-600">{Number(entry.quantity_rejected).toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge variant={entry.status === 'Approved' ? 'default' : 'secondary'}>
                          {entry.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {(productionData?.length || 0) > 50 && (
                <p className="text-sm text-muted-foreground text-center mt-4">
                  Showing first 50 of {productionData?.length} entries
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Rejections Tab */}
        <TabsContent value="rejections">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Rejection Analysis by Reason</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Defect Reason</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rejectionReasonData.map((reason, index) => (
                      <TableRow key={index}>
                        <TableCell>{reason.name}</TableCell>
                        <TableCell>
                          <Badge 
                            variant={reason.severity === 'Critical' ? 'destructive' : 
                                    reason.severity === 'Major' ? 'default' : 'secondary'}
                          >
                            {reason.severity}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{reason.quantity.toLocaleString()}</TableCell>
                        <TableCell className="text-right">
                          {summary.totalRejected > 0 
                            ? ((reason.quantity / summary.totalRejected) * 100).toFixed(1)
                            : 0}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Rejection Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={rejectionReasonData.map(r => ({ name: r.name, value: r.quantity }))}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                        outerRadius={100}
                        dataKey="value"
                      >
                        {rejectionReasonData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </ERPLayout>
  );
}
