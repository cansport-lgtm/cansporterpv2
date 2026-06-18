import { useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Eye, ArrowRight, Search } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-500',
  sent: 'bg-blue-500',
  accepted: 'bg-green-500',
  rejected: 'bg-red-500',
  expired: 'bg-gray-500',
  converted: 'bg-purple-500',
};

export default function QuotationsPage() {
  const queryClient = useQueryClient();
  const { user, hasModulePermission } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingQuotation, setEditingQuotation] = useState<any>(null);
  const [formData, setFormData] = useState({
    customer_id: '',
    quotation_date: format(new Date(), 'yyyy-MM-dd'),
    valid_until: '',
    discount_percent: '0',
    notes: '',
    items: [] as Array<{
      product_id: string;
      grade_id: string;
      packing_type: string;
      quantity_dozens: string;
      price_per_dozen: string;
      remarks: string;
    }>,
  });

  const canCreate = hasModulePermission('sales', 'create');
  const canEdit = hasModulePermission('sales', 'edit');
  const canDelete = hasModulePermission('sales', 'delete');

  // Fetch quotations
  const { data: quotations, isLoading } = useQuery({
    queryKey: ['sales-quotations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_quotations')
        .select(`
          *,
          customers(name, code),
          created_by_user:app_users!sales_quotations_created_by_fkey(full_name)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  // Fetch customers
  const { data: customers } = useQuery({
    queryKey: ['customers-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, code, name')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  // Fetch products
  const { data: products } = useQuery({
    queryKey: ['products-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, code, name, standard_selling_price')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  // Fetch grades
  const { data: grades } = useQuery({
    queryKey: ['grades-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('grades')
        .select('id, code, name')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  // Fetch customer pricing
  const { data: customerPricing } = useQuery({
    queryKey: ['customer-pricing', formData.customer_id],
    queryFn: async () => {
      if (!formData.customer_id) return [];
      const { data, error } = await supabase
        .from('customer_pricing')
        .select('*')
        .eq('customer_id', formData.customer_id)
        .eq('is_active', true);
      if (error) throw error;
      return data;
    },
    enabled: !!formData.customer_id,
  });

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const totalAmount = data.items.reduce((sum, item) => {
        return sum + (parseFloat(item.quantity_dozens) || 0) * (parseFloat(item.price_per_dozen) || 0);
      }, 0);
      const discountPercent = parseFloat(data.discount_percent) || 0;
      const netAmount = totalAmount * (1 - discountPercent / 100);

      if (editingQuotation) {
        // Update quotation
        const { error: quotationError } = await supabase
          .from('sales_quotations')
          .update({
            customer_id: data.customer_id,
            quotation_date: data.quotation_date,
            valid_until: data.valid_until || null,
            discount_percent: discountPercent,
            total_amount: totalAmount,
            net_amount: netAmount,
            notes: data.notes || null,
          })
          .eq('id', editingQuotation.id);

        if (quotationError) throw quotationError;

        // Delete existing items
        await supabase
          .from('sales_quotation_items')
          .delete()
          .eq('quotation_id', editingQuotation.id);

        // Insert new items
        if (data.items.length > 0) {
          const items = data.items.map(item => ({
            quotation_id: editingQuotation.id,
            product_id: item.product_id || null,
            grade_id: item.grade_id || null,
            packing_type: item.packing_type || null,
            quantity_dozens: parseFloat(item.quantity_dozens) || 0,
            price_per_dozen: parseFloat(item.price_per_dozen) || 0,
            amount: (parseFloat(item.quantity_dozens) || 0) * (parseFloat(item.price_per_dozen) || 0),
            remarks: item.remarks || null,
          }));

          const { error: itemsError } = await supabase
            .from('sales_quotation_items')
            .insert(items);

          if (itemsError) throw itemsError;
        }
      } else {
        // Insert quotation
        const { data: newQuotation, error: quotationError } = await supabase
          .from('sales_quotations')
          .insert({
            quotation_number: '', // Will be auto-generated
            customer_id: data.customer_id,
            quotation_date: data.quotation_date,
            valid_until: data.valid_until || null,
            discount_percent: discountPercent,
            total_amount: totalAmount,
            net_amount: netAmount,
            notes: data.notes || null,
            created_by: user?.id,
            status: 'draft',
          })
          .select()
          .single();

        if (quotationError) throw quotationError;

        // Insert items
        if (data.items.length > 0) {
          const items = data.items.map(item => ({
            quotation_id: newQuotation.id,
            product_id: item.product_id || null,
            grade_id: item.grade_id || null,
            packing_type: item.packing_type || null,
            quantity_dozens: parseFloat(item.quantity_dozens) || 0,
            price_per_dozen: parseFloat(item.price_per_dozen) || 0,
            amount: (parseFloat(item.quantity_dozens) || 0) * (parseFloat(item.price_per_dozen) || 0),
            remarks: item.remarks || null,
          }));

          const { error: itemsError } = await supabase
            .from('sales_quotation_items')
            .insert(items);

          if (itemsError) throw itemsError;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-quotations'] });
      toast.success(editingQuotation ? 'Quotation updated' : 'Quotation created');
      handleCloseDialog();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Status update mutation
  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from('sales_quotations')
        .update({ status })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-quotations'] });
      toast.success('Status updated');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('sales_quotations')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-quotations'] });
      toast.success('Quotation deleted');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingQuotation(null);
    setFormData({
      customer_id: '',
      quotation_date: format(new Date(), 'yyyy-MM-dd'),
      valid_until: '',
      discount_percent: '0',
      notes: '',
      items: [],
    });
  };

  const addItem = () => {
    setFormData({
      ...formData,
      items: [
        ...formData.items,
        { product_id: '', grade_id: '', packing_type: '', quantity_dozens: '', price_per_dozen: '', remarks: '' },
      ],
    });
  };

  const removeItem = (index: number) => {
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index),
    });
  };

  const updateItem = (index: number, field: string, value: string) => {
    const newItems = [...formData.items];
    newItems[index] = { ...newItems[index], [field]: value };

    // Auto-fill price: customer-specific price wins; otherwise fall back to the
    // product's standard selling price so lines are never left at Rs. 0.
    if (field === 'product_id' && value) {
      const pricing = customerPricing?.find(p => p.product_id === value);
      if (pricing) {
        newItems[index].price_per_dozen = pricing.price_per_dozen.toString();
      } else {
        const product = products?.find(p => p.id === value);
        const stdPrice = Number((product as any)?.standard_selling_price) || 0;
        if (stdPrice > 0) {
          newItems[index].price_per_dozen = stdPrice.toString();
        }
      }
    }

    setFormData({ ...formData, items: newItems });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.customer_id) {
      toast.error('Please select a customer');
      return;
    }
    if (formData.items.length === 0) {
      toast.error('Please add at least one item');
      return;
    }
    // Block zero-price lines so quotations never carry Rs. 0 prices that would
    // flow into a sales order. Set a Standard Selling Price on the product or a
    // Customer Price to auto-fill, or enter a price manually.
    const zeroPriced = formData.items.find(
      (item) => (parseFloat(item.quantity_dozens) || 0) > 0 && !((parseFloat(item.price_per_dozen) || 0) > 0)
    );
    if (zeroPriced) {
      toast.error('Each item must have a price greater than zero (Rs. 0 not allowed).');
      return;
    }
    saveMutation.mutate(formData);
  };

  const calculateTotal = () => {
    const total = formData.items.reduce((sum, item) => {
      return sum + (parseFloat(item.quantity_dozens) || 0) * (parseFloat(item.price_per_dozen) || 0);
    }, 0);
    const discount = parseFloat(formData.discount_percent) || 0;
    return total * (1 - discount / 100);
  };

  const filteredQuotations = quotations?.filter(q => {
    const matchesSearch = 
      q.quotation_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.customers?.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || q.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader 
          title="Quotations" 
          description="Create and manage sales quotations"
        />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">Quotation List</CardTitle>
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search quotations..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 w-48"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="accepted">Accepted</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="converted">Converted</SelectItem>
                </SelectContent>
              </Select>
              {canCreate && (
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                  <DialogTrigger asChild>
                    <Button onClick={handleCloseDialog}>
                      <Plus className="h-4 w-4 mr-2" />
                      New Quotation
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>{editingQuotation ? 'Edit Quotation' : 'New Quotation'}</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-4">
                      <div className="grid grid-cols-4 gap-4">
                        <div className="space-y-2">
                          <Label>Customer *</Label>
                          <Select 
                            value={formData.customer_id} 
                            onValueChange={(v) => setFormData({ ...formData, customer_id: v })}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select customer" />
                            </SelectTrigger>
                            <SelectContent>
                              {customers?.map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.code} - {c.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Quotation Date</Label>
                          <Input
                            type="date"
                            value={formData.quotation_date}
                            onChange={(e) => setFormData({ ...formData, quotation_date: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Valid Until</Label>
                          <Input
                            type="date"
                            value={formData.valid_until}
                            onChange={(e) => setFormData({ ...formData, valid_until: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Discount %</Label>
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            step="0.5"
                            value={formData.discount_percent}
                            onChange={(e) => setFormData({ ...formData, discount_percent: e.target.value })}
                          />
                        </div>
                      </div>

                      {/* Items */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label>Items</Label>
                          <Button type="button" variant="outline" size="sm" onClick={addItem}>
                            <Plus className="h-4 w-4 mr-1" /> Add Item
                          </Button>
                        </div>
                        <div className="border rounded-lg overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Product</TableHead>
                                <TableHead>Grade</TableHead>
                                <TableHead>Packing</TableHead>
                                <TableHead>Qty (Dz)</TableHead>
                                <TableHead>Price/Dz</TableHead>
                                <TableHead>Amount</TableHead>
                                <TableHead></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {formData.items.length === 0 ? (
                                <TableRow>
                                  <TableCell colSpan={7} className="text-center py-4 text-muted-foreground">
                                    No items added
                                  </TableCell>
                                </TableRow>
                              ) : (
                                formData.items.map((item, index) => (
                                  <TableRow key={index}>
                                    <TableCell>
                                      <Select value={item.product_id} onValueChange={(v) => updateItem(index, 'product_id', v)}>
                                        <SelectTrigger className="w-32">
                                          <SelectValue placeholder="Select" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {products?.map((p) => (
                                            <SelectItem key={p.id} value={p.id}>{p.code}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </TableCell>
                                    <TableCell>
                                      <Select value={item.grade_id} onValueChange={(v) => updateItem(index, 'grade_id', v)}>
                                        <SelectTrigger className="w-24">
                                          <SelectValue placeholder="Select" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {grades?.map((g) => (
                                            <SelectItem key={g.id} value={g.id}>{g.code}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </TableCell>
                                    <TableCell>
                                      <Input
                                        value={item.packing_type}
                                        onChange={(e) => updateItem(index, 'packing_type', e.target.value)}
                                        className="w-24"
                                        placeholder="e.g., 12 Dz"
                                      />
                                    </TableCell>
                                    <TableCell>
                                      <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={item.quantity_dozens}
                                        onChange={(e) => updateItem(index, 'quantity_dozens', e.target.value)}
                                        className="w-20"
                                      />
                                    </TableCell>
                                    <TableCell>
                                      <Input
                                        type="number"
                                        step="0.01"
                                        value={item.price_per_dozen}
                                        onChange={(e) => updateItem(index, 'price_per_dozen', e.target.value)}
                                        className="w-24"
                                      />
                                    </TableCell>
                                    <TableCell className="font-medium">
                                      Rs. {((parseFloat(item.quantity_dozens) || 0) * (parseFloat(item.price_per_dozen) || 0)).toLocaleString()}
                                    </TableCell>
                                    <TableCell>
                                      <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(index)}>
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                ))
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      </div>

                      {/* Notes and Total */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Notes</Label>
                          <Textarea
                            value={formData.notes}
                            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                            rows={3}
                          />
                        </div>
                        <div className="space-y-2 text-right">
                          <div className="text-sm text-muted-foreground">Net Amount</div>
                          <div className="text-3xl font-bold">Rs. {calculateTotal().toLocaleString()}</div>
                        </div>
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
                    <TableHead>Quotation #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Valid Until</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created By</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8">Loading...</TableCell>
                    </TableRow>
                  ) : filteredQuotations?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        No quotations found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredQuotations?.map((quotation) => (
                      <TableRow key={quotation.id}>
                        <TableCell className="font-mono">{quotation.quotation_number}</TableCell>
                        <TableCell>{format(new Date(quotation.quotation_date), 'dd MMM yyyy')}</TableCell>
                        <TableCell>
                          <div className="font-medium">{quotation.customers?.name}</div>
                          <div className="text-xs text-muted-foreground">{quotation.customers?.code}</div>
                        </TableCell>
                        <TableCell>
                          {quotation.valid_until ? format(new Date(quotation.valid_until), 'dd MMM yyyy') : '-'}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          Rs. {Number(quotation.net_amount || 0).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Badge className={STATUS_COLORS[quotation.status]}>
                            {quotation.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {quotation.created_by_user?.full_name || '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {canEdit && quotation.status === 'draft' && (
                              <Button variant="ghost" size="icon" onClick={() => statusMutation.mutate({ id: quotation.id, status: 'sent' })} title="Mark as Sent">
                                <ArrowRight className="h-4 w-4" />
                              </Button>
                            )}
                            {canDelete && quotation.status === 'draft' && (
                              <Button 
                                variant="ghost" 
                                size="icon"
                                onClick={() => {
                                  if (confirm('Delete this quotation?')) {
                                    deleteMutation.mutate(quotation.id);
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
