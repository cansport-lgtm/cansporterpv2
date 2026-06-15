import { useEffect, useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Edit, Trash2, Database } from "lucide-react";
import { toast } from "sonner";

export default function MarketingMastersPage() {
  const [tab, setTab] = useState("channels");
  const [channels, setChannels] = useState<any[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [stages, setStages] = useState<any[]>([]);

  // Dialog state (generic)
  const [open, setOpen] = useState<{ kind:string; edit:any|null }|null>(null);
  const [form, setForm] = useState<any>({});

  useEffect(()=>{ load(); },[]);
  const load = async () => {
    const [c, t, tpl, ts] = await Promise.all([
      supabase.from("marketing_channels").select("*").order("name"),
      supabase.from("marketing_deliverable_types").select("*").order("name"),
      supabase.from("marketing_milestone_templates").select("*").order("name"),
      supabase.from("marketing_milestone_template_stages").select("*").order("sort_order"),
    ]);
    setChannels(c.data||[]); setTypes(t.data||[]); setTemplates(tpl.data||[]); setStages(ts.data||[]);
  };

  const openDlg = (kind:string, edit:any|null) => {
    if (kind==="channel") setForm(edit||{ name:"", is_active:true });
    if (kind==="type") setForm(edit||{ name:"", default_template_id:"none", is_active:true });
    if (kind==="template") setForm(edit||{ name:"", description:"", is_active:true });
    setOpen({ kind, edit });
  };

  const save = async () => {
    if (!open) return;
    const tableMap:any = { channel:"marketing_channels", type:"marketing_deliverable_types", template:"marketing_milestone_templates" };
    const table = tableMap[open.kind];
    const payload = {...form};
    if (open.kind==="type") payload.default_template_id = payload.default_template_id==="none"?null:payload.default_template_id;
    if (open.edit) { const { error } = await supabase.from(table).update(payload).eq("id",open.edit.id); if (error){toast.error(error.message);return;} }
    else { const { error } = await supabase.from(table).insert(payload); if (error){toast.error(error.message);return;} }
    toast.success("Saved"); setOpen(null); load();
  };

  const remove = async (kind:string, id:string) => {
    const tableMap:any = { channel:"marketing_channels", type:"marketing_deliverable_types", template:"marketing_milestone_templates" };
    const { error } = await supabase.from(tableMap[kind]).delete().eq("id",id);
    if (error) toast.error(error.message); else { toast.success("Deleted"); load(); }
  };

  return (
    <ERPLayout>
      <PageHeader title="Marketing Masters" description="Channels, deliverable types and milestone templates" icon={Database} iconColor="bg-slate-500 text-white"/>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="channels">Channels</TabsTrigger>
          <TabsTrigger value="types">Deliverable Types</TabsTrigger>
          <TabsTrigger value="templates">Milestone Templates</TabsTrigger>
        </TabsList>

        <TabsContent value="channels">
          <Card><CardContent className="p-4">
            <div className="flex justify-end mb-3"><Button size="sm" onClick={()=>openDlg("channel",null)}><Plus className="h-4 w-4 mr-1"/>New Channel</Button></div>
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-muted-foreground"><th className="p-2">Name</th><th className="p-2">Active</th><th className="p-2">Actions</th></tr></thead>
              <tbody>{channels.map(c => (
                <tr key={c.id} className="border-b"><td className="p-2 font-medium">{c.name}</td><td className="p-2">{c.is_active?"Yes":"No"}</td>
                  <td className="p-2"><div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={()=>openDlg("channel",c)}><Edit className="h-4 w-4"/></Button>
                    <Button size="icon" variant="ghost" onClick={()=>remove("channel",c.id)}><Trash2 className="h-4 w-4 text-destructive"/></Button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="types">
          <Card><CardContent className="p-4">
            <div className="flex justify-end mb-3"><Button size="sm" onClick={()=>openDlg("type",null)}><Plus className="h-4 w-4 mr-1"/>New Type</Button></div>
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-muted-foreground"><th className="p-2">Name</th><th className="p-2">Default Template</th><th className="p-2">Active</th><th className="p-2">Actions</th></tr></thead>
              <tbody>{types.map(t => (
                <tr key={t.id} className="border-b"><td className="p-2 font-medium">{t.name}</td>
                  <td className="p-2 text-xs">{templates.find(x=>x.id===t.default_template_id)?.name || "-"}</td>
                  <td className="p-2">{t.is_active?"Yes":"No"}</td>
                  <td className="p-2"><div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={()=>openDlg("type",t)}><Edit className="h-4 w-4"/></Button>
                    <Button size="icon" variant="ghost" onClick={()=>remove("type",t.id)}><Trash2 className="h-4 w-4 text-destructive"/></Button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="templates">
          <Card><CardContent className="p-4">
            <div className="flex justify-end mb-3"><Button size="sm" onClick={()=>openDlg("template",null)}><Plus className="h-4 w-4 mr-1"/>New Template</Button></div>
            <div className="space-y-3">
              {templates.map(tpl => (
                <div key={tpl.id} className="border rounded p-3">
                  <div className="flex items-center justify-between">
                    <div><p className="font-semibold">{tpl.name}</p><p className="text-xs text-muted-foreground">{tpl.description}</p></div>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={()=>openDlg("template",tpl)}><Edit className="h-4 w-4"/></Button>
                      <Button size="icon" variant="ghost" onClick={()=>remove("template",tpl.id)}><Trash2 className="h-4 w-4 text-destructive"/></Button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {stages.filter(s=>s.template_id===tpl.id).map(s => (
                      <span key={s.id} className="px-2 py-1 bg-muted rounded text-xs">{s.sort_order}. {s.stage_name} (+{s.default_offset_days}d)</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!open} onOpenChange={()=>setOpen(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{open?.edit?"Edit":"New"} {open?.kind}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name *</Label><Input value={form.name||""} onChange={e=>setForm({...form,name:e.target.value})}/></div>
            {open?.kind==="template" && <div><Label>Description</Label><Input value={form.description||""} onChange={e=>setForm({...form,description:e.target.value})}/></div>}
            {open?.kind==="type" && (
              <div><Label>Default Template</Label>
                <Select value={form.default_template_id||"none"} onValueChange={v=>setForm({...form,default_template_id:v})}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent><SelectItem value="none">— None —</SelectItem>{templates.map(t=><SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="flex items-center gap-2"><Switch checked={form.is_active!==false} onCheckedChange={v=>setForm({...form,is_active:v})}/><Label>Active</Label></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={()=>setOpen(null)}>Cancel</Button><Button onClick={save}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
