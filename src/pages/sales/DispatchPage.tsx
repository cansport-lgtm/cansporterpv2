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
import { Plus, Trash2, Search, Truck, Eye } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-500',
  in_transit: 'bg-blue-500',
  delivered: 'bg-green-500',
  returned: 'bg-red-500',
};

export default function DispatchPage() {
  const queryClient = useQueryClient();
  const { user, hasModulePermission } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<string>('');
  const [formData, setFormData] = useState({
    order_id: '',
    dispatch_date: format(new Date(), 'yyyy-MM-dd'),
    vehicle_number: '',
    driver_name: '',
    driver_contact: '',
    transporter_name: '',
    lr_number: '',
    lr_date: '',
    freight_charges: '',
    total_packages: '',
    total_weight: '',
    delivery_address: '',
    expected_delivery_date: '',
    notes: '',
    items: [] as Array<{
      order_item_id: string;
      product_code: string;
      grade_code: string;
      available_qty: number;
      quantity_dozens: string;
      packages: string;
    }>,
  });

  const canCreate = hasModulePermission('sales', 'create');
  const canEdit = hasModulePermission('sales', 'edit');

  // Fetch dispatches
  const { data: dispatches, isLoading } = useQuery({
    queryKey: ['sales-dispatches'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_dispatches')
        .select(`
          *,
          sales_orders(order_number, customers(name, code)),
          dispatched_by_user:app_users!sales_dispatches_dispatched_by_fkey(full_name)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  // Fetch orders ready for dispatch
  const { data: pendingOrders } = useQuery({
    queryKey: ['orders-for-dispatch'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_orders')
        .select(`
          id,
          order_number,
          shipping_address,
          customers(name, code)
        `)
        .in('status', ['confirmed', 'in_production', 'ready', 'partially_dispatched'])
        .order('order_date', { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  // Fetch order items when order is selected
  const { data: orderItems } = useQuery({
    queryKey: ['order-items-for-dispatch', selectedOrder],
    queryFn: async () => {
      if (!selectedOrder) return [];
      const { data, error } = await supabase
        .from('sales_order_items')
        .select(`
          id,
          quantity_dozens,
          quantity_dispatched,
          products(code),
          grades(code)
        `)
        .eq('order_id', selectedOrder);

      if (error) throw error;
      return data?.filter(item => (item.quantity_dozens - (item.quantity_dispatched || 0)) > 0);
    },
    enabled: !!selectedOrder,
  });

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      // Insert dispatch
      const { data: newDispatch, error: dispatchError } = await supabase
        .from('sales_dispatches')
        .insert({
          dispatch_number: '', // Auto-generated
          order_id: data.order_id,
          dispatch_date: data.dispatch_date,
          vehicle_number: data.vehicle_number || null,
          driver_name: data.driver_name || null,
          driver_contact: data.driver_contact || null,
          transporter_name: data.transporter_name || null,
          lr_number: data.lr_number || null,
          lr_date: data.lr_date || null,
          freight_charges: parseFloat(data.freight_charges) || 0,
          total_packages: parseInt(data.total_packages) || 0,
          total_weight: parseFloat(data.total_weight) || null,
          delivery_address: data.delivery_address || null,
          expected_delivery_date: data.expected_delivery_date || null,
          notes: data.notes || null,
          dispatched_by: user?.id,
          delivery_status: 'pending',
        })
        .select()
        .single();

      if (dispatchError) throw dispatchError;

      // Insert dispatch items
      if (data.items.length > 0) {
        const items = data.items
          .filter(item => parseInt(item.quantity_dozens) > 0)
          .map(item => ({
            dispatch_id: newDispatch.id,
            order_item_id: item.order_item_id,
            quantity_dozens: parseInt(item.quantity_dozens),
            packages: parseInt(item.packages) || 1,
          }));

        if (items.length > 0) {
          const { error: itemsError } = await supabase
            .from('sales_dispatch_items')
            .insert(items);

          if (itemsError) throw itemsError;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-dispatches'] });
      queryClient.invalidateQueries({ queryKey: ['orders-for-dispatch'] });
      toast.success('Dispatch created');
      handleCloseDialog();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Status update mutation
  const statusMutation = useMutation({
    mutationFn: async ({ id, status, actualDeliveryDate }: { id: string; status: string; actualDeliveryDate?: string }) => {
      const updates: any = { delivery_status: status };
      if (status === 'delivered' && actualDeliveryDate) {
        updates.actual_delivery_date = actualDeliveryDate;
      }
      const { error } = await supabase
        .from('sales_dispatches')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-dispatches'] });
      toast.success('Status updated');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setSelectedOrder('');
    setFormData({
      order_id: '',
      dispatch_date: format(new Date(), 'yyyy-MM-dd'),
      vehicle_number: '',
      driver_name: '',
      driver_contact: '',
      transporter_name: '',
      lr_number: '',
      lr_date: '',
      freight_charges: '',
      total_packages: '',
      total_weight: '',
      delivery_address: '',
      expected_delivery_date: '',
      notes: '',
      items: [],
    });
  };

  const handleOrderSelect = (orderId: string) => {
    setSelectedOrder(orderId);
    const order = pendingOrders?.find(o => o.id === orderId);
    setFormData({
      ...formData,
      order_id: orderId,
      delivery_address: order?.shipping_address || '',
      items: [],
    });
  };

  // Update items when orderItems loads
  const loadOrderItems = () => {
    if (orderItems && orderItems.length > 0) {
      setFormData(prev => ({
        ...prev,
        items: orderItems.map(item => ({
          order_item_id: item.id,
          product_code: item.products?.code || '-',
          grade_code: item.grades?.code || '-',
          available_qty: item.quantity_dozens - (item.quantity_dispatched || 0),
          quantity_dozens: '',
          packages: '1',
        })),
      }));
    }
  };

  const updateItem = (index: number, field: string, value: string) => {
    const newItems = [...formData.items];
    newItems[index] = { ...newItems[index], [field]: value };
    setFormData({ ...formData, items: newItems });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.order_id) {
      toast.error('Please select an order');
      return;
    }
    const hasItems = formData.items.some(item => parseInt(item.quantity_dozens) > 0);
    if (!hasItems) {
      toast.error('Please add dispatch quantities');
      return;
    }
    saveMutation.mutate(formData);
  };

  const filteredDispatches = dispatches?.filter(d => {
    const matchesSearch = 
      d.dispatch_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.sales_orders?.order_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.sales_orders?.customers?.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || d.delivery_status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader 
          title="Dispatch & Delivery" 
          description="Manage order dispatches and track deliveries"
        />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">Dispatch List</CardTitle>
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search dispatches..."
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
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="in_transit">In Transit</SelectItem>
                  <SelectItem value="delivered">Delivered</SelectItem>
                  <SelectItem value="returned">Returned</SelectItem>
                </SelectContent>
              </Select>
              {canCreate && (
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                  <DialogTrigger asChild>
                    <Button onClick={handleCloseDialog}>
                      <Plus className="h-4 w-4 mr-2" />
                      New Dispatch
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Create Dispatch</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-4">
                      {/* Order Selection */}
                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label>Select Order *</Label>
                          <Select 
                            value={formData.order_id} 
                            onValueChange={handleOrderSelect}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select order" />
                            </SelectTrigger>
                            <SelectContent>
                              {pendingOrders?.map((o) => (
                                <SelectItem key={o.id} value={o.id}>
                                  {o.order_number} - {o.customers?.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Dispatch Date</Label>
                          <Input
                            type="date"
                            value={formData.dispatch_date}
                            onChange={(e) => setFormData({ ...formData, dispatch_date: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Expected Delivery</Label>
                          <Input
                            type="date"
                            value={formData.expected_delivery_date}
                            onChange={(e) => setFormData({ ...formData, expected_delivery_date: e.target.value })}
                          />
                        </div>
                      </div>

                      {/* Load items button */}
                      {selectedOrder && (
                        <Button type="button" variant="outline" onClick={loadOrderItems}>
                          Load Order Items
                        </Button>
                      )}

                      {/* Items */}
                      {formData.items.length > 0 && (
                        <div className="space-y-2">
                          <Label>Dispatch Items</Label>
                          <div className="border rounded-lg overflow-hidden">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Product</TableHead>
                                  <TableHead>Grade</TableHead>
                                  <TableHead className="text-right">Available</TableHead>
                                  <TableHead className="text-right">Dispatch Qty</TableHead>
                                  <TableHead className="text-right">Packages</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {formData.items.map((item, index) => (
                                  <TableRow key={index}>
                                    <TableCell>{item.product_code}</TableCell>
                                    <TableCell>{item.grade_code}</TableCell>
                                    <TableCell className="text-right">{item.available_qty} Dz</TableCell>
                                    <TableCell className="text-right">
                                      <Input
                                        type="number"
                                        min="0"
                                        max={item.available_qty}
                                        value={item.quantity_dozens}
                                        onChange={(e) => updateItem(index, 'quantity_dozens', e.target.value)}
                                        className="w-24 ml-auto"
                                      />
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <Input
                                        type="number"
                                        min="1"
                                        value={item.packages}
                                        onChange={(e) => updateItem(index, 'packages', e.target.value)}
                                        className="w-20 ml-auto"
                                      />
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      )}

                      {/* Transport Details */}
                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label>Vehicle Number</Label>
                          <Input
                            value={formData.vehicle_number}
                            onChange={(e) => setFormData({ ...formData, vehicle_number: e.target.value.toUpperCase() })}
                            placeholder="e.g., MH12AB1234"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Driver Name</Label>
                          <Input
                            value={formData.driver_name}
                            onChange={(e) => setFormData({ ...formData, driver_name: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Driver Contact</Label>
                          <Input
                            value={formData.driver_contact}
                            onChange={(e) => setFormData({ ...formData, driver_contact: e.target.value })}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label>Transporter</Label>
                          <Input
                            value={formData.transporter_name}
                            onChange={(e) => setFormData({ ...formData, transporter_name: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>LR Number</Label>
                          <Input
                            value={formData.lr_number}
                            onChange={(e) => setFormData({ ...formData, lr_number: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>LR Date</Label>
                          <Input
                            type="date"
                            value={formData.lr_date}
                            onChange={(e) => setFormData({ ...formData, lr_date: e.target.value })}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label>Freight Charges (Rs.)</Label>
                          <Input
                            type="number"
                            value={formData.freight_charges}
                            onChange={(e) => setFormData({ ...formData, freight_charges: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Total Packages</Label>
                          <Input
                            type="number"
                            value={formData.total_packages}
                            onChange={(e) => setFormData({ ...formData, total_packages: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Total Weight (Kg)</Label>
                          <Input
                            type="number"
                            step="0.1"
                            value={formData.total_weight}
                            onChange={(e) => setFormData({ ...formData, total_weight: e.target.value })}
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Delivery Address</Label>
                        <Textarea
                          value={formData.delivery_address}
                          onChange={(e) => setFormData({ ...formData, delivery_address: e.target.value })}
                          rows={2}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Notes</Label>
                        <Textarea
                          value={formData.notes}
                          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                          rows={2}
                        />
                      </div>

                      <div className="flex justify-end gap-2 pt-4">
                        <Button type="button" variant="outline" onClick={handleCloseDialog}>
                          Cancel
                        </Button>
                        <Button type="submit" disabled={saveMutation.isPending}>
                          {saveMutation.isPending ? 'Creating...' : 'Create Dispatch'}
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
                    <TableHead>DC #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Order</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Packages</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Dispatched By</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8">Loading...</TableCell>
                    </TableRow>
                  ) : filteredDispatches?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                        No dispatches found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredDispatches?.map((dispatch) => (
                      <TableRow key={dispatch.id}>
                        <TableCell className="font-mono">{dispatch.dispatch_number}</TableCell>
                        <TableCell>{format(new Date(dispatch.dispatch_date), 'dd MMM yyyy')}</TableCell>
                        <TableCell className="font-mono text-sm">{dispatch.sales_orders?.order_number}</TableCell>
                        <TableCell>{dispatch.sales_orders?.customers?.name}</TableCell>
                        <TableCell>{dispatch.vehicle_number || '-'}</TableCell>
                        <TableCell>{dispatch.total_packages || '-'}</TableCell>
                        <TableCell>
                          {canEdit && dispatch.delivery_status !== 'delivered' ? (
                            <Select 
                              value={dispatch.delivery_status} 
                              onValueChange={(status) => {
                                if (status === 'delivered') {
                                  const today = format(new Date(), 'yyyy-MM-dd');
                                  statusMutation.mutate({ id: dispatch.id, status, actualDeliveryDate: today });
                                } else {
                                  statusMutation.mutate({ id: dispatch.id, status });
                                }
                              }}
                            >
                              <SelectTrigger className="w-32">
                                <Badge className={STATUS_COLORS[dispatch.delivery_status]}>
                                  {dispatch.delivery_status.replace(/_/g, ' ')}
                                </Badge>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pending">Pending</SelectItem>
                                <SelectItem value="in_transit">In Transit</SelectItem>
                                <SelectItem value="delivered">Delivered</SelectItem>
                                <SelectItem value="returned">Returned</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge className={STATUS_COLORS[dispatch.delivery_status]}>
                              {dispatch.delivery_status.replace(/_/g, ' ')}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {dispatch.dispatched_by_user?.full_name || '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon">
                            <Eye className="h-4 w-4" />
                          </Button>
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
