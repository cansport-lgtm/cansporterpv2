import { useState, useEffect } from "react";
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
import { Plus, Trash2, Search, Eye } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Database } from "@/integrations/supabase/types";

type SalesSegment = Database["public"]["Enums"]["sales_segment"];

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

interface SalesOrdersPageBaseProps {
  segment: SalesSegment;
  title: string;
}

export default function SalesOrdersPageBase({ segment, title }: SalesOrdersPageBaseProps) {
  const queryClient = useQueryClient();
  const { user, hasModulePermission } = useAuth();
  const isMobile = useIsMobile();
  const location = useLocation();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [viewOrder, setViewOrder] = useState<any>(null);
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

  useEffect(() => {
    if (location.state?.openNewOrder && canCreate) {
      setIsDialogOpen(true);
      window.history.replaceState({}, document.title);
    }
  }, [location.state, canCreate]);

  // Fetch orders for this segment
  const { data: orders, isLoading } = useQuery({
    queryKey: ['sales-orders', segment],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_orders')
        .select(`
          *,
          customers(name, code, logo_url, billing_customer),
          created_by_user:app_users!sales_orders_created_by_fkey(full_name)
        `)
        .eq('sales_segment', segment)
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
        .select(`*, products(code, name), grades(code, name)`)
        .eq('order_id', viewOrder.id);

      if (error) throw error;
      return data;
    },
    enabled: !!viewOrder?.id,
  });

  // Fetch customers for this segment
  const { data: customers } = useQuery({
    queryKey: ['customers-active', segment],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, code, name, address, payment_terms, billing_customer')
        .eq('is_active', true)
        .eq('sales_segment', segment)
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

      const { data: newOrder, error: orderError } = await supabase
        .from('sales_orders')
        .insert({
          order_number: '',
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
          sales_segment: segment,
        })
        .select()
        .single();

      if (orderError) throw orderError;

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
      queryClient.invalidateQueries({ queryKey: ['sales-orders', segment] });
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
      queryClient.invalidateQueries({ queryKey: ['sales-orders', segment] });
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
      queryClient.invalidateQueries({ queryKey: ['sales-orders', segment] });
      toast.success('Order deleted');
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

    if (field === 'product_id' && value && customerPricing) {
      const pricing = customerPricing.find(p => p.product_id === value);
      if (pricing) {
        newItems[index].price_per_dozen = pricing.price_per_dozen.toString();
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
    // A sales order must roll up to a billing customer (the real accounting
    // customer). Block creation until the customer has a billing customer set.
    const selectedCustomer = customers?.find(c => c.id === formData.customer_id);
    const billingCustomer = ((selectedCustomer as any)?.billing_customer || '').trim();
    if (!billingCustomer) {
      toast.error(
        `Cannot create order: "${selectedCustomer?.name || 'This customer'}" has no Billing Customer set. ` +
        `Update the customer's billing customer first.`
      );
      return;
    }
    if (formData.items.length === 0) {
      toast.error('Please add at least one item');
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
          title={title}
          description="Manage sales orders"
        />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">Order List</CardTitle>
            <div className="flex items-center gap-4 flex-wrap">
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
                  <SelectItem value="dispatched">Dispatched</SelectItem>
                  <SelectItem value="delivered">Delivered</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              {canCreate && (
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
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="space-y-2 sm:col-span-2 lg:col-span-1">
                          <Label>Customer *</Label>
                          <Select value={formData.customer_id} onValueChange={handleCustomerChange}>
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
                            value={formData.discount_percent}
                            onChange={(e) => setFormData({ ...formData, discount_percent: e.target.value })}
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label>Order Items</Label>
                          <Button type="button" variant="default" size="sm" onClick={addItem}>
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
                                      <Select value={item.product_id} onValueChange={(v) => updateItem(index, 'product_id', v)}>
                                        <SelectTrigger className="w-48">
                                          <SelectValue placeholder="Select Product" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {products?.map((p) => (
                                            <SelectItem key={p.id} value={p.id}>{p.code} - {p.name}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
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
                          <div className="text-2xl font-bold">Rs. {calculateTotal().toLocaleString()}</div>
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
                    <TableHead>Order #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Billing Customer</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8">Loading...</TableCell>
                    </TableRow>
                  ) : filteredOrders?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        No orders found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredOrders?.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="font-mono">{order.order_number}</TableCell>
                        <TableCell>{format(new Date(order.order_date), 'dd MMM yyyy')}</TableCell>
                        <TableCell>
                          <div className="font-medium">{order.customers?.name}</div>
                          <div className="text-xs text-muted-foreground">{order.customers?.code}</div>
                        </TableCell>
                        <TableCell className="text-blue-600 font-medium">{(order.customers as any)?.billing_customer || '-'}</TableCell>
                        <TableCell className="text-right font-medium">
                          Rs. {Number(order.net_amount || 0).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {canEdit && order.status !== 'delivered' && order.status !== 'cancelled' ? (
                            <Select value={order.status} onValueChange={(status) => statusMutation.mutate({ id: order.id, status })}>
                              <SelectTrigger className="w-36">
                                <Badge className={STATUS_COLORS[order.status]}>{order.status.replace(/_/g, ' ')}</Badge>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="draft">Draft</SelectItem>
                                <SelectItem value="confirmed">Confirmed</SelectItem>
                                <SelectItem value="in_production">In Production</SelectItem>
                                <SelectItem value="ready">Ready</SelectItem>
                                <SelectItem value="dispatched">Dispatched</SelectItem>
                                <SelectItem value="delivered">Delivered</SelectItem>
                                <SelectItem value="cancelled">Cancelled</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge className={STATUS_COLORS[order.status]}>{order.status.replace(/_/g, ' ')}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => setViewOrder(order)}>
                              <Eye className="h-4 w-4" />
                            </Button>
                            {canDelete && (order.status === 'draft' || order.status === 'in_progress') && (
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
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* View Order Dialog */}
        <Dialog open={!!viewOrder} onOpenChange={() => setViewOrder(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Order Details - {viewOrder?.order_number}</DialogTitle>
            </DialogHeader>
            {viewOrder && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Customer</p>
                    <p className="font-medium">{viewOrder.customers?.name}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Date</p>
                    <p className="font-medium">{format(new Date(viewOrder.order_date), 'dd MMM yyyy')}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Amount</p>
                    <p className="font-medium">Rs. {Number(viewOrder.net_amount || 0).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Status</p>
                    <Badge className={STATUS_COLORS[viewOrder.status]}>{viewOrder.status.replace(/_/g, ' ')}</Badge>
                  </div>
                </div>
                <div>
                  <h4 className="font-semibold mb-2">Items</h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Qty (Dz)</TableHead>
                        <TableHead className="text-right">Price/Dz</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orderItems?.map((item: any) => (
                        <TableRow key={item.id}>
                          <TableCell>{item.products?.code} - {item.products?.name}</TableCell>
                          <TableCell className="text-right">{item.quantity_dozens}</TableCell>
                          <TableCell className="text-right">Rs. {item.price_per_dozen}</TableCell>
                          <TableCell className="text-right">Rs. {Number(item.amount).toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
