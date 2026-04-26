import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { MetricCard } from "@/components/shared/MetricCard";
import { FileDown, Factory, Target, CheckCircle, XCircle } from "lucide-react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import * as XLSX from "xlsx";

export default function ProductionEntryListPage() {
  const today = new Date();
  const [fromDate, setFromDate] = useState(format(startOfMonth(today), 'yyyy-MM-dd'));
  const [toDate, setToDate] = useState(format(endOfMonth(today), 'yyyy-MM-dd'));
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [gradeFilter, setGradeFilter] = useState<string>("all");
  const [shiftFilter, setShiftFilter] = useState<string>("all");

  const { data: departments } = useQuery({
    queryKey: ['production-departments'],
    queryFn: async () => {
      const { data, error } = await supabase.from('production_departments').select('*').eq('is_active', true).order('sequence_order');
      if (error) throw error;
      return data;
    },
  });

  const { data: grades } = useQuery({
    queryKey: ['grades'],
    queryFn: async () => {
      const { data, error } = await supabase.from('grades').select('*').eq('is_active', true).order('name');
      if (error) throw error;
      return data;
    },
  });

  const { data: entries } = useQuery({
    queryKey: ['production-entry-list', fromDate, toDate, departmentFilter, gradeFilter, shiftFilter],
    queryFn: async () => {
      let query = supabase
        .from('production_entries')
        .select(`*, production_departments(name, code), production_sub_departments(name, code), grades(name, code), created_by_user:app_users!production_entries_created_by_fkey(full_name)`)
        .gte('entry_date', fromDate)
        .lte('entry_date', toDate)
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (departmentFilter !== 'all') query = query.eq('department_id', departmentFilter);
      if (gradeFilter !== 'all') query = query.eq('grade_id', gradeFilter);
      if (shiftFilter !== 'all') query = query.eq('shift', shiftFilter);

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const totalProduced = entries?.reduce((sum, e) => sum + (Number(e.quantity_produced) || 0), 0) || 0;
  const totalTarget = entries?.reduce((sum, e) => sum + (Number(e.target_production) || 0), 0) || 0;
  const totalOk = entries?.reduce((sum, e) => sum + (Number(e.quantity_ok) || 0), 0) || 0;
  const totalRejected = entries?.reduce((sum, e) => sum + (Number(e.quantity_rejected) || 0), 0) || 0;
  const overallAchievement = totalTarget > 0 ? ((totalProduced / totalTarget) * 100).toFixed(1) : '0.0';

  const handleExport = () => {
    if (!entries || entries.length === 0) return;
    const exportData = entries.map((e: any) => ({
      Date: e.entry_date,
      Shift: e.shift,
      Department: e.production_departments?.name || '-',
      'Sub-Dept': e.production_sub_departments?.name || '-',
      Grade: e.grades?.code || '-',
      Target: Number(e.target_production) || 0,
      Produced: Number(e.quantity_produced) || 0,
      OK: Number(e.quantity_ok) || 0,
      Rejected: Number(e.quantity_rejected) || 0,
      'Achievement %': Number(e.target_production) > 0 ? ((Number(e.quantity_produced) / Number(e.target_production)) * 100).toFixed(1) : '0.0',
      Status: e.status,
      'Created By': e.created_by_user?.full_name || '-',
      Remarks: e.remarks || '',
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Production Entries");
    XLSX.writeFile(wb, `Production_Entries_${fromDate}_to_${toDate}.xlsx`);
  };

  const columns = [
    {
      key: 'entry_date', header: 'Date',
      render: (item: any) => {
        try { return format(new Date(item.entry_date), 'dd MMM yyyy'); } catch { return item.entry_date; }
      },
    },
    { key: 'shift', header: 'Shift' },
    { key: 'production_departments', header: 'Department', render: (item: any) => item.production_departments?.name || '-' },
    { key: 'production_sub_departments', header: 'Sub-Dept', render: (item: any) => item.production_sub_departments?.name || '-' },
    { key: 'grades', header: 'Grade', render: (item: any) => item.grades?.code || '-' },
    { key: 'target_production', header: 'Target', render: (item: any) => Number(item.target_production)?.toLocaleString() || '0' },
    { key: 'quantity_produced', header: 'Produced', render: (item: any) => Number(item.quantity_produced)?.toLocaleString() || '0' },
    {
      key: 'achievement', header: 'Achievement',
      render: (item: any) => {
        const target = Number(item.target_production) || 0;
        const produced = Number(item.quantity_produced) || 0;
        const pct = target > 0 ? ((produced / target) * 100).toFixed(1) : '0.0';
        const isGood = Number(pct) >= 100;
        return <span className={isGood ? 'text-green-600 font-medium' : 'text-amber-600 font-medium'}>{pct}%</span>;
      },
    },
    { key: 'quantity_ok', header: 'OK', render: (item: any) => <span className="text-green-600">{Number(item.quantity_ok)?.toLocaleString() || '0'}</span> },
    { key: 'quantity_rejected', header: 'Rejected', render: (item: any) => <span className="text-destructive">{Number(item.quantity_rejected)?.toLocaleString() || '0'}</span> },
    { key: 'status', header: 'Status', render: (item: any) => <StatusBadge status={item.status} /> },
    { key: 'created_by', header: 'Created By', render: (item: any) => item.created_by_user?.full_name || '-' },
  ];

  return (
    <ERPLayout>
      <PageHeader title="Production Entry List" description="View and export all production entries" />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <MetricCard title="Total Entries" value={entries?.length || 0} icon={Factory} />
        <MetricCard title="Total Target" value={totalTarget.toLocaleString()} icon={Target} />
        <MetricCard title="Total Produced" value={totalProduced.toLocaleString()} icon={Factory} />
        <MetricCard title="OK Qty" value={totalOk.toLocaleString()} icon={CheckCircle} />
        <MetricCard title="Rejected" value={totalRejected.toLocaleString()} icon={XCircle} />
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <Label>From Date</Label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <Label>To Date</Label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div className="min-w-[160px]">
              <Label>Department</Label>
              <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {departments?.map((d) => (<SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[140px]">
              <Label>Grade</Label>
              <Select value={gradeFilter} onValueChange={setGradeFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Grades</SelectItem>
                  {grades?.map((g) => (<SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[120px]">
              <Label>Shift</Label>
              <Select value={shiftFilter} onValueChange={setShiftFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Shifts</SelectItem>
                  <SelectItem value="Day">Day</SelectItem>
                  <SelectItem value="Night">Night</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={handleExport} disabled={!entries?.length}>
              <FileDown className="h-4 w-4 mr-2" /> Export
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Achievement Bar */}
      {totalTarget > 0 && (
        <Card className="mb-6">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Overall Achievement</span>
              <span className={`text-sm font-bold ${Number(overallAchievement) >= 100 ? 'text-green-600' : 'text-amber-600'}`}>
                {overallAchievement}%
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-3">
              <div
                className={`h-3 rounded-full transition-all ${Number(overallAchievement) >= 100 ? 'bg-green-500' : 'bg-amber-500'}`}
                style={{ width: `${Math.min(Number(overallAchievement), 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Data Table */}
      <DataTable columns={columns} data={entries || []} />
    </ERPLayout>
  );
}
