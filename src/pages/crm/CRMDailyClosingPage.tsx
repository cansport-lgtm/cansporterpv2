import { useEffect, useMemo, useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Pencil, Trash2, Phone, Users, Megaphone, Briefcase, UserCheck, Handshake } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

const NONE = "none";

const ACTIVITY_TYPES = [
  { value: "lead_worked", label: "Lead Worked", icon: UserCheck },
  { value: "deal_worked", label: "Deal Worked", icon: Briefcase },
  { value: "visit", label: "Visit", icon: Handshake },
  { value: "call", label: "Call", icon: Phone },
  { value: "meeting", label: "Meeting", icon: Users },
  { value: "content", label: "Content / Campaign", icon: Megaphone },
];

const CHANNELS = ["Facebook", "Instagram", "LinkedIn", "Email", "WhatsApp", "TikTok", "YouTube", "Other"];

const typeMeta = (t: string) => ACTIVITY_TYPES.find((x) => x.value === t);

export default function CRMDailyClosingPage() {
  const { user, hasRole } = useAuth();
  const isAdmin = hasRole("super_admin") || hasRole("admin");

  const today = format(new Date(), "yyyy-MM-dd");
  const [date, setDate] = useState(today);
  const [userFilter, setUserFilter] = useState<string>("self");
  const [activities, setActivities] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [summaryDraft, setSummaryDraft] = useState({
    accomplishments: "",
    tomorrow_plan: "",
    issues_feedback: "",
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>({
    activity_type: "visit",
    activity_time: format(new Date(), "HH:mm"),
    title: "",
    customer_name: "",
    related_lead_id: NONE,
    related_deal_id: NONE,
    channel: NONE,
    outcome: "",
    notes: "",
    metadata: {} as Record<string, any>,
  });

  useEffect(() => {
    loadStatic();
  }, []);

  useEffect(() => {
    loadDay();
  }, [date, userFilter, user?.id]);

  const effectiveUserId = useMemo(() => {
    if (isAdmin && userFilter !== "self" && userFilter !== "all") return userFilter;
    return user?.id || null;
  }, [isAdmin, userFilter, user?.id]);

  const loadStatic = async () => {
    const [permRes, roleRes, lRes, dRes] = await Promise.all([
      supabase.from("module_permissions").select("user_id").eq("module_name", "crm").eq("can_view", true),
      supabase.from("user_roles").select("user_id").eq("role", "super_admin"),
      supabase.from("crm_leads").select("id, lead_number, name").order("created_at", { ascending: false }).limit(500),
      supabase.from("crm_deals").select("id, deal_number, title").order("created_at", { ascending: false }).limit(500),
    ]);
    const allowedIds = Array.from(new Set([
      ...((permRes.data || []).map((r: any) => r.user_id)),
      ...((roleRes.data || []).map((r: any) => r.user_id)),
    ])).filter(Boolean);
    let usersData: any[] = [];
    if (allowedIds.length > 0) {
      const uRes = await supabase
        .from("app_users")
        .select("id, full_name")
        .eq("is_active", true)
        .in("id", allowedIds)
        .order("full_name");
      usersData = uRes.data || [];
    }
    setUsers(usersData);
    setLeads(lRes.data || []);
    setDeals(dRes.data || []);
  };

  const loadDay = async () => {
    let q = supabase
      .from("crm_daily_activities")
      .select("*")
      .eq("activity_date", date)
      .order("activity_time", { ascending: true });

    if (!isAdmin) {
      if (!user?.id) return;
      q = q.eq("user_id", user.id);
    } else if (userFilter === "self" && user?.id) {
      q = q.eq("user_id", user.id);
    } else if (userFilter !== "all" && userFilter !== "self") {
      q = q.eq("user_id", userFilter);
    }
    const { data: aData } = await q;
    setActivities(aData || []);

    if (effectiveUserId) {
      const { data: sData } = await supabase
        .from("crm_daily_summaries")
        .select("*")
        .eq("summary_date", date)
        .eq("user_id", effectiveUserId)
        .maybeSingle();
      setSummary(sData);
      setSummaryDraft({
        accomplishments: sData?.accomplishments || "",
        tomorrow_plan: sData?.tomorrow_plan || "",
        issues_feedback: sData?.issues_feedback || "",
      });
    } else {
      setSummary(null);
    }
  };

  const userMap = useMemo(() => {
    const m = new Map<string, string>();
    users.forEach((u) => m.set(u.id, u.full_name));
    return m;
  }, [users]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      activity_type: "visit",
      activity_time: format(new Date(), "HH:mm"),
      title: "",
      customer_name: "",
      related_lead_id: NONE,
      related_deal_id: NONE,
      channel: NONE,
      outcome: "",
      notes: "",
      metadata: {},
    });
    setDialogOpen(true);
  };

  const openEdit = (a: any) => {
    setEditing(a);
    setForm({
      activity_type: a.activity_type,
      activity_time: (a.activity_time || "00:00").slice(0, 5),
      title: a.title || "",
      customer_name: a.customer_name || "",
      related_lead_id: a.related_lead_id || NONE,
      related_deal_id: a.related_deal_id || NONE,
      channel: a.channel || NONE,
      outcome: a.outcome || "",
      notes: a.notes || "",
      metadata: a.metadata || {},
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!user?.id) {
      toast.error("Not signed in");
      return;
    }
    if (!form.title.trim()) {
      toast.error("Title is required");
      return;
    }
    const payload: any = {
      user_id: editing?.user_id || user.id,
      user_name: editing?.user_name || user.full_name,
      activity_date: date,
      activity_time: form.activity_time || null,
      activity_type: form.activity_type,
      title: form.title.trim(),
      customer_name: form.customer_name || null,
      related_lead_id: form.related_lead_id === NONE ? null : form.related_lead_id,
      related_deal_id: form.related_deal_id === NONE ? null : form.related_deal_id,
      channel: form.channel === NONE ? null : form.channel,
      outcome: form.outcome || null,
      notes: form.notes || null,
      metadata: form.metadata || {},
    };
    if (editing) {
      const { error } = await supabase.from("crm_daily_activities").update(payload).eq("id", editing.id);
      if (error) { toast.error("Failed to update"); return; }
      toast.success("Updated");
    } else {
      const { error } = await supabase.from("crm_daily_activities").insert(payload);
      if (error) { toast.error("Failed to create"); return; }
      toast.success("Activity added");
    }
    setDialogOpen(false);
    loadDay();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this activity?")) return;
    const { error } = await supabase.from("crm_daily_activities").delete().eq("id", id);
    if (error) { toast.error("Failed to delete"); return; }
    toast.success("Deleted");
    loadDay();
  };

  const saveSummary = async () => {
    if (!user?.id) return;
    const targetUserId = effectiveUserId || user.id;
    const targetUserName = userMap.get(targetUserId) || user.full_name;
    const payload = {
      user_id: targetUserId,
      user_name: targetUserName,
      summary_date: date,
      ...summaryDraft,
    };
    if (summary) {
      const { error } = await supabase.from("crm_daily_summaries").update(payload).eq("id", summary.id);
      if (error) { toast.error("Failed to save"); return; }
    } else {
      const { error } = await supabase.from("crm_daily_summaries").insert(payload);
      if (error) { toast.error("Failed to save"); return; }
    }
    toast.success("Day summary saved");
    loadDay();
  };

  const kpis = useMemo(() => {
    const k = { lead_worked: 0, deal_worked: 0, visit: 0, call: 0, meeting: 0, content: 0 };
    activities.forEach((a) => {
      if (k[a.activity_type as keyof typeof k] !== undefined) k[a.activity_type as keyof typeof k]++;
    });
    return k;
  }, [activities]);

  const summaryReadOnly = isAdmin && effectiveUserId && effectiveUserId !== user?.id;

  return (
    <ERPLayout>
      <PageHeader
        title="Daily Marketing Closing"
        description="Log day-to-day marketing activities and submit a daily summary"
        action={{ label: "Add Activity", onClick: openCreate }}
      />

      <Card className="mb-4">
        <CardContent className="p-3 flex flex-col sm:flex-row gap-2">
          <div className="flex-1">
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {isAdmin && (
            <div className="flex-1">
              <Label className="text-xs">User</Label>
              <Select value={userFilter} onValueChange={setUserFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="self">My entries</SelectItem>
                  <SelectItem value="all">All users</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
        {ACTIVITY_TYPES.map((t) => {
          const Icon = t.icon;
          return (
            <Card key={t.value}>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  <Icon className="h-3.5 w-3.5" /> {t.label}
                </div>
                <div className="text-2xl font-bold mt-1">{kpis[t.value as keyof typeof kpis] || 0}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Activities</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Customer / Link</TableHead>
                  <TableHead>Outcome</TableHead>
                  {(isAdmin && userFilter === "all") && <TableHead>User</TableHead>}
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activities.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={isAdmin && userFilter === "all" ? 7 : 6} className="text-center text-muted-foreground py-8">
                      No activities logged for this date
                    </TableCell>
                  </TableRow>
                ) : activities.map((a) => {
                  const meta = typeMeta(a.activity_type);
                  const Icon = meta?.icon || Phone;
                  const lead = a.related_lead_id ? leads.find((l) => l.id === a.related_lead_id) : null;
                  const deal = a.related_deal_id ? deals.find((d) => d.id === a.related_deal_id) : null;
                  const canEdit = a.user_id === user?.id || isAdmin;
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs">{(a.activity_time || "").slice(0, 5)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize gap-1">
                          <Icon className="h-3 w-3" />{meta?.label || a.activity_type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{a.title}</div>
                        {a.notes && <div className="text-xs text-muted-foreground truncate max-w-xs">{a.notes}</div>}
                      </TableCell>
                      <TableCell className="text-xs">
                        {a.customer_name && <div>{a.customer_name}</div>}
                        {lead && <div className="text-muted-foreground">Lead: {lead.lead_number}</div>}
                        {deal && <div className="text-muted-foreground">Deal: {deal.deal_number}</div>}
                        {a.channel && <div className="text-muted-foreground">{a.channel}</div>}
                      </TableCell>
                      <TableCell className="text-xs">{a.outcome || "—"}</TableCell>
                      {(isAdmin && userFilter === "all") && (
                        <TableCell className="text-xs">{a.user_name || userMap.get(a.user_id) || "—"}</TableCell>
                      )}
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={!canEdit} onClick={() => openEdit(a)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" disabled={!canEdit} onClick={() => handleDelete(a.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {(userFilter !== "all" || !isAdmin) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Day Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>What I did today</Label>
              <Textarea rows={3} disabled={!!summaryReadOnly}
                value={summaryDraft.accomplishments}
                onChange={(e) => setSummaryDraft({ ...summaryDraft, accomplishments: e.target.value })} />
            </div>
            <div>
              <Label>Plan for tomorrow</Label>
              <Textarea rows={3} disabled={!!summaryReadOnly}
                value={summaryDraft.tomorrow_plan}
                onChange={(e) => setSummaryDraft({ ...summaryDraft, tomorrow_plan: e.target.value })} />
            </div>
            <div>
              <Label>Issues / market feedback</Label>
              <Textarea rows={3} disabled={!!summaryReadOnly}
                value={summaryDraft.issues_feedback}
                onChange={(e) => setSummaryDraft({ ...summaryDraft, issues_feedback: e.target.value })} />
            </div>
            {!summaryReadOnly && (
              <div className="flex justify-end">
                <Button onClick={saveSummary}>Save Day Summary</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Activity" : "Add Activity"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <Select value={form.activity_type} onValueChange={(v) => setForm({ ...form, activity_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACTIVITY_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Time</Label>
                <Input type="time" value={form.activity_time} onChange={(e) => setForm({ ...form, activity_time: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Title / Subject *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div>
              <Label>Customer / Contact name</Label>
              <Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Linked Lead</Label>
                <Select value={form.related_lead_id} onValueChange={(v) => setForm({ ...form, related_lead_id: v })}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {leads.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.lead_number} — {l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Linked Deal</Label>
                <Select value={form.related_deal_id} onValueChange={(v) => setForm({ ...form, related_deal_id: v })}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {deals.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.deal_number} — {d.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.activity_type === "content" && (
              <div>
                <Label>Channel</Label>
                <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v })}>
                  <SelectTrigger><SelectValue placeholder="Channel" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>—</SelectItem>
                    {CHANNELS.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Outcome</Label>
              <Input value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })}
                placeholder="e.g. Quoted, Follow-up scheduled, Won, Lost" />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editing ? "Update" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
