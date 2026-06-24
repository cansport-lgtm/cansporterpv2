import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { Users, Pencil, Trash2, Search } from "lucide-react";
import { toast } from "sonner";
import { Database } from "@/integrations/supabase/types";

type DistributorCustomer = Database["public"]["Tables"]["distributor_customers"]["Row"];

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

export default function DistributorCustomersPage() {
  const queryClient = useQueryClient();
  const { user, getDistributorScope } = useAuth();
  const { isCompany, distributorId } = getDistributorScope();

  // Company staff (super_admin) choose which distributor to view; distributor users are
  // locked to their own distributor_id.
  const [selectedDistributor, setSelectedDistributor] = useState<string | null>(distributorId);
  const activeDistributorId = isCompany ? selectedDistributor : distributorId;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DistributorCustomer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DistributorCustomer | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [search, setSearch] = useState("");

  // Distributor list for the company-level selector.
  const { data: distributors = [] } = useQuery({
    queryKey: ["distributors-active"],
    enabled: isCompany,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributors")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["distributor_customers", activeDistributorId],
    enabled: !!activeDistributorId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributor_customers")
        .select("*")
        .eq("distributor_id", activeDistributorId as string)
        .order("name");
      if (error) throw error;
      return data as DistributorCustomer[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeDistributorId) throw new Error("No distributor selected");
      const payload = {
        distributor_id: activeDistributorId,
        code: form.code.trim() || null,
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
        const { error } = await supabase
          .from("distributor_customers")
          .update(payload)
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("distributor_customers")
          .insert({ ...payload, created_by: user?.id ?? null });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distributor_customers", activeDistributorId] });
      toast.success(editing ? "Customer updated" : "Customer created");
      setDialogOpen(false);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to save customer"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("distributor_customers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distributor_customers", activeDistributorId] });
      toast.success("Customer deleted");
      setDeleteTarget(null);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to delete customer"),
  });

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setDialogOpen(true);
  };

  const openEdit = (c: DistributorCustomer) => {
    setEditing(c);
    setForm({
      code: c.code ?? "",
      name: c.name,
      contact_person: c.contact_person ?? "",
      phone: c.phone ?? "",
      email: c.email ?? "",
      address: c.address ?? "",
      city: c.city ?? "",
      area: c.area ?? "",
      is_active: c.is_active,
      notes: c.notes ?? "",
    });
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!form.name.trim()) {
      toast.error("Customer name is required");
      return;
    }
    saveMutation.mutate();
  };

  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.code ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (c.city ?? "").toLowerCase().includes(search.toLowerCase())
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
      render: (c: DistributorCustomer) => (
        <StatusBadge status={c.is_active ? "approved" : "rejected"} />
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (c: DistributorCustomer) => (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => openEdit(c)}>
            <Pencil className="h-3 w-3 mr-1" /> Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteTarget(c)}
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
        title="Customers"
        description="Your distributor's own customers. These are separate from the company's customers."
        icon={Users}
        action={activeDistributorId ? { label: "New Customer", onClick: openNew } : undefined}
      />

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-4 justify-between">
          {isCompany && (
            <div className="w-full sm:w-72">
              <Select
                value={selectedDistributor ?? ""}
                onValueChange={(v) => setSelectedDistributor(v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a distributor..." />
                </SelectTrigger>
                <SelectContent>
                  {distributors.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name} ({d.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search customers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {!activeDistributorId ? (
          <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
            {isCompany
              ? "Select a distributor to view their customers."
              : "Your account is not linked to a distributor. Contact your administrator."}
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={filtered}
            emptyMessage={isLoading ? "Loading..." : "No customers yet"}
          />
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Customer" : "New Customer"}</DialogTitle>
            <DialogDescription>Customer details</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="code">Code</Label>
                <Input id="code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="Optional" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
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
            <AlertDialogTitle>Delete Customer</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <strong>{deleteTarget?.name}</strong>? This cannot be undone.
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
