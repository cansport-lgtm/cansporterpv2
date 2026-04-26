import { useEffect, useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Pencil, Trash2, Phone, Mail, Calendar as CalIcon, ListTodo, StickyNote } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

const TYPES = ["call", "meeting", "email", "task", "note"];
const TYPE_ICONS: Record<string, any> = {
  call: Phone,
  meeting: CalIcon,
  email: Mail,
  task: ListTodo,
  note: StickyNote,
};
const RELATED_TYPES = ["lead", "deal", "contact"];
const NONE = "none";

export default function CRMActivitiesPage() {
  const [activities, setActivities] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({
    activity_type: "task",
    subject: "",
    description: "",
    due_date: "",
    completed: false,
    related_to: NONE,
    related_id: NONE,
    owner_id: NONE,
  });

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const [aRes, uRes, lRes, dRes, cRes] = await Promise.all([
      supabase.from("crm_activities").select("*").order("due_date", { ascending: true }),
      supabase.from("app_users").select("id, full_name").eq("is_active", true),
      supabase.from("crm_leads").select("id, lead_number, name"),
      supabase.from("crm_deals").select("id, deal_number, title"),
      supabase.from("crm_contacts").select("id, full_name"),
    ]);
    setActivities(aRes.data || []);
    setUsers(uRes.data || []);
    setLeads(lRes.data || []);
    setDeals(dRes.data || []);
    setContacts(cRes.data || []);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({
      activity_type: "task",
      subject: "",
      description: "",
      due_date: "",
      completed: false,
      related_to: NONE,
      related_id: NONE,
      owner_id: NONE,
    });
    setDialogOpen(true);
  };

  const openEdit = (a: any) => {
    setEditing(a);
    setForm({
      activity_type: a.activity_type,
      subject: a.subject || "",
      description: a.description || "",
      due_date: a.due_date ? a.due_date.slice(0, 16) : "",
      completed: !!a.completed,
      related_to: a.related_to || NONE,
      related_id: a.related_id || NONE,
      owner_id: a.owner_id || NONE,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.subject.trim()) {
      toast.error("Subject is required");
      return;
    }
    const payload: any = {
      activity_type: form.activity_type,
      subject: form.subject.trim(),
      description: form.description || null,
      due_date: form.due_date ? new Date(form.due_date).toISOString() : null,
      completed: form.completed,
      completed_at: form.completed ? new Date().toISOString() : null,
      related_to: form.related_to === NONE ? null : form.related_to,
      related_id: form.related_id === NONE ? null : form.related_id,
      owner_id: form.owner_id === NONE ? null : form.owner_id,
    };
    if (editing) {
      const { error } = await supabase.from("crm_activities").update(payload).eq("id", editing.id);
      if (error) {
        toast.error("Failed to update");
        return;
      }
      toast.success("Activity updated");
    } else {
      const { error } = await supabase.from("crm_activities").insert(payload);
      if (error) {
        toast.error("Failed to create");
        return;
      }
      toast.success("Activity created");
    }
    setDialogOpen(false);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this activity?")) return;
    const { error } = await supabase.from("crm_activities").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete");
      return;
    }
    toast.success("Deleted");
    load();
  };

  const toggleComplete = async (a: any) => {
    const newCompleted = !a.completed;
    await supabase
      .from("crm_activities")
      .update({
        completed: newCompleted,
        completed_at: newCompleted ? new Date().toISOString() : null,
      })
      .eq("id", a.id);
    load();
  };

  const relatedOptions = (() => {
    if (form.related_to === "lead") return leads.map((l) => ({ id: l.id, label: `${l.lead_number} — ${l.name}` }));
    if (form.related_to === "deal") return deals.map((d) => ({ id: d.id, label: `${d.deal_number} — ${d.title}` }));
    if (form.related_to === "contact") return contacts.map((c) => ({ id: c.id, label: c.full_name }));
    return [];
  })();

  const relatedLabel = (a: any) => {
    if (!a.related_to || !a.related_id) return "—";
    if (a.related_to === "lead") {
      const l = leads.find((x) => x.id === a.related_id);
      return l ? `Lead: ${l.lead_number}` : "Lead";
    }
    if (a.related_to === "deal") {
      const d = deals.find((x) => x.id === a.related_id);
      return d ? `Deal: ${d.deal_number}` : "Deal";
    }
    if (a.related_to === "contact") {
      const c = contacts.find((x) => x.id === a.related_id);
      return c ? `Contact: ${c.full_name}` : "Contact";
    }
    return "—";
  };

  const filtered = activities.filter((a) => {
    if (filterType !== "all" && a.activity_type !== filterType) return false;
    if (filterStatus === "open" && a.completed) return false;
    if (filterStatus === "done" && !a.completed) return false;
    return true;
  });

  return (
    <ERPLayout>
      <PageHeader
        title="Activities"
        description="Calls, meetings, emails & follow-up tasks"
        action={{ label: "New Activity", onClick: openCreate }}
      />

      <Card className="mb-4">
        <CardContent className="p-3 flex flex-col sm:flex-row gap-2">
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {TYPES.map((t) => (
                <SelectItem key={t} value={t} className="capitalize">
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="done">Completed</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Done</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Related</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No activities
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((a) => {
                    const Icon = TYPE_ICONS[a.activity_type] || ListTodo;
                    return (
                      <TableRow key={a.id} className={a.completed ? "opacity-60" : ""}>
                        <TableCell>
                          <Checkbox
                            checked={a.completed}
                            onCheckedChange={() => toggleComplete(a)}
                          />
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize gap-1">
                            <Icon className="h-3 w-3" />
                            {a.activity_type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className={a.completed ? "line-through" : "font-medium"}>
                            {a.subject}
                          </div>
                          {a.description && (
                            <div className="text-xs text-muted-foreground truncate max-w-xs">
                              {a.description}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{relatedLabel(a)}</TableCell>
                        <TableCell className="text-xs">
                          {a.due_date ? format(new Date(a.due_date), "dd MMM yyyy HH:mm") : "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {users.find((u) => u.id === a.owner_id)?.full_name || "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => openEdit(a)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => handleDelete(a.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Activity" : "New Activity"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <Select
                  value={form.activity_type}
                  onValueChange={(v) => setForm({ ...form, activity_type: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPES.map((t) => (
                      <SelectItem key={t} value={t} className="capitalize">
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Owner</Label>
                <Select
                  value={form.owner_id}
                  onValueChange={(v) => setForm({ ...form, owner_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Unassigned</SelectItem>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Subject *</Label>
              <Input
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div>
              <Label>Due Date / Time</Label>
              <Input
                type="datetime-local"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Related To</Label>
                <Select
                  value={form.related_to}
                  onValueChange={(v) =>
                    setForm({ ...form, related_to: v, related_id: NONE })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {RELATED_TYPES.map((t) => (
                      <SelectItem key={t} value={t} className="capitalize">
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Record</Label>
                <Select
                  value={form.related_id}
                  onValueChange={(v) => setForm({ ...form, related_id: v })}
                  disabled={form.related_to === NONE}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>—</SelectItem>
                    {relatedOptions.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={form.completed}
                onCheckedChange={(v) => setForm({ ...form, completed: !!v })}
              />
              <Label>Mark as completed</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>{editing ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
