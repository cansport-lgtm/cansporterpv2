import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function MPHMasterPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm] = useState({ department_id: '', sub_department_id: '', mph_number: '' });

  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: async () => {
      const { data, error } = await supabase.from('production_departments').select('id, name').eq('is_active', true).order('sequence_order');
      if (error) throw error;
      return data || [];
    },
  });

  const { data: subDepartments = [] } = useQuery({
    queryKey: ['sub-departments'],
    queryFn: async () => {
      const { data, error } = await supabase.from('production_sub_departments').select('id, name, department_id').eq('is_active', true).order('name');
      if (error) throw error;
      return data || [];
    },
  });

  const { data: mphEntries = [], isLoading, isError, error } = useQuery({
    queryKey: ['mph-calculating-numbers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mph_calculating_numbers')
        .select('id, department_id, sub_department_id, mph_number, is_active, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Build lookup maps for department/sub-department names
  const deptMap = Object.fromEntries((departments || []).map((d: any) => [d.id, d.name]));
  const subDeptMap = Object.fromEntries((subDepartments || []).map((sd: any) => [sd.id, sd.name]));

  const filteredSubDepts = (subDepartments || []).filter((sd: any) => sd.department_id === form.department_id);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        department_id: form.department_id,
        sub_department_id: form.sub_department_id || null,
        mph_number: Number(form.mph_number) || 0,
      };
      if (editItem) {
        const { error } = await supabase.from('mph_calculating_numbers').update(payload).eq('id', editItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('mph_calculating_numbers').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mph-calculating-numbers'] });
      toast.success(editItem ? 'MPH number updated' : 'MPH number added');
      setDialogOpen(false);
      setEditItem(null);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('mph_calculating_numbers').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mph-calculating-numbers'] });
      toast.success('Deleted');
      setDeleteId(null);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('mph_calculating_numbers').update({ is_active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mph-calculating-numbers'] }),
    onError: (err: any) => toast.error(err.message),
  });

  const openAdd = () => {
    setEditItem(null);
    setForm({ department_id: '', sub_department_id: '', mph_number: '' });
    setDialogOpen(true);
  };

  const openEdit = (item: any) => {
    setEditItem(item);
    setForm({
      department_id: item.department_id,
      sub_department_id: item.sub_department_id || '',
      mph_number: String(item.mph_number),
    });
    setDialogOpen(true);
  };

  return (
    <ERPLayout>
      <PageHeader title="MPH Calculating Numbers" description="Manage MPH multiplier per department/sub-department">
        <Button onClick={openAdd} size="sm"><Plus className="h-4 w-4 mr-1" /> Add MPH Number</Button>
      </PageHeader>

      {isError && (
        <div className="p-4 mb-4 bg-destructive/10 text-destructive rounded-md">
          Error loading data: {(error as any)?.message || 'Unknown error'}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left py-3 px-4 font-medium">Department</th>
                  <th className="text-left py-3 px-4 font-medium">Sub-Department</th>
                  <th className="text-right py-3 px-4 font-medium">MPH Number</th>
                  <th className="text-center py-3 px-4 font-medium">Active</th>
                  <th className="text-center py-3 px-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">Loading...</td></tr>
                ) : mphEntries.length === 0 ? (
                  <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">No MPH numbers configured</td></tr>
                ) : mphEntries.map((item: any) => (
                  <tr key={item.id} className="border-b hover:bg-muted/50">
                    <td className="py-3 px-4">{deptMap[item.department_id] || '-'}</td>
                    <td className="py-3 px-4">{item.sub_department_id ? (subDeptMap[item.sub_department_id] || '-') : '-'}</td>
                    <td className="py-3 px-4 text-right font-mono">{item.mph_number}</td>
                    <td className="py-3 px-4 text-center">
                      <Switch checked={item.is_active} onCheckedChange={(v) => toggleActive.mutate({ id: item.id, is_active: v })} />
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex justify-center gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(item)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteId(item.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editItem ? 'Edit' : 'Add'} MPH Calculating Number</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Department *</Label>
              <Select value={form.department_id} onValueChange={(v) => setForm({ ...form, department_id: v, sub_department_id: '' })}>
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  {departments.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Sub-Department (optional)</Label>
              <Select value={form.sub_department_id || 'none'} onValueChange={(v) => setForm({ ...form, sub_department_id: v === 'none' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {filteredSubDepts.map((sd: any) => <SelectItem key={sd.id} value={sd.id}>{sd.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>MPH Calculating Number *</Label>
              <Input type="number" step="any" value={form.mph_number} onChange={e => setForm({ ...form, mph_number: e.target.value })} placeholder="e.g. 0.5" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={!form.department_id || !form.mph_number || saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete MPH Number?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ERPLayout>
  );
}
