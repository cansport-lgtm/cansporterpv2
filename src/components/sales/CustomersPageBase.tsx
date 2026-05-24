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
import { Plus, Pencil, Trash2, Search, Image, Printer } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";

type SalesSegment = Database["public"]["Enums"]["sales_segment"];

interface Customer {
  id: string;
  code: string;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  area?: string | null;
  billing_customer: string | null;
  gst_number: string | null;
  credit_limit: number | null;
  payment_terms: number | null;
  is_active: boolean;
  logo_url: string | null;
  sales_segment: SalesSegment;
  customer_category?: string | null;
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
  billing_customer: string;
  gst_number: string;
  credit_limit: string;
  payment_terms: string;
  is_active: boolean;
  customer_category: string;
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
  billing_customer: '',
  gst_number: '',
  credit_limit: '',
  payment_terms: '30',
  is_active: true,
  customer_category: '',
};

interface CustomersPageBaseProps {
  segment: SalesSegment;
  title: string;
}

export default function CustomersPageBase({ segment, title }: CustomersPageBaseProps) {
  const queryClient = useQueryClient();
  const { hasModulePermission, roles } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [cityFilter, setCityFilter] = useState<string>('all');
  const [areaFilter, setAreaFilter] = useState<string>('all');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [formData, setFormData] = useState<CustomerFormData>(initialFormData);

  const isSuperAdmin = roles.some(r => r.role === 'super_admin');
  const isSalesExecutive = roles.some(r => r.role === 'sales_executive') && !isSuperAdmin;
  
  const canCreate = hasModulePermission('sales', 'create');
  const canEdit = hasModulePermission('sales', 'edit') && !isSalesExecutive;
  const canDelete = hasModulePermission('sales', 'delete');

  const handlePrintCustomerList = () => {
    if (!filteredCustomers?.length) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <html><head><title>${title} - Customer List</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 11px; margin: 20px; }
        h2 { margin-bottom: 5px; }
        .date { color: #666; margin-bottom: 15px; font-size: 10px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
        th { background: #f0f0f0; font-weight: bold; }
        .billing { color: #2563eb; font-weight: bold; }
        @media print { body { margin: 10px; } }
      </style></head><body>
      <h2>${title}</h2>
      <div class="date">Printed: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</div>
      <table>
        <thead><tr>
          <th>#</th><th>Code</th><th>Name</th><th>Billing Customer</th>
          ${segment === 'private_label' ? '<th>Category</th>' : ''}
          <th>Contact</th><th>Phone</th><th>City</th><th>Area</th>
          <th>Credit Limit</th><th>Status</th>
        </tr></thead>
        <tbody>
          ${filteredCustomers.map((c, i) => `<tr>
            <td>${i + 1}</td>
            <td>${c.code}</td>
            <td>${c.name}</td>
            <td class="billing">${c.billing_customer || '-'}</td>
            ${segment === 'private_label' ? `<td>${c.customer_category || '-'}</td>` : ''}
            <td>${c.contact_person || '-'}</td>
            <td>${c.phone || '-'}</td>
            <td>${c.city || '-'}</td>
            <td>${c.area || '-'}</td>
            <td>${c.credit_limit ? 'Rs. ' + c.credit_limit.toLocaleString() : '-'}</td>
            <td>${c.is_active ? 'Active' : 'Inactive'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="date" style="margin-top:10px;">Total: ${filteredCustomers.length} customers</div>
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  // Fetch customers for this segment
  const { data: customers, isLoading } = useQuery({
    queryKey: ['customers', segment],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('sales_segment', segment)
        .order('code', { ascending: true });

      if (error) throw error;
      return data as Customer[];
    },
  });

  // Master cities/areas
  const { data: masterCities } = useQuery({
    queryKey: ["sales_cities_master"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_cities" as any).select("id,name,is_active").order("name");
      if (error) throw error;
      return data as unknown as { id: string; name: string; is_active: boolean }[];
    },
  });
  const { data: masterAreas } = useQuery({
    queryKey: ["sales_areas_master"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_areas" as any).select("id,name,city_id,is_active").order("name");
      if (error) throw error;
      return data as unknown as { id: string; name: string; city_id: string | null; is_active: boolean }[];
    },
  });

  const existingCities = useMemo(() => {
    const masterNames = (masterCities || []).filter(c => c.is_active).map(c => c.name);
    const customerCities = customers?.map(c => c.city).filter(Boolean) || [];
    return [...new Set([...masterNames, ...customerCities])].sort() as string[];
  }, [customers, masterCities]);

  const selectedCityId = useMemo(() => masterCities?.find(c => c.name === formData.city)?.id, [masterCities, formData.city]);

  const existingAreas = useMemo(() => {
    const masterFiltered = (masterAreas || []).filter(a => a.is_active && (!selectedCityId || !a.city_id || a.city_id === selectedCityId));
    const masterNames = masterFiltered.map(a => a.name);
    const customerAreas = customers?.map(c => c.area).filter(Boolean) || [];
    return [...new Set([...masterNames, ...customerAreas])].sort() as string[];
  }, [customers, masterAreas, selectedCityId]);

  const { data: masterCategories } = useQuery({
    queryKey: ["sales_customer_categories_master"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_customer_categories" as any).select("id,name,is_active").order("name");
      if (error) throw error;
      return data as unknown as { id: string; name: string; is_active: boolean }[];
    },
    enabled: segment === 'private_label',
  });

  const existingCategories = useMemo(() => {
    const masterNames = (masterCategories || []).filter(c => c.is_active).map(c => c.name);
    const customerCats = customers?.map(c => c.customer_category).filter(Boolean) as string[] || [];
    const merged = [...new Set([...masterNames, ...customerCats])];
    return merged.length ? merged.sort() : ['A', 'B', 'C', 'D'];
  }, [customers, masterCategories]);


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
        billing_customer: data.billing_customer || null,
        gst_number: data.gst_number || null,
        credit_limit: data.credit_limit ? parseFloat(data.credit_limit) : null,
        payment_terms: data.payment_terms ? parseInt(data.payment_terms) : null,
        is_active: data.is_active,
        sales_segment: segment,
        ...(segment === 'private_label' ? { customer_category: data.customer_category || null } : {}),
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
      queryClient.invalidateQueries({ queryKey: ['customers', segment] });
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
      queryClient.invalidateQueries({ queryKey: ['customers', segment] });
      toast.success('Customer deleted');
    },
    onError: (error: Error) => {
      toast.error(error.message);
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
      area: customer.area || '',
      billing_customer: (customer as any).billing_customer || '',
      gst_number: customer.gst_number || '',
      credit_limit: customer.credit_limit?.toString() || '',
      payment_terms: customer.payment_terms?.toString() || '30',
      is_active: customer.is_active ?? true,
      customer_category: customer.customer_category || '',
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

  const filteredCustomers = customers?.filter(c => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.contact_person?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCity = cityFilter === 'all' || (c.city || '') === cityFilter;
    const matchesArea = areaFilter === 'all' || (c.area || '') === areaFilter;
    return matchesSearch && matchesCity && matchesArea;
  });

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader 
          title={title}
          description="Manage customer information"
        />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">Customer List</CardTitle>
            <div className="flex items-center gap-4">
              {isSuperAdmin && (
                <Button variant="outline" size="sm" onClick={handlePrintCustomerList}>
                  <Printer className="h-4 w-4 mr-2" />
                  Print
                </Button>
              )}
              <Select value={cityFilter} onValueChange={setCityFilter}>
                <SelectTrigger className="w-36 bg-background">
                  <SelectValue placeholder="All cities" />
                </SelectTrigger>
                <SelectContent className="bg-background z-50">
                  <SelectItem value="all">All Cities</SelectItem>
                  {existingCities.map((city) => (
                    <SelectItem key={city} value={city}>{city}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={areaFilter} onValueChange={setAreaFilter}>
                <SelectTrigger className="w-36 bg-background">
                  <SelectValue placeholder="All areas" />
                </SelectTrigger>
                <SelectContent className="bg-background z-50">
                  <SelectItem value="all">All Areas</SelectItem>
                  {existingAreas.map((area) => (
                    <SelectItem key={area} value={area}>{area}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

                      <div className="space-y-2">
                        <Label>Billing Customer</Label>
                        <Input
                          value={formData.billing_customer}
                          onChange={(e) => setFormData({ ...formData, billing_customer: e.target.value })}
                          placeholder="Billing customer name"
                        />
                      </div>

                      {segment === 'private_label' && (
                        <div className="space-y-2">
                          <Label>Customer Category</Label>
                          <Select
                            value={formData.customer_category || 'none'}
                            onValueChange={(value) => setFormData({ ...formData, customer_category: value === 'none' ? '' : value })}
                          >
                            <SelectTrigger className="bg-background">
                              <SelectValue placeholder="Select category" />
                            </SelectTrigger>
                            <SelectContent className="bg-background z-50">
                              <SelectItem value="none">— None —</SelectItem>
                              {existingCategories.map((cat) => (
                                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

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
                    <TableHead>Billing Customer</TableHead>
                    {segment === 'private_label' && <TableHead>Category</TableHead>}
                    <TableHead>Contact</TableHead>
                    <TableHead>City</TableHead>
                    <TableHead>Credit Limit</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={segment === 'private_label' ? 10 : 9} className="text-center py-8">Loading...</TableCell>
                    </TableRow>
                  ) : filteredCustomers?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={segment === 'private_label' ? 10 : 9} className="text-center py-8 text-muted-foreground">
                        No customers found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredCustomers?.map((customer) => (
                      <TableRow key={customer.id}>
                        <TableCell>
                          {customer.logo_url ? (
                            <img src={customer.logo_url} alt="" className="h-8 w-8 object-contain rounded" />
                          ) : (
                            <div className="h-8 w-8 bg-muted rounded flex items-center justify-center">
                              <Image className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono">{customer.code}</TableCell>
                        <TableCell className="font-medium">{customer.name}</TableCell>
                        <TableCell className="text-blue-600 font-medium">{(customer as any).billing_customer || '-'}</TableCell>
                        {segment === 'private_label' && (
                          <TableCell>
                            {customer.customer_category ? (
                              <Badge variant="outline" className="font-mono">{customer.customer_category}</Badge>
                            ) : '-'}
                          </TableCell>
                        )}
                        <TableCell>
                          <div className="text-sm">
                            {customer.contact_person && <div>{customer.contact_person}</div>}
                            {customer.phone && <div className="text-muted-foreground">{customer.phone}</div>}
                          </div>
                        </TableCell>
                        <TableCell>{customer.city || '-'}</TableCell>
                        <TableCell>
                          {customer.credit_limit ? `Rs. ${customer.credit_limit.toLocaleString()}` : '-'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={customer.is_active ? 'default' : 'secondary'}>
                            {customer.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {canEdit && (
                              <Button variant="ghost" size="icon" onClick={() => handleEdit(customer)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
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
      </div>
    </ERPLayout>
  );
}
