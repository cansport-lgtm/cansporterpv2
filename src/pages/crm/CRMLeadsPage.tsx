import { useEffect, useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
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
import { Pencil, Trash2, ArrowRightLeft, Search } from "lucide-react";
import { toast } from "sonner";

const STATUSES = ["new", "contacted", "qualified", "unqualified", "converted"];
const SOURCES = ["Website", "Referral", "Cold Call", "Trade Show", "Social Media", "Email Campaign", "Other"];
const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  contacted: "bg-amber-100 text-amber-700",
  qualified: "bg-green-100 text-green-700",
  unqualified: "bg-gray-100 text-gray-700",
  converted: "bg-purple-100 text-purple-700",
};

const NONE = "none";

export default function CRMLeadsPage() {
  const [leads, setLeads] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [convertingLead, setConvertingLead] = useState<any | null>(null);
  const [form, setForm] = useState({
    name: "",
    company: "",
    phone: "",
    email: "",
    source: NONE,
    status: "new",
    assigned_to: NONE,
    notes: "",
  });
  const [dealForm, setDealForm] = useState({
    title: "",
    value: "",
    expected_close_date: "",
  });

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const [lRes, uRes] = await Promise.all([
      supabase.from("crm_leads").select("*").order("created_at", { ascending: false }),
      supabase.from("app_users").select("id, full_name").eq("is_active", true),
    ]);
    setLeads(lRes.data || []);
    setUsers(uRes.data || []);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({
      name: "",
      company: "",
      phone: "",
      email: "",
      source: NONE,
      status: "new",
      assigned_to: NONE,
      notes: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (lead: any) => {
    setEditing(lead);
    setForm({
      name: lead.name || "",
      company: lead.company || "",
      phone: lead.phone || "",
      email: lead.email || "",
      source: lead.source || NONE,
      status: lead.status || "new",
      assigned_to: lead.assigned_to || NONE,
      notes: lead.notes || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    const payload: any = {
      name: form.name.trim(),
      company: form.company || null,
      phone: form.phone || null,
      email: form.email || null,
      source: form.source === NONE ? null : form.source,
      status: form.status,
      assigned_to: form.assigned_to === NONE ? null : form.assigned_to,
      notes: form.notes || null,
    };
    if (editing) {
      const { error } = await supabase.from("crm_leads").update(payload).eq("id", editing.id);
      if (error) {
        toast.error("Failed to update lead");
        return;
      }
      toast.success("Lead updated");
    } else {
      const { error } = await supabase.from("crm_leads").insert(payload);
      if (error) {
        toast.error("Failed to create lead");
        return;
      }
      toast.success("Lead created");
    }
    setDialogOpen(false);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this lead?")) return;
    const { error } = await supabase.from("crm_leads").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete");
      return;
    }
    toast.success("Lead deleted");
    load();
  };

  const openConvert = (lead: any) => {
    setConvertingLead(lead);
    setDealForm({
      title: lead.company ? `${lead.company} - Opportunity` : `${lead.name} - Opportunity`,
      value: "",
      expected_close_date: "",
    });
    setConvertOpen(true);
  };

  const handleConvert = async () => {
    if (!convertingLead) return;
    if (!dealForm.title.trim()) {
      toast.error("Deal title is required");
      return;
    }
    const dealPayload: any = {
      title: dealForm.title.trim(),
      value: dealForm.value ? parseFloat(dealForm.value) : 0,
      expected_close_date: dealForm.expected_close_date || null,
      stage: "prospecting",
      currency: "PKR",
      owner_id: convertingLead.assigned_to || null,
    };
    const { data: deal, error: dErr } = await supabase
      .from("crm_deals")
      .insert(dealPayload)
      .select()
      .single();
    if (dErr || !deal) {
      toast.error("Failed to create deal");
      return;
    }
    await supabase
      .from("crm_leads")
      .update({ status: "converted", converted_deal_id: deal.id })
      .eq("id", convertingLead.id);
    toast.success(`Lead converted to deal ${deal.deal_number}`);
    setConvertOpen(false);
    setConvertingLead(null);
    load();
  };

  const filtered = leads.filter((l) => {
    const matchSearch =
      !search ||
      [l.name, l.company, l.phone, l.email, l.lead_number]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(search.toLowerCase()));
    const matchStatus = statusFilter === "all" || l.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <ERPLayout>
      <PageHeader
        title="Leads"
        description="Inbound prospects pipeline"
        action={{ label: "New Lead", onClick: openCreate }}
      />

      <Card className="mb-4">
        <CardContent className="p-3 flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, company, phone, email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">
                  {s}
                </SelectItem>
              ))}
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
                  <TableHead>Lead #</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No leads found
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-xs">{l.lead_number}</TableCell>
                      <TableCell className="font-medium">{l.name}</TableCell>
                      <TableCell>{l.company || "—"}</TableCell>
                      <TableCell className="text-xs">
                        {l.phone && <div>{l.phone}</div>}
                        {l.email && <div className="text-muted-foreground">{l.email}</div>}
                      </TableCell>
                      <TableCell>{l.source || "—"}</TableCell>
                      <TableCell>
                        <Badge className={STATUS_COLORS[l.status] || ""}>
                          {l.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {users.find((u) => u.id === l.assigned_to)?.full_name || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {l.status !== "converted" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => openConvert(l)}
                              title="Convert to Deal"
                            >
                              <ArrowRightLeft className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEdit(l)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => handleDelete(l.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Lead" : "New Lead"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Company</Label>
                <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Source</Label>
                <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select source" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>—</SelectItem>
                    {SOURCES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s} className="capitalize">
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Assigned To</Label>
              <Select
                value={form.assigned_to}
                onValueChange={(v) => setForm({ ...form, assigned_to: v })}
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
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
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

      <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Convert Lead to Deal</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Deal Title *</Label>
              <Input
                value={dealForm.title}
                onChange={(e) => setDealForm({ ...dealForm, title: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Value (Rs.)</Label>
                <Input
                  type="number"
                  value={dealForm.value}
                  onChange={(e) => setDealForm({ ...dealForm, value: e.target.value })}
                />
              </div>
              <div>
                <Label>Expected Close</Label>
                <Input
                  type="date"
                  value={dealForm.expected_close_date}
                  onChange={(e) =>
                    setDealForm({ ...dealForm, expected_close_date: e.target.value })
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConvert}>Convert</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
