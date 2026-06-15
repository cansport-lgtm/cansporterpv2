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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Edit, Trash2, Users } from "lucide-react";
import { differenceInDays, format, parseISO } from "date-fns";
import { toast } from "sonner";
import { CAMPAIGN_STATUSES, STATUS_COLORS } from "./constants";

const EVENT_TYPES = ["Trade Show","Exhibition","Sponsorship","Activation","Conference","Launch","Other"];

export default function MarketingEventsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [users, setUsers] = useState<{id:string;full_name:string}[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any|null>(null);
  const [deleteId, setDeleteId] = useState<string|null>(null);
  const [form, setForm] = useState({ name:"", event_type:"Trade Show", venue:"", owner_user_id:"none", planned_start:"", planned_end:"", actual_start:"", actual_end:"", budget:"", status:"Draft", remarks:"" });

  useEffect(()=>{ load(); },[]);
  const load = async () => {
    const [e, u] = await Promise.all([
      supabase.from("marketing_events").select("*").order("planned_start",{ascending:false,nullsFirst:false}),
      supabase.from("app_users").select("id,full_name").eq("is_active",true),
    ]);
    setItems(e.data||[]); setUsers(u.data||[]);
  };
  const reset = () => setForm({ name:"", event_type:"Trade Show", venue:"", owner_user_id:"none", planned_start:"", planned_end:"", actual_start:"", actual_end:"", budget:"", status:"Draft", remarks:"" });
  const openNew = () => { setEditing(null); reset(); setOpen(true); };
  const openEdit = (e:any) => { setEditing(e); setForm({ name:e.name, event_type:e.event_type||"Trade Show", venue:e.venue||"", owner_user_id:e.owner_user_id||"none", planned_start:e.planned_start||"", planned_end:e.planned_end||"", actual_start:e.actual_start||"", actual_end:e.actual_end||"", budget:e.budget?.toString()||"", status:e.status, remarks:e.remarks||"" }); setOpen(true); };

  const save = async () => {
    if (!form.name.trim()) { toast.error("Name required"); return; }
    const payload:any = { name:form.name, event_type:form.event_type, venue:form.venue||null,
      owner_user_id: form.owner_user_id==="none"?null:form.owner_user_id,
      planned_start: form.planned_start||null, planned_end: form.planned_end||null,
      actual_start: form.actual_start||null, actual_end: form.actual_end||null,
      budget: form.budget?parseFloat(form.budget):0, status:form.status, remarks:form.remarks||null };
    if (editing) { const { error } = await supabase.from("marketing_events").update(payload).eq("id",editing.id); if (error){toast.error(error.message);return;} toast.success("Updated"); }
    else { payload.event_number=""; const { error } = await supabase.from("marketing_events").insert(payload); if (error){toast.error(error.message);return;} toast.success("Created"); }
    setOpen(false); load();
  };

  const remove = async (id:string) => {
    const { error } = await supabase.from("marketing_events").delete().eq("id",id);
    if (error) toast.error(error.message); else { toast.success("Deleted"); load(); }
    setDeleteId(null);
  };

  return (
    <ERPLayout>
      <PageHeader title="Events & Activations" description="Trade shows, exhibitions and on-ground activations" icon={Users} iconColor="bg-purple-500 text-white">
        <Button onClick={openNew} size="sm"><Plus className="h-4 w-4 mr-1"/> New Event</Button>
      </PageHeader>

      <Card><CardContent className="p-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-muted-foreground">
            <th className="p-2">Event #</th><th className="p-2">Name</th><th className="p-2">Type</th><th className="p-2">Venue</th>
            <th className="p-2">Start</th><th className="p-2">End</th><th className="p-2">Countdown</th>
            <th className="p-2">Status</th><th className="p-2">Actions</th>
          </tr></thead>
          <tbody>
            {items.length===0 ? <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No events yet</td></tr> :
              items.map(e => {
                const days = e.planned_start ? differenceInDays(parseISO(e.planned_start), new Date()) : null;
                return (
                <tr key={e.id} className="border-b hover:bg-muted/50">
                  <td className="p-2 font-mono text-xs">{e.event_number}</td>
                  <td className="p-2 font-medium">{e.name}</td>
                  <td className="p-2 text-xs"><Badge variant="secondary">{e.event_type}</Badge></td>
                  <td className="p-2 text-xs">{e.venue||"-"}</td>
                  <td className="p-2 text-xs">{e.planned_start?format(parseISO(e.planned_start),"dd MMM yy"):"-"}</td>
                  <td className="p-2 text-xs">{e.planned_end?format(parseISO(e.planned_end),"dd MMM yy"):"-"}</td>
                  <td className="p-2 text-xs">{days===null?"-":days>0?`in ${days}d`:days===0?"Today":`${-days}d ago`}</td>
                  <td className="p-2"><Badge variant="outline" className={STATUS_COLORS[e.status]}>{e.status}</Badge></td>
                  <td className="p-2"><div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={()=>openEdit(e)}><Edit className="h-4 w-4"/></Button>
                    <Button size="icon" variant="ghost" onClick={()=>setDeleteId(e.id)}><Trash2 className="h-4 w-4 text-destructive"/></Button>
                  </div></td>
                </tr>);
              })
            }
          </tbody>
        </table>
      </CardContent></Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?"Edit Event":"New Event"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name *</Label><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Type</Label>
                <Select value={form.event_type} onValueChange={v=>setForm({...form,event_type:v})}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{EVENT_TYPES.map(t=><SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Status</Label>
                <Select value={form.status} onValueChange={v=>setForm({...form,status:v})}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{CAMPAIGN_STATUSES.map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Venue</Label><Input value={form.venue} onChange={e=>setForm({...form,venue:e.target.value})}/></div>
            <div><Label>Owner</Label>
              <Select value={form.owner_user_id} onValueChange={v=>setForm({...form,owner_user_id:v})}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent><SelectItem value="none">— None —</SelectItem>{users.map(u=><SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}</SelectContent>
              </Select>
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
          <DialogFooter><Button variant="outline" onClick={()=>setOpen(false)}>Cancel</Button><Button onClick={save}>{editing?"Update":"Create"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={()=>setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete event?</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={()=>deleteId && remove(deleteId)}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ERPLayout>
  );
}
