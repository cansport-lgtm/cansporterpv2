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
import { Plus, ListTodo, Trash2, CheckCircle2, Circle, Calendar } from "lucide-react";
import { format, parseISO, isBefore } from "date-fns";
import { toast } from "sonner";
import { DELIVERABLE_STATUSES, PRIORITIES, PRIORITY_COLORS, STATUS_COLORS } from "./constants";

interface Deliverable {
  id: string; deliverable_number: string; title: string; description: string|null;
  deliverable_type_id: string|null; channel_id: string|null; campaign_id: string|null;
  event_id: string|null; owner_user_id: string|null; approver_user_id: string|null;
  priority: string; planned_start: string|null; planned_end: string|null;
  actual_start: string|null; actual_end: string|null; publish_date: string|null;
  status: string; remarks: string|null;
}
interface Milestone { id: string; deliverable_id: string; stage_name: string; sort_order: number; planned_date: string|null; actual_date: string|null; }

export default function MarketingDeliverablesKanbanPage() {
  const [items, setItems] = useState<Deliverable[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [channels, setChannels] = useState<{id:string;name:string}[]>([]);
  const [types, setTypes] = useState<{id:string;name:string;default_template_id:string|null}[]>([]);
  const [campaigns, setCampaigns] = useState<{id:string;name:string;campaign_number:string}[]>([]);
  const [users, setUsers] = useState<{id:string;full_name:string}[]>([]);
  const [templates, setTemplates] = useState<{id:string;stages:any[]}[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Deliverable|null>(null);
  const [deleteId, setDeleteId] = useState<string|null>(null);
  const [detailOpen, setDetailOpen] = useState<Deliverable|null>(null);
  const [draggedId, setDraggedId] = useState<string|null>(null);
  const [search, setSearch] = useState("");

  const [form, setForm] = useState({
    title:"", description:"", deliverable_type_id:"none", channel_id:"none", campaign_id:"none",
    owner_user_id:"none", approver_user_id:"none", priority:"medium",
    planned_start:"", planned_end:"", publish_date:"", status:"Draft", remarks:""
  });

  useEffect(()=>{ load(); }, []);

  const load = async () => {
    const [d, m, c, t, cp, u, tpl, tplStages] = await Promise.all([
      supabase.from("marketing_deliverables").select("*").order("created_at",{ascending:false}),
      supabase.from("marketing_milestones").select("*").order("sort_order"),
      supabase.from("marketing_channels").select("id,name").eq("is_active",true).order("name"),
      supabase.from("marketing_deliverable_types").select("id,name,default_template_id").eq("is_active",true).order("name"),
      supabase.from("marketing_campaigns").select("id,name,campaign_number").order("created_at",{ascending:false}),
      supabase.from("app_users").select("id,full_name").eq("is_active",true),
      supabase.from("marketing_milestone_templates").select("id"),
      supabase.from("marketing_milestone_template_stages").select("*").order("sort_order"),
    ]);
    setItems(d.data||[]); setMilestones(m.data||[]);
    setChannels(c.data||[]); setTypes(t.data||[]); setCampaigns(cp.data||[]); setUsers(u.data||[]);
    const tplMap = (tpl.data||[]).map(x => ({ id: x.id, stages: (tplStages.data||[]).filter(s => s.template_id === x.id) }));
    setTemplates(tplMap);
  };

  const reset = () => setForm({ title:"", description:"", deliverable_type_id:"none", channel_id:"none", campaign_id:"none", owner_user_id:"none", approver_user_id:"none", priority:"medium", planned_start:"", planned_end:"", publish_date:"", status:"Draft", remarks:"" });
  const openNew = () => { setEditing(null); reset(); setOpen(true); };
  const openEdit = (d: Deliverable) => {
    setEditing(d);
    setForm({
      title: d.title, description: d.description||"",
      deliverable_type_id: d.deliverable_type_id||"none", channel_id: d.channel_id||"none",
      campaign_id: d.campaign_id||"none", owner_user_id: d.owner_user_id||"none",
      approver_user_id: d.approver_user_id||"none", priority: d.priority,
      planned_start: d.planned_start||"", planned_end: d.planned_end||"",
      publish_date: d.publish_date||"", status: d.status, remarks: d.remarks||""
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.title.trim()) { toast.error("Title required"); return; }
    const payload: any = {
      title: form.title, description: form.description||null,
      deliverable_type_id: form.deliverable_type_id==="none"?null:form.deliverable_type_id,
      channel_id: form.channel_id==="none"?null:form.channel_id,
      campaign_id: form.campaign_id==="none"?null:form.campaign_id,
      owner_user_id: form.owner_user_id==="none"?null:form.owner_user_id,
      approver_user_id: form.approver_user_id==="none"?null:form.approver_user_id,
      priority: form.priority,
      planned_start: form.planned_start||null, planned_end: form.planned_end||null,
      publish_date: form.publish_date||null, status: form.status,
      remarks: form.remarks||null,
    };
    if (editing) {
      const { error } = await supabase.from("marketing_deliverables").update(payload).eq("id", editing.id);
      if (error) { toast.error(error.message); return; }
      toast.success("Updated");
    } else {
      payload.deliverable_number = "";
      const { data, error } = await supabase.from("marketing_deliverables").insert(payload).select().single();
      if (error) { toast.error(error.message); return; }
      // Auto-create milestones from template
      const typ = types.find(t=>t.id===payload.deliverable_type_id);
      if (typ?.default_template_id && data) {
        const tpl = templates.find(t=>t.id===typ.default_template_id);
        if (tpl?.stages.length) {
          const base = payload.planned_start ? new Date(payload.planned_start) : new Date();
          const rows = tpl.stages.map((s:any) => {
            const dt = new Date(base); dt.setDate(dt.getDate() + (s.default_offset_days||0));
            return {
              deliverable_id: data.id, stage_name: s.stage_name, sort_order: s.sort_order,
              planned_date: dt.toISOString().split("T")[0]
            };
          });
          await supabase.from("marketing_milestones").insert(rows);
        }
      }
      toast.success("Created");
    }
    setOpen(false); load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("marketing_deliverables").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Deleted"); load(); }
    setDeleteId(null);
  };

  const moveStatus = async (id: string, status: string) => {
    const patch: any = { status };
    if (status === "In Progress") patch.actual_start = new Date().toISOString().split("T")[0];
    if (status === "Published") patch.actual_end = new Date().toISOString().split("T")[0];
    const { error } = await supabase.from("marketing_deliverables").update(patch).eq("id", id);
    if (error) toast.error(error.message); else { toast.success(`Moved to ${status}`); load(); }
  };

  const toggleMilestone = async (m: Milestone) => {
    const patch = { actual_date: m.actual_date ? null : new Date().toISOString().split("T")[0] };
    await supabase.from("marketing_milestones").update(patch).eq("id", m.id);
    load();
  };

  const visible = items.filter(d => !search || d.title.toLowerCase().includes(search.toLowerCase()) || d.deliverable_number.toLowerCase().includes(search.toLowerCase()));

  return (
    <ERPLayout>
      <PageHeader title="Deliverables Kanban" description="Drag cards across stages" icon={ListTodo} iconColor="bg-blue-500 text-white">
        <Input placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)} className="w-48"/>
        <Button onClick={openNew} size="sm"><Plus className="h-4 w-4 mr-1"/> New Deliverable</Button>
      </PageHeader>

      <div className="flex gap-3 overflow-x-auto pb-4">
        {DELIVERABLE_STATUSES.map(status => {
          const col = visible.filter(d => d.status === status);
          return (
            <div key={status}
              className="flex-shrink-0 w-72 bg-muted/30 rounded-lg p-2"
              onDragOver={e=>e.preventDefault()}
              onDrop={()=>{ if (draggedId) { moveStatus(draggedId, status); setDraggedId(null); }}}
            >
              <div className="flex items-center justify-between px-2 py-1 mb-2">
                <Badge variant="outline" className={STATUS_COLORS[status]}>{status}</Badge>
                <span className="text-xs text-muted-foreground">{col.length}</span>
              </div>
              <div className="space-y-2 min-h-[200px]">
                {col.map(d => {
                  const overdue = d.planned_end && isBefore(parseISO(d.planned_end), new Date()) && !["Published","Closed","Rejected"].includes(d.status);
                  const ch = channels.find(c=>c.id===d.channel_id);
                  return (
                    <Card key={d.id}
                      draggable onDragStart={()=>setDraggedId(d.id)}
                      onClick={()=>setDetailOpen(d)}
                      className={`cursor-move hover:shadow-md transition-shadow ${overdue ? "border-red-300" : ""}`}>
                      <CardContent className="p-3 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium text-sm leading-snug">{d.title}</p>
                          <Badge variant="outline" className={`text-[10px] ${PRIORITY_COLORS[d.priority]}`}>{d.priority}</Badge>
                        </div>
                        <p className="text-[11px] font-mono text-muted-foreground">{d.deliverable_number}</p>
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          {ch && <span>{ch.name}</span>}
                          {d.planned_end && (
                            <span className={`flex items-center gap-1 ${overdue?"text-red-600 font-semibold":""}`}>
                              <Calendar className="h-3 w-3"/>{format(parseISO(d.planned_end),"dd MMM")}
                            </span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?"Edit Deliverable":"New Deliverable"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Title *</Label><Input value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></div>
            <div><Label>Description</Label><Textarea rows={2} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Type</Label>
                <Select value={form.deliverable_type_id} onValueChange={v=>setForm({...form,deliverable_type_id:v})}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent><SelectItem value="none">— None —</SelectItem>{types.map(t=><SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Channel</Label>
                <Select value={form.channel_id} onValueChange={v=>setForm({...form,channel_id:v})}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent><SelectItem value="none">— None —</SelectItem>{channels.map(c=><SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Campaign</Label>
                <Select value={form.campaign_id} onValueChange={v=>setForm({...form,campaign_id:v})}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent><SelectItem value="none">— None —</SelectItem>{campaigns.map(c=><SelectItem key={c.id} value={c.id}>{c.campaign_number} • {c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Priority</Label>
                <Select value={form.priority} onValueChange={v=>setForm({...form,priority:v})}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{PRIORITIES.map(p=><SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Owner</Label>
                <Select value={form.owner_user_id} onValueChange={v=>setForm({...form,owner_user_id:v})}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent><SelectItem value="none">— None —</SelectItem>{users.map(u=><SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Approver</Label>
                <Select value={form.approver_user_id} onValueChange={v=>setForm({...form,approver_user_id:v})}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent><SelectItem value="none">— None —</SelectItem>{users.map(u=><SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Planned Start</Label><Input type="date" value={form.planned_start} onChange={e=>setForm({...form,planned_start:e.target.value})}/></div>
              <div><Label>Planned End</Label><Input type="date" value={form.planned_end} onChange={e=>setForm({...form,planned_end:e.target.value})}/></div>
              <div><Label>Publish Date</Label><Input type="date" value={form.publish_date} onChange={e=>setForm({...form,publish_date:e.target.value})}/></div>
              <div><Label>Status</Label>
                <Select value={form.status} onValueChange={v=>setForm({...form,status:v})}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{DELIVERABLE_STATUSES.map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Remarks</Label><Textarea rows={2} value={form.remarks} onChange={e=>setForm({...form,remarks:e.target.value})}/></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={()=>setOpen(false)}>Cancel</Button>
            <Button onClick={save}>{editing?"Update":"Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog with milestones */}
      <Dialog open={!!detailOpen} onOpenChange={()=>setDetailOpen(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          {detailOpen && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{detailOpen.deliverable_number}</span>
                  {detailOpen.title}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className={STATUS_COLORS[detailOpen.status]}>{detailOpen.status}</Badge>
                  <Badge variant="outline" className={PRIORITY_COLORS[detailOpen.priority]}>{detailOpen.priority}</Badge>
                  {channels.find(c=>c.id===detailOpen.channel_id) && <Badge variant="secondary">{channels.find(c=>c.id===detailOpen.channel_id)?.name}</Badge>}
                </div>
                {detailOpen.description && <p className="text-muted-foreground">{detailOpen.description}</p>}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-muted-foreground">Owner:</span> {users.find(u=>u.id===detailOpen.owner_user_id)?.full_name || "-"}</div>
                  <div><span className="text-muted-foreground">Approver:</span> {users.find(u=>u.id===detailOpen.approver_user_id)?.full_name || "-"}</div>
                  <div><span className="text-muted-foreground">Planned:</span> {detailOpen.planned_start?format(parseISO(detailOpen.planned_start),"dd MMM"):"-"} → {detailOpen.planned_end?format(parseISO(detailOpen.planned_end),"dd MMM"):"-"}</div>
                  <div><span className="text-muted-foreground">Publish:</span> {detailOpen.publish_date?format(parseISO(detailOpen.publish_date),"dd MMM yy"):"-"}</div>
                </div>

                <div className="border-t pt-3">
                  <p className="font-semibold mb-2">Milestones</p>
                  <div className="space-y-1">
                    {milestones.filter(m=>m.deliverable_id===detailOpen.id).length === 0 ?
                      <p className="text-xs text-muted-foreground">No milestones</p> :
                      milestones.filter(m=>m.deliverable_id===detailOpen.id).map(m => {
                        const overdue = m.planned_date && !m.actual_date && isBefore(parseISO(m.planned_date), new Date());
                        return (
                          <div key={m.id} className="flex items-center justify-between border-b py-1.5 text-xs">
                            <button onClick={()=>toggleMilestone(m)} className="flex items-center gap-2 flex-1">
                              {m.actual_date ? <CheckCircle2 className="h-4 w-4 text-emerald-600"/> : <Circle className="h-4 w-4 text-muted-foreground"/>}
                              <span className={m.actual_date?"line-through text-muted-foreground":""}>{m.stage_name}</span>
                            </button>
                            <span className={overdue?"text-red-600 font-semibold":"text-muted-foreground"}>
                              {m.actual_date ? `✓ ${format(parseISO(m.actual_date),"dd MMM")}` : m.planned_date ? format(parseISO(m.planned_date),"dd MMM") : "-"}
                            </span>
                          </div>
                        );
                      })
                    }
                  </div>
                </div>

                {detailOpen.remarks && <div className="border-t pt-3"><p className="text-xs text-muted-foreground">{detailOpen.remarks}</p></div>}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={()=>{ setDeleteId(detailOpen.id); setDetailOpen(null); }}><Trash2 className="h-4 w-4 mr-1 text-destructive"/> Delete</Button>
                <Button variant="outline" onClick={()=>setDetailOpen(null)}>Close</Button>
                <Button onClick={()=>{ openEdit(detailOpen); setDetailOpen(null); }}>Edit</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={()=>setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete deliverable?</AlertDialogTitle><AlertDialogDescription>This will also delete all its milestones.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={()=>deleteId && remove(deleteId)}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ERPLayout>
  );
}
