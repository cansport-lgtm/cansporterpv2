import { useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";

type PurchaseCategory = Database["public"]["Enums"]["purchase_category"];

interface Column<T> {
  key: keyof T | string;
  header: string;
  render?: (item: T) => React.ReactNode;
  className?: string;
}

interface Supplier {
  id: string;
  code: string;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  gst_number: string | null;
  payment_terms: number | null;
  lead_time_days: number | null;
  categories: PurchaseCategory[] | null;
  is_active: boolean;
  accounting_party_id: string | null;
}

const CATEGORIES: { value: PurchaseCategory; label: string }[] = [
  { value: "raw_material", label: "Raw Material" },
  { value: "office_supplies", label: "Office Supplies" },
  { value: "general_supplies", label: "General Supplies" },
  { value: "spare_maintenance", label: "Spare & Maintenance" },
];

export default function SuppliersPage() {
  const queryClient = useQueryClient();
  const { hasModulePermission } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    contact_person: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    gst_number: '',
    payment_terms: '',
    lead_time_days: '',
    categories: [] as PurchaseCategory[],
    is_active: true,
  });

  const canCreate = hasModulePermission('purchase', 'create');
  const canEdit = hasModulePermission('purchase', 'edit');
  const canDelete = hasModulePermission('purchase', 'delete');

  const { data: suppliers, isLoading } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('suppliers')
        .select('*')
        .order('code');
      if (error) throw error;
      return data as Supplier[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      // `sb` bypasses the generated types for the accounting bridge columns/table.
      const sb = supabase as any;
      const payload = {
        code: data.code,
        name: data.name,
        contact_person: data.contact_person || null,
        email: data.email || null,
        phone: data.phone || null,
        address: data.address || null,
        city: data.city || null,
        gst_number: data.gst_number || null,
        payment_terms: data.payment_terms ? parseInt(data.payment_terms) : null,
        lead_time_days: data.lead_time_days ? parseInt(data.lead_time_days) : null,
        categories: data.categories.length > 0 ? data.categories : null,
        is_active: data.is_active,
      };

      if (selectedSupplier) {
        const { error } = await supabase
          .from('suppliers')
          .update(payload)
          .eq('id', selectedSupplier.id);
        if (error) throw error;

        // Keep the linked accounting party in sync so it shows correctly in AP.
        // (code left NULL to match party convention + avoid UNIQUE(code) clashes)
        if (selectedSupplier.accounting_party_id) {
          await sb
            .from('accounting_parties')
            .update({ name: data.name, is_active: data.is_active })
            .eq('id', selectedSupplier.accounting_party_id);
        } else {
          const { data: party } = await sb
            .from('accounting_parties')
            .insert({ name: data.name, code: null, party_type: 'supplier', is_active: data.is_active })
            .select('id')
            .single();
          if (party) {
            await sb.from('suppliers').update({ accounting_party_id: party.id }).eq('id', selectedSupplier.id);
          }
        }
      } else {
        // Create the accounting party first, then link it on the supplier so the
        // new vendor appears in the Accounts Payable list immediately.
        const { data: party, error: partyError } = await sb
          .from('accounting_parties')
          .insert({ name: data.name, code: null, party_type: 'supplier', is_active: data.is_active })
          .select('id')
          .single();
        if (partyError) throw partyError;

        const { error } = await sb
          .from('suppliers')
          .insert({ ...payload, accounting_party_id: party?.id ?? null });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success(selectedSupplier ? 'Supplier updated' : 'Supplier created');
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to save supplier');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('suppliers')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success('Supplier deleted');
      setDeleteDialogOpen(false);
      setSelectedSupplier(null);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to delete supplier');
    },
  });

  const resetForm = () => {
    setFormData({
      code: '',
      name: '',
      contact_person: '',
      email: '',
      phone: '',
      address: '',
      city: '',
      gst_number: '',
      payment_terms: '',
      lead_time_days: '',
      categories: [],
      is_active: true,
    });
    setSelectedSupplier(null);
    setDialogOpen(false);
  };

  const handleEdit = (supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setFormData({
      code: supplier.code,
      name: supplier.name,
      contact_person: supplier.contact_person || '',
      email: supplier.email || '',
      phone: supplier.phone || '',
      address: supplier.address || '',
      city: supplier.city || '',
      gst_number: supplier.gst_number || '',
      payment_terms: supplier.payment_terms?.toString() || '',
      lead_time_days: supplier.lead_time_days?.toString() || '',
      categories: supplier.categories || [],
      is_active: supplier.is_active,
    });
    setDialogOpen(true);
  };

  const handleDelete = (supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setDeleteDialogOpen(true);
  };

  const toggleCategory = (category: PurchaseCategory) => {
    setFormData(prev => ({
      ...prev,
      categories: prev.categories.includes(category)
        ? prev.categories.filter(c => c !== category)
        : [...prev.categories, category],
    }));
  };

  const columns: Column<Supplier>[] = [
    { key: 'code', header: 'Code' },
    { key: 'name', header: 'Name' },
    { key: 'contact_person', header: 'Contact Person' },
    { key: 'phone', header: 'Phone' },
    { key: 'city', header: 'City' },
    {
      key: 'categories',
      header: 'Categories',
      render: (supplier) => (
        <div className="flex flex-wrap gap-1">
          {supplier.categories?.map(cat => (
            <Badge key={cat} variant="outline" className="text-xs">
              {CATEGORIES.find(c => c.value === cat)?.label || cat}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: 'is_active',
      header: 'Status',
      render: (supplier) => (
        <Badge variant={supplier.is_active ? 'default' : 'secondary'}>
          {supplier.is_active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'id',
      header: 'Actions',
      render: (supplier) => (
        <div className="flex gap-2">
          {canEdit && (
            <Button variant="ghost" size="icon" onClick={() => handleEdit(supplier)}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {canDelete && (
            <Button variant="ghost" size="icon" onClick={() => handleDelete(supplier)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <ERPLayout>
      <PageHeader
        title="Suppliers"
        description="Manage supplier master data"
      >
        {canCreate && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => { resetForm(); setDialogOpen(true); }}>
                <Plus className="mr-2 h-4 w-4" /> Add Supplier
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{selectedSupplier ? 'Edit' : 'Add'} Supplier</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Code *</Label>
                    <Input
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                      placeholder="SUP-001"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Name *</Label>
                    <Input
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Supplier Name"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Contact Person</Label>
                    <Input
                      value={formData.contact_person}
                      onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Phone</Label>
                    <Input
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>City</Label>
                    <Input
                      value={formData.city}
                      onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Address</Label>
                  <Textarea
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    rows={2}
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>GST Number</Label>
                    <Input
                      value={formData.gst_number}
                      onChange={(e) => setFormData({ ...formData, gst_number: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Payment Terms (Days)</Label>
                    <Input
                      type="number"
                      value={formData.payment_terms}
                      onChange={(e) => setFormData({ ...formData, payment_terms: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Lead Time (Days)</Label>
                    <Input
                      type="number"
                      value={formData.lead_time_days}
                      onChange={(e) => setFormData({ ...formData, lead_time_days: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Categories</Label>
                  <div className="flex flex-wrap gap-4 pt-2">
                    {CATEGORIES.map(cat => (
                      <div key={cat.value} className="flex items-center space-x-2">
                        <Checkbox
                          id={cat.value}
                          checked={formData.categories.includes(cat.value)}
                          onCheckedChange={() => toggleCategory(cat.value)}
                        />
                        <label htmlFor={cat.value} className="text-sm">{cat.label}</label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    checked={formData.is_active}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                  />
                  <Label>Active</Label>
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button variant="outline" onClick={resetForm}>Cancel</Button>
                  <Button
                    onClick={() => saveMutation.mutate(formData)}
                    disabled={!formData.code || !formData.name || saveMutation.isPending}
                  >
                    {saveMutation.isPending ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </PageHeader>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={suppliers || []}
        />
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Supplier</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedSupplier?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedSupplier && deleteMutation.mutate(selectedSupplier.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ERPLayout>
  );
}