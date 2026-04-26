import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Target, CalendarIcon, TrendingUp, TrendingDown, CheckCircle, AlertTriangle, XCircle, Plus, Pencil, Trash2, Settings2 } from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth } from "date-fns";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell,
  LineChart, Line,
} from "recharts";

export default function ProductionTargetDashboard() {
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole('super_admin');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [viewMode, setViewMode] = useState<'daily' | 'monthly'>('daily');
  const [activeTab, setActiveTab] = useState('dashboard');

  // Target setting state
  const [isTargetDialogOpen, setIsTargetDialogOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<any>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [targetForm, setTargetForm] = useState({ department_id: '', grade_id: '', target_quantity: '' });

  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const dateStr = format(selectedDate, 'yyyy-MM-dd');
  const monthStart = format(startOfMonth(selectedDate), 'yyyy-MM-dd');
  const monthEnd = format(endOfMonth(selectedDate), 'yyyy-MM-dd');

  const dateRange = viewMode === 'daily'
    ? { start: dateStr, end: dateStr }
    : { start: monthStart, end: monthEnd };

  // Fetch departments
  const { data: departments } = useQuery({
    queryKey: ['departments'],
    queryFn: async () => {
      const { data, error } = await supabase.from('production_departments').select('*').eq('is_active', true).order('sequence_order');
      if (error) throw error;
      return data;
    },
  });

  // Fetch grades
  const { data: grades } = useQuery({
    queryKey: ['grades'],
    queryFn: async () => {
      const { data, error } = await supabase.from('grades').select('*').eq('is_active', true).order('name');
      if (error) throw error;
      return data;
    },
  });

  // Fetch saved targets
  const { data: savedTargets, isLoading: targetsLoading } = useQuery({
    queryKey: ['production-targets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_targets')
        .select('*, production_departments(name, code, sequence_order), grades(name, code)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Fetch department-wise target vs actual
  const { data: deptTargetData, isLoading } = useQuery({
    queryKey: ['prod-target-dashboard', dateRange.start, dateRange.end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_entries')
        .select(`
          entry_date, target_production, quantity_produced, quantity_ok, quantity_rejected,
          department_id, production_departments(id, name, code, sequence_order)
        `)
        .gte('entry_date', dateRange.start)
        .lte('entry_date', dateRange.end);

      if (error) throw error;

      const byDept: Record<string, {
        name: string; code: string; sequence: number;
        target: number; produced: number; ok: number; rejected: number;
        days: Set<string>;
      }> = {};

      data?.forEach(entry => {
        const dept = entry.production_departments as any;
        if (!dept) return;
        if (!byDept[dept.id]) {
          byDept[dept.id] = { name: dept.name, code: dept.code, sequence: dept.sequence_order || 0, target: 0, produced: 0, ok: 0, rejected: 0, days: new Set() };
        }
        byDept[dept.id].target += Number(entry.target_production || 0);
        byDept[dept.id].produced += Number(entry.quantity_produced);
        byDept[dept.id].ok += Number(entry.quantity_ok);
        byDept[dept.id].rejected += Number(entry.quantity_rejected);
        byDept[dept.id].days.add(entry.entry_date);
      });

      return Object.entries(byDept)
        .filter(([, d]) => d.target > 0)
        .map(([id, d]) => ({
          id, name: d.name, code: d.code, sequence: d.sequence,
          target: d.target, produced: d.produced, ok: d.ok, rejected: d.rejected,
          achievement: d.target > 0 ? Math.round((d.produced / d.target) * 100) : 0,
          workingDays: d.days.size,
        }))
        .sort((a, b) => a.sequence - b.sequence);
    },
  });

  // Trend data: last 14 days
  const { data: trendData } = useQuery({
    queryKey: ['prod-target-trend', dateStr],
    queryFn: async () => {
      const days: string[] = [];
      for (let i = 13; i >= 0; i--) {
        days.push(format(subDays(selectedDate, i), 'yyyy-MM-dd'));
      }
      const { data, error } = await supabase
        .from('production_entries')
        .select('entry_date, target_production, quantity_produced')
        .in('entry_date', days);
      if (error) throw error;
      return days.map(date => {
        const entries = data?.filter(e => e.entry_date === date) || [];
        const target = entries.reduce((s, e) => s + Number(e.target_production || 0), 0);
        const produced = entries.reduce((s, e) => s + Number(e.quantity_produced), 0);
        return { date: format(new Date(date), 'dd MMM'), target, produced, achievement: target > 0 ? Math.round((produced / target) * 100) : 0 };
      }).filter(d => d.target > 0);
    },
  });

  // Target CRUD mutations
  const saveTargetMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        department_id: targetForm.department_id,
        grade_id: targetForm.grade_id,
        target_quantity: Number(targetForm.target_quantity) || 0,
        is_active: true,
        created_by: user?.id,
      };

      if (editingTarget) {
        const { error } = await supabase.from('production_targets').update({
          target_quantity: payload.target_quantity,
        }).eq('id', editingTarget.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('production_targets').upsert(payload, { onConflict: 'department_id,grade_id' });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: "Success", description: editingTarget ? "Target updated" : "Target saved" });
      queryClient.invalidateQueries({ queryKey: ['production-targets'] });
      setIsTargetDialogOpen(false);
      resetTargetForm();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteTargetMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('production_targets').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Target deleted" });
      queryClient.invalidateQueries({ queryKey: ['production-targets'] });
      setDeleteTargetId(null);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resetTargetForm = () => {
    setTargetForm({ department_id: '', grade_id: '', target_quantity: '' });
    setEditingTarget(null);
  };

  const openEditTarget = (target: any) => {
    setEditingTarget(target);
    setTargetForm({
      department_id: target.department_id,
      grade_id: target.grade_id,
      target_quantity: String(target.target_quantity),
    });
    setIsTargetDialogOpen(true);
  };

  // Summary stats
  const summary = useMemo(() => {
    if (!deptTargetData) return { totalTarget: 0, totalProduced: 0, overallAchievement: 0, aboveTarget: 0, belowTarget: 0 };
    const totalTarget = deptTargetData.reduce((s, d) => s + d.target, 0);
    const totalProduced = deptTargetData.reduce((s, d) => s + d.produced, 0);
    return {
      totalTarget, totalProduced,
      overallAchievement: totalTarget > 0 ? Math.round((totalProduced / totalTarget) * 100) : 0,
      aboveTarget: deptTargetData.filter(d => d.achievement >= 100).length,
      belowTarget: deptTargetData.filter(d => d.achievement < 100).length,
    };
  }, [deptTargetData]);

  const getStatusColor = (achievement: number) => {
    if (achievement >= 100) return 'text-green-600';
    if (achievement >= 80) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getStatusBadge = (achievement: number) => {
    if (achievement >= 100) return <Badge className="bg-green-100 text-green-800 border-green-200"><CheckCircle className="h-3 w-3 mr-1" />Achieved</Badge>;
    if (achievement >= 80) return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200"><AlertTriangle className="h-3 w-3 mr-1" />Near Target</Badge>;
    return <Badge className="bg-red-100 text-red-800 border-red-200"><XCircle className="h-3 w-3 mr-1" />Below Target</Badge>;
  };

  const getBarColor = (achievement: number) => {
    if (achievement >= 100) return '#22c55e';
    if (achievement >= 80) return '#eab308';
    return '#ef4444';
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Production Target Dashboard" description="Set targets & track daily achievement by department" />

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="dashboard">Achievement Dashboard</TabsTrigger>
            {isSuperAdmin && <TabsTrigger value="targets"><Settings2 className="h-4 w-4 mr-1" />Target Settings</TabsTrigger>}
          </TabsList>

          {/* ===== DASHBOARD TAB ===== */}
          <TabsContent value="dashboard" className="space-y-6">
            <div className="flex items-center gap-3 justify-end">
              <Select value={viewMode} onValueChange={(v: 'daily' | 'monthly') => setViewMode(v)}>
                <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <CalendarIcon className="h-4 w-4" />
                    {format(selectedDate, viewMode === 'daily' ? 'dd MMM yyyy' : 'MMM yyyy')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar mode="single" selected={selectedDate} onSelect={(d) => d && setSelectedDate(d)} initialFocus />
                </PopoverContent>
              </Popover>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card><CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-100"><Target className="h-5 w-5 text-blue-600" /></div>
                  <div><p className="text-xs text-muted-foreground">Total Target</p><p className="text-xl font-bold">{summary.totalTarget.toLocaleString()}</p></div>
                </div>
              </CardContent></Card>
              <Card><CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-100"><TrendingUp className="h-5 w-5 text-purple-600" /></div>
                  <div><p className="text-xs text-muted-foreground">Total Produced</p><p className="text-xl font-bold">{summary.totalProduced.toLocaleString()}</p></div>
                </div>
              </CardContent></Card>
              <Card><CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className={cn("p-2 rounded-lg", summary.overallAchievement >= 100 ? "bg-green-100" : "bg-red-100")}>
                    {summary.overallAchievement >= 100 ? <CheckCircle className="h-5 w-5 text-green-600" /> : <TrendingDown className="h-5 w-5 text-red-600" />}
                  </div>
                  <div><p className="text-xs text-muted-foreground">Overall Achievement</p><p className={cn("text-xl font-bold", getStatusColor(summary.overallAchievement))}>{summary.overallAchievement}%</p></div>
                </div>
              </CardContent></Card>
              <Card><CardContent className="pt-6">
                <div className="flex items-center gap-3 justify-between w-full">
                  <div className="text-center"><p className="text-xs text-muted-foreground">Above Target</p><p className="text-xl font-bold text-green-600">{summary.aboveTarget}</p></div>
                  <div className="h-8 w-px bg-border" />
                  <div className="text-center"><p className="text-xs text-muted-foreground">Below Target</p><p className="text-xl font-bold text-red-600">{summary.belowTarget}</p></div>
                </div>
              </CardContent></Card>
            </div>

            {/* Department-wise Achievement */}
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Target className="h-5 w-5" />Department-wise Achievement Status</CardTitle></CardHeader>
              <CardContent>
                {isLoading ? (
                  <p className="text-muted-foreground text-center py-8">Loading...</p>
                ) : !deptTargetData?.length ? (
                  <p className="text-muted-foreground text-center py-8">No departments with targets for this period</p>
                ) : (
                  <div className="space-y-5">
                    {deptTargetData.map((dept) => (
                      <div key={dept.id} className="space-y-2 p-4 rounded-lg border">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="font-semibold text-sm">{dept.name}</span>
                            {getStatusBadge(dept.achievement)}
                          </div>
                          <span className={cn("text-lg font-bold", getStatusColor(dept.achievement))}>{dept.achievement}%</span>
                        </div>
                        <Progress value={Math.min(dept.achievement, 100)} className="h-3" />
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Target: <strong>{dept.target.toLocaleString()}</strong></span>
                          <span>Produced: <strong>{dept.produced.toLocaleString()}</strong></span>
                          <span>OK: <strong>{dept.ok.toLocaleString()}</strong></span>
                          <span>Rejected: <strong>{dept.rejected.toLocaleString()}</strong></span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle className="text-sm">Target vs Actual by Department</CardTitle></CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    {deptTargetData?.length ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={deptTargetData} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                          <XAxis type="number" />
                          <YAxis dataKey="code" type="category" width={60} tick={{ fontSize: 12 }} />
                          <Tooltip formatter={(value: number) => value.toLocaleString()} />
                          <Legend />
                          <Bar dataKey="target" fill="#94a3b8" name="Target" radius={[0, 4, 4, 0]} />
                          <Bar dataKey="produced" name="Produced" radius={[0, 4, 4, 0]}>
                            {deptTargetData.map((entry, index) => (
                              <Cell key={index} fill={getBarColor(entry.achievement)} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="text-muted-foreground text-center py-16">No data available</p>
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">Achievement Trend (Last 14 Days)</CardTitle></CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    {trendData?.length ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={trendData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                          <YAxis domain={[0, 'auto']} />
                          <Tooltip />
                          <Legend />
                          <Line type="monotone" dataKey="target" stroke="#94a3b8" strokeWidth={2} name="Target" dot={false} />
                          <Line type="monotone" dataKey="produced" stroke="#3b82f6" strokeWidth={2} name="Produced" dot={{ r: 3 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="text-muted-foreground text-center py-16">No trend data available</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ===== TARGET SETTINGS TAB ===== */}
          <TabsContent value="targets" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><Settings2 className="h-5 w-5" />Production Target Settings</CardTitle>
                  <Button onClick={() => { resetTargetForm(); setIsTargetDialogOpen(true); }}>
                    <Plus className="h-4 w-4 mr-2" />Set Target
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">Configure default targets per department & grade. These will auto-fill during production daily entry.</p>
              </CardHeader>
              <CardContent>
                {targetsLoading ? (
                  <p className="text-muted-foreground text-center py-8">Loading...</p>
                ) : !savedTargets?.length ? (
                  <p className="text-muted-foreground text-center py-8">No targets configured yet. Click "Set Target" to add.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-3 px-4 font-medium">Department</th>
                          <th className="text-left py-3 px-4 font-medium">Grade</th>
                          <th className="text-right py-3 px-4 font-medium">Target Quantity</th>
                          <th className="text-center py-3 px-4 font-medium">Status</th>
                          <th className="text-right py-3 px-4 font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {savedTargets.map((target: any) => (
                          <tr key={target.id} className="border-b hover:bg-muted/50">
                            <td className="py-3 px-4">{target.production_departments?.name || '-'}</td>
                            <td className="py-3 px-4">{target.grades?.code} - {target.grades?.name}</td>
                            <td className="py-3 px-4 text-right font-semibold">{Number(target.target_quantity).toLocaleString()}</td>
                            <td className="py-3 px-4 text-center">
                              <Badge variant={target.is_active ? "default" : "secondary"}>
                                {target.is_active ? 'Active' : 'Inactive'}
                              </Badge>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <div className="flex gap-1 justify-end">
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditTarget(target)}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteTargetId(target.id)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Target Dialog */}
        <Dialog open={isTargetDialogOpen} onOpenChange={(open) => { setIsTargetDialogOpen(open); if (!open) resetTargetForm(); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingTarget ? 'Edit Target' : 'Set Production Target'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label>Department *</Label>
                <Select value={targetForm.department_id} onValueChange={(v) => setTargetForm({ ...targetForm, department_id: v })} disabled={!!editingTarget}>
                  <SelectTrigger><SelectValue placeholder="Select Department" /></SelectTrigger>
                  <SelectContent>
                    {departments?.map((dept) => (
                      <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Grade *</Label>
                <Select value={targetForm.grade_id} onValueChange={(v) => setTargetForm({ ...targetForm, grade_id: v })} disabled={!!editingTarget}>
                  <SelectTrigger><SelectValue placeholder="Select Grade" /></SelectTrigger>
                  <SelectContent>
                    {grades?.map((grade) => (
                      <SelectItem key={grade.id} value={grade.id}>{grade.code} - {grade.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Target Quantity *</Label>
                <Input
                  type="number"
                  value={targetForm.target_quantity}
                  onChange={(e) => setTargetForm({ ...targetForm, target_quantity: e.target.value })}
                  placeholder="Enter daily target quantity"
                />
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => { setIsTargetDialogOpen(false); resetTargetForm(); }}>Cancel</Button>
                <Button
                  onClick={() => saveTargetMutation.mutate()}
                  disabled={!targetForm.department_id || !targetForm.grade_id || !targetForm.target_quantity || saveTargetMutation.isPending}
                >
                  {saveTargetMutation.isPending ? 'Saving...' : (editingTarget ? 'Update Target' : 'Save Target')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteTargetId} onOpenChange={(open) => !open && setDeleteTargetId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Target</AlertDialogTitle>
              <AlertDialogDescription>Are you sure you want to delete this target? This cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteTargetId && deleteTargetMutation.mutate(deleteTargetId)}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </ERPLayout>
  );
}
