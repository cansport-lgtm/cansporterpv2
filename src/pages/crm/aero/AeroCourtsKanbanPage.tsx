import { useEffect, useMemo, useState, DragEvent, useCallback } from "react";
import { Link } from "react-router-dom";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  Plus, Phone, MessageCircle, MapPin, BarChart3, LayoutGrid, List as ListIcon,
  CalendarPlus, Star, RefreshCw,
} from "lucide-react";
import {
  PIPELINE_STAGES, STAGE_LABEL, STAGE_COLOR,
  INTERACTION_TYPES, AGREEMENT_TYPES,
  PadelCourt, PadelInteraction, PadelDemo, PadelAgreement,
  PipelineStage, InteractionType, AgreementType, phoneDigits, fmtPKR,
} from "./types";

interface CustomerOpt { id: string; name: string; code: string }
interface SalesOrderRow { id: string; order_number: string; customer_id: string; order_date: string; net_amount: number | null; status: string }

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function AeroCourtsKanbanPage() {
  const { user, hasRole } = useAuth();
  const isAdmin = hasRole("super_admin") || hasRole("admin");

  const [courts, setCourts] = useState<PadelCourt[]>([]);
  const [interactions, setInteractions] = useState<PadelInteraction[]>([]);
  const [demos, setDemos] = useState<PadelDemo[]>([]);
  const [agreements, setAgreements] = useState<PadelAgreement[]>([]);
  const [customers, setCustomers] = useState<CustomerOpt[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [search, setSearch] = useState("");
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [stageFilter, setStageFilter] = useState<string>("all");

  const [draggedCourtId, setDraggedCourtId] = useState<string | null>(null);
  const [stageChange, setStageChange] = useState<{ court: PadelCourt; newStage: PipelineStage } | null>(null);

  const [drawerCourt, setDrawerCourt] = useState<PadelCourt | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [demoSchedOpen, setDemoSchedOpen] = useState<PadelCourt | null>(null);
  const [demoCompleteOpen, setDemoCompleteOpen] = useState<PadelDemo | null>(null);
  const [agreementOpen, setAgreementOpen] = useState<PadelCourt | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [c, i, d, a, cu, so] = await Promise.all([
      supabase.from("padel_courts").select("*").order("created_at", { ascending: false }),
      supabase.from("padel_court_interactions").select("*").order("performed_at", { ascending: false }),
      supabase.from("padel_demo_sessions").select("*").order("created_at", { ascending: false }),
      supabase.from("padel_supply_agreements").select("*").order("created_at", { ascending: false }),
      supabase.from("customers").select("id, name, code").eq("is_active", true).order("name"),
      supabase.from("sales_orders").select("id, order_number, customer_id, order_date, net_amount, status").order("order_date", { ascending: false }).limit(500),
    ]);
    setCourts((c.data ?? []) as PadelCourt[]);
    setInteractions((i.data ?? []) as PadelInteraction[]);
    setDemos((d.data ?? []) as PadelDemo[]);
    setAgreements((a.data ?? []) as PadelAgreement[]);
    setCustomers((cu.data ?? []) as CustomerOpt[]);
    setSalesOrders((so.data ?? []) as SalesOrderRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const cities = useMemo(() => {
    const s = new Set<string>();
    courts.forEach(c => c.city && s.add(c.city));
    return Array.from(s).sort();
  }, [courts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return courts.filter(c =>
      (cityFilter === "all" || c.city === cityFilter) &&
      (stageFilter === "all" || c.pipeline_stage === stageFilter) &&
      (!q ||
        c.venue_name.toLowerCase().includes(q) ||
        (c.area ?? "").toLowerCase().includes(q) ||
        (c.manager_name ?? "").toLowerCase().includes(q))
    );
  }, [courts, search, cityFilter, stageFilter]);

  const interactionsByCourt = useMemo(() => {
    const m = new Map<string, PadelInteraction[]>();
    interactions.forEach(it => {
      const arr = m.get(it.court_id) ?? [];
      arr.push(it);
      m.set(it.court_id, arr);
    });
    return m;
  }, [interactions]);

  const demosByCourt = useMemo(() => {
    const m = new Map<string, PadelDemo[]>();
    demos.forEach(it => {
      const arr = m.get(it.court_id) ?? [];
      arr.push(it);
      m.set(it.court_id, arr);
    });
    return m;
  }, [demos]);

  const agreementsByCourt = useMemo(() => {
    const m = new Map<string, PadelAgreement[]>();
    agreements.forEach(it => {
      const arr = m.get(it.court_id) ?? [];
      arr.push(it);
      m.set(it.court_id, arr);
    });
    return m;
  }, [agreements]);

  const stageMonthlyEst = (stage: PipelineStage) =>
    filtered.filter(c => c.pipeline_stage === stage)
      .reduce((s, c) => s + (Number(c.monthly_consumption_estimate) || 0), 0);

  const onDragStart = (e: DragEvent, id: string) => { setDraggedCourtId(id); e.dataTransfer.effectAllowed = "move"; };
  const onDragOver = (e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; };
  const onDrop = (e: DragEvent, newStage: PipelineStage) => {
    e.preventDefault();
    if (!draggedCourtId) return;
    const court = courts.find(c => c.id === draggedCourtId);
    setDraggedCourtId(null);
    if (!court || court.pipeline_stage === newStage) return;
    setStageChange({ court, newStage });
  };

  const commitStageChange = async (note: string, outcome: string, followUp: string, type: InteractionType) => {
    if (!stageChange) return;
    const { court, newStage } = stageChange;
    const { error: e1 } = await supabase
      .from("padel_courts").update({ pipeline_stage: newStage }).eq("id", court.id);
    if (e1) { toast.error(`Stage update failed: ${e1.message}`); return; }
    const { error: e2 } = await supabase.from("padel_court_interactions").insert({
      court_id: court.id,
      type,
      outcome: outcome || null,
      stage_before: court.pipeline_stage,
      stage_after: newStage,
      follow_up_date: followUp || null,
      notes: note || null,
      performed_by: user?.id ?? null,
    });
    if (e2) toast.error(`Interaction log failed: ${e2.message}`);
    toast.success(`Moved to ${STAGE_LABEL[newStage]}`);
    setStageChange(null);
    load();
  };

  return (
    <ERPLayout>
      <PageHeader title="Aero Padel Court Tracker" description="B2B pipeline for Aero ball supply">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/crm/aero-courts/insights"><BarChart3 className="h-4 w-4 mr-1" />Insights</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => load()}>
            <RefreshCw className="h-4 w-4 mr-1" />Refresh
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />Add Court
          </Button>
        </div>
      </PageHeader>

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="p-3 flex flex-wrap gap-2 items-center">
          <Input placeholder="Search venue, area, manager…" value={search} onChange={e => setSearch(e.target.value)} className="w-full sm:w-64" />
          <Select value={cityFilter} onValueChange={setCityFilter}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All cities</SelectItem>
              {cities.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              {PIPELINE_STAGES.map(s => <SelectItem key={s} value={s}>{STAGE_LABEL[s]}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="ml-auto flex gap-1">
            <Button variant={view === "kanban" ? "default" : "outline"} size="sm" onClick={() => setView("kanban")}>
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button variant={view === "list" ? "default" : "outline"} size="sm" onClick={() => setView("list")}>
              <ListIcon className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">Loading…</CardContent></Card>
      ) : view === "kanban" ? (
        <div className="overflow-x-auto -mx-2 px-2 pb-2">
          <div className="flex gap-3 min-w-max">
            {PIPELINE_STAGES.map(stage => {
              const items = filtered.filter(c => c.pipeline_stage === stage);
              return (
                <div
                  key={stage}
                  className={`w-72 flex-shrink-0 rounded-lg border-t-4 ${STAGE_COLOR[stage]} bg-muted/30 min-h-[400px] flex flex-col`}
                  onDragOver={onDragOver}
                  onDrop={e => onDrop(e, stage)}
                >
                  <div className="p-3 border-b">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-sm">{STAGE_LABEL[stage]}</h3>
                      <Badge variant="secondary" className="text-xs">{items.length}</Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Est. {fmtPKR(stageMonthlyEst(stage))}/mo
                    </p>
                  </div>
                  <div className="flex-1 p-2 space-y-2 overflow-y-auto">
                    {items.map(court => (
                      <div
                        key={court.id}
                        draggable
                        onDragStart={e => onDragStart(e, court.id)}
                        onClick={() => setDrawerCourt(court)}
                        className={`p-3 rounded-md bg-background border shadow-sm cursor-grab hover:shadow-md transition ${draggedCourtId === court.id ? "opacity-50" : ""}`}
                      >
                        <p className="text-sm font-medium truncate">{court.venue_name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {[court.city, court.area].filter(Boolean).join(" · ") || "—"}
                        </p>
                        <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>{court.number_of_courts ?? 0} courts</span>
                          <span>~{Number(court.monthly_consumption_estimate ?? 0).toLocaleString()}/mo</span>
                        </div>
                      </div>
                    ))}
                    {items.length === 0 && (
                      <p className="text-[11px] text-muted-foreground text-center py-6">Drop here</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <Card><CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Venue</TableHead><TableHead>City</TableHead>
              <TableHead>Manager</TableHead><TableHead>Stage</TableHead>
              <TableHead className="text-right">Courts</TableHead>
              <TableHead className="text-right">Est./mo</TableHead>
              <TableHead>Last Interaction</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map(c => {
                const last = interactionsByCourt.get(c.id)?.[0];
                return (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => setDrawerCourt(c)}>
                    <TableCell className="font-medium">{c.venue_name}</TableCell>
                    <TableCell>{c.city ?? "—"}</TableCell>
                    <TableCell>{c.manager_name ?? "—"}</TableCell>
                    <TableCell><Badge variant="outline">{STAGE_LABEL[c.pipeline_stage]}</Badge></TableCell>
                    <TableCell className="text-right">{c.number_of_courts ?? 0}</TableCell>
                    <TableCell className="text-right">{Number(c.monthly_consumption_estimate ?? 0).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{last ? `${last.type} · ${new Date(last.performed_at).toLocaleDateString()}` : "—"}</TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No courts match filters</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}

      {/* Stage change note dialog */}
      <StageChangeDialog
        ctx={stageChange}
        onCancel={() => setStageChange(null)}
        onConfirm={commitStageChange}
      />

      {/* Add court */}
      <AddCourtDialog open={addOpen} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); load(); }} userId={user?.id ?? null} />

      {/* Schedule demo */}
      {demoSchedOpen && (
        <ScheduleDemoDialog
          court={demoSchedOpen}
          onClose={() => setDemoSchedOpen(null)}
          onSaved={() => { setDemoSchedOpen(null); load(); }}
          userId={user?.id ?? null}
        />
      )}

      {/* Complete demo */}
      {demoCompleteOpen && (
        <CompleteDemoDialog
          demo={demoCompleteOpen}
          onClose={() => setDemoCompleteOpen(null)}
          onSaved={() => { setDemoCompleteOpen(null); load(); }}
        />
      )}

      {/* Create agreement */}
      {agreementOpen && (
        <AgreementDialog
          court={agreementOpen}
          customers={customers}
          onClose={() => setAgreementOpen(null)}
          onSaved={() => { setAgreementOpen(null); load(); }}
          userId={user?.id ?? null}
        />
      )}

      {/* Court drawer */}
      <CourtDrawer
        court={drawerCourt}
        interactions={drawerCourt ? interactionsByCourt.get(drawerCourt.id) ?? [] : []}
        demos={drawerCourt ? demosByCourt.get(drawerCourt.id) ?? [] : []}
        agreements={drawerCourt ? agreementsByCourt.get(drawerCourt.id) ?? [] : []}
        salesOrders={salesOrders}
        customers={customers}
        isAdmin={isAdmin}
        userId={user?.id ?? null}
        onClose={() => setDrawerCourt(null)}
        onScheduleDemo={() => demoSchedOpen ? null : setDemoSchedOpen(drawerCourt)}
        onCompleteDemo={(d) => setDemoCompleteOpen(d)}
        onCreateAgreement={() => setAgreementOpen(drawerCourt)}
        onChanged={load}
      />
    </ERPLayout>
  );
}

/* ---------- Stage Change Dialog ---------- */
function StageChangeDialog({ ctx, onCancel, onConfirm }: {
  ctx: { court: PadelCourt; newStage: PipelineStage } | null;
  onCancel: () => void;
  onConfirm: (note: string, outcome: string, followUp: string, type: InteractionType) => void;
}) {
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [type, setType] = useState<InteractionType>("call");
  useEffect(() => { if (ctx) { setNote(""); setOutcome(""); setFollowUp(""); setType("call"); } }, [ctx]);
  if (!ctx) return null;
  return (
    <Dialog open={!!ctx} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Move to {STAGE_LABEL[ctx.newStage]}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">{ctx.court.venue_name}</div>
          <div>
            <Label>Interaction type</Label>
            <Select value={type} onValueChange={(v) => setType(v as InteractionType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {INTERACTION_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Outcome (short)</Label>
            <Input value={outcome} onChange={e => setOutcome(e.target.value)} placeholder="e.g. Manager interested" />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={3} />
          </div>
          <div>
            <Label>Follow-up date</Label>
            <Input type="date" value={followUp} onChange={e => setFollowUp(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onConfirm(note, outcome, followUp, type)}>Confirm move</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Add Court ---------- */
function AddCourtDialog({ open, onClose, onSaved, userId }: {
  open: boolean; onClose: () => void; onSaved: () => void; userId: string | null;
}) {
  const [form, setForm] = useState({
    venue_name: "", city: "", area: "", google_maps_url: "", number_of_courts: "1",
    weekly_play_hours: "", manager_name: "", manager_phone: "", manager_email: "",
    current_ball_brand: "", monthly_consumption_estimate: "", notes: "",
  });
  useEffect(() => {
    if (open) setForm({
      venue_name: "", city: "", area: "", google_maps_url: "", number_of_courts: "1",
      weekly_play_hours: "", manager_name: "", manager_phone: "", manager_email: "",
      current_ball_brand: "", monthly_consumption_estimate: "", notes: "",
    });
  }, [open]);

  const save = async () => {
    if (!form.venue_name.trim()) { toast.error("Venue name required"); return; }
    const { error } = await supabase.from("padel_courts").insert({
      venue_name: form.venue_name.trim(),
      city: form.city || null,
      area: form.area || null,
      google_maps_url: form.google_maps_url || null,
      number_of_courts: parseInt(form.number_of_courts) || 1,
      weekly_play_hours: form.weekly_play_hours ? Number(form.weekly_play_hours) : null,
      manager_name: form.manager_name || null,
      manager_phone: form.manager_phone || null,
      manager_email: form.manager_email || null,
      current_ball_brand: form.current_ball_brand || null,
      monthly_consumption_estimate: form.monthly_consumption_estimate ? Number(form.monthly_consumption_estimate) : null,
      notes: form.notes || null,
      created_by: userId,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Court added");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add Court</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2"><Label>Venue Name *</Label><Input value={form.venue_name} onChange={e => setForm({ ...form, venue_name: e.target.value })} /></div>
          <div><Label>City</Label><Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} /></div>
          <div><Label>Area</Label><Input value={form.area} onChange={e => setForm({ ...form, area: e.target.value })} /></div>
          <div className="sm:col-span-2"><Label>Google Maps URL</Label><Input value={form.google_maps_url} onChange={e => setForm({ ...form, google_maps_url: e.target.value })} /></div>
          <div><Label># Courts</Label><Input type="number" value={form.number_of_courts} onChange={e => setForm({ ...form, number_of_courts: e.target.value })} /></div>
          <div><Label>Weekly Play Hours</Label><Input type="number" value={form.weekly_play_hours} onChange={e => setForm({ ...form, weekly_play_hours: e.target.value })} /></div>
          <div><Label>Manager Name</Label><Input value={form.manager_name} onChange={e => setForm({ ...form, manager_name: e.target.value })} /></div>
          <div><Label>Manager Phone</Label><Input value={form.manager_phone} onChange={e => setForm({ ...form, manager_phone: e.target.value })} /></div>
          <div className="sm:col-span-2"><Label>Manager Email</Label><Input type="email" value={form.manager_email} onChange={e => setForm({ ...form, manager_email: e.target.value })} /></div>
          <div><Label>Current Ball Brand</Label><Input value={form.current_ball_brand} onChange={e => setForm({ ...form, current_ball_brand: e.target.value })} /></div>
          <div><Label>Monthly Consumption Est.</Label><Input type="number" value={form.monthly_consumption_estimate} onChange={e => setForm({ ...form, monthly_consumption_estimate: e.target.value })} /></div>
          <div className="sm:col-span-2"><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save Court</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Schedule Demo ---------- */
function ScheduleDemoDialog({ court, onClose, onSaved, userId }: {
  court: PadelCourt; onClose: () => void; onSaved: () => void; userId: string | null;
}) {
  const [scheduledAt, setScheduledAt] = useState<string>(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  const [attendees, setAttendees] = useState("");
  const [balls, setBalls] = useState("");
  const [notes, setNotes] = useState("");

  const save = async () => {
    const { error } = await supabase.from("padel_demo_sessions").insert({
      court_id: court.id,
      scheduled_at: new Date(scheduledAt).toISOString(),
      attendees_count: attendees ? parseInt(attendees) : null,
      balls_provided: balls ? Number(balls) : 0,
      created_by: userId,
    });
    if (error) { toast.error(error.message); return; }
    // Move to demo_scheduled if currently identified/contacted
    if (["identified", "contacted"].includes(court.pipeline_stage)) {
      await supabase.from("padel_courts").update({ pipeline_stage: "demo_scheduled" }).eq("id", court.id);
    }
    await supabase.from("padel_court_interactions").insert({
      court_id: court.id, type: "demo",
      stage_before: court.pipeline_stage, stage_after: "demo_scheduled",
      outcome: "Demo scheduled", notes: notes || null, performed_by: userId,
    });
    toast.success("Demo scheduled");
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Schedule Demo · {court.venue_name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Date & time</Label><Input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} /></div>
          <div><Label>Attendees expected</Label><Input type="number" value={attendees} onChange={e => setAttendees(e.target.value)} /></div>
          <div><Label>Balls to send</Label><Input type="number" value={balls} onChange={e => setBalls(e.target.value)} /></div>
          <div><Label>Notes</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Schedule</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Complete Demo (large rating buttons) ---------- */
function RatingRow({ label, value, onChange }: { label: string; value: number | null; onChange: (n: number) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="grid grid-cols-5 gap-2 mt-1">
        {[1, 2, 3, 4, 5].map(n => (
          <Button
            key={n}
            type="button"
            variant={value === n ? "default" : "outline"}
            className="h-12 text-base"
            onClick={() => onChange(n)}
          >
            <Star className={`h-4 w-4 mr-1 ${value && n <= value ? "fill-current" : ""}`} />{n}
          </Button>
        ))}
      </div>
    </div>
  );
}

function CompleteDemoDialog({ demo, onClose, onSaved }: {
  demo: PadelDemo; onClose: () => void; onSaved: () => void;
}) {
  const [perf, setPerf] = useState<number | null>(demo.performance_rating);
  const [press, setPress] = useState<number | null>(demo.pressure_retention_rating);
  const [dura, setDura] = useState<number | null>(demo.durability_rating);
  const [mgr, setMgr] = useState(demo.manager_feedback ?? "");
  const [plr, setPlr] = useState(demo.player_feedback ?? "");
  const [convert, setConvert] = useState(demo.converted_to_trial);
  const [files, setFiles] = useState<FileList | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    let photoUrls: string[] = demo.photos_url ?? [];
    if (files && files.length) {
      for (const f of Array.from(files)) {
        const path = `aero-demos/${demo.court_id}/${demo.id}/${Date.now()}-${f.name}`;
        const up = await supabase.storage.from("crm-content").upload(path, f, { upsert: false });
        if (up.error) { toast.error(`Upload failed: ${up.error.message}`); continue; }
        const { data } = supabase.storage.from("crm-content").getPublicUrl(path);
        photoUrls.push(data.publicUrl);
      }
    }
    const { error } = await supabase.from("padel_demo_sessions").update({
      completed_at: new Date().toISOString(),
      performance_rating: perf, pressure_retention_rating: press, durability_rating: dura,
      manager_feedback: mgr || null, player_feedback: plr || null,
      photos_url: photoUrls, converted_to_trial: convert,
    }).eq("id", demo.id);
    if (error) { setSaving(false); toast.error(error.message); return; }
    // Pipeline transitions
    if (convert) {
      await supabase.from("padel_courts").update({ pipeline_stage: "trial_supply" }).eq("id", demo.court_id);
    } else {
      await supabase.from("padel_courts").update({ pipeline_stage: "demo_completed" }).eq("id", demo.court_id);
    }
    toast.success("Demo completed");
    setSaving(false);
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Complete Demo</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <RatingRow label="Performance" value={perf} onChange={setPerf} />
          <RatingRow label="Pressure retention" value={press} onChange={setPress} />
          <RatingRow label="Durability" value={dura} onChange={setDura} />
          <div><Label>Manager feedback</Label><Textarea value={mgr} onChange={e => setMgr(e.target.value)} /></div>
          <div><Label>Player feedback</Label><Textarea value={plr} onChange={e => setPlr(e.target.value)} /></div>
          <div>
            <Label>Photos</Label>
            <Input type="file" accept="image/*" capture="environment" multiple onChange={e => setFiles(e.target.files)} />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="convert" checked={convert} onCheckedChange={(v) => setConvert(!!v)} />
            <Label htmlFor="convert" className="cursor-pointer">Convert to trial supply</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Agreement (admin only) ---------- */
function AgreementDialog({ court, customers, onClose, onSaved, userId }: {
  court: PadelCourt; customers: CustomerOpt[]; onClose: () => void; onSaved: () => void; userId: string | null;
}) {
  const [form, setForm] = useState<{
    type: AgreementType; customer_id: string; monthly_volume: string;
    unit_price: string; payment_terms: string; start_date: string; end_date: string; auto_renew: boolean;
  }>({
    type: "trial", customer_id: "", monthly_volume: "", unit_price: "",
    payment_terms: "", start_date: todayISO(), end_date: "", auto_renew: false,
  });

  const save = async () => {
    const { error } = await supabase.from("padel_supply_agreements").insert({
      court_id: court.id,
      customer_id: form.customer_id || null,
      type: form.type,
      monthly_volume: form.monthly_volume ? Number(form.monthly_volume) : null,
      unit_price: form.unit_price ? Number(form.unit_price) : null,
      payment_terms: form.payment_terms || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      auto_renew: form.auto_renew,
      status: "Approved",
      created_by: userId,
    });
    if (error) { toast.error(error.message); return; }
    // Promote pipeline
    const newStage: PipelineStage = form.type === "house_ball" || form.type === "exclusive" ? "house_ball" : "trial_supply";
    await supabase.from("padel_courts").update({ pipeline_stage: newStage }).eq("id", court.id);
    toast.success("Agreement created");
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Create Agreement · {court.venue_name}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Type</Label>
            <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as AgreementType })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{AGREEMENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Linked Customer</Label>
            <Select value={form.customer_id || "none"} onValueChange={(v) => setForm({ ...form, customer_id: v === "none" ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.code} · {c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Monthly Volume</Label><Input type="number" value={form.monthly_volume} onChange={e => setForm({ ...form, monthly_volume: e.target.value })} /></div>
          <div><Label>Unit Price (PKR)</Label><Input type="number" value={form.unit_price} onChange={e => setForm({ ...form, unit_price: e.target.value })} /></div>
          <div><Label>Start Date</Label><Input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} /></div>
          <div><Label>End Date</Label><Input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} /></div>
          <div className="sm:col-span-2"><Label>Payment Terms</Label><Input value={form.payment_terms} onChange={e => setForm({ ...form, payment_terms: e.target.value })} /></div>
          <div className="sm:col-span-2 flex items-center gap-2">
            <Checkbox id="ar" checked={form.auto_renew} onCheckedChange={(v) => setForm({ ...form, auto_renew: !!v })} />
            <Label htmlFor="ar" className="cursor-pointer">Auto-renew</Label>
          </div>
          <div className="sm:col-span-2 text-xs text-muted-foreground">Number generated automatically (ASA-YYYY-NNNN).</div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Drawer ---------- */
function CourtDrawer({
  court, interactions, demos, agreements, salesOrders, customers, isAdmin, userId,
  onClose, onScheduleDemo, onCompleteDemo, onCreateAgreement, onChanged,
}: {
  court: PadelCourt | null;
  interactions: PadelInteraction[];
  demos: PadelDemo[];
  agreements: PadelAgreement[];
  salesOrders: SalesOrderRow[];
  customers: CustomerOpt[];
  isAdmin: boolean;
  userId: string | null;
  onClose: () => void;
  onScheduleDemo: () => void;
  onCompleteDemo: (d: PadelDemo) => void;
  onCreateAgreement: () => void;
  onChanged: () => void;
}) {
  const [logOpen, setLogOpen] = useState(false);
  const [logForm, setLogForm] = useState<{ type: InteractionType; outcome: string; notes: string; follow_up_date: string }>({
    type: "call", outcome: "", notes: "", follow_up_date: "",
  });

  if (!court) return null;
  const phone = phoneDigits(court.manager_phone);
  const mapsHref = court.google_maps_url
    || (court.latitude && court.longitude ? `https://www.google.com/maps?q=${court.latitude},${court.longitude}` : null);

  const linkedCustomerIds = new Set(agreements.map(a => a.customer_id).filter(Boolean) as string[]);
  const linkedSales = salesOrders.filter(o => linkedCustomerIds.has(o.customer_id));
  const customerName = (id: string | null) => customers.find(c => c.id === id)?.name ?? "—";

  const logInteraction = async () => {
    const { error } = await supabase.from("padel_court_interactions").insert({
      court_id: court.id,
      type: logForm.type,
      outcome: logForm.outcome || null,
      stage_before: court.pipeline_stage,
      stage_after: court.pipeline_stage,
      notes: logForm.notes || null,
      follow_up_date: logForm.follow_up_date || null,
      performed_by: userId,
    });
    if (error) { toast.error(error.message); return; }
    setLogOpen(false);
    setLogForm({ type: "call", outcome: "", notes: "", follow_up_date: "" });
    toast.success("Interaction logged");
    onChanged();
  };

  return (
    <Sheet open={!!court} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{court.venue_name}</SheetTitle>
          <p className="text-xs text-muted-foreground">{[court.city, court.area].filter(Boolean).join(" · ") || "—"}</p>
          <Badge variant="outline" className="w-fit mt-1">{STAGE_LABEL[court.pipeline_stage]}</Badge>
        </SheetHeader>

        {/* Quick actions */}
        <div className="flex gap-2 mt-4">
          <Button asChild variant="outline" size="sm" disabled={!phone} className="flex-1">
            <a href={phone ? `https://wa.me/${phone}` : "#"} target="_blank" rel="noreferrer">
              <MessageCircle className="h-4 w-4 mr-1" />WhatsApp
            </a>
          </Button>
          <Button asChild variant="outline" size="sm" disabled={!phone} className="flex-1">
            <a href={phone ? `tel:${phone}` : "#"}><Phone className="h-4 w-4 mr-1" />Call</a>
          </Button>
          <Button asChild variant="outline" size="sm" disabled={!mapsHref} className="flex-1">
            <a href={mapsHref ?? "#"} target="_blank" rel="noreferrer"><MapPin className="h-4 w-4 mr-1" />Maps</a>
          </Button>
        </div>

        <Tabs defaultValue="overview" className="mt-4">
          <TabsList className="grid grid-cols-5 w-full">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="interactions">Logs</TabsTrigger>
            <TabsTrigger value="demos">Demos</TabsTrigger>
            <TabsTrigger value="agreements">Deals</TabsTrigger>
            <TabsTrigger value="sales">Sales</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-2 text-sm">
            <Row k="Manager" v={court.manager_name} />
            <Row k="Phone" v={court.manager_phone} />
            <Row k="Email" v={court.manager_email} />
            <Row k="# Courts" v={String(court.number_of_courts ?? "—")} />
            <Row k="Weekly Play Hours" v={court.weekly_play_hours ? String(court.weekly_play_hours) : "—"} />
            <Row k="Current Brand" v={court.current_ball_brand} />
            <Row k="Monthly Est." v={Number(court.monthly_consumption_estimate ?? 0).toLocaleString()} />
            {court.notes && <div className="pt-2"><Label>Notes</Label><p className="text-muted-foreground whitespace-pre-wrap">{court.notes}</p></div>}
          </TabsContent>

          <TabsContent value="interactions">
            <div className="flex justify-end mb-2">
              <Button size="sm" onClick={() => setLogOpen(true)}><Plus className="h-3 w-3 mr-1" />Log</Button>
            </div>
            <div className="space-y-2">
              {interactions.length === 0 && <p className="text-xs text-muted-foreground">No interactions yet.</p>}
              {interactions.map(i => (
                <div key={i.id} className="p-2 border rounded text-xs">
                  <div className="flex justify-between"><span className="font-medium capitalize">{i.type}</span><span className="text-muted-foreground">{new Date(i.performed_at).toLocaleString()}</span></div>
                  {i.outcome && <div className="mt-1">{i.outcome}</div>}
                  {i.notes && <div className="text-muted-foreground mt-1 whitespace-pre-wrap">{i.notes}</div>}
                  {i.stage_before !== i.stage_after && (
                    <div className="text-[10px] text-muted-foreground mt-1">{i.stage_before} → {i.stage_after}</div>
                  )}
                  {i.follow_up_date && <div className="text-[10px] mt-1">Follow up: {i.follow_up_date}</div>}
                </div>
              ))}
            </div>

            <Dialog open={logOpen} onOpenChange={setLogOpen}>
              <DialogContent className="max-w-sm">
                <DialogHeader><DialogTitle>Log Interaction</DialogTitle></DialogHeader>
                <div className="space-y-2">
                  <Select value={logForm.type} onValueChange={v => setLogForm({ ...logForm, type: v as InteractionType })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{INTERACTION_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input placeholder="Outcome" value={logForm.outcome} onChange={e => setLogForm({ ...logForm, outcome: e.target.value })} />
                  <Textarea placeholder="Notes" value={logForm.notes} onChange={e => setLogForm({ ...logForm, notes: e.target.value })} />
                  <Input type="date" value={logForm.follow_up_date} onChange={e => setLogForm({ ...logForm, follow_up_date: e.target.value })} />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setLogOpen(false)}>Cancel</Button>
                  <Button onClick={logInteraction}>Save</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>

          <TabsContent value="demos">
            <div className="flex justify-end mb-2">
              <Button size="sm" onClick={onScheduleDemo}><CalendarPlus className="h-3 w-3 mr-1" />Schedule</Button>
            </div>
            <div className="space-y-2">
              {demos.length === 0 && <p className="text-xs text-muted-foreground">No demos yet.</p>}
              {demos.map(d => (
                <div key={d.id} className="p-2 border rounded text-xs">
                  <div className="flex justify-between">
                    <span className="font-medium">
                      {d.scheduled_at ? new Date(d.scheduled_at).toLocaleString() : "—"}
                    </span>
                    <Badge variant={d.completed_at ? "default" : "outline"} className="text-[10px]">
                      {d.completed_at ? "Completed" : "Scheduled"}
                    </Badge>
                  </div>
                  <div className="text-muted-foreground mt-1">
                    Attendees {d.attendees_count ?? "—"} · Balls {d.balls_provided ?? 0}
                  </div>
                  {d.completed_at && (
                    <div className="mt-1 flex gap-3">
                      <span>Perf: {d.performance_rating ?? "—"}</span>
                      <span>Press: {d.pressure_retention_rating ?? "—"}</span>
                      <span>Dura: {d.durability_rating ?? "—"}</span>
                    </div>
                  )}
                  {!d.completed_at && (
                    <Button size="sm" variant="outline" className="mt-2 h-7" onClick={() => onCompleteDemo(d)}>
                      Complete
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="agreements">
            <div className="flex justify-end mb-2">
              {isAdmin ? (
                <Button size="sm" onClick={onCreateAgreement}><Plus className="h-3 w-3 mr-1" />Create</Button>
              ) : (
                <span className="text-[11px] text-muted-foreground">Admin only</span>
              )}
            </div>
            <div className="space-y-2">
              {agreements.length === 0 && <p className="text-xs text-muted-foreground">No agreements.</p>}
              {agreements.map(a => (
                <div key={a.id} className="p-2 border rounded text-xs">
                  <div className="flex justify-between">
                    <span className="font-medium">{a.agreement_number}</span>
                    <Badge variant="outline" className="text-[10px] capitalize">{a.type}</Badge>
                  </div>
                  <div className="text-muted-foreground mt-1">{customerName(a.customer_id)}</div>
                  <div className="mt-1 flex justify-between">
                    <span>{a.monthly_volume ?? "—"} units/mo · {fmtPKR(a.unit_price)}</span>
                    <span>{a.start_date ?? ""} → {a.end_date ?? ""}</span>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="sales">
            {linkedSales.length === 0 ? (
              <p className="text-xs text-muted-foreground">No linked sales orders. Add a customer to an agreement to surface sales here.</p>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Order #</TableHead><TableHead>Date</TableHead>
                  <TableHead className="text-right">Net</TableHead><TableHead>Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {linkedSales.slice(0, 30).map(o => (
                    <TableRow key={o.id}>
                      <TableCell className="text-xs">{o.order_number}</TableCell>
                      <TableCell className="text-xs">{o.order_date}</TableCell>
                      <TableCell className="text-xs text-right">{fmtPKR(Number(o.net_amount ?? 0))}</TableCell>
                      <TableCell className="text-xs capitalize">{o.status}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function Row({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div className="flex justify-between border-b py-1">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium text-right">{v || "—"}</span>
    </div>
  );
}
