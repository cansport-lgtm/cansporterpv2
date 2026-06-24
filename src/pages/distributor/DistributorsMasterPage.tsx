import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Building, Pencil, Trash2, Search } from "lucide-react";
import { toast } from "sonner";
import { Database } from "@/integrations/supabase/types";

type Distributor = Database["public"]["Tables"]["distributors"]["Row"];

const emptyForm = {
  code: "",
  name: "",
  contact_person: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  area: "",
  is_active: true,
  notes: "",
};

export default function DistributorsMasterPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Distributor | null>(null);
  const [editing, setEditing] = useState<Distributor | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [search, setSearch] = useState("");

  const { data: distributors = [], isLoading } = useQuery({
    queryKey: ["distributors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributors")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as Distributor[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        contact_person: form.contact_person.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        area: form.area.trim() || null,
        is_active: form.is_active,
        notes: form.notes.trim() || null,
      };
      if (editing) {
        const { error } = await supabase.from("distributors").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("distributors").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distributors"] });
      toast.success(editing ? "Distributor updated" : "Distributor created");
      setDialogOpen(false);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to save distributor"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("distributors").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distributors"] });
      toast.success("Distributor deleted");
      setDeleteTarget(null);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to delete distributor"),
  });

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setDialogOpen(true);
  };

  const openEdit = (d: Distributor) => {
    setEditing(d);
    setForm({
      code: d.code,
      name: d.name,
      contact_person: d.contact_person ?? "",
      phone: d.phone ?? "",
      email: d.email ?? "",
      address: d.address ?? "",
      city: d.city ?? "",
      area: d.area ?? "",
      is_active: d.is_active,
      notes: d.notes ?? "",
    });
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!form.code.trim() || !form.name.trim()) {
      toast.error("Code and Name are required");
      return;
    }
    saveMutation.mutate();
  };

  const filtered = distributors.filter(
    (d) =>
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.code.toLowerCase().includes(search.toLowerCase()) ||
      (d.city ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const columns = [
    { key: "code", header: "Code" },
    { key: "name", header: "Name" },
    { key: "contact_person", header: "Contact" },
    { key: "phone", header: "Phone" },
    { key: "city", header: "City" },
    {
      key: "is_active",
      header: "Status",
      render: (d: Distributor) => <StatusBadge status={d.is_active ? "approved" : "rejected"} />,
    },
    {
      key: "actions",
      header: "Actions",
      render: (d: Distributor) => (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => openEdit(d)}>
            <Pencil className="h-3 w-3 mr-1" /> Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteTarget(d)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <ERPLayout>
      <PageHeader
        title="Distributors"
        description="Manage distributor companies. Each distributor's team only sees their own data."
        icon={Building}
        action={{ label: "New Distributor", onClick: openNew }}
      />

      <div className="space-y-4">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search distributors..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <DataTable
          columns={columns}
          data={filtered}
          emptyMessage={isLoading ? "Loading..." : "No distributors yet"}
        />
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Distributor" : "New Distributor"}</DialogTitle>
            <DialogDescription>Distributor company details</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="code">Code *</Label>
                <Input id="code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. DIST-01" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Distributor name" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="contact_person">Contact Person</Label>
                <Input id="contact_person" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input id="city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="area">Area / Region</Label>
                <Input id="area" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
              </div>
              <div className="flex items-center gap-2 pt-7">
                <Switch id="is_active" checked={form.is_active} onCheckedChange={(c) => setForm({ ...form, is_active: c })} />
                <Label htmlFor="is_active">Active</Label>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Input id="address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Input id="notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {editing ? "Save Changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Distributor</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <strong>{deleteTarget?.name}</strong>? This also removes their customers and
              unlinks their users. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ERPLayout>
  );
}
