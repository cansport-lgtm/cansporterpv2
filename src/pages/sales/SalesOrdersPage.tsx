import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
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
import { Plus, Trash2, Search, Eye, Pencil, ChevronDown, ChevronRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileSalesOrderForm } from "@/components/sales/MobileSalesOrderForm";

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-500',
  confirmed: 'bg-blue-500',
  in_production: 'bg-amber-500',
  ready: 'bg-cyan-500',
  partially_dispatched: 'bg-purple-500',
  dispatched: 'bg-green-500',
  delivered: 'bg-emerald-600',
  cancelled: 'bg-red-500',
};

export default function SalesOrdersPage() {
  const queryClient = useQueryClient();
  const { user, hasModulePermission } = useAuth();
  const isMobile = useIsMobile();
  const location = useLocation();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [viewOrder, setViewOrder] = useState<any>(null);
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<{ id: string; code: string; name: string; description: string } | null>(null);
  const [newProduct, setNewProduct] = useState({ code: '', name: '', description: '' });
  const [formData, setFormData] = useState({
    customer_id: '',
    order_date: format(new Date(), 'yyyy-MM-dd'),
    required_date: '',
    discount_percent: '0',
    payment_terms: '',
    shipping_address: '',
    notes: '',
    items: [] as Array<{
      product_id: string;
      quantity_dozens: string;
      price_per_dozen: string;
      remarks: string;
    }>,
  });

  const canCreate = hasModulePermission('sales', 'create');
  const canEdit = hasModulePermission('sales', 'edit');
  const canDelete = hasModulePermission('sales', 'delete');

  // Handle navigation state to open new order dialog
  useEffect(() => {
    if (location.state?.openNewOrder && canCreate) {
      setIsDialogOpen(true);
      // Clear the state to prevent reopening on refresh
      window.history.replaceState({}, document.title);
    }
  }, [location.state, canCreate]);

  // Fetch orders
  const { data: orders, isLoading } = useQuery({
    queryKey: ['sales-orders-private-label'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_orders')
        .select(`
          *,
          customers(name, code, logo_url),
          created_by_user:app_users!sales_orders_created_by_fkey(full_name)
        `)
        .eq('sales_segment', 'private_label')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  // Fetch order items for viewing
  const { data: orderItems } = useQuery({
    queryKey: ['sales-order-items', viewOrder?.id],
    queryFn: async () => {
      if (!viewOrder?.id) return [];
      const { data, error } = await supabase
        .from('sales_order_items')
        .select(`
          *,
          products(code, name),
          grades(code, name)
        `)
        .eq('order_id', viewOrder.id);

      if (error) throw error;
      return data;
    },
    enabled: !!viewOrder?.id,
  });

  // Fetch ALL order items for inline list view
  const allOrderIds = orders?.map(o => o.id) || [];
  const { data: allOrderItems } = useQuery({
    queryKey: ['all-sales-order-items', 'private_label', allOrderIds.join(',')],
    queryFn: async () => {
      if (allOrderIds.length === 0) return [];
      const { data, error } = await supabase
        .from('sales_order_items')
        .select(`*, products(code, name)`)
        .in('order_id', allOrderIds);
      if (error) throw error;
      return data;
    },
    enabled: allOrderIds.length > 0,
  });

  const toggleExpand = (orderId: string) => {
    setExpandedOrders(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const getOrderItems = (orderId: string) => {
    return allOrderItems?.filter((item: any) => item.order_id === orderId) || [];
  };

  // Fetch customers (private label only)
  const { data: customers } = useQuery({
    queryKey: ['customers-private-label-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, code, name, address, payment_terms')
        .eq('is_active', true)
        .eq('sales_segment', 'private_label')
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

      // Insert order
      const { data: newOrder, error: orderError } = await supabase
        .from('sales_orders')
        .insert({
          order_number: '', // Will be auto-generated
          customer_id: data.customer_id,
          order_date: data.order_date,
          required_date: data.required_date || null,
          discount_percent: discountPercent,
          total_amount: totalAmount,
          net_amount: netAmount,
          payment_terms: data.payment_terms || null,
          shipping_address: data.shipping_address || null,
          notes: data.notes || null,
          created_by: user?.id,
          status: 'draft',
          sales_segment: 'private_label',
        })
        .select()
        .single();

      if (orderError) throw orderError;

      // Insert items
      if (data.items.length > 0) {
        const items = data.items.map(item => ({
          order_id: newOrder.id,
          product_id: item.product_id || null,
          grade_id: null,
          packing_type: null,
          quantity_dozens: parseFloat(item.quantity_dozens) || 0,
          price_per_dozen: parseFloat(item.price_per_dozen) || 0,
          amount: (parseFloat(item.quantity_dozens) || 0) * (parseFloat(item.price_per_dozen) || 0),
          remarks: item.remarks || null,
        }));

        const { error: itemsError } = await supabase
          .from('sales_order_items')
          .insert(items);

        if (itemsError) throw itemsError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      toast.success('Order created');
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
        .from('sales_orders')
        .update({ status })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
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
        .from('sales_orders')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      toast.success('Order deleted');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Add product mutation
  const addProductMutation = useMutation({
    mutationFn: async (productData: typeof newProduct) => {
      // Check if product code already exists (including inactive products)
      const { data: existingProduct } = await supabase
        .from('products')
        .select('id, is_active')
        .eq('code', productData.code)
        .maybeSingle();

      if (existingProduct) {
        if (!existingProduct.is_active) {
          // Reactivate the inactive product
          const { data, error } = await supabase
            .from('products')
            .update({
              name: productData.name,
              description: productData.description || null,
              is_active: true,
            })
            .eq('id', existingProduct.id)
            .select()
            .single();
          if (error) throw error;
          return data;
        }
        throw new Error('Product code already exists. Please use a different code.');
      }

      const { data, error } = await supabase
        .from('products')
        .insert({
          code: productData.code,
          name: productData.name,
          description: productData.description || null,
          is_active: true,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['products-active'] });
      toast.success('Product added');
      setIsAddProductOpen(false);
      setNewProduct({ code: '', name: '', description: '' });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Edit product mutation
  const editProductMutation = useMutation({
    mutationFn: async (productData: { id: string; code: string; name: string; description: string }) => {
      const { error } = await supabase
        .from('products')
        .update({
          code: productData.code,
          name: productData.name,
          description: productData.description || null,
        })
        .eq('id', productData.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products-active'] });
      toast.success('Product updated');
      setEditingProduct(null);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Delete product mutation
  const deleteProductMutation = useMutation({
    mutationFn: async (productId: string) => {
      const { error } = await supabase
        .from('products')
        .update({ is_active: false })
        .eq('id', productId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products-active'] });
      toast.success('Product deleted');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setFormData({
      customer_id: '',
      order_date: format(new Date(), 'yyyy-MM-dd'),
      required_date: '',
      discount_percent: '0',
      payment_terms: '',
      shipping_address: '',
      notes: '',
      items: [],
    });
  };

  const handleCustomerChange = (customerId: string) => {
    const customer = customers?.find(c => c.id === customerId);
    setFormData({
      ...formData,
      customer_id: customerId,
      shipping_address: customer?.address || '',
      payment_terms: customer?.payment_terms?.toString() || '',
    });
  };

  const addItem = () => {
    setFormData({
      ...formData,
      items: [
        ...formData.items,
        { product_id: '', quantity_dozens: '', price_per_dozen: '', remarks: '' },
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
    // Block zero-price lines — a priced quantity with no price posts COGS but no
    // revenue/AR at dispatch. Set a Standard Selling Price on the product or a
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

  const filteredOrders = orders?.filter(o => {
    const matchesSearch = 
      o.order_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      o.customers?.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || o.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader 
          title="Private Label Sales Order" 
          description="Manage customer sales orders"
        />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">Order List</CardTitle>
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search orders..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 w-48"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="in_production">In Production</SelectItem>
                  <SelectItem value="ready">Ready</SelectItem>
                  <SelectItem value="partially_dispatched">Partially Dispatched</SelectItem>
                  <SelectItem value="dispatched">Dispatched</SelectItem>
                  <SelectItem value="delivered">Delivered</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              {canCreate && (
                <>
                  {/* Mobile: Full-screen form */}
                  {isMobile && isDialogOpen && (
                    <MobileSalesOrderForm
                      formData={formData}
                      setFormData={setFormData}
                      customers={customers}
                      products={products}
                      customerPricing={customerPricing}
                      onSubmit={handleSubmit}
                      onCancel={handleCloseDialog}
                      isPending={saveMutation.isPending}
                      onAddProduct={() => setIsAddProductOpen(true)}
                    />
                  )}

                  {/* Mobile: Button to open form */}
                  {isMobile && !isDialogOpen && (
                    <Button onClick={() => setIsDialogOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      New Order
                    </Button>
                  )}

                  {/* Desktop: Dialog form */}
                  {!isMobile && (
                    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                      <DialogTrigger asChild>
                        <Button onClick={handleCloseDialog}>
                          <Plus className="h-4 w-4 mr-2" />
                          New Order
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle>New Sales Order</DialogTitle>
                        </DialogHeader>
                        <form onSubmit={handleSubmit} className="space-y-4">
                          {/* Customer and Dates - Responsive Grid */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            <div className="space-y-2 sm:col-span-2 lg:col-span-1">
                              <Label>Customer *</Label>
                              <Select 
                                value={formData.customer_id} 
                                onValueChange={handleCustomerChange}
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
                              <Label>Order Date</Label>
                              <Input
                                type="date"
                                value={formData.order_date}
                                onChange={(e) => setFormData({ ...formData, order_date: e.target.value })}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Required Date</Label>
                              <Input
                                type="date"
                                value={formData.required_date}
                                onChange={(e) => setFormData({ ...formData, required_date: e.target.value })}
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

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label>Payment Terms (Days)</Label>
                              <Input
                                value={formData.payment_terms}
                                onChange={(e) => setFormData({ ...formData, payment_terms: e.target.value })}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Shipping Address</Label>
                              <Textarea
                                value={formData.shipping_address}
                                onChange={(e) => setFormData({ ...formData, shipping_address: e.target.value })}
                                rows={2}
                              />
                            </div>
                          </div>

                          {/* Items */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label>Order Items</Label>
                              <Button 
                                type="button" 
                                variant="default" 
                                size="sm" 
                                onClick={addItem}
                              >
                                <Plus className="h-4 w-4 mr-1" /> Add Item
                              </Button>
                            </div>
                            
                            <div className="border rounded-lg overflow-hidden">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Product</TableHead>
                                    <TableHead>Qty (Dz)</TableHead>
                                    <TableHead>Price/Dz</TableHead>
                                    <TableHead>Amount</TableHead>
                                    <TableHead></TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {formData.items.length === 0 ? (
                                    <TableRow>
                                      <TableCell colSpan={5} className="text-center py-4 text-muted-foreground">
                                        No items added
                                      </TableCell>
                                    </TableRow>
                                  ) : (
                                    formData.items.map((item, index) => (
                                      <TableRow key={index}>
                                        <TableCell>
                                          <div className="flex items-center gap-1">
                                            <Select value={item.product_id} onValueChange={(v) => updateItem(index, 'product_id', v)}>
                                              <SelectTrigger className="w-48">
                                                <SelectValue placeholder="Select Product" />
                                              </SelectTrigger>
                                              <SelectContent className="min-w-[200px]">
                                                {products?.map((p) => (
                                                  <SelectItem key={p.id} value={p.id}>{p.code} - {p.name}</SelectItem>
                                                ))}
                                              </SelectContent>
                                            </Select>
                                            <Button 
                                              type="button" 
                                              variant="ghost" 
                                              size="icon" 
                                              className="h-8 w-8 shrink-0"
                                              onClick={() => setIsAddProductOpen(true)}
                                            >
                                              <Plus className="h-4 w-4" />
                                            </Button>
                                          </div>
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
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                              <div className="text-2xl sm:text-3xl font-bold">Rs. {calculateTotal().toLocaleString()}</div>
                            </div>
                          </div>

                          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-4">
                            <Button type="button" variant="outline" onClick={handleCloseDialog} className="w-full sm:w-auto">
                              Cancel
                            </Button>
                            <Button type="submit" disabled={saveMutation.isPending} className="w-full sm:w-auto">
                              {saveMutation.isPending ? 'Saving...' : 'Save'}
                            </Button>
                          </div>
                        </form>
                      </DialogContent>
                    </Dialog>
                  )}
                </>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {/* Desktop Table View */}
            <div className="hidden md:block border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Required By</TableHead>
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
                  ) : filteredOrders?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        No orders found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredOrders?.map((order) => {
                      const isExpanded = expandedOrders.has(order.id);
                      const items = getOrderItems(order.id);
                      return (
                        <React.Fragment key={order.id}>
                          <TableRow className="cursor-pointer" onClick={() => toggleExpand(order.id)}>
                            <TableCell className="font-mono">
                              <div className="flex items-center gap-1">
                                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                {order.order_number}
                              </div>
                            </TableCell>
                            <TableCell>{format(new Date(order.order_date), 'dd MMM yyyy')}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                {order.customers?.logo_url && (
                                  <img 
                                    src={order.customers.logo_url} 
                                    alt="" 
                                    className="h-6 w-6 object-contain rounded"
                                  />
                                )}
                                <div>
                                  <div className="font-medium">{order.customers?.name}</div>
                                  <div className="text-xs text-muted-foreground">{order.customers?.code}</div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              {order.required_date ? format(new Date(order.required_date), 'dd MMM yyyy') : '-'}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              Rs. {Number(order.net_amount || 0).toLocaleString()}
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              {canEdit && order.status !== 'delivered' && order.status !== 'cancelled' ? (
                                <Select 
                                  value={order.status} 
                                  onValueChange={(status) => statusMutation.mutate({ id: order.id, status })}
                                >
                                  <SelectTrigger className="w-36">
                                    <Badge className={STATUS_COLORS[order.status]}>
                                      {order.status.replace(/_/g, ' ')}
                                    </Badge>
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="draft">Draft</SelectItem>
                                    <SelectItem value="confirmed">Confirmed</SelectItem>
                                    <SelectItem value="in_production">In Production</SelectItem>
                                    <SelectItem value="ready">Ready</SelectItem>
                                    <SelectItem value="partially_dispatched">Partially Dispatched</SelectItem>
                                    <SelectItem value="dispatched">Dispatched</SelectItem>
                                    <SelectItem value="delivered">Delivered</SelectItem>
                                    <SelectItem value="cancelled">Cancelled</SelectItem>
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Badge className={STATUS_COLORS[order.status]}>
                                  {order.status.replace(/_/g, ' ')}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-sm">
                              {order.created_by_user?.full_name || '-'}
                            </TableCell>
                            <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex justify-end gap-1">
                                <Button 
                                  variant="ghost" 
                                  size="icon"
                                  onClick={() => setViewOrder(order)}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                {canDelete && order.status === 'draft' && (
                                  <Button 
                                    variant="ghost" 
                                    size="icon"
                                    onClick={() => {
                                      if (confirm('Delete this order?')) {
                                        deleteMutation.mutate(order.id);
                                      }
                                    }}
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                          {isExpanded && (
                            <TableRow>
                              <TableCell colSpan={8} className="bg-muted/30 p-0">
                                <div className="px-8 py-3">
                                  {items.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">No items</p>
                                  ) : (
                                    <Table>
                                      <TableHeader>
                                        <TableRow className="border-b-0">
                                          <TableHead className="h-8 text-xs">Product</TableHead>
                                          <TableHead className="h-8 text-xs text-right">Qty (Dz)</TableHead>
                                          <TableHead className="h-8 text-xs text-right">Price/Dz</TableHead>
                                          <TableHead className="h-8 text-xs text-right">Amount</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {items.map((item: any) => (
                                          <TableRow key={item.id} className="border-b-0">
                                            <TableCell className="py-1 text-sm">{item.products?.code} - {item.products?.name}</TableCell>
                                            <TableCell className="py-1 text-sm text-right">{item.quantity_dozens}</TableCell>
                                            <TableCell className="py-1 text-sm text-right">{Number(item.price_per_dozen || 0).toLocaleString()}</TableCell>
                                            <TableCell className="py-1 text-sm text-right">{Number(item.amount || 0).toLocaleString()}</TableCell>
                                          </TableRow>
                                        ))}
                                        <TableRow className="border-t">
                                          <TableCell className="py-1 text-sm font-semibold text-right">Total:</TableCell>
                                          <TableCell className="py-1 text-sm font-semibold text-right">
                                            {items.reduce((sum: number, item: any) => sum + (item.quantity_dozens || 0), 0)}
                                          </TableCell>
                                          <TableCell className="py-1 text-sm"></TableCell>
                                          <TableCell className="py-1 text-sm font-semibold text-right">
                                            {items.reduce((sum: number, item: any) => sum + (Number(item.amount) || 0), 0).toLocaleString()}
                                          </TableCell>
                                        </TableRow>
                                      </TableBody>
                                    </Table>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden space-y-3">
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : filteredOrders?.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No orders found</div>
              ) : (
                filteredOrders?.map((order) => (
                  <div 
                    key={order.id} 
                    className="border rounded-xl p-4 space-y-3 bg-card shadow-sm"
                    onClick={() => setViewOrder(order)}
                  >
                    {/* Header Row */}
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-mono font-semibold text-primary">{order.order_number}</div>
                        <div className="text-sm text-muted-foreground">
                          {format(new Date(order.order_date), 'dd MMM yyyy')}
                        </div>
                      </div>
                      <Badge className={STATUS_COLORS[order.status]}>
                        {order.status.replace(/_/g, ' ')}
                      </Badge>
                    </div>

                    {/* Customer */}
                    <div className="flex items-center gap-2">
                      {order.customers?.logo_url && (
                        <img 
                          src={order.customers.logo_url} 
                          alt="" 
                          className="h-8 w-8 object-contain rounded"
                        />
                      )}
                      <div>
                        <div className="font-medium">{order.customers?.name}</div>
                        <div className="text-xs text-muted-foreground">{order.customers?.code}</div>
                      </div>
                    </div>

                    {/* Details Row */}
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Required: </span>
                        <span>{order.required_date ? format(new Date(order.required_date), 'dd MMM') : '-'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">By: </span>
                        <span>{order.created_by_user?.full_name || '-'}</span>
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between pt-2 border-t">
                      <div className="text-lg font-bold">
                        Rs. {Number(order.net_amount || 0).toLocaleString()}
                      </div>
                      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                        {canEdit && order.status !== 'delivered' && order.status !== 'cancelled' && (
                          <Select 
                            value={order.status} 
                            onValueChange={(status) => statusMutation.mutate({ id: order.id, status })}
                          >
                            <SelectTrigger className="w-28 h-8 text-xs">
                              <SelectValue placeholder="Status" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="draft">Draft</SelectItem>
                              <SelectItem value="confirmed">Confirmed</SelectItem>
                              <SelectItem value="in_production">In Production</SelectItem>
                              <SelectItem value="ready">Ready</SelectItem>
                              <SelectItem value="partially_dispatched">Partially Dispatched</SelectItem>
                              <SelectItem value="dispatched">Dispatched</SelectItem>
                              <SelectItem value="delivered">Delivered</SelectItem>
                              <SelectItem value="cancelled">Cancelled</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                        {canDelete && order.status === 'draft' && (
                          <Button 
                            variant="ghost" 
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                              if (confirm('Delete this order?')) {
                                deleteMutation.mutate(order.id);
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* View Order Dialog */}
        <Dialog open={!!viewOrder} onOpenChange={() => setViewOrder(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Order Details - {viewOrder?.order_number}</DialogTitle>
            </DialogHeader>
            {viewOrder && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-sm text-muted-foreground">Customer</div>
                    <div className="font-medium">{viewOrder.customers?.name}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Order Date</div>
                    <div className="font-medium">{format(new Date(viewOrder.order_date), 'dd MMM yyyy')}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Required Date</div>
                    <div className="font-medium">
                      {viewOrder.required_date ? format(new Date(viewOrder.required_date), 'dd MMM yyyy') : '-'}
                    </div>
                  </div>
                </div>

                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Grade</TableHead>
                        <TableHead>Packing</TableHead>
                        <TableHead className="text-right">Ordered</TableHead>
                        <TableHead className="text-right">Dispatched</TableHead>
                        <TableHead className="text-right">Pending</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orderItems?.map((item: any) => (
                        <TableRow key={item.id}>
                          <TableCell>{item.products?.code || '-'}{item.products?.name ? ` - ${item.products.name}` : ''}</TableCell>
                          <TableCell>{item.grades?.code || '-'}</TableCell>
                          <TableCell>{item.packing_type || '-'}</TableCell>
                          <TableCell className="text-right">{item.quantity_dozens} Dz</TableCell>
                          <TableCell className="text-right">{item.quantity_dispatched || 0} Dz</TableCell>
                          <TableCell className="text-right font-medium">
                            {item.quantity_dozens - (item.quantity_dispatched || 0)} Dz
                          </TableCell>
                          <TableCell className="text-right">Rs. {Number(item.amount || 0).toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex justify-between items-center pt-4 border-t">
                  <div>
                    <Badge className={STATUS_COLORS[viewOrder.status]}>
                      {viewOrder.status.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-muted-foreground">Net Amount</div>
                    <div className="text-2xl font-bold">Rs. {Number(viewOrder.net_amount || 0).toLocaleString()}</div>
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Product Management Dialog */}
        <Dialog open={isAddProductOpen} onOpenChange={(open) => {
          setIsAddProductOpen(open);
          if (!open) {
            setEditingProduct(null);
            setNewProduct({ code: '', name: '', description: '' });
          }
        }}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Manage Products</DialogTitle>
            </DialogHeader>
            <div className="space-y-6">
              {/* Add New Product Form */}
              <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                <h4 className="font-medium">{editingProduct ? 'Edit Product' : 'Add New Product'}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Product Code *</Label>
                    <Input
                      value={editingProduct ? editingProduct.code : newProduct.code}
                      onChange={(e) => editingProduct 
                        ? setEditingProduct({ ...editingProduct, code: e.target.value })
                        : setNewProduct({ ...newProduct, code: e.target.value })
                      }
                      placeholder="e.g., SKU001"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Product Name *</Label>
                    <Input
                      value={editingProduct ? editingProduct.name : newProduct.name}
                      onChange={(e) => editingProduct 
                        ? setEditingProduct({ ...editingProduct, name: e.target.value })
                        : setNewProduct({ ...newProduct, name: e.target.value })
                      }
                      placeholder="Enter product name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Input
                      value={editingProduct ? editingProduct.description : newProduct.description}
                      onChange={(e) => editingProduct 
                        ? setEditingProduct({ ...editingProduct, description: e.target.value })
                        : setNewProduct({ ...newProduct, description: e.target.value })
                      }
                      placeholder="Optional"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  {editingProduct && (
                    <Button type="button" variant="outline" onClick={() => {
                      setEditingProduct(null);
                      setNewProduct({ code: '', name: '', description: '' });
                    }}>
                      Cancel Edit
                    </Button>
                  )}
                  <Button
                    type="button"
                    onClick={() => {
                      if (editingProduct) {
                        if (!editingProduct.code || !editingProduct.name) {
                          toast.error('Code and Name are required');
                          return;
                        }
                        editProductMutation.mutate(editingProduct);
                      } else {
                        if (!newProduct.code || !newProduct.name) {
                          toast.error('Code and Name are required');
                          return;
                        }
                        addProductMutation.mutate(newProduct);
                      }
                    }}
                    disabled={addProductMutation.isPending || editProductMutation.isPending}
                  >
                    {editingProduct 
                      ? (editProductMutation.isPending ? 'Updating...' : 'Update Product')
                      : (addProductMutation.isPending ? 'Adding...' : 'Add Product')
                    }
                  </Button>
                </div>
              </div>

              {/* Products List */}
              <div className="space-y-2">
                <h4 className="font-medium">Existing Products</h4>
                <div className="border rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {products?.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center py-4 text-muted-foreground">
                            No products found
                          </TableCell>
                        </TableRow>
                      ) : (
                        products?.map((product) => (
                          <TableRow key={product.id}>
                            <TableCell className="font-mono">{product.code}</TableCell>
                            <TableCell>{product.name}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => setEditingProduct({
                                    id: product.id,
                                    code: product.code,
                                    name: product.name,
                                    description: '',
                                  })}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => {
                                    if (confirm('Are you sure you want to delete this product?')) {
                                      deleteProductMutation.mutate(product.id);
                                    }
                                  }}
                                  disabled={deleteProductMutation.isPending}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="flex justify-end">
                <Button type="button" variant="outline" onClick={() => setIsAddProductOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
