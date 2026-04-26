import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";

const S_CATEGORIES = ['Sort', 'Set in Order', 'Shine', 'Standardize', 'Sustain'] as const;
const CATEGORY_COLORS: Record<string, string> = {
  'Sort': 'bg-blue-100 text-blue-800',
  'Set in Order': 'bg-green-100 text-green-800',
  'Shine': 'bg-yellow-100 text-yellow-800',
  'Standardize': 'bg-purple-100 text-purple-800',
  'Sustain': 'bg-red-100 text-red-800',
};

export default function FiveSCheckpointsPage() {
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [form, setForm] = useState({ category: 'Sort', checkpoint_text: '', checkpoint_text_urdu: '', sort_order: 0, is_active: true });

  const { data: checkpoints = [], isLoading } = useQuery({
    queryKey: ['five-s-checkpoints-master', categoryFilter],
    queryFn: async () => {
      let query = supabase.from('five_s_checkpoints').select('*').order('sort_order');
      if (categoryFilter !== 'all') query = query.eq('category', categoryFilter);
      const { data } = await query;
      return data || [];
    },
  });

  const resetForm = () => {
    setForm({ category: 'Sort', checkpoint_text: '', checkpoint_text_urdu: '', sort_order: 0, is_active: true });
    setEditingItem(null);
  };

  const openNew = () => { resetForm(); setShowDialog(true); };
  const openEdit = (item: any) => {
    setEditingItem(item);
    setForm({ category: item.category, checkpoint_text: item.checkpoint_text, checkpoint_text_urdu: item.checkpoint_text_urdu || '', sort_order: item.sort_order, is_active: item.is_active });
    setShowDialog(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editingItem) {
        const { error } = await supabase.from('five_s_checkpoints').update(form).eq('id', editingItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('five_s_checkpoints').insert(form);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['five-s-checkpoints-master'] });
      setShowDialog(false);
      resetForm();
      toast.success(editingItem ? "Checkpoint updated" : "Checkpoint created");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('five_s_checkpoints').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['five-s-checkpoints-master'] });
      toast.success("Checkpoint deleted");
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <ERPLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <PageHeader title="5S Checkpoints" description="Manage audit checklist items" />
          <div className="flex gap-2">
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {S_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" /> Add Checkpoint</Button>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Category</TableHead>
                   <TableHead>Checkpoint</TableHead>
                   <TableHead>اردو متن</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {checkpoints.map(cp => (
                  <TableRow key={cp.id}>
                    <TableCell>{cp.sort_order}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${CATEGORY_COLORS[cp.category] || ''}`}>
                        {cp.category}
                      </span>
                    </TableCell>
                    <TableCell>{cp.checkpoint_text}</TableCell>
                    <TableCell dir="rtl" className="font-urdu text-right">{(cp as any).checkpoint_text_urdu || '-'}</TableCell>
                    <TableCell>
                      <Badge variant={cp.is_active ? 'default' : 'secondary'}>{cp.is_active ? 'Active' : 'Inactive'}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(cp)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => { if (confirm('Delete this checkpoint?')) deleteMutation.mutate(cp.id); }}>
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {checkpoints.length === 0 && !isLoading && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No checkpoints found</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingItem ? 'Edit' : 'Add'} Checkpoint</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Category *</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {S_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Checkpoint Text (English) *</Label>
                <Input value={form.checkpoint_text} onChange={e => setForm(f => ({ ...f, checkpoint_text: e.target.value }))} placeholder="Enter checkpoint description..." />
              </div>
              <div>
                <Label>اردو متن (Urdu Text)</Label>
                <Input dir="rtl" className="text-right" value={form.checkpoint_text_urdu} onChange={e => setForm(f => ({ ...f, checkpoint_text_urdu: e.target.value }))} placeholder="...اردو میں چیک پوائنٹ درج کریں" />
              </div>
              <div>
                <Label>Sort Order</Label>
                <Input type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))} />
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
                <Label>Active</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
              <Button onClick={() => saveMutation.mutate()} disabled={!form.checkpoint_text || saveMutation.isPending}>
                {editingItem ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
