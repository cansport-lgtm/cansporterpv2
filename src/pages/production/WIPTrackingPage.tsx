import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Package, ArrowRight, TrendingUp, TrendingDown, Calendar, CalendarDays } from "lucide-react";
import { format, startOfMonth, endOfMonth, parseISO } from "date-fns";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ViewMode = 'daily' | 'monthly';

export default function WIPTrackingPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const [dateFilter, setDateFilter] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [monthFilter, setMonthFilter] = useState(format(new Date(), 'yyyy-MM'));

  // Departments to exclude from WIP matrix (matched case-insensitively)
  const EXCLUDED_DEPARTMENTS = [
    'kapra cutting',
    'chakki and lacha',
    'housekeeping',
    'testing & inspection',
    'testing and inspection',
    'master compounding',
    'trainings',
    'training',
    'compounding+others',
  ];

  // Fetch departments
  const { data: departments } = useQuery({
    queryKey: ['production-departments-wip'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_departments')
        .select('*')
        .eq('is_active', true)
        .order('sequence_order');
      if (error) throw error;
      // Filter out excluded departments
      return data?.filter(
        (dept) => !EXCLUDED_DEPARTMENTS.some(
          (excluded) => dept.name.toLowerCase().trim() === excluded.toLowerCase().trim()
        )
      );
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

  // Get date range based on view mode
  const getDateRange = () => {
    if (viewMode === 'daily') {
      return { start: dateFilter, end: dateFilter };
    } else {
      const monthStart = startOfMonth(parseISO(`${monthFilter}-01`));
      const monthEnd = endOfMonth(monthStart);
      return {
        start: format(monthStart, 'yyyy-MM-dd'),
        end: format(monthEnd, 'yyyy-MM-dd'),
      };
    }
  };

  const dateRange = getDateRange();

  // Fetch WIP inventory for selected date/month
  const { data: wipData, isLoading } = useQuery({
    queryKey: ['wip-inventory', viewMode, viewMode === 'daily' ? dateFilter : monthFilter],
    queryFn: async () => {
      if (viewMode === 'daily') {
        const { data, error } = await supabase
          .from('wip_inventory')
          .select(`
            *,
            production_departments(id, name, code, sequence_order),
            grades(id, name, code)
          `)
          .eq('entry_date', dateFilter)
          .order('created_at');
        if (error) throw error;
        return data;
      } else {
        // For monthly view, get the last entry of the month for each department/grade
        const { data, error } = await supabase
          .from('wip_inventory')
          .select(`
            *,
            production_departments(id, name, code, sequence_order),
            grades(id, name, code)
          `)
          .gte('entry_date', dateRange.start)
          .lte('entry_date', dateRange.end)
          .order('entry_date', { ascending: false });
        if (error) throw error;
        return data;
      }
    },
  });

  // Fetch production entries to calculate WIP if no inventory data
  const { data: productionData } = useQuery({
    queryKey: ['production-for-wip', viewMode, viewMode === 'daily' ? dateFilter : monthFilter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_entries')
        .select(`
          quantity_produced,
          quantity_ok,
          quantity_rejected,
          department_id,
          grade_id,
          production_departments(id, name, code, sequence_order),
          grades(id, name, code)
        `)
        .gte('entry_date', dateRange.start)
        .lte('entry_date', dateRange.end);
      if (error) throw error;
      return data;
    },
  });

  // Build WIP matrix: departments x grades
  const buildWIPMatrix = () => {
    if (!departments || !grades) return { matrix: [], totals: {} };

    const matrix: Record<string, Record<string, number>> = {};
    const totals: Record<string, number> = {};

    // Initialize matrix
    departments.forEach(dept => {
      matrix[dept.id] = {};
      grades.forEach(grade => {
        matrix[dept.id][grade.id] = 0;
      });
    });

    // Fill with WIP data if available
    if (wipData && wipData.length > 0) {
      wipData.forEach(wip => {
        if (matrix[wip.department_id] && wip.grade_id) {
          matrix[wip.department_id][wip.grade_id] = Number(wip.closing_qty);
        }
      });
    } else if (productionData) {
      // Otherwise calculate from production entries
      productionData.forEach(entry => {
        if (matrix[entry.department_id] && entry.grade_id) {
          matrix[entry.department_id][entry.grade_id] += Number(entry.quantity_ok);
        }
      });
    }

    // Calculate totals
    departments.forEach(dept => {
      totals[dept.id] = grades.reduce((sum, grade) => sum + (matrix[dept.id][grade.id] || 0), 0);
    });

    return { matrix, totals };
  };

  const { matrix, totals } = buildWIPMatrix();

  // Build chart data for department comparison
  const chartData = departments?.map(dept => ({
    name: dept.code,
    ...grades?.reduce((acc, grade) => ({
      ...acc,
      [grade.code]: matrix[dept.id]?.[grade.id] || 0,
    }), {}),
  })) || [];

  const COLORS = ['#3b82f6', '#22c55e', '#eab308', '#ef4444', '#8b5cf6', '#06b6d4'];

  return (
    <ERPLayout>
      <PageHeader
        title="WIP Tracking"
        description="Track work-in-progress across departments and grades"
      />

      {/* Date Filter */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-[150px]">
              <Label>View Mode</Label>
              <Select value={viewMode} onValueChange={(value: ViewMode) => setViewMode(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      Daily
                    </div>
                  </SelectItem>
                  <SelectItem value="monthly">
                    <div className="flex items-center gap-2">
                      <CalendarDays className="h-4 w-4" />
                      Monthly
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {viewMode === 'daily' ? (
              <div className="w-[200px]">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                />
              </div>
            ) : (
              <div className="w-[200px]">
                <Label>Month</Label>
                <Input
                  type="month"
                  value={monthFilter}
                  onChange={(e) => setMonthFilter(e.target.value)}
                />
              </div>
            )}
            
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Package className="h-4 w-4" />
              {viewMode === 'daily' 
                ? `Showing WIP status as of ${format(new Date(dateFilter), 'dd MMM yyyy')}`
                : `Showing WIP summary for ${format(parseISO(`${monthFilter}-01`), 'MMMM yyyy')}`
              }
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="matrix" className="space-y-6">
        <TabsList>
          <TabsTrigger value="matrix">Matrix View</TabsTrigger>
          <TabsTrigger value="chart">Chart View</TabsTrigger>
          <TabsTrigger value="flow">Flow View</TabsTrigger>
        </TabsList>

        {/* Matrix View */}
        <TabsContent value="matrix">
          <Card>
            <CardHeader>
              <CardTitle>WIP Matrix (Department × Grade)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 bg-background">Department</TableHead>
                      {grades?.map(grade => (
                        <TableHead key={grade.id} className="text-center min-w-[80px]">
                          <Badge variant="outline">{grade.code}</Badge>
                        </TableHead>
                      ))}
                      <TableHead className="text-center font-bold">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {departments?.map(dept => (
                      <TableRow key={dept.id}>
                        <TableCell className="sticky left-0 bg-background font-medium">
                          {dept.name}
                        </TableCell>
                        {grades?.map(grade => {
                          const value = matrix[dept.id]?.[grade.id] || 0;
                          return (
                            <TableCell key={grade.id} className="text-center">
                              <span className={value > 0 ? 'font-medium' : 'text-muted-foreground'}>
                                {value > 0 ? value.toLocaleString() : '-'}
                              </span>
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-center font-bold">
                          {(totals[dept.id] || 0).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                    {/* Grand Total Row */}
                    <TableRow className="bg-muted/50">
                      <TableCell className="sticky left-0 bg-muted/50 font-bold">
                        Grand Total
                      </TableCell>
                      {grades?.map(grade => {
                        const gradeTotal = departments?.reduce(
                          (sum, dept) => sum + (matrix[dept.id]?.[grade.id] || 0),
                          0
                        ) || 0;
                        return (
                          <TableCell key={grade.id} className="text-center font-bold">
                            {gradeTotal > 0 ? gradeTotal.toLocaleString() : '-'}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-center font-bold text-primary">
                        {Object.values(totals).reduce((a, b) => a + b, 0).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Chart View */}
        <TabsContent value="chart">
          <Card>
            <CardHeader>
              <CardTitle>WIP by Department and Grade</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" className="text-xs" />
                    <YAxis className="text-xs" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend />
                    {grades?.map((grade, index) => (
                      <Bar
                        key={grade.id}
                        dataKey={grade.code}
                        fill={COLORS[index % COLORS.length]}
                        stackId="a"
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Flow View */}
        <TabsContent value="flow">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {departments?.map((dept, index) => {
              const total = totals[dept.id] || 0;
              const prevTotal = index > 0 ? (totals[departments[index - 1].id] || 0) : 0;
              const difference = total - prevTotal;

              return (
                <Card key={dept.id} className="relative">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{dept.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-primary mb-2">
                      {total.toLocaleString()}
                    </div>
                    <div className="space-y-1">
                      {grades?.map(grade => {
                        const value = matrix[dept.id]?.[grade.id] || 0;
                        if (value === 0) return null;
                        return (
                          <div key={grade.id} className="flex justify-between text-sm">
                            <span className="text-muted-foreground">{grade.code}</span>
                            <span>{value.toLocaleString()}</span>
                          </div>
                        );
                      })}
                    </div>
                    {index > 0 && (
                      <div className={`mt-3 pt-3 border-t flex items-center gap-1 text-sm ${difference >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {difference >= 0 ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : (
                          <TrendingDown className="h-3 w-3" />
                        )}
                        {difference >= 0 ? '+' : ''}{difference.toLocaleString()} from {departments[index - 1].code}
                      </div>
                    )}
                  </CardContent>
                  {index < (departments?.length || 0) - 1 && (
                    <div className="hidden md:flex absolute -right-4 top-1/2 -translate-y-1/2 z-10">
                      <ArrowRight className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </ERPLayout>
  );
}
