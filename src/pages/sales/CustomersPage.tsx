import { useState, useMemo } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Upload, Search, Image } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface Customer {
  id: string;
  code: string;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  gst_number: string | null;
  credit_limit: number | null;
  payment_terms: number | null;
  is_active: boolean;
  logo_url: string | null;
}

interface CustomerFormData {
  code: string;
  name: string;
  contact_person: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  area: string;
  gst_number: string;
  credit_limit: string;
  payment_terms: string;
  is_active: boolean;
}

const initialFormData: CustomerFormData = {
  code: '',
  name: '',
  contact_person: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  area: '',
  gst_number: '',
  credit_limit: '',
  payment_terms: '30',
  is_active: true,
};

export default function CustomersPage() {
  const queryClient = useQueryClient();
  const { hasModulePermission, roles } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLogoDialogOpen, setIsLogoDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [formData, setFormData] = useState<CustomerFormData>(initialFormData);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const isSalesExecutive = roles.some(r => r.role === 'sales_executive') && !roles.some(r => r.role === 'super_admin');
  
  const canCreate = hasModulePermission('sales', 'create');
  const canEdit = hasModulePermission('sales', 'edit') && !isSalesExecutive;
  const canDelete = hasModulePermission('sales', 'delete');

  // Fetch customers
  const { data: customers, isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .order('code', { ascending: true });

      if (error) throw error;
      return data as Customer[];
    },
  });

  // Predefined cities list
  const predefinedCities = ['Karachi', 'Lahore', 'Rawalpindi', 'Hyderabad', 'Sukkur'];

  // Get unique cities and areas from existing customers
  const existingCities = useMemo(() => {
    const customerCities = customers?.map(c => c.city).filter(Boolean) || [];
    const allCities = [...predefinedCities, ...customerCities];
    return [...new Set(allCities)].sort() as string[];
  }, [customers]);

  // Predefined areas list
  const predefinedAreas = ['Light House'];

  const existingAreas = useMemo(() => {
    const customerAreas = customers?.map(c => (c as any).area).filter(Boolean) || [];
    const allAreas = [...predefinedAreas, ...customerAreas];
    return [...new Set(allAreas)].sort() as string[];
  }, [customers]);

  // Create/Update mutation
  const saveMutation = useMutation({
    mutationFn: async (data: CustomerFormData) => {
      const payload = {
        code: data.code,
        name: data.name,
        contact_person: data.contact_person || null,
        email: data.email || null,
        phone: data.phone || null,
        address: data.address || null,
        city: data.city || null,
        area: data.area || null,
        gst_number: data.gst_number || null,
        credit_limit: data.credit_limit ? parseFloat(data.credit_limit) : null,
        payment_terms: data.payment_terms ? parseInt(data.payment_terms) : null,
        is_active: data.is_active,
      };

      if (editingCustomer) {
        const { error } = await supabase
          .from('customers')
          .update(payload)
          .eq('id', editingCustomer.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('customers')
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success(editingCustomer ? 'Customer updated' : 'Customer created');
      handleCloseDialog();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('customers')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Customer deleted');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Logo upload mutation
  const uploadLogoMutation = useMutation({
    mutationFn: async ({ customerId, file }: { customerId: string; file: File }) => {
      setUploading(true);
      const fileExt = file.name.split('.').pop();
      const fileName = `${customerId}.${fileExt}`;
      const filePath = `logos/${fileName}`;

      // Upload file
      const { error: uploadError } = await supabase.storage
        .from('customer-logos')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('customer-logos')
        .getPublicUrl(filePath);

      // Update customer
      const { error: updateError } = await supabase
        .from('customers')
        .update({ logo_url: publicUrl })
        .eq('id', customerId);

      if (updateError) throw updateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Logo uploaded successfully');
      setIsLogoDialogOpen(false);
      setLogoFile(null);
      setSelectedCustomer(null);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
    onSettled: () => {
      setUploading(false);
    },
  });

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingCustomer(null);
    setFormData(initialFormData);
  };

  const handleEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    setFormData({
      code: customer.code,
      name: customer.name,
      contact_person: customer.contact_person || '',
      email: customer.email || '',
      phone: customer.phone || '',
      address: customer.address || '',
      city: customer.city || '',
      area: (customer as any).area || '',
      gst_number: customer.gst_number || '',
      credit_limit: customer.credit_limit?.toString() || '',
      payment_terms: customer.payment_terms?.toString() || '30',
      is_active: customer.is_active ?? true,
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.code || !formData.name) {
      toast.error('Code and Name are required');
      return;
    }
    saveMutation.mutate(formData);
  };

  const handleUploadLogo = (customer: Customer) => {
    setSelectedCustomer(customer);
    setIsLogoDialogOpen(true);
  };

  const handleLogoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer || !logoFile) return;
    uploadLogoMutation.mutate({ customerId: selectedCustomer.id, file: logoFile });
  };

  const filteredCustomers = customers?.filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.contact_person?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader 
          title="Customers" 
          description="Manage customer information and logos"
        />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">Customer List</CardTitle>
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search customers..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 w-64"
                />
              </div>
              {canCreate && (
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                  <DialogTrigger asChild>
                    <Button onClick={() => { setEditingCustomer(null); setFormData(initialFormData); }}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Customer
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>{editingCustomer ? 'Edit Customer' : 'New Customer'}</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Customer Code *</Label>
                          <Input
                            value={formData.code}
                            onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                            placeholder="e.g., CUST001"
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Name *</Label>
                          <Input
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder="Customer name"
                            required
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

                      <div className="space-y-2">
                        <Label>Email</Label>
                        <Input
                          type="email"
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Address</Label>
                        <Textarea
                          value={formData.address}
                          onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                          rows={2}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>City</Label>
                          <Select 
                            value={formData.city} 
                            onValueChange={(value) => setFormData({ ...formData, city: value })}
                          >
                            <SelectTrigger className="bg-background">
                              <SelectValue placeholder="Select city" />
                            </SelectTrigger>
                            <SelectContent className="bg-background z-50">
                              {existingCities.map((city) => (
                                <SelectItem key={city} value={city}>{city}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Area</Label>
                          <Select 
                            value={formData.area} 
                            onValueChange={(value) => setFormData({ ...formData, area: value })}
                          >
                            <SelectTrigger className="bg-background">
                              <SelectValue placeholder="Select area" />
                            </SelectTrigger>
                            <SelectContent className="bg-background z-50">
                              {existingAreas.map((area) => (
                                <SelectItem key={area} value={area}>{area}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label>GST Number</Label>
                          <Input
                            value={formData.gst_number}
                            onChange={(e) => setFormData({ ...formData, gst_number: e.target.value.toUpperCase() })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Credit Limit (Rs.)</Label>
                          <Input
                            type="number"
                            value={formData.credit_limit}
                            onChange={(e) => setFormData({ ...formData, credit_limit: e.target.value })}
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
                      </div>

                      <div className="flex items-center justify-between rounded-lg border p-4">
                        <div className="space-y-0.5">
                          <Label htmlFor="is_active">Customer Status</Label>
                          <p className="text-sm text-muted-foreground">
                            {formData.is_active ? 'Active - Customer can place orders' : 'Inactive - Customer cannot place orders'}
                          </p>
                        </div>
                        <Switch
                          id="is_active"
                          checked={formData.is_active}
                          onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                        />
                      </div>

                      <div className="flex justify-end gap-2 pt-4">
                        <Button type="button" variant="outline" onClick={handleCloseDialog}>
                          Cancel
                        </Button>
                        <Button type="submit" disabled={saveMutation.isPending}>
                          {saveMutation.isPending ? 'Saving...' : 'Save'}
                        </Button>
                      </div>
                    </form>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Logo</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>City</TableHead>
                    <TableHead>GST</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8">Loading...</TableCell>
                    </TableRow>
                  ) : filteredCustomers?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        No customers found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredCustomers?.map((customer) => (
                      <TableRow key={customer.id}>
                        <TableCell>
                          {customer.logo_url ? (
                            <img 
                              src={customer.logo_url} 
                              alt={`${customer.name} logo`}
                              className="h-10 w-10 object-contain rounded border"
                            />
                          ) : (
                            <div className="h-10 w-10 bg-muted rounded border flex items-center justify-center">
                              <Image className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{customer.code}</TableCell>
                        <TableCell className="font-medium">{customer.name}</TableCell>
                        <TableCell>
                          <div className="text-sm">{customer.contact_person || '-'}</div>
                          <div className="text-xs text-muted-foreground">{customer.phone || ''}</div>
                        </TableCell>
                        <TableCell>{customer.city || '-'}</TableCell>
                        <TableCell className="font-mono text-xs">{customer.gst_number || '-'}</TableCell>
                        <TableCell>
                          <Badge variant={customer.is_active ? 'default' : 'secondary'}>
                            {customer.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {canEdit && (
                              <>
                                <Button 
                                  variant="ghost" 
                                  size="icon"
                                  onClick={() => handleUploadLogo(customer)}
                                  title="Upload Logo"
                                >
                                  <Upload className="h-4 w-4" />
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="icon"
                                  onClick={() => handleEdit(customer)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                            {canDelete && (
                              <Button 
                                variant="ghost" 
                                size="icon"
                                onClick={() => {
                                  if (confirm('Delete this customer?')) {
                                    deleteMutation.mutate(customer.id);
                                  }
                                }}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
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

        {/* Logo Upload Dialog */}
        <Dialog open={isLogoDialogOpen} onOpenChange={setIsLogoDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Upload Customer Logo</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleLogoSubmit} className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Uploading logo for: <strong>{selectedCustomer?.name}</strong>
              </div>
              
              {selectedCustomer?.logo_url && (
                <div className="p-4 border rounded-lg bg-muted/50">
                  <div className="text-xs text-muted-foreground mb-2">Current Logo:</div>
                  <img 
                    src={selectedCustomer.logo_url} 
                    alt="Current logo" 
                    className="h-20 object-contain"
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label>Select Logo File</Label>
                <Input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                />
                <p className="text-xs text-muted-foreground">
                  Recommended: PNG or JPG, max 2MB
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsLogoDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!logoFile || uploading}>
                  {uploading ? 'Uploading...' : 'Upload'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
