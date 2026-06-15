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
import { Plus, Edit, Trash2, ClipboardList, ChevronDown, ChevronRight, CheckCircle2 } from "lucide-react";
import { format, isBefore, parseISO } from "date-fns";
import { toast } from "sonner";
import { DELIVERABLE_STATUSES, STATUS_COLORS } from "./constants";

interface Meeting { id:string; meeting_number:string; meeting_date:string; title:string; agenda:string|null; attendees:string|null; minutes:string|null; }
interface Action { id:string; meeting_id:string; action_text:string; owner_user_id:string|null; due_date:string|null; status:string; completed_at:string|null; }

export default function MarketingMeetingsPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [users, setUsers] = useState<{id:string;full_name:string}[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [mOpen, setMOpen] = useState(false);
  const [mEdit, setMEdit] = useState<Meeting|null>(null);
  const [mDelete, setMDelete] = useState<string|null>(null);
  const [mForm, setMForm] = useState({ meeting_date: new Date().toISOString().split("T")[0], title:"", agenda:"", attendees:"", minutes:"" });

  const [aOpen, setAOpen] = useState(false);
  const [aMeeting, setAMeeting] = useState<string|null>(null);
  const [aEdit, setAEdit] = useState<Action|null>(null);
  const [aForm, setAForm] = useState({ action_text:"", owner_user_id:"none", due_date:"", status:"Draft" });

  useEffect(()=>{ load(); },[]);
  const load = async () => {
    const [m, a, u] = await Promise.all([
      supabase.from("marketing_meetings").select("*").order("meeting_date",{ascending:false}),
      supabase.from("marketing_meeting_actions").select("*").order("due_date",{ascending:true,nullsFirst:false}),
      supabase.from("app_users").select("id,full_name").eq("is_active",true),
    ]);
    setMeetings(m.data||[]); setActions(a.data||[]); setUsers(u.data||[]);
  };

  const toggle = (id:string) => { const n=new Set(expanded); n.has(id)?n.delete(id):n.add(id); setExpanded(n); };

  const openMNew = () => { setMEdit(null); setMForm({ meeting_date: new Date().toISOString().split("T")[0], title:"", agenda:"", attendees:"", minutes:"" }); setMOpen(true); };
  const openMEdit = (m:Meeting) => { setMEdit(m); setMForm({ meeting_date:m.meeting_date, title:m.title, agenda:m.agenda||"", attendees:m.attendees||"", minutes:m.minutes||"" }); setMOpen(true); };

  const saveM = async () => {
    if (!mForm.title.trim()) { toast.error("Title required"); return; }
    const p:any = { ...mForm };
    if (mEdit) { const { error } = await supabase.from("marketing_meetings").update(p).eq("id",mEdit.id); if (error){toast.error(error.message);return;} toast.success("Updated"); }
    else { p.meeting_number=""; const { error } = await supabase.from("marketing_meetings").insert(p); if (error){toast.error(error.message);return;} toast.success("Created"); }
    setMOpen(false); load();
  };
  const removeM = async (id:string) => { await supabase.from("marketing_meetings").delete().eq("id",id); toast.success("Deleted"); setMDelete(null); load(); };

  const openANew = (meetingId:string) => { setAEdit(null); setAMeeting(meetingId); setAForm({ action_text:"", owner_user_id:"none", due_date:"", status:"Draft" }); setAOpen(true); };
  const openAEdit = (a:Action) => { setAEdit(a); setAMeeting(a.meeting_id); setAForm({ action_text:a.action_text, owner_user_id:a.owner_user_id||"none", due_date:a.due_date||"", status:a.status }); setAOpen(true); };

  const saveA = async () => {
    if (!aForm.action_text.trim() || !aMeeting) { toast.error("Action text required"); return; }
    const p:any = {
      meeting_id: aMeeting, action_text: aForm.action_text,
      owner_user_id: aForm.owner_user_id==="none"?null:aForm.owner_user_id,
      due_date: aForm.due_date||null, status: aForm.status,
      completed_at: aForm.status==="Closed" || aForm.status==="Published" ? new Date().toISOString() : null,
    };
    if (aEdit) { await supabase.from("marketing_meeting_actions").update(p).eq("id",aEdit.id); toast.success("Updated"); }
    else { await supabase.from("marketing_meeting_actions").insert(p); toast.success("Created"); }
    setAOpen(false); load();
  };
  const removeA = async (id:string) => { await supabase.from("marketing_meeting_actions").delete().eq("id",id); load(); };
  const toggleADone = async (a:Action) => {
    const newStatus = a.status === "Closed" ? "In Progress" : "Closed";
    await supabase.from("marketing_meeting_actions").update({ status: newStatus, completed_at: newStatus==="Closed"?new Date().toISOString():null }).eq("id",a.id);
    load();
  };

  return (
    <ERPLayout>
      <PageHeader title="Meetings & Action Items" description="Capture meeting agendas, minutes and time-bound actions" icon={ClipboardList} iconColor="bg-amber-500 text-white">
        <Button onClick={openMNew} size="sm"><Plus className="h-4 w-4 mr-1"/> New Meeting</Button>
      </PageHeader>

      <Card><CardContent className="p-4">
        {meetings.length===0 ? <p className="p-6 text-center text-muted-foreground text-sm">No meetings yet</p> :
          <div className="space-y-2">
            {meetings.map(m => {
              const acts = actions.filter(a => a.meeting_id === m.id);
              const open = expanded.has(m.id);
              const pending = acts.filter(a => a.status !== "Closed").length;
              return (
                <div key={m.id} className="border rounded-md">
                  <div className="flex items-center gap-2 p-3 bg-muted/30">
                    <button onClick={()=>toggle(m.id)} className="p-1">{open?<ChevronDown className="h-4 w-4"/>:<ChevronRight className="h-4 w-4"/>}</button>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{m.meeting_number}</span>
                        <span className="font-medium">{m.title}</span>
                        <span className="text-xs text-muted-foreground">{format(parseISO(m.meeting_date),"dd MMM yy")}</span>
                        {pending>0 && <Badge variant="outline" className="bg-amber-100 text-amber-800 text-[10px]">{pending} pending</Badge>}
                      </div>
                      {m.attendees && <p className="text-xs text-muted-foreground mt-0.5">{m.attendees}</p>}
                    </div>
                    <Button size="sm" variant="ghost" onClick={()=>openANew(m.id)}><Plus className="h-3 w-3 mr-1"/>Action</Button>
                    <Button size="icon" variant="ghost" onClick={()=>openMEdit(m)}><Edit className="h-4 w-4"/></Button>
                    <Button size="icon" variant="ghost" onClick={()=>setMDelete(m.id)}><Trash2 className="h-4 w-4 text-destructive"/></Button>
                  </div>
                  {open && (
                    <div className="p-3 space-y-3 text-sm">
                      {m.agenda && <div><p className="font-semibold text-xs mb-1">Agenda</p><p className="text-muted-foreground whitespace-pre-wrap text-xs">{m.agenda}</p></div>}
                      {m.minutes && <div><p className="font-semibold text-xs mb-1">Minutes</p><p className="text-muted-foreground whitespace-pre-wrap text-xs">{m.minutes}</p></div>}
                      <div>
                        <p className="font-semibold text-xs mb-2">Action Items ({acts.length})</p>
                        {acts.length===0 ? <p className="text-xs text-muted-foreground">No actions logged</p> :
                          <table className="w-full text-xs">
                            <thead><tr className="border-b text-left text-muted-foreground"><th className="p-1"></th><th className="p-1">Action</th><th className="p-1">Owner</th><th className="p-1">Due</th><th className="p-1">Status</th><th className="p-1"></th></tr></thead>
                            <tbody>
                              {acts.map(a => {
                                const overdue = a.due_date && a.status !== "Closed" && isBefore(parseISO(a.due_date), new Date());
                                return (
                                  <tr key={a.id} className="border-b">
                                    <td className="p-1"><button onClick={()=>toggleADone(a)}><CheckCircle2 className={`h-4 w-4 ${a.status==="Closed"?"text-emerald-600":"text-muted-foreground"}`}/></button></td>
                                    <td className={`p-1 ${a.status==="Closed"?"line-through text-muted-foreground":""}`}>{a.action_text}</td>
                                    <td className="p-1">{users.find(u=>u.id===a.owner_user_id)?.full_name||"-"}</td>
                                    <td className={`p-1 ${overdue?"text-red-600 font-semibold":""}`}>{a.due_date?format(parseISO(a.due_date),"dd MMM"):"-"}</td>
                                    <td className="p-1"><Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[a.status]}`}>{a.status}</Badge></td>
                                    <td className="p-1"><div className="flex gap-1">
                                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={()=>openAEdit(a)}><Edit className="h-3 w-3"/></Button>
                                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={()=>removeA(a.id)}><Trash2 className="h-3 w-3 text-destructive"/></Button>
                                    </div></td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        }
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        }
      </CardContent></Card>

      {/* Meeting Dialog */}
      <Dialog open={mOpen} onOpenChange={setMOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{mEdit?"Edit Meeting":"New Meeting"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Date</Label><Input type="date" value={mForm.meeting_date} onChange={e=>setMForm({...mForm,meeting_date:e.target.value})}/></div>
              <div className="col-span-2"><Label>Title *</Label><Input value={mForm.title} onChange={e=>setMForm({...mForm,title:e.target.value})}/></div>
            </div>
            <div><Label>Attendees</Label><Input placeholder="Comma separated names" value={mForm.attendees} onChange={e=>setMForm({...mForm,attendees:e.target.value})}/></div>
            <div><Label>Agenda</Label><Textarea rows={3} value={mForm.agenda} onChange={e=>setMForm({...mForm,agenda:e.target.value})}/></div>
            <div><Label>Minutes</Label><Textarea rows={3} value={mForm.minutes} onChange={e=>setMForm({...mForm,minutes:e.target.value})}/></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={()=>setMOpen(false)}>Cancel</Button><Button onClick={saveM}>{mEdit?"Update":"Create"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Action Dialog */}
      <Dialog open={aOpen} onOpenChange={setAOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{aEdit?"Edit Action":"New Action"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Action *</Label><Textarea rows={2} value={aForm.action_text} onChange={e=>setAForm({...aForm,action_text:e.target.value})}/></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Owner</Label>
                <Select value={aForm.owner_user_id} onValueChange={v=>setAForm({...aForm,owner_user_id:v})}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent><SelectItem value="none">— None —</SelectItem>{users.map(u=><SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Due Date</Label><Input type="date" value={aForm.due_date} onChange={e=>setAForm({...aForm,due_date:e.target.value})}/></div>
            </div>
            <div><Label>Status</Label>
              <Select value={aForm.status} onValueChange={v=>setAForm({...aForm,status:v})}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>{DELIVERABLE_STATUSES.map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={()=>setAOpen(false)}>Cancel</Button><Button onClick={saveA}>{aEdit?"Update":"Create"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!mDelete} onOpenChange={()=>setMDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete meeting?</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={()=>mDelete && removeM(mDelete)}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ERPLayout>
  );
}
