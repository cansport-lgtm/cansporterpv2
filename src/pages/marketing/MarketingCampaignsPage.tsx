import { useEffect, useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Edit, Trash2, Megaphone, Search } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { CAMPAIGN_STATUSES, STATUS_COLORS } from "./constants";

interface Campaign { id: string; campaign_number: string; name: string; description: string|null; owner_user_id: string|null; planned_start: string|null; planned_end: string|null; actual_start: string|null; actual_end: string|null; budget: number; status: string; remarks: string|null; }

export default function MarketingCampaignsPage() {
  const [items, setItems] = useState<Campaign[]>([]);
  const [users, setUsers] = useState<{id:string;full_name:string}[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Campaign|null>(null);
  const [deleteId, setDeleteId] = useState<string|null>(null);
  const [form, setForm] = useState({ name:"", description:"", owner_user_id:"none", planned_start:"", planned_end:"", actual_start:"", actual_end:"", budget:"", status:"Draft", remarks:"" });

  useEffect(() => { load(); }, []);

  const load = async () => {
    const [c, u] = await Promise.all([
      supabase.from("marketing_campaigns").select("*").order("created_at",{ascending:false}),
      supabase.from("app_users").select("id, full_name").eq("is_active", true),
    ]);
    setItems(c.data || []);
    setUsers(u.data || []);
  };

  const reset = () => setForm({ name:"", description:"", owner_user_id:"none", planned_start:"", planned_end:"", actual_start:"", actual_end:"", budget:"", status:"Draft", remarks:"" });

  const openNew = () => { setEditing(null); reset(); setOpen(true); };
  const openEdit = (c: Campaign) => {
    setEditing(c);
    setForm({
      name: c.name, description: c.description||"", owner_user_id: c.owner_user_id||"none",
      planned_start: c.planned_start||"", planned_end: c.planned_end||"",
      actual_start: c.actual_start||"", actual_end: c.actual_end||"",
      budget: c.budget?.toString()||"", status: c.status, remarks: c.remarks||""
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    const payload: any = {
      name: form.name, description: form.description || null,
      owner_user_id: form.owner_user_id === "none" ? null : form.owner_user_id,
      planned_start: form.planned_start || null, planned_end: form.planned_end || null,
      actual_start: form.actual_start || null, actual_end: form.actual_end || null,
      budget: form.budget ? parseFloat(form.budget) : 0,
      status: form.status, remarks: form.remarks || null,
    };
    if (editing) {
      const { error } = await supabase.from("marketing_campaigns").update(payload).eq("id", editing.id);
      if (error) { toast.error(error.message); return; }
      toast.success("Campaign updated");
    } else {
      payload.campaign_number = "";
      const { error } = await supabase.from("marketing_campaigns").insert(payload);
      if (error) { toast.error(error.message); return; }
      toast.success("Campaign created");
    }
    setOpen(false); load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("marketing_campaigns").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Deleted"); load(); }
    setDeleteId(null);
  };

  const filtered = items.filter(c =>
    (statusFilter === "all" || c.status === statusFilter) &&
    (!search || c.name.toLowerCase().includes(search.toLowerCase()) || c.campaign_number.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <ERPLayout>
      <PageHeader title="Marketing Campaigns" description="Multi-deliverable initiatives with time bounds" icon={Megaphone} iconColor="bg-pink-500 text-white">
        <Button onClick={openNew} size="sm"><Plus className="h-4 w-4 mr-1"/> New Campaign</Button>
      </PageHeader>

      <Card>
        <CardContent className="p-4">
          <div className="flex gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
              <Input className="pl-9" placeholder="Search campaigns..." value={search} onChange={e=>setSearch(e.target.value)}/>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]"><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {CAMPAIGN_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-muted-foreground">
                <th className="p-2">Campaign #</th><th className="p-2">Name</th><th className="p-2">Status</th>
                <th className="p-2">Owner</th><th className="p-2">Planned Start</th><th className="p-2">Planned End</th>
                <th className="p-2">Budget (Rs.)</th><th className="p-2">Actions</th>
              </tr></thead>
              <tbody>
                {filtered.length === 0 ? <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No campaigns yet</td></tr> :
                  filtered.map(c => (
                    <tr key={c.id} className="border-b hover:bg-muted/50">
                      <td className="p-2 font-mono text-xs">{c.campaign_number}</td>
                      <td className="p-2 font-medium">{c.name}</td>
                      <td className="p-2"><Badge variant="outline" className={STATUS_COLORS[c.status]}>{c.status}</Badge></td>
                      <td className="p-2 text-xs">{users.find(u=>u.id===c.owner_user_id)?.full_name || "-"}</td>
                      <td className="p-2 text-xs">{c.planned_start ? format(new Date(c.planned_start),"dd MMM yy") : "-"}</td>
                      <td className="p-2 text-xs">{c.planned_end ? format(new Date(c.planned_end),"dd MMM yy") : "-"}</td>
                      <td className="p-2 text-xs">{c.budget?.toLocaleString() || 0}</td>
                      <td className="p-2"><div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={()=>openEdit(c)}><Edit className="h-4 w-4"/></Button>
                        <Button size="icon" variant="ghost" onClick={()=>setDeleteId(c.id)}><Trash2 className="h-4 w-4 text-destructive"/></Button>
                      </div></td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Campaign" : "New Campaign"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name *</Label><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></div>
            <div><Label>Description</Label><Textarea rows={2} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Status</Label>
                <Select value={form.status} onValueChange={v=>setForm({...form,status:v})}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{CAMPAIGN_STATUSES.map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Owner</Label>
                <Select value={form.owner_user_id} onValueChange={v=>setForm({...form,owner_user_id:v})}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {users.map(u=><SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Planned Start</Label><Input type="date" value={form.planned_start} onChange={e=>setForm({...form,planned_start:e.target.value})}/></div>
              <div><Label>Planned End</Label><Input type="date" value={form.planned_end} onChange={e=>setForm({...form,planned_end:e.target.value})}/></div>
              <div><Label>Actual Start</Label><Input type="date" value={form.actual_start} onChange={e=>setForm({...form,actual_start:e.target.value})}/></div>
              <div><Label>Actual End</Label><Input type="date" value={form.actual_end} onChange={e=>setForm({...form,actual_end:e.target.value})}/></div>
            </div>
            <div><Label>Budget (Rs.)</Label><Input type="number" value={form.budget} onChange={e=>setForm({...form,budget:e.target.value})}/></div>
            <div><Label>Remarks</Label><Textarea rows={2} value={form.remarks} onChange={e=>setForm({...form,remarks:e.target.value})}/></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={()=>setOpen(false)}>Cancel</Button>
            <Button onClick={save}>{editing ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={()=>setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete campaign?</AlertDialogTitle><AlertDialogDescription>Linked deliverables will lose their campaign reference but remain.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={()=>deleteId && remove(deleteId)}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ERPLayout>
  );
}
