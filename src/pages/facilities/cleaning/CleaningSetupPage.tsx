import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Loader2, Pencil, Plus, Settings2 } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, facilitiesCan, fcDb } from "@/lib/facilities";
import {
  FREQUENCY_META, WEEKDAYS, frequencyLabel, loadAreas, saveArea, saveCheckpoint, saveTemplate,
  type Area, type AreaFrequency, type Checkpoint, type Template,
} from "@/lib/facilitiesCleaning";

type UserRow = { id: string; full_name: string | null; roles?: { role: string }[] };
const NONE = "__none__";

const emptyArea = { code: "", name: "", location: "", template_id: "", frequency: "daily" as AreaFrequency, due_weekday: "1", due_day: "1", supervisor_id: NONE, is_active: true };
type AreaForm = typeof emptyArea;

export default function CleaningSetupPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { roles } = useAuth();
  const canManage = facilitiesCan(roles, "manage");
  const [tab, setTab] = useState<"areas" | "templates">("areas");

  const [areaDialog, setAreaDialog] = useState(false);
  const [areaId, setAreaId] = useState<string | null>(null);
  const [areaForm, setAreaForm] = useState<AreaForm>(emptyArea);

  const [templateDialog, setTemplateDialog] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [templateForm, setTemplateForm] = useState({ name: "", is_active: true });
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");

  const [cpDialog, setCpDialog] = useState(false);
  const [cpId, setCpId] = useState<string | null>(null);
  const [cpForm, setCpForm] = useState({ text: "", sort_order: "1", is_active: true });

  const { data: areas = [] } = useQuery<Area[]>({ queryKey: ["facilities-areas", "all"], queryFn: () => loadAreas(false) });
  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ["facilities-cleaning-templates"],
    queryFn: async () => {
      const { data, error } = await fcDb.from("facilities_cleaning_templates").select("id, name, is_active").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const currentTemplate = selectedTemplate || templates[0]?.id || "";
  const { data: checkpoints = [] } = useQuery<Checkpoint[]>({
    queryKey: ["facilities-cleaning-checkpoints", currentTemplate],
    enabled: Boolean(currentTemplate),
    queryFn: async () => {
      const { data, error } = await fcDb.from("facilities_cleaning_checkpoints").select("*").eq("template_id", currentTemplate).order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: users = [] } = useQuery<UserRow[]>({
    queryKey: ["facilities-users-with-roles"],
    queryFn: async () => {
      const { data, error } = await fcDb.from("app_users").select("id, full_name, roles:user_roles(role)").eq("is_active", true).order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const supervisors = users.filter((u) => (u.roles ?? []).some((r) => r.role === "cleaning_supervisor"));
  const otherUsers = users.filter((u) => !supervisors.includes(u));

  const invalidate = (keys: string[]) => keys.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
  const fail = (title: string) => (e: unknown) => toast({ title, description: errorMessage(e), variant: "destructive" });

  const areaSave = useMutation({
    mutationFn: () => saveArea(areaId, {
      ...areaForm,
      supervisor_id: areaForm.supervisor_id === NONE ? null : areaForm.supervisor_id,
      due_weekday: areaForm.frequency === "weekly" ? Number(areaForm.due_weekday) : null,
      due_day: areaForm.frequency === "monthly" ? Number(areaForm.due_day) : null,
    }),
    onSuccess: () => { invalidate(["facilities-areas"]); setAreaDialog(false); toast({ title: "Area saved" }); },
    onError: fail("Could not save the area"),
  });
  const templateSave = useMutation({
    mutationFn: () => saveTemplate(templateId, templateForm),
    onSuccess: (id) => { invalidate(["facilities-cleaning-templates"]); setTemplateDialog(false); setSelectedTemplate(id); toast({ title: "Template saved" }); },
    onError: fail("Could not save the template"),
  });
  const cpSave = useMutation({
    mutationFn: () => saveCheckpoint(cpId, { template_id: currentTemplate, text: cpForm.text, sort_order: Number(cpForm.sort_order), is_active: cpForm.is_active }),
    onSuccess: () => { invalidate(["facilities-cleaning-checkpoints"]); setCpDialog(false); toast({ title: "Checkpoint saved" }); },
    onError: fail("Could not save the checkpoint"),
  });

  const openArea = (a?: Area) => {
    setAreaId(a?.id ?? null);
    setAreaForm(a ? {
      code: a.code, name: a.name, location: a.location ?? "", template_id: a.template_id, frequency: a.frequency,
      due_weekday: String(a.due_weekday ?? 1), due_day: String(a.due_day ?? 1), supervisor_id: a.supervisor_id ?? NONE, is_active: a.is_active,
    } : { ...emptyArea, template_id: templates[0]?.id ?? "" });
    setAreaDialog(true);
  };
  const openTemplate = (t?: Template) => { setTemplateId(t?.id ?? null); setTemplateForm({ name: t?.name ?? "", is_active: t?.is_active ?? true }); setTemplateDialog(true); };
  const openCp = (c?: Checkpoint) => {
    setCpId(c?.id ?? null);
    setCpForm({ text: c?.text ?? "", sort_order: String(c?.sort_order ?? (checkpoints.length + 1)), is_active: c?.is_active ?? true });
    setCpDialog(true);
  };

  if (!canManage) {
    return <ERPLayout><div className="p-8 text-center text-muted-foreground">Only a facilities manager can set up areas and checklists.</div></ERPLayout>;
  }

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title="Areas & Checklists" description="Which areas are inspected, how often, by which checklist, and who fixes what fails" icon={Settings2}>
          <Button variant="outline" asChild><Link to="/facilities/cleaning">Inspections</Link></Button>
        </PageHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "areas" | "templates")}>
          <TabsList>
            <TabsTrigger value="areas">Areas</TabsTrigger>
            <TabsTrigger value="templates">Checklist templates</TabsTrigger>
          </TabsList>
        </Tabs>

        {tab === "areas" ? (
          <Card>
            <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Areas</CardTitle>
              <Button size="sm" onClick={() => openArea()} disabled={templates.length === 0}><Plus className="h-4 w-4 mr-1" /> Area</Button>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead><TableHead>Area</TableHead><TableHead>Checklist</TableHead>
                    <TableHead>Frequency</TableHead><TableHead>Supervisor</TableHead><TableHead>Active</TableHead><TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {areas.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No areas yet{templates.length === 0 ? " — add a checklist template first" : ""}.</TableCell></TableRow>}
                  {areas.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-mono text-xs">{a.code}</TableCell>
                      <TableCell><div className="font-medium">{a.name}</div><div className="text-xs text-muted-foreground">{a.location}</div></TableCell>
                      <TableCell>{a.template?.name ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{frequencyLabel(a)}</TableCell>
                      <TableCell>{a.supervisor?.full_name ?? <span className="text-amber-700">not set</span>}</TableCell>
                      <TableCell><Badge variant={a.is_active ? "success" : "secondary"}>{a.is_active ? "Yes" : "No"}</Badge></TableCell>
                      <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => openArea(a)}><Pencil className="h-4 w-4" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
            <Card>
              <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Templates</CardTitle>
                <Button size="sm" variant="outline" onClick={() => openTemplate()}><Plus className="h-4 w-4" /></Button>
              </CardHeader>
              <CardContent className="p-2">
                {templates.map((t) => (
                  <div key={t.id} className={`flex items-center justify-between rounded px-2 py-1.5 cursor-pointer ${t.id === currentTemplate ? "bg-muted" : "hover:bg-muted/60"}`} onClick={() => setSelectedTemplate(t.id)}>
                    <span className={t.is_active ? "" : "text-muted-foreground line-through"}>{t.name}</span>
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openTemplate(t); }}><Pencil className="h-3.5 w-3.5" /></Button>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Checkpoints · {templates.find((t) => t.id === currentTemplate)?.name ?? "—"}</CardTitle>
                <Button size="sm" onClick={() => openCp()} disabled={!currentTemplate}><Plus className="h-4 w-4 mr-1" /> Checkpoint</Button>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead className="w-12">#</TableHead><TableHead>Point</TableHead><TableHead>Active</TableHead><TableHead></TableHead></TableRow></TableHeader>
                  <TableBody>
                    {checkpoints.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No checkpoints yet.</TableCell></TableRow>}
                    {checkpoints.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="tabular-nums">{c.sort_order}</TableCell>
                        <TableCell>{c.text}</TableCell>
                        <TableCell><Badge variant={c.is_active ? "success" : "secondary"}>{c.is_active ? "Yes" : "No"}</Badge></TableCell>
                        <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => openCp(c)}><Pencil className="h-4 w-4" /></Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}

        <Dialog open={areaDialog} onOpenChange={setAreaDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{areaId ? "Edit area" : "New area"}</DialogTitle></DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label htmlFor="area-code">Code</Label><Input id="area-code" value={areaForm.code} onChange={(e) => setAreaForm({ ...areaForm, code: e.target.value })} placeholder="WR-F-G" /></div>
              <div className="space-y-1"><Label htmlFor="area-name">Name</Label><Input id="area-name" value={areaForm.name} onChange={(e) => setAreaForm({ ...areaForm, name: e.target.value })} placeholder="Washroom F · ground" /></div>
              <div className="space-y-1 sm:col-span-2"><Label htmlFor="area-loc">Location</Label><Input id="area-loc" value={areaForm.location} onChange={(e) => setAreaForm({ ...areaForm, location: e.target.value })} /></div>
              <div className="space-y-1">
                <Label htmlFor="area-template">Checklist</Label>
                <Select value={areaForm.template_id} onValueChange={(v) => setAreaForm({ ...areaForm, template_id: v })}>
                  <SelectTrigger id="area-template"><SelectValue placeholder="Choose" /></SelectTrigger>
                  <SelectContent>{templates.filter((t) => t.is_active || t.id === areaForm.template_id).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="area-freq">Frequency</Label>
                <Select value={areaForm.frequency} onValueChange={(v) => setAreaForm({ ...areaForm, frequency: v as AreaFrequency })}>
                  <SelectTrigger id="area-freq"><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(FREQUENCY_META) as AreaFrequency[]).map((f) => <SelectItem key={f} value={f}>{FREQUENCY_META[f]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {areaForm.frequency === "weekly" && (
                <div className="space-y-1">
                  <Label htmlFor="area-weekday">Weekday</Label>
                  <Select value={areaForm.due_weekday} onValueChange={(v) => setAreaForm({ ...areaForm, due_weekday: v })}>
                    <SelectTrigger id="area-weekday"><SelectValue /></SelectTrigger>
                    <SelectContent>{WEEKDAYS.map((d, i) => <SelectItem key={d} value={String(i)}>{d}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              {areaForm.frequency === "monthly" && (
                <div className="space-y-1"><Label htmlFor="area-day">Day of month</Label><Input id="area-day" type="number" min={1} max={28} value={areaForm.due_day} onChange={(e) => setAreaForm({ ...areaForm, due_day: e.target.value })} /></div>
              )}
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="area-sup">Cleaning supervisor (gets the action items)</Label>
                <Select value={areaForm.supervisor_id} onValueChange={(v) => setAreaForm({ ...areaForm, supervisor_id: v })}>
                  <SelectTrigger id="area-sup"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not set</SelectItem>
                    {supervisors.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name} · supervisor</SelectItem>)}
                    {otherUsers.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 sm:col-span-2">
                <Switch id="area-active" checked={areaForm.is_active} onCheckedChange={(v) => setAreaForm({ ...areaForm, is_active: v })} />
                <Label htmlFor="area-active">Active</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAreaDialog(false)}>Cancel</Button>
              <Button disabled={areaSave.isPending} onClick={() => areaSave.mutate()}>{areaSave.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={templateDialog} onOpenChange={setTemplateDialog}>
          <DialogContent>
            <DialogHeader><DialogTitle>{templateId ? "Edit template" : "New template"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1"><Label htmlFor="tpl-name">Name</Label><Input id="tpl-name" value={templateForm.name} onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })} /></div>
              <div className="flex items-center gap-2"><Switch id="tpl-active" checked={templateForm.is_active} onCheckedChange={(v) => setTemplateForm({ ...templateForm, is_active: v })} /><Label htmlFor="tpl-active">Active</Label></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setTemplateDialog(false)}>Cancel</Button>
              <Button disabled={templateSave.isPending} onClick={() => templateSave.mutate()}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={cpDialog} onOpenChange={setCpDialog}>
          <DialogContent>
            <DialogHeader><DialogTitle>{cpId ? "Edit checkpoint" : "New checkpoint"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1"><Label htmlFor="cp-text">Point</Label><Input id="cp-text" value={cpForm.text} onChange={(e) => setCpForm({ ...cpForm, text: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="cp-order">Order</Label><Input id="cp-order" type="number" value={cpForm.sort_order} onChange={(e) => setCpForm({ ...cpForm, sort_order: e.target.value })} /></div>
              <div className="flex items-center gap-2"><Switch id="cp-active" checked={cpForm.is_active} onCheckedChange={(v) => setCpForm({ ...cpForm, is_active: v })} /><Label htmlFor="cp-active">Active</Label></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCpDialog(false)}>Cancel</Button>
              <Button disabled={cpSave.isPending} onClick={() => cpSave.mutate()}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
