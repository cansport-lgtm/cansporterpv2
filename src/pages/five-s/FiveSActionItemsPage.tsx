import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";
import { format, parseISO } from "date-fns";

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-blue-100 text-blue-800',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
};

const STATUS_COLORS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  open: 'outline',
  in_progress: 'secondary',
  completed: 'default',
  overdue: 'destructive',
};

export default function FiveSActionItemsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [form, setForm] = useState({
    audit_id: '',
    department_id: '',
    description: '',
    assigned_to: '',
    priority: 'medium',
    status: 'open',
    due_date: '',
    corrective_action: '',
  });

  const { data: actionItems = [], isLoading } = useQuery({
    queryKey: ['five-s-action-items', statusFilter],
    queryFn: async () => {
      let query = supabase.from('five_s_action_items').select(`
        *,
        five_s_audits(audit_number),
        five_s_departments(name),
        assigned:app_users!five_s_action_items_assigned_to_fkey(full_name),
        creator:app_users!five_s_action_items_created_by_fkey(full_name)
      `).order('created_at', { ascending: false });
      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      const { data } = await query;
      return data || [];
    },
  });

  const { data: audits = [] } = useQuery({
    queryKey: ['five-s-audits-for-actions'],
    queryFn: async () => {
      const { data } = await supabase.from('five_s_audits').select('id, audit_number, department_id').eq('status', 'completed').order('audit_date', { ascending: false });
      return data || [];
    },
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['five-s-departments'],
    queryFn: async () => {
      const { data } = await supabase.from('five_s_departments').select('id, name').eq('is_active', true).order('name');
      return data || [];
    },
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users-5s-actions'],
    queryFn: async () => {
      const { data } = await supabase.from('app_users').select('id, full_name').eq('is_active', true).order('full_name');
      return data || [];
    },
  });

  const resetForm = () => {
    setForm({ audit_id: '', department_id: '', description: '', assigned_to: '', priority: 'medium', status: 'open', due_date: '', corrective_action: '' });
    setEditingItem(null);
  };

  const openNew = () => { resetForm(); setShowDialog(true); };

  const openEdit = (item: any) => {
    setEditingItem(item);
    setForm({
      audit_id: item.audit_id || '',
      department_id: item.department_id || '',
      description: item.description,
      assigned_to: item.assigned_to || '',
      priority: item.priority,
      status: item.status,
      due_date: item.due_date || '',
      corrective_action: item.corrective_action || '',
    });
    setShowDialog(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        audit_id: form.audit_id || null,
        department_id: form.department_id || null,
        description: form.description,
        assigned_to: form.assigned_to || null,
        priority: form.priority,
        status: form.status,
        due_date: form.due_date || null,
        corrective_action: form.corrective_action || null,
        completed_date: form.status === 'completed' ? format(new Date(), 'yyyy-MM-dd') : null,
      };

      if (editingItem) {
        const { error } = await supabase.from('five_s_action_items').update(payload).eq('id', editingItem.id);
        if (error) throw error;
      } else {
        payload.created_by = user?.id;
        const { error } = await supabase.from('five_s_action_items').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['five-s-action-items'] });
      setShowDialog(false);
      resetForm();
      toast.success(editingItem ? "Action item updated" : "Action item created");
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <ERPLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <PageHeader title="5S Action Items" description="Track corrective actions from audits" />
          <div className="flex gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={openNew}>
              <Plus className="h-4 w-4 mr-2" /> New Action
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Audit</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Assigned To</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {actionItems.map(item => (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-[200px] truncate">{item.description}</TableCell>
                    <TableCell className="text-xs">{(item as any).five_s_audits?.audit_number || '-'}</TableCell>
                    <TableCell>{(item as any).five_s_departments?.name || '-'}</TableCell>
                    <TableCell>{(item as any).assigned?.full_name || '-'}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_COLORS[item.priority]}`}>
                        {item.priority}
                      </span>
                    </TableCell>
                    <TableCell>{item.due_date ? format(parseISO(item.due_date), 'dd MMM yyyy') : '-'}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_COLORS[item.status] || 'outline'}>
                        {item.status.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(item)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {actionItems.length === 0 && !isLoading && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">No action items found</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Create/Edit Dialog */}
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingItem ? 'Edit' : 'New'} Action Item</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Description *</Label>
                <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe the action required..." />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Related Audit</Label>
                  <Select value={form.audit_id} onValueChange={v => {
                    const audit = audits.find(a => a.id === v);
                    setForm(f => ({ ...f, audit_id: v, department_id: audit?.department_id || f.department_id }));
                  }}>
                    <SelectTrigger><SelectValue placeholder="Select audit" /></SelectTrigger>
                    <SelectContent>
                      {audits.map(a => (
                        <SelectItem key={a.id} value={a.id}>{a.audit_number}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Department</Label>
                  <Select value={form.department_id} onValueChange={v => setForm(f => ({ ...f, department_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select dept" /></SelectTrigger>
                    <SelectContent>
                      {departments.map(d => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Assigned To</Label>
                  <Select value={form.assigned_to} onValueChange={v => setForm(f => ({ ...f, assigned_to: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
                    <SelectContent>
                      {users.map(u => (
                        <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Due Date</Label>
                  <Input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Priority</Label>
                  <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="overdue">Overdue</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Corrective Action</Label>
                <Textarea value={form.corrective_action} onChange={e => setForm(f => ({ ...f, corrective_action: e.target.value }))} placeholder="Describe corrective action taken..." />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
              <Button onClick={() => saveMutation.mutate()} disabled={!form.description || saveMutation.isPending}>
                {editingItem ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
