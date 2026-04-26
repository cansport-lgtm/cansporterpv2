import { useEffect, useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { Pencil, Trash2, Search } from "lucide-react";
import { toast } from "sonner";

const NONE = "none";

export default function CRMContactsPage() {
  const [contacts, setContacts] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({
    full_name: "",
    designation: "",
    company: "",
    phone: "",
    email: "",
    customer_id: NONE,
    notes: "",
  });

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const [cRes, custRes] = await Promise.all([
      supabase.from("crm_contacts").select("*").order("full_name"),
      supabase.from("customers").select("id, name, code").eq("is_active", true).order("name"),
    ]);
    setContacts(cRes.data || []);
    setCustomers(custRes.data || []);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({
      full_name: "",
      designation: "",
      company: "",
      phone: "",
      email: "",
      customer_id: NONE,
      notes: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (c: any) => {
    setEditing(c);
    setForm({
      full_name: c.full_name || "",
      designation: c.designation || "",
      company: c.company || "",
      phone: c.phone || "",
      email: c.email || "",
      customer_id: c.customer_id || NONE,
      notes: c.notes || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.full_name.trim()) {
      toast.error("Name is required");
      return;
    }
    const payload: any = {
      full_name: form.full_name.trim(),
      designation: form.designation || null,
      company: form.company || null,
      phone: form.phone || null,
      email: form.email || null,
      customer_id: form.customer_id === NONE ? null : form.customer_id,
      notes: form.notes || null,
    };
    if (editing) {
      const { error } = await supabase.from("crm_contacts").update(payload).eq("id", editing.id);
      if (error) {
        toast.error("Failed to update");
        return;
      }
      toast.success("Contact updated");
    } else {
      const { error } = await supabase.from("crm_contacts").insert(payload);
      if (error) {
        toast.error("Failed to create");
        return;
      }
      toast.success("Contact created");
    }
    setDialogOpen(false);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this contact?")) return;
    const { error } = await supabase.from("crm_contacts").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete");
      return;
    }
    toast.success("Deleted");
    load();
  };

  const filtered = contacts.filter((c) => {
    if (!search) return true;
    return [c.full_name, c.company, c.phone, c.email, c.designation]
      .filter(Boolean)
      .some((v) => v.toLowerCase().includes(search.toLowerCase()));
  });

  return (
    <ERPLayout>
      <PageHeader
        title="Contacts"
        description="People directory across companies"
        action={{ label: "New Contact", onClick: openCreate }}
      />

      <Card className="mb-4">
        <CardContent className="p-3">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search contacts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Designation</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Linked Customer</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No contacts found
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.full_name}</TableCell>
                      <TableCell>{c.designation || "—"}</TableCell>
                      <TableCell>{c.company || "—"}</TableCell>
                      <TableCell>{c.phone || "—"}</TableCell>
                      <TableCell className="text-xs">{c.email || "—"}</TableCell>
                      <TableCell className="text-xs">
                        {customers.find((cu) => cu.id === c.customer_id)?.name || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEdit(c)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => handleDelete(c.id)}
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
            <DialogTitle>{editing ? "Edit Contact" : "New Contact"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Full Name *</Label>
              <Input
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Designation</Label>
                <Input
                  value={form.designation}
                  onChange={(e) => setForm({ ...form, designation: e.target.value })}
                />
              </div>
              <div>
                <Label>Company</Label>
                <Input
                  value={form.company}
                  onChange={(e) => setForm({ ...form, company: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Phone</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
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
                  {customers.map((cu) => (
                    <SelectItem key={cu.id} value={cu.id}>
                      {cu.code} — {cu.name}
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
    </ERPLayout>
  );
}
