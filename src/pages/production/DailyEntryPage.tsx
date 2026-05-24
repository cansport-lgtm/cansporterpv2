import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, AlertTriangle, Trash2, Pencil } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { format, startOfMonth, endOfMonth } from "date-fns";

interface RejectionEntry {
  defect_reason_id: string;
  quantity: number;
  remarks?: string;
}

export default function DailyEntryPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  const PRESS_SHEETS_UOM_ID = '417273f3-3f89-41af-ba32-49e5e84ae310';
  const BAGS_UOM_ID = '7b39d4ca-f31c-4a1a-b742-28239101ff91';
  const PRESS_DEPT_CODE = 'PRESS';

  const [formData, setFormData] = useState({
    entry_date: format(new Date(), 'yyyy-MM-dd'),
    shift: 'Day',
    department_id: '',
    sub_department_id: '',
    grade_id: '',
    target_production: '',
    quantity_produced: '',
    quantity_ok: '',
    quantity_rejected: '',
    remarks: '',
  });
  const [rejections, setRejections] = useState<RejectionEntry[]>([]);

  const getUomIdForDepartment = (deptId: string): string => {
    const dept = departments?.find(d => d.id === deptId);
    if (dept?.code === PRESS_DEPT_CODE) return PRESS_SHEETS_UOM_ID;
    return BAGS_UOM_ID;
  };

  const getUnitLabel = (deptId: string): string => {
    const dept = departments?.find(d => d.id === deptId);
    if (dept?.code === PRESS_DEPT_CODE) return 'Press Sheets';
    return 'Bags';
  };
  
  const { toast } = useToast();
  const { user, hasRole } = useAuth();
  const queryClient = useQueryClient();

  const { data: departments } = useQuery({
    queryKey: ['production-departments'],
    queryFn: async () => {
      const { data, error } = await supabase.from('production_departments').select('*').eq('is_active', true).order('sequence_order');
      if (error) throw error;
      return data;
    },
  });

  // Fetch sub-departments for selected department
  const { data: subDepartments } = useQuery({
    queryKey: ['production-sub-departments', formData.department_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('production_sub_departments').select('*').eq('department_id', formData.department_id).eq('is_active', true).order('sequence_order');
      if (error) throw error;
      return data;
    },
    enabled: !!formData.department_id,
  });

  const { data: grades } = useQuery({
    queryKey: ['grades'],
    queryFn: async () => {
      const { data, error } = await supabase.from('grades').select('*').eq('is_active', true).order('name');
      if (error) throw error;
      return data;
    },
  });

  // Fetch saved production targets for auto-fill
  const { data: productionTargets } = useQuery({
    queryKey: ['production-targets-lookup'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_targets')
        .select('department_id, grade_id, target_quantity')
        .eq('is_active', true);
      if (error) throw error;
      return data;
    },
  });

  const { data: defectReasons } = useQuery({
    queryKey: ['defect-reasons'],
    queryFn: async () => {
      const { data, error } = await supabase.from('defect_reasons').select('*').eq('is_active', true).order('name');
      if (error) throw error;
      return data;
    },
  });

  const { data: entries, isLoading } = useQuery({
    queryKey: ['production-entries', dateFilter, departmentFilter],
    queryFn: async () => {
      let query = supabase
        .from('production_entries')
        .select(`*, production_departments(name, code), production_sub_departments(name, code), grades(name, code), created_by_user:app_users!production_entries_created_by_fkey(full_name)`)
        .eq('entry_date', dateFilter)
        .order('created_at', { ascending: false });
      if (departmentFilter !== 'all') query = query.eq('department_id', departmentFilter);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  // Auto-fill target when department+grade changes
  const lookupTarget = (deptId: string, gradeId: string): string => {
    if (!productionTargets || !deptId || !gradeId) return '';
    const match = productionTargets.find(t => t.department_id === deptId && t.grade_id === gradeId);
    return match ? String(match.target_quantity) : '';
  };

  const handleDepartmentChange = (v: string) => {
    const target = lookupTarget(v, formData.grade_id);
    setFormData({ ...formData, department_id: v, sub_department_id: '', target_production: target || formData.target_production });
  };

  const handleGradeChange = (v: string) => {
    const target = lookupTarget(formData.department_id, v);
    setFormData({ ...formData, grade_id: v, target_production: target || formData.target_production });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const { data: entry, error: entryError } = await supabase
        .from('production_entries')
        .insert({
          entry_date: formData.entry_date,
          shift: formData.shift,
          department_id: formData.department_id,
          sub_department_id: formData.sub_department_id || null,
          grade_id: formData.grade_id,
          uom_id: getUomIdForDepartment(formData.department_id),
          target_production: Number(formData.target_production) || 0,
          quantity_produced: Number(formData.quantity_produced),
          quantity_ok: Number(formData.quantity_ok),
          quantity_rejected: Number(formData.quantity_rejected),
          remarks: formData.remarks || null,
          created_by: user?.id,
          status: 'Draft',
        })
        .select()
        .single();
      if (entryError) throw entryError;

      if (rejections.length > 0 && entry) {
        const rejectionsToInsert = rejections.filter(r => r.quantity > 0).map(r => ({
          production_entry_id: entry.id,
          defect_reason_id: r.defect_reason_id,
          quantity: r.quantity,
          remarks: r.remarks || null,
        }));
        if (rejectionsToInsert.length > 0) {
          const { error: rejError } = await supabase.from('production_rejections').insert(rejectionsToInsert);
          if (rejError) throw rejError;
        }
      }
      return entry;
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Production entry created successfully" });
      queryClient.invalidateQueries({ queryKey: ['production-entries'] });
      setIsDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({
      entry_date: format(new Date(), 'yyyy-MM-dd'),
      shift: 'Day',
      department_id: '',
      sub_department_id: '',
      grade_id: '',
      target_production: '',
      quantity_produced: '',
      quantity_ok: '',
      quantity_rejected: '',
      remarks: '',
    });
    setRejections([]);
    setEditingEntry(null);
  };

  const loadEntryForEdit = async (entry: any) => {
    setEditingEntry(entry);
    setFormData({
      entry_date: entry.entry_date,
      shift: entry.shift || 'Day',
      department_id: entry.department_id,
      sub_department_id: entry.sub_department_id || '',
      grade_id: entry.grade_id,
      target_production: String(entry.target_production || ''),
      quantity_produced: String(entry.quantity_produced || ''),
      quantity_ok: String(entry.quantity_ok || ''),
      quantity_rejected: String(entry.quantity_rejected || ''),
      remarks: entry.remarks || '',
    });

    const { data: existingRejections } = await supabase.from('production_rejections').select('*').eq('production_entry_id', entry.id);
    if (existingRejections && existingRejections.length > 0) {
      setRejections(existingRejections.map(r => ({ defect_reason_id: r.defect_reason_id, quantity: r.quantity, remarks: r.remarks || '' })));
    } else {
      setRejections([]);
    }
    setIsDialogOpen(true);
  };

  const handleQuantityChange = (field: 'quantity_produced' | 'quantity_ok' | 'quantity_rejected', value: string) => {
    const numValue = Number(value) || 0;
    const newData = { ...formData, [field]: value };
    if (field === 'quantity_produced' || field === 'quantity_rejected') {
      const produced = field === 'quantity_produced' ? numValue : Number(formData.quantity_produced) || 0;
      const rejected = field === 'quantity_rejected' ? numValue : Number(formData.quantity_rejected) || 0;
      newData.quantity_ok = String(Math.max(0, produced - rejected));
    } else if (field === 'quantity_ok') {
      const produced = Number(formData.quantity_produced) || 0;
      newData.quantity_rejected = String(Math.max(0, produced - numValue));
    }
    setFormData(newData);
  };

  const addRejection = () => {
    setRejections([...rejections, { defect_reason_id: '', quantity: 0, remarks: '' }]);
  };

  const updateRejection = (index: number, field: keyof RejectionEntry, value: any) => {
    const updated = [...rejections];
    updated[index] = { ...updated[index], [field]: value };
    setRejections(updated);
  };

  const removeRejection = (index: number) => {
    setRejections(rejections.filter((_, i) => i !== index));
  };

  const columns = [
    {
      key: 'entry_date', header: 'Date',
      render: (item: any) => {
        if (!item.entry_date) return '-';
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
    { key: 'quantity_rejected', header: 'Rejected', render: (item: any) => <span className="text-red-600">{Number(item.quantity_rejected)?.toLocaleString() || '0'}</span> },
    { key: 'status', header: 'Status', render: (item: any) => <StatusBadge status={item.status} /> },
    ...(user ? [{
      key: 'actions', header: 'Actions',
      render: (item: any) => {
        const EDIT_WINDOW_MS = 72 * 60 * 60 * 1000;
        const createdAt = item.created_at ? new Date(item.created_at).getTime() : 0;
        const withinWindow = createdAt > 0 && (Date.now() - createdAt) <= EDIT_WINDOW_MS;
        const canEdit = hasRole('super_admin') || withinWindow;
        const canDelete = hasRole('super_admin');
        if (!canEdit && !canDelete) return null;
        return (
          <div className="flex gap-1">
            {canEdit && (
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10" onClick={(e) => { e.stopPropagation(); loadEntryForEdit(item); }}>
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {canDelete && (
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={(e) => { e.stopPropagation(); setDeleteId(item.id); }}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        );
      },
    }] : []),
  ];

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editingEntry) throw new Error('No entry selected for editing');
      const EDIT_WINDOW_MS = 72 * 60 * 60 * 1000;
      if (!hasRole('super_admin') && editingEntry.created_at) {
        const elapsed = Date.now() - new Date(editingEntry.created_at).getTime();
        if (elapsed > EDIT_WINDOW_MS) throw new Error('Editing window expired (72 hours). Contact a Super Admin.');
      }
      const { error: entryError } = await supabase.from('production_entries').update({
        entry_date: formData.entry_date, shift: formData.shift, department_id: formData.department_id,
        sub_department_id: formData.sub_department_id || null,
        grade_id: formData.grade_id, uom_id: getUomIdForDepartment(formData.department_id),
        target_production: Number(formData.target_production) || 0,
        quantity_produced: Number(formData.quantity_produced), quantity_ok: Number(formData.quantity_ok),
        quantity_rejected: Number(formData.quantity_rejected), remarks: formData.remarks || null,
      }).eq('id', editingEntry.id);
      if (entryError) throw entryError;

      const { error: deleteRejError } = await supabase.from('production_rejections').delete().eq('production_entry_id', editingEntry.id);
      if (deleteRejError) throw deleteRejError;

      if (rejections.length > 0) {
        const rejectionsToInsert = rejections.filter(r => r.quantity > 0 && r.defect_reason_id).map(r => ({
          production_entry_id: editingEntry.id, defect_reason_id: r.defect_reason_id, quantity: r.quantity, remarks: r.remarks || null,
        }));
        if (rejectionsToInsert.length > 0) {
          const { error: rejError } = await supabase.from('production_rejections').insert(rejectionsToInsert);
          if (rejError) throw rejError;
        }
      }
      return editingEntry;
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Production entry updated successfully" });
      queryClient.invalidateQueries({ queryKey: ['production-entries'] });
      setIsDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error: rejError } = await supabase.from('production_rejections').delete().eq('production_entry_id', id);
      if (rejError) throw rejError;
      const { error } = await supabase.from('production_entries').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Entry deleted successfully" });
      queryClient.invalidateQueries({ queryKey: ['production-entries'] });
      setDeleteId(null);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <ERPLayout>
      <PageHeader title="Daily Production Entry" description="Log daily production output by department and grade" />

      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <Label>Date</Label>
              <Input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label>Department</Label>
              <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                <SelectTrigger><SelectValue placeholder="All Departments" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {departments?.map((dept) => (<SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
              <DialogTrigger asChild>
                <Button onClick={() => { resetForm(); setIsDialogOpen(true); }}><Plus className="h-4 w-4 mr-2" />New Entry</Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{editingEntry ? 'Edit Production Entry' : 'New Production Entry'}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Date *</Label>
                      <Input type="date" value={formData.entry_date} onChange={(e) => setFormData({ ...formData, entry_date: e.target.value })} />
                    </div>
                    <div>
                      <Label>Shift *</Label>
                      <Select value={formData.shift} onValueChange={(v) => setFormData({ ...formData, shift: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Day">Day</SelectItem>
                          <SelectItem value="Night" disabled>Night (Disabled)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label>Department *</Label>
                    <Select value={formData.department_id} onValueChange={handleDepartmentChange}>
                      <SelectTrigger><SelectValue placeholder="Select Department" /></SelectTrigger>
                      <SelectContent>
                        {departments?.map((dept) => (<SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>

                  {subDepartments && subDepartments.length > 0 && (
                    <div>
                      <Label>Sub-Department</Label>
                      <Select value={formData.sub_department_id || "none"} onValueChange={(v) => setFormData({ ...formData, sub_department_id: v === 'none' ? '' : v })}>
                        <SelectTrigger><SelectValue placeholder="Select Sub-Department (Optional)" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {subDepartments.map((sub) => (<SelectItem key={sub.id} value={sub.id}>{sub.name}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div>
                    <Label>Grade *</Label>
                    <Select value={formData.grade_id} onValueChange={handleGradeChange}>
                      <SelectTrigger><SelectValue placeholder="Select Grade" /></SelectTrigger>
                      <SelectContent>
                        {grades?.map((grade) => (<SelectItem key={grade.id} value={grade.id}>{grade.code} - {grade.name}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>

                  {formData.department_id && (
                    <div className="text-sm text-muted-foreground bg-muted/50 px-3 py-2 rounded-md">
                      Unit: <span className="font-medium">{getUnitLabel(formData.department_id)}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Target Production ({formData.department_id ? getUnitLabel(formData.department_id) : 'units'}) *</Label>
                      <Input type="number" value={formData.target_production} onChange={(e) => setFormData({ ...formData, target_production: e.target.value })} placeholder="0" />
                      {formData.department_id && formData.grade_id && lookupTarget(formData.department_id, formData.grade_id) && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Auto-filled from saved target: {lookupTarget(formData.department_id, formData.grade_id)}
                        </p>
                      )}
                    </div>
                    <div>
                      <Label>Qty Produced ({formData.department_id ? getUnitLabel(formData.department_id) : 'units'}) *</Label>
                      <Input type="number" value={formData.quantity_produced} onChange={(e) => handleQuantityChange('quantity_produced', e.target.value)} placeholder="0" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Qty OK</Label>
                      <Input type="number" value={formData.quantity_ok} onChange={(e) => handleQuantityChange('quantity_ok', e.target.value)} placeholder="0" className="text-green-600" />
                    </div>
                    <div>
                      <Label>Qty Rejected</Label>
                      <Input type="number" value={formData.quantity_rejected} onChange={(e) => handleQuantityChange('quantity_rejected', e.target.value)} placeholder="0" className="text-red-600" />
                    </div>
                  </div>

                  {Number(formData.quantity_rejected) > 0 && (
                    <Card className="border-red-200 bg-red-50/50">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 text-red-500" />Rejection Details
                          </CardTitle>
                          <Button type="button" variant="outline" size="sm" onClick={addRejection}><Plus className="h-3 w-3 mr-1" />Add Reason</Button>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {rejections.map((rej, index) => (
                          <div key={index} className="flex gap-2 items-start">
                            <Select value={rej.defect_reason_id} onValueChange={(v) => updateRejection(index, 'defect_reason_id', v)}>
                              <SelectTrigger className="flex-1"><SelectValue placeholder="Select Reason" /></SelectTrigger>
                              <SelectContent>
                                {defectReasons?.map((reason) => (<SelectItem key={reason.id} value={reason.id}>{reason.name} ({reason.severity})</SelectItem>))}
                              </SelectContent>
                            </Select>
                            <Input type="number" value={rej.quantity} onChange={(e) => updateRejection(index, 'quantity', Number(e.target.value))} placeholder="Qty" className="w-20" />
                            <Button type="button" variant="ghost" size="sm" onClick={() => removeRejection(index)}>×</Button>
                          </div>
                        ))}
                        {rejections.length === 0 && (
                          <p className="text-sm text-muted-foreground text-center py-2">Click "Add Reason" to specify rejection details</p>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  <div>
                    <Label>Remarks</Label>
                    <Textarea value={formData.remarks} onChange={(e) => setFormData({ ...formData, remarks: e.target.value })} placeholder="Optional notes..." rows={2} />
                  </div>

                  <div className="flex justify-end gap-2 pt-4">
                    <Button variant="outline" onClick={() => { setIsDialogOpen(false); resetForm(); }}>Cancel</Button>
                    <Button
                      onClick={() => editingEntry ? updateMutation.mutate() : createMutation.mutate()}
                      disabled={!formData.department_id || !formData.grade_id || !formData.quantity_produced || createMutation.isPending || updateMutation.isPending}
                    >
                      {(createMutation.isPending || updateMutation.isPending) ? 'Saving...' : (editingEntry ? 'Update Entry' : 'Save Entry')}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <DataTable columns={columns} data={entries || []} emptyMessage="No production entries found for the selected date" />
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Production Entry</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to delete this production entry? This action cannot be undone and will also remove any associated rejection records.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteId && deleteMutation.mutate(deleteId)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ERPLayout>
  );
}
