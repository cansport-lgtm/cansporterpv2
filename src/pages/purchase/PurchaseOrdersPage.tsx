import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Trash2, Eye, Pencil, Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import type { Database } from "@/integrations/supabase/types";

type PurchaseCategory = Database["public"]["Enums"]["purchase_category"];

interface Column<T> {
  key: keyof T | string;
  header: string;
  render?: (item: T) => React.ReactNode;
  className?: string;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-500',
  pending_approval: 'bg-amber-500',
  approved: 'bg-blue-500',
  ordered: 'bg-cyan-500',
  partially_received: 'bg-purple-500',
  received: 'bg-green-500',
  cancelled: 'bg-red-500',
};

const CATEGORIES: { value: PurchaseCategory; label: string }[] = [
  { value: "raw_material", label: "Raw Material" },
  { value: "office_supplies", label: "Office Supplies" },
  { value: "general_supplies", label: "General Supplies" },
  { value: "spare_maintenance", label: "Spare & Maintenance" },
];

interface PurchaseOrderItem {
  id?: string;
  item_id: string;
  description: string;
  quantity: string;
  unit_price: string;
  amount: string;
}

export default function PurchaseOrdersPage() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const { user, hasModulePermission, hasPurchaseCategoryPermission } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewOrder, setViewOrder] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [formData, setFormData] = useState({
    supplier_id: '',
    category: '' as PurchaseCategory | '',
    order_date: format(new Date(), 'yyyy-MM-dd'),
    expected_date: '',
    payment_terms: '',
    shipping_address: '',
    notes: '',
    items: [] as PurchaseOrderItem[],
  });

  const canCreate = hasModulePermission('purchase', 'create');
  const canEdit = hasModulePermission('purchase', 'edit');
  const canApprove = hasModulePermission('purchase', 'approve');

  // Handle navigation state to open new order dialog
  useEffect(() => {
    if (location.state?.openNewOrder && canCreate) {
      setDialogOpen(true);
      window.history.replaceState({}, document.title);
    }
  }, [location.state, canCreate]);

  // Fetch orders
  const { data: orders, isLoading } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(`
          *,
          suppliers(name, code),
          created_by_user:app_users!purchase_orders_created_by_fkey(full_name)
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Fetch order items for viewing
  const { data: orderItems } = useQuery({
    queryKey: ['purchase-order-items', viewOrder?.id],
    queryFn: async () => {
      if (!viewOrder?.id) return [];
      const { data, error } = await supabase
        .from('purchase_order_items')
        .select(`*, items(code, name)`)
        .eq('order_id', viewOrder.id);
      if (error) throw error;
      return data;
    },
    enabled: !!viewOrder?.id,
  });

  // Fetch suppliers
  const { data: suppliers } = useQuery({
    queryKey: ['suppliers-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('suppliers')
        .select('id, code, name, categories, payment_terms')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  // Fetch items filtered by category
  const { data: items } = useQuery({
    queryKey: ['items-by-category', formData.category],
    queryFn: async () => {
      if (!formData.category) return [];
      const { data, error } = await supabase
        .from('items')
        .select('id, code, name, unit_price')
        .eq('category', formData.category)
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data;
    },
    enabled: !!formData.category,
  });

  // Filter suppliers by selected category
  const filteredSuppliers = suppliers?.filter(sup => 
    !formData.category || sup.categories?.includes(formData.category as PurchaseCategory)
  );

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      // Filter out empty items (rows without item_id selected)
      const validItems = data.items.filter(item => item.item_id);
      const totalAmount = validItems.reduce((sum, item) => sum + parseFloat(item.amount || '0'), 0);

      const { data: newOrder, error: orderError } = await supabase
        .from('purchase_orders')
        .insert({
          po_number: '', // Auto-generated
          supplier_id: data.supplier_id,
          category: data.category as PurchaseCategory,
          order_date: data.order_date,
          expected_date: data.expected_date || null,
          total_amount: totalAmount,
          payment_terms: data.payment_terms ? parseInt(data.payment_terms) : null,
          shipping_address: data.shipping_address || null,
          notes: data.notes || null,
          created_by: user?.id,
          status: 'draft',
        })
        .select()
        .single();

      if (orderError) throw orderError;

      if (validItems.length > 0) {
        const itemsToInsert = validItems.map(item => ({
          order_id: newOrder.id,
          item_id: item.item_id || null,
          description: item.description || null,
          quantity: parseFloat(item.quantity) || 1,
          unit_price: parseFloat(item.unit_price) || 0,
          amount: parseFloat(item.amount) || 0,
        }));

        const { error: itemsError } = await supabase
          .from('purchase_order_items')
          .insert(itemsToInsert);

        if (itemsError) throw itemsError;
      }

      return newOrder;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('Purchase order created');
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create purchase order');
    },
  });

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase
        .from('purchase_orders')
        .update({
          status: 'approved',
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('Purchase order approved');
      setViewOrder(null);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to approve');
    },
  });

  const resetForm = () => {
    setFormData({
      supplier_id: '',
      category: '',
      order_date: format(new Date(), 'yyyy-MM-dd'),
      expected_date: '',
      payment_terms: '',
      shipping_address: '',
      notes: '',
      items: [],
    });
    setDialogOpen(false);
  };

  const createEmptyItem = (): PurchaseOrderItem => ({
    item_id: '',
    description: '',
    quantity: '1',
    unit_price: '0',
    amount: '0',
  });

  const addItem = () => {
    setFormData({
      ...formData,
      items: [...formData.items, createEmptyItem()],
    });
  };

  const updateItem = (index: number, field: string, value: string) => {
    const newItems = [...formData.items];
    newItems[index] = { ...newItems[index], [field]: value };
    
    if (field === 'quantity' || field === 'unit_price') {
      const qty = parseFloat(newItems[index].quantity) || 0;
      const price = parseFloat(newItems[index].unit_price) || 0;
      newItems[index].amount = (qty * price).toFixed(2);
    }
    
    if (field === 'item_id' && value) {
      const selectedItem = items?.find(i => i.id === value);
      if (selectedItem) {
        newItems[index].description = selectedItem.name;
        newItems[index].unit_price = selectedItem.unit_price?.toString() || '0';
        const qty = parseFloat(newItems[index].quantity) || 0;
        newItems[index].amount = (qty * (selectedItem.unit_price || 0)).toFixed(2);
      }
    }
    
    // Auto-add new row if this is the last row and an item was selected
    const isLastRow = index === newItems.length - 1;
    const hasItemSelected = newItems[index].item_id !== '';
    if (isLastRow && hasItemSelected && field === 'item_id') {
      newItems.push(createEmptyItem());
    }
    
    setFormData({ ...formData, items: newItems });
  };

  // Ensure there's always at least one empty row when category is selected
  useEffect(() => {
    if (formData.category && formData.items.length === 0) {
      setFormData(prev => ({ ...prev, items: [createEmptyItem()] }));
    }
  }, [formData.category]);

  const removeItem = (index: number) => {
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index),
    });
  };

  // Check category permission
  const canAccessCategory = (category: PurchaseCategory) => {
    return hasPurchaseCategoryPermission(category, 'view');
  };

  const canCreateForCategory = (category: PurchaseCategory) => {
    return hasPurchaseCategoryPermission(category, 'create');
  };

  const canApproveForCategory = (category: PurchaseCategory) => {
    return hasPurchaseCategoryPermission(category, 'approve');
  };

  // Filter orders by status and category (and user's category permissions)
  const filteredOrders = orders?.filter(order => {
    const statusMatch = statusFilter === 'all' || order.status === statusFilter;
    const categoryMatch = categoryFilter === 'all' || order.category === categoryFilter;
    const hasAccess = canAccessCategory(order.category);
    return statusMatch && categoryMatch && hasAccess;
  });

  // Available categories for filter (based on user permissions)
  const availableCategories = CATEGORIES.filter(cat => canAccessCategory(cat.value));

  const columns: Column<any>[] = [
    { key: 'po_number', header: 'PO #' },
    {
      key: 'supplier_id',
      header: 'Supplier',
      render: (order) => order.suppliers?.name || '-',
    },
    {
      key: 'category',
      header: 'Category',
      render: (order) => (
        <Badge variant="outline">
          {CATEGORIES.find(c => c.value === order.category)?.label || order.category}
        </Badge>
      ),
    },
    {
      key: 'order_date',
      header: 'Order Date',
      render: (order) => format(new Date(order.order_date), 'dd/MM/yyyy'),
    },
    {
      key: 'total_amount',
      header: 'Amount',
      render: (order) => `Rs. ${order.total_amount?.toLocaleString() || 0}`,
    },
    {
      key: 'status',
      header: 'Status',
      render: (order) => (
        <Badge className={STATUS_COLORS[order.status] || 'bg-gray-500'}>
          {order.status?.replace('_', ' ')}
        </Badge>
      ),
    },
    {
      key: 'id',
      header: 'Actions',
      render: (order) => (
        <Button variant="ghost" size="icon" onClick={() => setViewOrder(order)}>
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  // Calculate total only from valid items (with item_id selected)
  const validItems = formData.items.filter(item => item.item_id);
  const totalAmount = validItems.reduce((sum, item) => sum + parseFloat(item.amount || '0'), 0);
  const hasValidItems = validItems.length > 0;

  return (
    <ERPLayout>
      <PageHeader
        title="Purchase Orders"
        description="Create and manage purchase orders"
      >
        {canCreate && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => { resetForm(); setDialogOpen(true); }}>
                <Plus className="mr-2 h-4 w-4" /> New PO
              </Button>
            </DialogTrigger>
            <DialogContent className="w-[95vw] max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create Purchase Order</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Category *</Label>
                    <Select
                      value={formData.category}
                      onValueChange={(value) => setFormData({ ...formData, category: value as PurchaseCategory, supplier_id: '', items: [] })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableCategories.filter(cat => canCreateForCategory(cat.value)).map(cat => (
                          <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Supplier *</Label>
                    <Select
                      value={formData.supplier_id}
                      onValueChange={(value) => {
                        const sup = suppliers?.find(s => s.id === value);
                        setFormData({ 
                          ...formData, 
                          supplier_id: value,
                          payment_terms: sup?.payment_terms?.toString() || '',
                        });
                      }}
                      disabled={!formData.category}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select supplier" />
                      </SelectTrigger>
                      <SelectContent>
                        {filteredSuppliers?.map(sup => (
                          <SelectItem key={sup.id} value={sup.id}>{sup.code} - {sup.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Order Date *</Label>
                    <Input
                      type="date"
                      value={formData.order_date}
                      onChange={(e) => setFormData({ ...formData, order_date: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Expected Date</Label>
                    <Input
                      type="date"
                      value={formData.expected_date}
                      onChange={(e) => setFormData({ ...formData, expected_date: e.target.value })}
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

                <div className="space-y-2">
                  <Label>Shipping Address</Label>
                  <Textarea
                    value={formData.shipping_address}
                    onChange={(e) => setFormData({ ...formData, shipping_address: e.target.value })}
                    rows={2}
                  />
                </div>

                {/* Items - Continuous Form */}
                <div className="space-y-2">
                  <Label>Items</Label>
                  
                  {/* Desktop / tablet: table layout */}
                  {formData.category && formData.items.length > 0 && (
                    <div className="hidden md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Item</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead className="w-24">Qty</TableHead>
                            <TableHead className="w-32">Unit Price</TableHead>
                            <TableHead className="w-32">Amount</TableHead>
                            <TableHead className="w-12"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {formData.items.map((item, index) => (
                            <TableRow key={index}>
                              <TableCell>
                                <Select
                                  value={item.item_id}
                                  onValueChange={(value) => updateItem(index, 'item_id', value)}
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select item" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {items?.map(i => (
                                      <SelectItem key={i.id} value={i.id}>{i.code} - {i.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <Input
                                  value={item.description}
                                  onChange={(e) => updateItem(index, 'description', e.target.value)}
                                  placeholder="Description"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  value={item.quantity}
                                  onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  value={item.unit_price}
                                  onChange={(e) => updateItem(index, 'unit_price', e.target.value)}
                                />
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                Rs. {parseFloat(item.amount || '0').toLocaleString()}
                              </TableCell>
                              <TableCell>
                                <Button variant="ghost" size="icon" onClick={() => removeItem(index)}>
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  {/* Mobile: stacked card layout with full-width fields */}
                  {formData.category && formData.items.length > 0 && (
                    <div className="space-y-4 md:hidden">
                      {formData.items.map((item, index) => (
                        <div key={index} className="rounded-lg border p-3 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-muted-foreground">
                              Item {index + 1}
                            </span>
                            <Button variant="ghost" size="icon" onClick={() => removeItem(index)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Item</Label>
                            <Select
                              value={item.item_id}
                              onValueChange={(value) => updateItem(index, 'item_id', value)}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select item" />
                              </SelectTrigger>
                              <SelectContent>
                                {items?.map(i => (
                                  <SelectItem key={i.id} value={i.id}>{i.code} - {i.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Description</Label>
                            <Input
                              value={item.description}
                              onChange={(e) => updateItem(index, 'description', e.target.value)}
                              placeholder="Description"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <Label className="text-xs">Qty</Label>
                              <Input
                                type="number"
                                inputMode="decimal"
                                value={item.quantity}
                                onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Unit Price</Label>
                              <Input
                                type="number"
                                inputMode="decimal"
                                value={item.unit_price}
                                onChange={(e) => updateItem(index, 'unit_price', e.target.value)}
                              />
                            </div>
                          </div>
                          <div className="flex justify-between border-t pt-2 text-sm font-medium">
                            <span className="text-muted-foreground">Amount</span>
                            <span>Rs. {parseFloat(item.amount || '0').toLocaleString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {formData.items.filter(item => item.item_id).length > 0 && (
                    <div className="text-right font-semibold text-lg pt-2">
                      Total: Rs. {totalAmount.toLocaleString()}
                    </div>
                  )}
                  
                  {!formData.category && (
                    <div className="text-muted-foreground text-sm italic">
                      Select a category to add items
                    </div>
                  )}
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
                  <Button variant="outline" onClick={resetForm}>Cancel</Button>
                  <Button
                    onClick={() => saveMutation.mutate(formData)}
                    disabled={!formData.supplier_id || !formData.category || !hasValidItems || saveMutation.isPending}
                  >
                    {saveMutation.isPending ? 'Creating...' : 'Create PO'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </PageHeader>

      {/* Filters */}
      <div className="flex gap-4 mb-4">
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {availableCategories.map(cat => (
              <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="pending_approval">Pending Approval</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="ordered">Ordered</SelectItem>
            <SelectItem value="partially_received">Partially Received</SelectItem>
            <SelectItem value="received">Received</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={filteredOrders || []}
        />
      )}

      {/* View Order Dialog */}
      <Dialog open={!!viewOrder} onOpenChange={() => setViewOrder(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Purchase Order: {viewOrder?.po_number}</DialogTitle>
          </DialogHeader>
          {viewOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><strong>Supplier:</strong> {viewOrder.suppliers?.name}</div>
                <div><strong>Category:</strong> {CATEGORIES.find(c => c.value === viewOrder.category)?.label}</div>
                <div><strong>Order Date:</strong> {format(new Date(viewOrder.order_date), 'dd/MM/yyyy')}</div>
                <div><strong>Expected Date:</strong> {viewOrder.expected_date ? format(new Date(viewOrder.expected_date), 'dd/MM/yyyy') : '-'}</div>
                <div><strong>Status:</strong> <Badge className={STATUS_COLORS[viewOrder.status]}>{viewOrder.status?.replace('_', ' ')}</Badge></div>
                <div><strong>Total:</strong> Rs. {viewOrder.total_amount?.toLocaleString()}</div>
              </div>

              {orderItems && orderItems.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Received</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orderItems.map((item: any) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.items?.code || '-'}</TableCell>
                        <TableCell>{item.description || item.items?.name}</TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                        <TableCell className="text-right">{item.quantity_received || 0}</TableCell>
                        <TableCell className="text-right">Rs. {item.unit_price?.toLocaleString()}</TableCell>
                        <TableCell className="text-right">Rs. {item.amount?.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {viewOrder.notes && (
                <div>
                  <strong>Notes:</strong>
                  <p className="text-muted-foreground">{viewOrder.notes}</p>
                </div>
              )}

              <div className="flex justify-end gap-2">
                {viewOrder.status === 'draft' && canApproveForCategory(viewOrder.category) && (
                  <Button onClick={() => approveMutation.mutate(viewOrder.id)}>
                    <Check className="h-4 w-4 mr-2" /> Approve
                  </Button>
                )}
                <Button variant="outline" onClick={() => setViewOrder(null)}>Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}