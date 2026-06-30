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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Trash2, Eye, Check, MessageCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import type { Database } from "@/integrations/supabase/types";
import { SearchableSelect } from "@/components/shared/SearchableSelect";

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

// Incoming-material QC gate (raw material only). Drives the badge shown on the
// order detail so buyers know whether goods receipt is unlocked.
const QC_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-500',
  passed: 'bg-green-500',
  failed: 'bg-red-500',
  not_required: 'bg-slate-400',
};

const QC_STATUS_LABELS: Record<string, string> = {
  pending: 'inspection pending',
  passed: 'inspection passed',
  failed: 'inspection failed',
  not_required: 'not required',
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
  const { user, hasModulePermission, hasPurchaseCategoryPermission, hasRole } = useAuth();
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
  // Deleting a purchase order is destructive (cascades to its line items),
  // so it is reserved exclusively for super admins.
  const canDelete = hasRole('super_admin');

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
          suppliers(name, code, phone),
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

  // Delete mutation (super admin only). Line items are removed automatically
  // via the ON DELETE CASCADE foreign key on purchase_order_items.
  const deleteMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase
        .from('purchase_orders')
        .delete()
        .eq('id', orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('Purchase order deleted');
      setViewOrder(null);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to delete purchase order');
    },
  });

  // Normalise a stored supplier phone into the digits-only form wa.me expects.
  // Best-effort for Pakistani numbers: 03xx... -> 923xx..., bare 3xx... -> 923xx...
  const normalizeWhatsAppPhone = (raw?: string | null): string => {
    if (!raw) return '';
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('92')) return digits;
    if (digits.startsWith('0')) return '92' + digits.slice(1);
    if (digits.length === 10 && digits.startsWith('3')) return '92' + digits;
    return digits;
  };

  // Build a readable WhatsApp message summarising the purchase order so the
  // vendor receives the full order details in chat.
  const buildWhatsAppMessage = (order: any, lineItems: any[]): string => {
    const lines: string[] = [];
    lines.push('*PURCHASE ORDER*');
    lines.push('Cansport Global Industries');
    lines.push('');
    lines.push(`*PO #:* ${order.po_number}`);
    lines.push(`*Supplier:* ${order.suppliers?.name || '-'}`);
    lines.push(`*Order Date:* ${format(new Date(order.order_date), 'dd/MM/yyyy')}`);
    if (order.expected_date) {
      lines.push(`*Expected:* ${format(new Date(order.expected_date), 'dd/MM/yyyy')}`);
    }
    lines.push('');
    lines.push('*Items:*');
    if (lineItems.length === 0) {
      lines.push('-');
    } else {
      lineItems.forEach((it, i) => {
        const name = it.items?.name || it.description || 'Item';
        lines.push(
          `${i + 1}. ${name} — ${it.quantity} x Rs. ${Number(it.unit_price || 0).toLocaleString()} = Rs. ${Number(it.amount || 0).toLocaleString()}`
        );
      });
    }
    lines.push('');
    lines.push(`*Total: Rs. ${Number(order.total_amount || 0).toLocaleString()}*`);
    if (order.payment_terms) lines.push(`Payment Terms: ${order.payment_terms} days`);
    if (order.shipping_address) lines.push(`Ship To: ${order.shipping_address}`);
    if (order.notes) lines.push(`Notes: ${order.notes}`);
    return lines.join('\n');
  };

  const handleWhatsAppShare = () => {
    if (!viewOrder) return;
    const message = buildWhatsAppMessage(viewOrder, orderItems || []);
    const phone = normalizeWhatsAppPhone(viewOrder.suppliers?.phone);
    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
    if (!phone) {
      toast.message('No supplier phone on file', {
        description: 'Pick the vendor in WhatsApp to send the order.',
      });
    }
  };

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
                    <SearchableSelect
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
                      placeholder="Select supplier"
                      options={(filteredSuppliers || []).map(sup => ({
                        value: sup.id,
                        label: sup.name,
                        secondary: `(${sup.code})`,
                        search: sup.code,
                      }))}
                    />
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
                                <SearchableSelect
                                  value={item.item_id}
                                  onValueChange={(value) => updateItem(index, 'item_id', value)}
                                  placeholder="Select item"
                                  options={(items || []).map(i => ({
                                    value: i.id,
                                    label: i.name,
                                    secondary: `(${i.code})`,
                                    search: i.code,
                                  }))}
                                />
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
                            <SearchableSelect
                              value={item.item_id}
                              onValueChange={(value) => updateItem(index, 'item_id', value)}
                              placeholder="Select item"
                              options={(items || []).map(i => ({
                                value: i.id,
                                label: i.name,
                                secondary: `(${i.code})`,
                                search: i.code,
                              }))}
                            />
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
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-48">
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
          <SelectTrigger className="w-full sm:w-48">
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
        <>
          {/* Desktop / tablet: full data table */}
          <div className="hidden md:block">
            <DataTable
              columns={columns}
              data={filteredOrders || []}
            />
          </div>

          {/* Mobile: tappable card list */}
          <div className="space-y-3 md:hidden">
            {(filteredOrders || []).length === 0 ? (
              <div className="rounded-lg border bg-card py-8 text-center text-sm text-muted-foreground">
                No purchase orders
              </div>
            ) : (
              (filteredOrders || []).map((order) => (
                <button
                  key={order.id}
                  type="button"
                  onClick={() => setViewOrder(order)}
                  className="w-full rounded-lg border bg-card p-4 text-left transition-colors active:bg-muted/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{order.po_number}</span>
                    <Badge className={STATUS_COLORS[order.status] || 'bg-gray-500'}>
                      {order.status?.replace('_', ' ')}
                    </Badge>
                  </div>
                  <div className="mt-1 text-sm font-medium">{order.suppliers?.name || '-'}</div>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {format(new Date(order.order_date), 'dd/MM/yyyy')}
                    </span>
                    <span className="font-semibold">
                      Rs. {order.total_amount?.toLocaleString() || 0}
                    </span>
                  </div>
                  <div className="mt-2">
                    <Badge variant="outline" className="text-xs">
                      {CATEGORIES.find(c => c.value === order.category)?.label || order.category}
                    </Badge>
                  </div>
                </button>
              ))
            )}
          </div>
        </>
      )}

      {/* View Order Dialog */}
      <Dialog open={!!viewOrder} onOpenChange={() => setViewOrder(null)}>
        <DialogContent className="w-[95vw] max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Purchase Order: {viewOrder?.po_number}</DialogTitle>
          </DialogHeader>
          {viewOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4 text-sm">
                <div><strong>Supplier:</strong> {viewOrder.suppliers?.name}</div>
                <div><strong>Category:</strong> {CATEGORIES.find(c => c.value === viewOrder.category)?.label}</div>
                <div><strong>Order Date:</strong> {format(new Date(viewOrder.order_date), 'dd/MM/yyyy')}</div>
                <div><strong>Expected Date:</strong> {viewOrder.expected_date ? format(new Date(viewOrder.expected_date), 'dd/MM/yyyy') : '-'}</div>
                <div><strong>Status:</strong> <Badge className={STATUS_COLORS[viewOrder.status]}>{viewOrder.status?.replace('_', ' ')}</Badge></div>
                <div><strong>Total:</strong> Rs. {viewOrder.total_amount?.toLocaleString()}</div>
                {viewOrder.category === 'raw_material' && (
                  <div className="flex items-center gap-1">
                    <strong>Quality:</strong>
                    <Badge className={QC_STATUS_COLORS[viewOrder.qc_status] || 'bg-gray-500'}>
                      {QC_STATUS_LABELS[viewOrder.qc_status] || viewOrder.qc_status}
                    </Badge>
                  </div>
                )}
              </div>

              {orderItems && orderItems.length > 0 && (
                <>
                  {/* Desktop / tablet: items table */}
                  <div className="hidden sm:block overflow-x-auto">
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
                  </div>

                  {/* Mobile: stacked item cards */}
                  <div className="space-y-3 sm:hidden">
                    {orderItems.map((item: any) => (
                      <div key={item.id} className="rounded-lg border p-3 space-y-2 text-sm">
                        <div className="font-medium">
                          {item.description || item.items?.name}
                          {item.items?.code && (
                            <span className="text-muted-foreground"> ({item.items.code})</span>
                          )}
                        </div>
                        <div className="flex justify-between text-muted-foreground">
                          <span>Qty: <span className="text-foreground">{item.quantity}</span></span>
                          <span>Received: <span className="text-foreground">{item.quantity_received || 0}</span></span>
                        </div>
                        <div className="flex justify-between text-muted-foreground">
                          <span>Unit: <span className="text-foreground">Rs. {item.unit_price?.toLocaleString()}</span></span>
                          <span className="font-semibold text-foreground">Rs. {item.amount?.toLocaleString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {viewOrder.notes && (
                <div>
                  <strong>Notes:</strong>
                  <p className="text-muted-foreground">{viewOrder.notes}</p>
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t">
                {canDelete && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30 sm:mr-auto"
                      >
                        <Trash2 className="h-4 w-4 mr-2" /> Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="w-[95vw] max-w-md">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete purchase order?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete {viewOrder.po_number} and all of its
                          line items. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteMutation.mutate(viewOrder.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
                <Button
                  variant="outline"
                  onClick={handleWhatsAppShare}
                  className="text-green-600 hover:text-green-700 hover:bg-green-50 border-green-200"
                  title="Send this purchase order to the vendor on WhatsApp"
                >
                  <MessageCircle className="h-4 w-4 mr-2" /> WhatsApp
                </Button>
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