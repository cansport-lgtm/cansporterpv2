import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Factory, AlertTriangle, CheckCircle, CalendarIcon, Target, Percent } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { format, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { cn } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

const COLORS = ['#3b82f6', '#22c55e', '#eab308', '#ef4444', '#8b5cf6', '#06b6d4'];

type ViewMode = 'daily' | 'weekly' | 'monthly';

export default function ProductionDashboard() {
  const [selectedDate, setSelectedDate] = useState<Date>(subDays(new Date(), 1));
  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const [rejectionDeptFilter, setRejectionDeptFilter] = useState<string>('all');
  const [rejectionGradeFilter, setRejectionGradeFilter] = useState<string>('all');
  const [daywiseDeptFilter, setDaywiseDeptFilter] = useState<string>('all');
  const [showSubDepts, setShowSubDepts] = useState<boolean>(false);
  
  const dateStr = format(selectedDate, 'yyyy-MM-dd');
  const weekStart = format(startOfWeek(selectedDate), 'yyyy-MM-dd');
  const weekEnd = format(endOfWeek(selectedDate), 'yyyy-MM-dd');
  const monthStart = format(startOfMonth(selectedDate), 'yyyy-MM-dd');
  const monthEnd = format(endOfMonth(selectedDate), 'yyyy-MM-dd');

  // Get date range based on view mode
  const getDateRange = () => {
    switch (viewMode) {
      case 'daily':
        return { start: dateStr, end: dateStr };
      case 'weekly':
        return { start: weekStart, end: weekEnd };
      case 'monthly':
        return { start: monthStart, end: monthEnd };
    }
  };

  const dateRange = getDateRange();

  // Fetch departments
  const { data: departments } = useQuery({
    queryKey: ['departments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_departments')
        .select('*')
        .eq('is_active', true)
        .order('sequence_order', { ascending: true });
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
        .order('name', { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  // Production summary for selected period
  const { data: periodStats } = useQuery({
    queryKey: ['production-period-stats', dateRange.start, dateRange.end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_entries')
        .select('target_production, quantity_produced, quantity_ok, quantity_rejected, entry_date')
        .gte('entry_date', dateRange.start)
        .lte('entry_date', dateRange.end);
      
      if (error) throw error;
      
      const totalTarget = data?.reduce((sum, e) => sum + Number(e.target_production || 0), 0) || 0;
      const totalProduced = data?.reduce((sum, e) => sum + Number(e.quantity_produced), 0) || 0;
      const totalOk = data?.reduce((sum, e) => sum + Number(e.quantity_ok), 0) || 0;
      const totalRejected = data?.reduce((sum, e) => sum + Number(e.quantity_rejected), 0) || 0;
      const achievement = totalTarget > 0 ? ((totalProduced / totalTarget) * 100).toFixed(1) : '0.0';
      
      // Count unique working days
      const workingDays = new Set(data?.map(e => e.entry_date) || []).size;
      
      return { totalTarget, totalProduced, totalOk, totalRejected, achievement, entries: data?.length || 0, workingDays };
    },
  });

  // Fetch MPH calculating numbers
  const { data: mphNumbers } = useQuery({
    queryKey: ['mph-calculating-numbers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mph_calculating_numbers')
        .select('department_id, sub_department_id, mph_number')
        .eq('is_active', true);
      if (error) throw error;
      const map: Record<string, number> = {};
      data?.forEach(m => {
        const key = `${m.department_id}_${m.sub_department_id || 'none'}`;
        map[key] = Number(m.mph_number) || 0;
      });
      return map;
    },
  });

  // Department-wise analytics for selected period
  const { data: deptAnalytics } = useQuery({
    queryKey: ['production-dept-analytics', dateRange.start, dateRange.end, mphNumbers],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_entries')
        .select(`
          department_id,
          sub_department_id,
          target_production,
          quantity_produced,
          quantity_ok,
          quantity_rejected,
          entry_date,
          production_departments(id, name, code, sequence_order),
          production_sub_departments(id, name)
        `)
        .gte('entry_date', dateRange.start)
        .lte('entry_date', dateRange.end);
      
      if (error) throw error;
      
      // Group by department + sub-department
      const byKey: Record<string, {
        deptName: string;
        subDeptName: string | null;
        code: string;
        target: number;
        produced: number;
        ok: number;
        rejected: number;
        sequence: number;
        workingDays: Set<string>;
        key: string;
      }> = {};
      
      data?.forEach(entry => {
        const dept = entry.production_departments as any;
        if (!dept) return;
        const subDept = entry.production_sub_departments as any;
        const subDeptName = subDept?.name || null;
        const key = `${dept.id}_${entry.sub_department_id || 'none'}`;
        
        if (!byKey[key]) {
          byKey[key] = {
            deptName: dept.name,
            subDeptName,
            code: dept.code,
            target: 0,
            produced: 0,
            ok: 0,
            rejected: 0,
            sequence: dept.sequence_order || 0,
            workingDays: new Set(),
            key,
          };
        }
        
        byKey[key].target += Number(entry.target_production || 0);
        byKey[key].produced += Number(entry.quantity_produced);
        byKey[key].ok += Number(entry.quantity_ok);
        byKey[key].rejected += Number(entry.quantity_rejected);
        byKey[key].workingDays.add(entry.entry_date);
      });
      
      return Object.values(byKey)
        .sort((a, b) => a.sequence - b.sequence || (a.subDeptName || '').localeCompare(b.subDeptName || ''))
        .map(d => {
          const mphNum = mphNumbers?.[d.key] || 0;
          return {
            name: d.deptName,
            subDeptName: d.subDeptName,
            displayName: d.subDeptName ? `${d.deptName} › ${d.subDeptName}` : d.deptName,
            code: d.code,
            target: d.target,
            produced: d.produced,
            ok: d.ok,
            rejected: d.rejected,
            sequence: d.sequence,
            workingDays: d.workingDays.size,
            avgProduced: d.workingDays.size > 0 ? Math.round(d.produced / d.workingDays.size) : 0,
            avgOk: d.workingDays.size > 0 ? Math.round(d.ok / d.workingDays.size) : 0,
            achievement: d.target > 0 ? ((d.produced / d.target) * 100).toFixed(1) : '0.0',
            rejectionRate: d.produced > 0 ? ((d.rejected / d.produced) * 100).toFixed(1) : '0.0',
            authorisedMph: Math.round(d.produced * mphNum * 100) / 100,
          };
        });
    },
    enabled: mphNumbers !== undefined,
  });

  // Production by grade for each department
  const { data: gradeByDeptAnalytics } = useQuery({
    queryKey: ['production-grade-by-dept-analytics', dateRange.start, dateRange.end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_entries')
        .select(`
          quantity_produced,
          department_id,
          production_departments(id, name, code, sequence_order),
          grades(name, code)
        `)
        .gte('entry_date', dateRange.start)
        .lte('entry_date', dateRange.end);
      
      if (error) throw error;
      
      // Group by department, then by grade
      const byDeptGrade: Record<string, {
        deptName: string;
        deptCode: string;
        sequence: number;
        grades: Record<string, number>;
      }> = {};
      
      data?.forEach(entry => {
        const dept = entry.production_departments as any;
        const grade = entry.grades as any;
        if (!dept || !grade) return;
        
        if (!byDeptGrade[dept.id]) {
          byDeptGrade[dept.id] = {
            deptName: dept.name,
            deptCode: dept.code,
            sequence: dept.sequence_order || 0,
            grades: {},
          };
        }
        
        const gradeCode = grade.code || 'Unknown';
        byDeptGrade[dept.id].grades[gradeCode] = (byDeptGrade[dept.id].grades[gradeCode] || 0) + Number(entry.quantity_produced);
      });
      
      return Object.entries(byDeptGrade)
        .map(([id, data]) => ({
          id,
          ...data,
          gradeData: Object.entries(data.grades).map(([name, value]) => ({ name, value })),
          total: Object.values(data.grades).reduce((sum, v) => sum + v, 0),
        }))
        .sort((a, b) => a.sequence - b.sequence);
    },
  });

  // Grade-wise Production vs Rejection for Jorr, Local Final, Fancy Final
  const { data: gradeWiseProdRejection } = useQuery({
    queryKey: ['grade-wise-prod-rejection', dateRange.start, dateRange.end],
    queryFn: async () => {
      const targetDepts = ['jorr', 'local final', 'fancy final'];
      
      const { data, error } = await supabase
        .from('production_entries')
        .select(`
          quantity_produced,
          quantity_rejected,
          department_id,
          production_departments(id, name, code),
          grades(name, code)
        `)
        .gte('entry_date', dateRange.start)
        .lte('entry_date', dateRange.end);
      
      if (error) throw error;
      
      // Group by department, then by grade with produced and rejected
      const byDeptGrade: Record<string, {
        deptName: string;
        deptCode: string;
        grades: Record<string, { produced: number; rejected: number }>;
      }> = {};
      
      data?.forEach(entry => {
        const dept = entry.production_departments as any;
        const grade = entry.grades as any;
        if (!dept || !grade) return;
        
        // Only process target departments
        if (!targetDepts.includes(dept.name.toLowerCase())) return;
        
        if (!byDeptGrade[dept.id]) {
          byDeptGrade[dept.id] = {
            deptName: dept.name,
            deptCode: dept.code,
            grades: {},
          };
        }
        
        const gradeCode = grade.code || 'Unknown';
        if (!byDeptGrade[dept.id].grades[gradeCode]) {
          byDeptGrade[dept.id].grades[gradeCode] = { produced: 0, rejected: 0 };
        }
        
        byDeptGrade[dept.id].grades[gradeCode].produced += Number(entry.quantity_produced);
        byDeptGrade[dept.id].grades[gradeCode].rejected += Number(entry.quantity_rejected);
      });
      
      return Object.entries(byDeptGrade).map(([id, data]) => ({
        id,
        ...data,
        gradeData: Object.entries(data.grades).map(([name, values]) => ({ 
          name, 
          produced: values.produced,
          rejected: values.rejected,
        })),
      }));
    },
  });


  // Trend data based on view mode
  const { data: trendData } = useQuery({
    queryKey: ['production-trend', viewMode, dateStr],
    queryFn: async () => {
      if (viewMode === 'monthly') {
        // Last 6 months trend
        const months = [];
        for (let i = 5; i >= 0; i--) {
          const monthDate = subMonths(selectedDate, i);
          months.push({
            start: format(startOfMonth(monthDate), 'yyyy-MM-dd'),
            end: format(endOfMonth(monthDate), 'yyyy-MM-dd'),
            label: format(monthDate, 'MMM yyyy'),
          });
        }
        
        const results = await Promise.all(months.map(async (month) => {
          const { data, error } = await supabase
            .from('production_entries')
            .select('quantity_produced, quantity_rejected')
            .gte('entry_date', month.start)
            .lte('entry_date', month.end);
          
          if (error) throw error;
          
          return {
            date: month.label,
            produced: data?.reduce((sum, e) => sum + Number(e.quantity_produced), 0) || 0,
            rejected: data?.reduce((sum, e) => sum + Number(e.quantity_rejected), 0) || 0,
          };
        }));
        
        return results;
      } else {
        // Last 7 days trend
        const days = [];
        for (let i = 6; i >= 0; i--) {
          const date = format(subDays(selectedDate, i), 'yyyy-MM-dd');
          days.push(date);
        }
        
        const { data, error } = await supabase
          .from('production_entries')
          .select('entry_date, quantity_produced, quantity_rejected')
          .in('entry_date', days);
        
        if (error) throw error;
        
        return days.map(date => {
          const dayEntries = data?.filter(e => e.entry_date === date) || [];
          const produced = dayEntries.reduce((sum, e) => sum + Number(e.quantity_produced), 0);
          const rejected = dayEntries.reduce((sum, e) => sum + Number(e.quantity_rejected), 0);
          return {
            date: format(new Date(date), 'EEE dd'),
            produced,
            rejected,
          };
        });
      }
    },
  });

  // Current WIP by department
  const { data: wipStats } = useQuery({
    queryKey: ['wip-current', dateStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wip_inventory')
        .select(`
          closing_qty,
          production_departments(name)
        `)
        .eq('entry_date', dateStr);
      
      if (error) throw error;
      
      const byDept: Record<string, number> = {};
      data?.forEach(entry => {
        const deptName = (entry.production_departments as any)?.name || 'Unknown';
        byDept[deptName] = (byDept[deptName] || 0) + Number(entry.closing_qty);
      });
      
      return Object.entries(byDept).map(([name, value]) => ({ name, value }));
    },
  });

  // Day-wise production data for bar chart with department filter
  const { data: daywiseProduction } = useQuery({
    queryKey: ['production-daywise', monthStart, monthEnd, daywiseDeptFilter],
    queryFn: async () => {
      let query = supabase
        .from('production_entries')
        .select(`
          entry_date,
          quantity_produced,
          quantity_rejected,
          department_id
        `)
        .gte('entry_date', monthStart)
        .lte('entry_date', monthEnd);

      if (daywiseDeptFilter !== 'all') {
        query = query.eq('department_id', daywiseDeptFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Group by date
      const byDate: Record<string, { produced: number; rejected: number }> = {};
      
      data?.forEach(entry => {
        const date = entry.entry_date;
        if (!byDate[date]) {
          byDate[date] = { produced: 0, rejected: 0 };
        }
        byDate[date].produced += Number(entry.quantity_produced);
        byDate[date].rejected += Number(entry.quantity_rejected);
      });

      // Sort by date and format
      return Object.entries(byDate)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, data]) => ({
          date: format(new Date(date), 'dd MMM'),
          fullDate: date,
          produced: data.produced,
          rejected: data.rejected,
        }));
    },
  });

  // Fetch rejections with details
  const { data: rejectionsData } = useQuery({
    queryKey: ['production-rejections', dateRange.start, dateRange.end, rejectionDeptFilter, rejectionGradeFilter],
    queryFn: async () => {
      let query = supabase
        .from('production_rejections')
        .select(`
          id,
          quantity,
          remarks,
          created_at,
          defect_reasons(id, name, code, severity),
          production_entries!inner(
            id,
            entry_date,
            department_id,
            grade_id,
            production_departments(id, name, code),
            grades(id, name, code)
          )
        `)
        .gte('production_entries.entry_date', dateRange.start)
        .lte('production_entries.entry_date', dateRange.end);

      const { data, error } = await query;
      if (error) throw error;

      // Filter by department and grade on client side
      let filtered = data || [];
      
      if (rejectionDeptFilter !== 'all') {
        filtered = filtered.filter(r => {
          const entry = r.production_entries as any;
          return entry?.department_id === rejectionDeptFilter;
        });
      }
      
      if (rejectionGradeFilter !== 'all') {
        filtered = filtered.filter(r => {
          const entry = r.production_entries as any;
          return entry?.grade_id === rejectionGradeFilter;
        });
      }

      return filtered.map(r => {
        const entry = r.production_entries as any;
        const defect = r.defect_reasons as any;
        return {
          id: r.id,
          date: entry?.entry_date,
          department: entry?.production_departments?.name || '-',
          grade: entry?.grades?.name || '-',
          defectReason: defect?.name || '-',
          defectCode: defect?.code || '-',
          severity: defect?.severity || '-',
          quantity: r.quantity,
          remarks: r.remarks || '-',
        };
      }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    },
  });

  const getViewModeLabel = () => {
    switch (viewMode) {
      case 'daily': return format(selectedDate, 'MMMM d, yyyy');
      case 'weekly': return `Week of ${format(startOfWeek(selectedDate), 'MMM d')} - ${format(endOfWeek(selectedDate), 'MMM d, yyyy')}`;
      case 'monthly': return format(selectedDate, 'MMMM yyyy');
    }
  };

  return (
    <ERPLayout>
      <PageHeader
        title="Production Dashboard"
        description="Real-time production metrics and analytics"
      />

      {/* Date & View Mode Controls */}
      <div className="flex flex-wrap gap-4 mb-6 items-center">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">View:</span>
          <Select value={viewMode} onValueChange={(v: ViewMode) => setViewMode(v)}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("justify-start text-left font-normal min-w-[200px]")}>
              <CalendarIcon className="mr-2 h-4 w-4" />
              {getViewModeLabel()}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => date && setSelectedDate(date)}
              initialFocus
              className="pointer-events-auto"
            />
          </PopoverContent>
        </Popover>

        <div className="ml-auto text-sm text-muted-foreground">
          Showing: {getViewModeLabel()}
        </div>
      </div>

      {/* Main Output Cards - Local Final & Final Ball */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-200 dark:border-blue-800">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Local Final Output</p>
                <p className="text-4xl font-bold text-blue-600 dark:text-blue-400">
                  {deptAnalytics?.find(d => d.code === 'LOCAL_FINAL')?.produced?.toLocaleString() || '0'}
                </p>
                <div className="flex gap-4 mt-2 text-sm">
                  <span className="text-green-600">
                    OK: {deptAnalytics?.find(d => d.code === 'LOCAL_FINAL')?.ok?.toLocaleString() || '0'}
                  </span>
                  <span className="text-red-600">
                    Rej: {deptAnalytics?.find(d => d.code === 'LOCAL_FINAL')?.rejected?.toLocaleString() || '0'}
                  </span>
                </div>
              </div>
              <div className="h-16 w-16 rounded-full bg-blue-500/20 flex items-center justify-center">
                <Factory className="h-8 w-8 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Achievement:</span>
                <span className={cn(
                  "font-semibold",
                  Number(deptAnalytics?.find(d => d.code === 'LOCAL_FINAL')?.achievement || 0) >= 100 ? "text-green-600" : "text-yellow-600"
                )}>
                  {deptAnalytics?.find(d => d.code === 'LOCAL_FINAL')?.achievement || '0.0'}%
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Avg/Day:</span>
                <span className="font-semibold text-blue-600 dark:text-blue-400">
                  {deptAnalytics?.find(d => d.code === 'LOCAL_FINAL')?.avgProduced?.toLocaleString() || '0'}
                </span>
                <span className="text-muted-foreground text-xs">
                  ({deptAnalytics?.find(d => d.code === 'LOCAL_FINAL')?.workingDays || 0} days)
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 border-purple-200 dark:border-purple-800">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Final Ball Output</p>
                <p className="text-4xl font-bold text-purple-600 dark:text-purple-400">
                  {deptAnalytics?.find(d => d.code === 'FANCY_FINAL')?.produced?.toLocaleString() || '0'}
                </p>
                <div className="flex gap-4 mt-2 text-sm">
                  <span className="text-green-600">
                    OK: {deptAnalytics?.find(d => d.code === 'FANCY_FINAL')?.ok?.toLocaleString() || '0'}
                  </span>
                  <span className="text-red-600">
                    Rej: {deptAnalytics?.find(d => d.code === 'FANCY_FINAL')?.rejected?.toLocaleString() || '0'}
                  </span>
                </div>
              </div>
              <div className="h-16 w-16 rounded-full bg-purple-500/20 flex items-center justify-center">
                <Factory className="h-8 w-8 text-purple-600 dark:text-purple-400" />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Achievement:</span>
                <span className={cn(
                  "font-semibold",
                  Number(deptAnalytics?.find(d => d.code === 'FANCY_FINAL')?.achievement || 0) >= 100 ? "text-green-600" : "text-yellow-600"
                )}>
                  {deptAnalytics?.find(d => d.code === 'FANCY_FINAL')?.achievement || '0.0'}%
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Avg/Day:</span>
                <span className="font-semibold text-purple-600 dark:text-purple-400">
                  {deptAnalytics?.find(d => d.code === 'FANCY_FINAL')?.avgProduced?.toLocaleString() || '0'}
                </span>
                <span className="text-muted-foreground text-xs">
                  ({deptAnalytics?.find(d => d.code === 'FANCY_FINAL')?.workingDays || 0} days)
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <MetricCard
          title="Target"
          value={periodStats?.totalTarget?.toLocaleString() || '0'}
          icon={Target}
        />
        <MetricCard
          title="Production"
          value={periodStats?.totalProduced?.toLocaleString() || '0'}
          icon={Factory}
        />
        <MetricCard
          title="Achievement"
          value={`${periodStats?.achievement || '0.0'}%`}
          icon={Percent}
          trend={{ value: Number(periodStats?.achievement || 0) >= 100 ? 5 : -5, isPositive: Number(periodStats?.achievement || 0) >= 100 }}
        />
        <MetricCard
          title="Good Output"
          value={periodStats?.totalOk?.toLocaleString() || '0'}
          icon={CheckCircle}
        />
        <MetricCard
          title="Rejections"
          value={periodStats?.totalRejected?.toLocaleString() || '0'}
          icon={AlertTriangle}
        />
      </div>

      {/* Department-wise Analytics Table */}
      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Department-wise Production Analytics</CardTitle>
          <div className="flex items-center gap-2">
            <Label htmlFor="sub-dept-toggle" className="text-sm text-muted-foreground cursor-pointer">
              Show Sub-Departments
            </Label>
            <Switch
              id="sub-dept-toggle"
              checked={showSubDepts}
              onCheckedChange={setShowSubDepts}
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-2 font-medium">Department</th>
                  <th className="text-right py-3 px-2 font-medium">Target</th>
                  <th className="text-right py-3 px-2 font-medium">Produced</th>
                  <th className="text-right py-3 px-2 font-medium">OK Qty</th>
                  <th className="text-right py-3 px-2 font-medium">Rejected</th>
                  <th className="text-right py-3 px-2 font-medium">Auth MPH</th>
                  <th className="text-right py-3 px-2 font-medium">Achievement %</th>
                  <th className="text-right py-3 px-2 font-medium">Rejection %</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const displayData = showSubDepts
                    ? deptAnalytics
                    : (() => {
                        // Aggregate by parent department
                        const byDept: Record<string, {
                          name: string; code: string; sequence: number;
                          target: number; produced: number; ok: number; rejected: number; authorisedMph: number;
                        }> = {};
                        deptAnalytics?.forEach(d => {
                          if (!byDept[d.code]) {
                            byDept[d.code] = { name: d.name, code: d.code, sequence: d.sequence, target: 0, produced: 0, ok: 0, rejected: 0, authorisedMph: 0 };
                          }
                          byDept[d.code].target += d.target;
                          byDept[d.code].produced += d.produced;
                          byDept[d.code].ok += d.ok;
                          byDept[d.code].rejected += d.rejected;
                          byDept[d.code].authorisedMph += d.authorisedMph;
                        });
                        return Object.values(byDept)
                          .sort((a, b) => a.sequence - b.sequence)
                          .map(d => ({
                            ...d,
                            subDeptName: null as string | null,
                            displayName: d.name,
                            achievement: d.target > 0 ? ((d.produced / d.target) * 100).toFixed(1) : '0.0',
                            rejectionRate: d.produced > 0 ? ((d.rejected / d.produced) * 100).toFixed(1) : '0.0',
                          }));
                      })();
                  return displayData?.map((dept, idx) => (
                    <tr key={`${dept.code}-${dept.subDeptName || idx}`} className="border-b hover:bg-muted/50">
                      <td className="py-3 px-2 font-medium">
                        {dept.subDeptName ? (
                          <span>{dept.name} <span className="text-muted-foreground">› {dept.subDeptName}</span></span>
                        ) : dept.name}
                      </td>
                      <td className="py-3 px-2 text-right">{dept.target.toLocaleString()}</td>
                      <td className="py-3 px-2 text-right">{dept.produced.toLocaleString()}</td>
                      <td className="py-3 px-2 text-right text-green-600">{dept.ok.toLocaleString()}</td>
                      <td className="py-3 px-2 text-right text-red-600">{dept.rejected.toLocaleString()}</td>
                      <td className="py-3 px-2 text-right font-mono text-blue-600">{dept.authorisedMph.toLocaleString()}</td>
                      <td className="py-3 px-2 text-right">
                        <span className={cn(
                          "font-medium",
                          Number(dept.achievement) >= 100 ? "text-green-600" : 
                          Number(dept.achievement) >= 80 ? "text-yellow-600" : "text-red-600"
                        )}>
                          {dept.achievement}%
                        </span>
                      </td>
                      <td className="py-3 px-2 text-right">
                        <span className={cn(
                          "font-medium",
                          Number(dept.rejectionRate) <= 2 ? "text-green-600" : 
                          Number(dept.rejectionRate) <= 5 ? "text-yellow-600" : "text-red-600"
                        )}>
                          {dept.rejectionRate}%
                        </span>
                      </td>
                    </tr>
                  ));
                })()}
                {(!deptAnalytics || deptAnalytics.length === 0) && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-muted-foreground">
                      No production data for selected period
                    </td>
                  </tr>
                )}
              </tbody>
              {deptAnalytics && deptAnalytics.length > 0 && (
                <tfoot>
                  <tr className="bg-muted/50 font-medium">
                    <td className="py-3 px-2">Total</td>
                    <td className="py-3 px-2 text-right">{periodStats?.totalTarget?.toLocaleString() || 0}</td>
                    <td className="py-3 px-2 text-right">{periodStats?.totalProduced?.toLocaleString() || 0}</td>
                    <td className="py-3 px-2 text-right text-green-600">{periodStats?.totalOk?.toLocaleString() || 0}</td>
                    <td className="py-3 px-2 text-right text-red-600">{periodStats?.totalRejected?.toLocaleString() || 0}</td>
                    <td className="py-3 px-2 text-right font-mono text-blue-600">
                      {deptAnalytics?.reduce((sum, d) => sum + d.authorisedMph, 0).toLocaleString()}
                    </td>
                    <td className="py-3 px-2 text-right">{periodStats?.achievement || '0.0'}%</td>
                    <td className="py-3 px-2 text-right">
                      {periodStats?.totalProduced ? ((periodStats.totalRejected / periodStats.totalProduced) * 100).toFixed(1) : '0.0'}%
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Target vs Achievement Charts - Press separate from others */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Press Department Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Press Department - Target vs Achievement</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={(() => {
                    const filtered = deptAnalytics?.filter(d => d.code.toLowerCase() === 'press') || [];
                    if (showSubDepts) {
                      return filtered.map(d => ({ name: d.displayName, Target: d.target, Achieved: d.produced }));
                    }
                    const agg: Record<string, { target: number; produced: number }> = {};
                    filtered.forEach(d => {
                      if (!agg[d.name]) agg[d.name] = { target: 0, produced: 0 };
                      agg[d.name].target += d.target;
                      agg[d.name].produced += d.produced;
                    });
                    return Object.entries(agg).map(([name, v]) => ({ name, Target: v.target, Achieved: v.produced }));
                  })()}
                  margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))', 
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                    formatter={(value: number) => value.toLocaleString()}
                  />
                  <Legend />
                  <Bar dataKey="Target" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Achieved" fill="hsl(142 76% 36%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Other Departments Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Other Departments - Target vs Achievement</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={(() => {
                    const filtered = deptAnalytics?.filter(d => d.code.toLowerCase() !== 'press') || [];
                    if (showSubDepts) {
                      return filtered.map(d => ({ name: d.displayName, Target: d.target, Achieved: d.produced }));
                    }
                    const agg: Record<string, { code: string; target: number; produced: number }> = {};
                    filtered.forEach(d => {
                      if (!agg[d.code]) agg[d.code] = { code: d.code, target: 0, produced: 0 };
                      agg[d.code].target += d.target;
                      agg[d.code].produced += d.produced;
                    });
                    return Object.values(agg).map(v => ({ name: v.code, Target: v.target, Achieved: v.produced }));
                  })()}
                  margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))', 
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                    formatter={(value: number) => value.toLocaleString()}
                  />
                  <Legend />
                  <Bar dataKey="Target" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Achieved" fill="hsl(142 76% 36%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Production Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {viewMode === 'monthly' ? '6-Month Production Trend' : '7-Day Production Trend'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData || []}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" className="text-xs" />
                  <YAxis className="text-xs" />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))', 
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                  />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="produced" 
                    stroke="hsl(var(--primary))" 
                    strokeWidth={2}
                    name="Produced"
                  />
                  <Line 
                    type="monotone" 
                    dataKey="rejected" 
                    stroke="hsl(var(--destructive))" 
                    strokeWidth={2}
                    name="Rejected"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Production by Department Bar Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Production by Department</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={deptAnalytics?.map(d => ({ ...d, name: d.displayName })) || []} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" className="text-xs" />
                  <YAxis dataKey="name" type="category" className="text-xs" width={140} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))', 
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                    formatter={(value: number, name: string) => [value.toLocaleString(), name === 'produced' ? 'Produced' : name === 'rejected' ? 'Rejected' : name]}
                  />
                  <Legend />
                  <Bar dataKey="produced" fill="hsl(var(--primary))" name="Produced" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="rejected" fill="hsl(var(--destructive))" name="Rejected" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Production by Grade - Department-wise Pie Charts */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Production by Grade (Department-wise)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
            {gradeByDeptAnalytics?.map((dept) => (
              <div key={dept.id} className="flex flex-col items-center">
                <h4 className="font-medium text-sm mb-2">{dept.deptName}</h4>
                <div className="h-[200px] w-full">
                  {dept.total > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={dept.gradeData}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          outerRadius={60}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {dept.gradeData.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: 'hsl(var(--card))', 
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px'
                          }}
                          formatter={(value: number) => value.toLocaleString()}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                      No data
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Total: {dept.total.toLocaleString()}
                </p>
              </div>
            ))}
            {(!gradeByDeptAnalytics || gradeByDeptAnalytics.length === 0) && (
              <div className="col-span-full py-8 text-center text-muted-foreground">
                No production data for selected period
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Grade-wise Rejection % for Jorr, Local Final, Fancy Final */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {['Jorr', 'Local Final', 'Fancy Final'].map((deptName) => {
          const deptData = gradeWiseProdRejection?.find(
            d => d.deptName.toLowerCase() === deptName.toLowerCase()
          );
          // Calculate rejection percentage for each grade
          const pieData = deptData?.gradeData.map(g => ({
            name: g.name,
            value: g.produced > 0 ? Number(((g.rejected / g.produced) * 100).toFixed(1)) : 0,
            produced: g.produced,
            rejected: g.rejected,
          })).filter(g => g.value > 0) || [];
          
          return (
            <Card key={deptName}>
              <CardHeader>
                <CardTitle className="text-base">{deptName} - Rejection % (Grade-wise)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  {pieData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          labelLine={true}
                          label={({ name, value }) => `${name}: ${value}%`}
                          outerRadius={80}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {pieData.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: 'hsl(var(--card))', 
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px'
                          }}
                          formatter={(value: number, name: string, props: any) => [
                            `${value}% (${props.payload.rejected.toLocaleString()} / ${props.payload.produced.toLocaleString()})`,
                            'Rejection %'
                          ]}
                        />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                      No rejection data for selected period
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>


      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Current WIP */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">WIP by Department ({format(selectedDate, 'MMM d, yyyy')})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={wipStats || []}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" className="text-xs" />
                  <YAxis className="text-xs" />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))', 
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                    formatter={(value: number) => value.toLocaleString()}
                  />
                  <Bar dataKey="value" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} name="WIP Qty" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Day-wise Production Chart */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-base">Day-wise Production ({format(selectedDate, 'MMMM yyyy')})</CardTitle>
            <Select value={daywiseDeptFilter} onValueChange={setDaywiseDeptFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select Department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments?.map((dept) => (
                  <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daywiseProduction || []}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="date" 
                    className="text-xs" 
                    tick={{ fontSize: 10 }}
                    interval={0}
                    angle={-45}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis className="text-xs" />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))', 
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                    formatter={(value: number) => value.toLocaleString()}
                  />
                  <Legend />
                  <Bar dataKey="produced" fill="hsl(var(--primary))" name="Produced" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="rejected" fill="hsl(var(--destructive))" name="Rejected" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Rejections Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-base">Rejection Details</CardTitle>
          <div className="flex gap-3">
            <Select value={rejectionDeptFilter} onValueChange={setRejectionDeptFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments?.map((dept) => (
                  <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={rejectionGradeFilter} onValueChange={setRejectionGradeFilter}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Grade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Grades</SelectItem>
                {grades?.map((grade) => (
                  <SelectItem key={grade.id} value={grade.id}>{grade.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left py-3 px-3 font-medium">Date</th>
                  <th className="text-left py-3 px-3 font-medium">Department</th>
                  <th className="text-left py-3 px-3 font-medium">Grade</th>
                  <th className="text-left py-3 px-3 font-medium">Defect Reason</th>
                  <th className="text-left py-3 px-3 font-medium">Severity</th>
                  <th className="text-right py-3 px-3 font-medium">Quantity</th>
                  <th className="text-left py-3 px-3 font-medium">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {rejectionsData?.map((rejection) => (
                  <tr key={rejection.id} className="border-b hover:bg-muted/50">
                    <td className="py-3 px-3">{format(new Date(rejection.date), 'dd MMM yyyy')}</td>
                    <td className="py-3 px-3">{rejection.department}</td>
                    <td className="py-3 px-3">{rejection.grade}</td>
                    <td className="py-3 px-3">
                      <span className="font-medium">{rejection.defectReason}</span>
                      <span className="text-muted-foreground ml-1">({rejection.defectCode})</span>
                    </td>
                    <td className="py-3 px-3">
                      <span className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                        rejection.severity === 'critical' && "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
                        rejection.severity === 'major' && "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
                        rejection.severity === 'minor' && "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
                        !['critical', 'major', 'minor'].includes(rejection.severity) && "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
                      )}>
                        {rejection.severity}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right text-red-600 font-medium">{rejection.quantity.toLocaleString()}</td>
                    <td className="py-3 px-3 text-muted-foreground max-w-[200px] truncate">{rejection.remarks}</td>
                  </tr>
                ))}
                {(!rejectionsData || rejectionsData.length === 0) && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">
                      No rejection data for selected period
                    </td>
                  </tr>
                )}
              </tbody>
              {rejectionsData && rejectionsData.length > 0 && (
                <tfoot>
                  <tr className="bg-muted/50 font-medium">
                    <td colSpan={5} className="py-3 px-3">Total</td>
                    <td className="py-3 px-3 text-right text-red-600">
                      {rejectionsData.reduce((sum, r) => sum + r.quantity, 0).toLocaleString()}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>
    </ERPLayout>
  );
}
