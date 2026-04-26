import { useEffect, useState, DragEvent } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { supabase } from "@/integrations/supabase/client";
import { Plus, GripVertical, Calendar, User, Pencil, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

const STAGES = [
  { key: "prospecting", label: "Prospecting", color: "border-t-blue-500" },
  { key: "qualification", label: "Qualification", color: "border-t-cyan-500" },
  { key: "proposal", label: "Proposal", color: "border-t-amber-500" },
  { key: "negotiation", label: "Negotiation", color: "border-t-orange-500" },
  { key: "won", label: "Won", color: "border-t-green-500" },
  { key: "lost", label: "Lost", color: "border-t-red-500" },
];

const NONE = "none";

const fmt = (n: number) => `Rs. ${new Intl.NumberFormat("en-PK").format(Math.round(n))}`;

export default function CRMDealsPipelinePage() {
  const [deals, setDeals] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [initialStage, setInitialStage] = useState<string>("prospecting");
  const [form, setForm] = useState({
    title: "",
    contact_id: NONE,
    customer_id: NONE,
    value: "",
    expected_close_date: "",
    probability: "0",
    owner_id: NONE,
    notes: "",
    lost_reason: "",
  });

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const [dRes, cRes, custRes, uRes] = await Promise.all([
      supabase.from("crm_deals").select("*").order("created_at", { ascending: false }),
      supabase.from("crm_contacts").select("id, full_name, company"),
      supabase.from("customers").select("id, name, code").eq("is_active", true),
      supabase.from("app_users").select("id, full_name").eq("is_active", true),
    ]);
    setDeals(dRes.data || []);
    setContacts(cRes.data || []);
    setCustomers(custRes.data || []);
    setUsers(uRes.data || []);
  };

  const openCreate = (stage: string) => {
    setEditing(null);
    setInitialStage(stage);
    setForm({
      title: "",
      contact_id: NONE,
      customer_id: NONE,
      value: "",
      expected_close_date: "",
      probability: "0",
      owner_id: NONE,
      notes: "",
      lost_reason: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (d: any) => {
    setEditing(d);
    setForm({
      title: d.title || "",
      contact_id: d.contact_id || NONE,
      customer_id: d.customer_id || NONE,
      value: d.value?.toString() || "",
      expected_close_date: d.expected_close_date || "",
      probability: d.probability?.toString() || "0",
      owner_id: d.owner_id || NONE,
      notes: d.notes || "",
      lost_reason: d.lost_reason || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      toast.error("Title is required");
      return;
    }
    const payload: any = {
      title: form.title.trim(),
      contact_id: form.contact_id === NONE ? null : form.contact_id,
      customer_id: form.customer_id === NONE ? null : form.customer_id,
      value: form.value ? parseFloat(form.value) : 0,
      expected_close_date: form.expected_close_date || null,
      probability: form.probability ? parseInt(form.probability) : 0,
      owner_id: form.owner_id === NONE ? null : form.owner_id,
      notes: form.notes || null,
      lost_reason: form.lost_reason || null,
    };
    if (editing) {
      const { error } = await supabase.from("crm_deals").update(payload).eq("id", editing.id);
      if (error) {
        toast.error("Failed to update");
        return;
      }
      toast.success("Deal updated");
    } else {
      payload.stage = initialStage;
      payload.currency = "PKR";
      if (initialStage === "won") payload.won_at = new Date().toISOString();
      const { error } = await supabase.from("crm_deals").insert(payload);
      if (error) {
        toast.error("Failed to create");
        return;
      }
      toast.success("Deal created");
    }
    setDialogOpen(false);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this deal?")) return;
    const { error } = await supabase.from("crm_deals").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete");
      return;
    }
    toast.success("Deleted");
    load();
  };

  const handleDragStart = (e: DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = async (e: DragEvent, newStage: string) => {
    e.preventDefault();
    if (!draggedId) return;
    const update: any = { stage: newStage };
    if (newStage === "won") update.won_at = new Date().toISOString();
    else if (newStage !== "lost") update.won_at = null;
    const { error } = await supabase.from("crm_deals").update(update).eq("id", draggedId);
    if (error) toast.error("Failed to update stage");
    else toast.success(`Moved to ${newStage}`);
    setDraggedId(null);
    load();
  };

  const stageDeals = (s: string) => deals.filter((d) => d.stage === s);
  const stageValue = (s: string) =>
    stageDeals(s).reduce((sum, d) => sum + Number(d.value || 0), 0);

  return (
    <ERPLayout>
      <PageHeader
        title="Deals Pipeline"
        description="Drag deals across stages to update pipeline"
        action={{ label: "New Deal", onClick: () => openCreate("prospecting") }}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {STAGES.map((col) => (
          <div
            key={col.key}
            className={`rounded-lg border-t-4 ${col.color} bg-muted/30 min-h-[400px] flex flex-col`}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, col.key)}
          >
            <div className="p-2 flex items-center justify-between border-b">
              <div className="min-w-0">
                <h3 className="font-semibold text-sm truncate">{col.label}</h3>
                <p className="text-[10px] text-muted-foreground">{fmt(stageValue(col.key))}</p>
              </div>
              <div className="flex items-center gap-1">
                <Badge variant="secondary" className="text-xs">
                  {stageDeals(col.key).length}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => openCreate(col.key)}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <div className="flex-1 p-2 space-y-2 overflow-y-auto">
              {stageDeals(col.key).map((d) => (
                <div
                  key={d.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, d.id)}
                  className={`p-2 rounded-md bg-background border shadow-sm cursor-grab hover:shadow-md transition-shadow ${
                    draggedId === d.id ? "opacity-50" : ""
                  }`}
                >
                  <div className="flex items-start gap-1">
                    <GripVertical className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0" onClick={() => openEdit(d)}>
                      <p className="text-sm font-medium truncate">{d.title}</p>
                      <p className="text-[10px] font-mono text-muted-foreground">
                        {d.deal_number}
                      </p>
                      <p className="text-xs font-semibold text-amber-600 mt-1">
                        {fmt(Number(d.value || 0))}
                      </p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {d.expected_close_date && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                            <Calendar className="h-3 w-3" />
                            {format(new Date(d.expected_close_date), "dd MMM")}
                          </span>
                        )}
                        {d.owner_id && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                            <User className="h-3 w-3" />
                            {users.find((u) => u.id === d.owner_id)?.full_name?.split(" ")[0] ||
                              ""}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={() => openEdit(d)}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 text-destructive"
                        onClick={() => handleDelete(d.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              {stageDeals(col.key).length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No deals</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Deal" : "New Deal"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Title *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Value (Rs.)</Label>
                <Input
                  type="number"
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                />
              </div>
              <div>
                <Label>Probability (%)</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={form.probability}
                  onChange={(e) => setForm({ ...form, probability: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label>Expected Close Date</Label>
              <Input
                type="date"
                value={form.expected_close_date}
                onChange={(e) => setForm({ ...form, expected_close_date: e.target.value })}
              />
            </div>
            <div>
              <Label>Contact</Label>
              <Select
                value={form.contact_id}
                onValueChange={(v) => setForm({ ...form, contact_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.full_name}
                      {c.company ? ` (${c.company})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Linked Customer</Label>
              <Select
                value={form.customer_id}
                onValueChange={(v) => setForm({ ...form, customer_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.code} — {c.name}
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
            <div>
              <Label>Notes</Label>
              <Textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            {editing && editing.stage === "lost" && (
              <div>
                <Label>Lost Reason</Label>
                <Input
                  value={form.lost_reason}
                  onChange={(e) => setForm({ ...form, lost_reason: e.target.value })}
                />
              </div>
            )}
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
