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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Trash2, Search, Eye, ChevronDown, ChevronRight, Pencil, Printer, CalendarClock, Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { SearchableSelect } from "@/components/shared/SearchableSelect";

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

const PACKING_OPTIONS = [
  { value: '12dz_ctn', label: '12 Dz CTN', dozens: 12 },
  { value: '20dz_bag', label: '20 Dz Bag', dozens: 20 },
  { value: '60dz_bag', label: '60 Dz Bag', dozens: 60 },
  { value: '20dz_ctn', label: '20 Dz CTN', dozens: 20 },
  { value: '6dz_ctn', label: '6 Dz CTN', dozens: 6 },
  { value: '25dz_bag', label: '25 Dz Bag', dozens: 25 },
  { value: '15dz_ctn', label: '15 Dz CTN', dozens: 15 },
];

const getPackingDozens = (packingType: string): number => {
  const option = PACKING_OPTIONS.find(o => o.value === packingType);
  return option?.dozens || 0;
};

export default function DomesticSalesOrdersPage() {
  const queryClient = useQueryClient();
  const { user, hasModulePermission, hasRole } = useAuth();
  const location = useLocation();
  const [searchTerm, setSearchTerm] = useState('');
  const [customerPopoverOpen, setCustomerPopoverOpen] = useState(false);
  const [editCustomerPopoverOpen, setEditCustomerPopoverOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [viewOrder, setViewOrder] = useState<any>(null);
  const [editOrder, setEditOrder] = useState<any>(null);
  const [deadlineRequestOrder, setDeadlineRequestOrder] = useState<any>(null);
  const [deadlineRequestDate, setDeadlineRequestDate] = useState('');
  const [deadlineRequestReason, setDeadlineRequestReason] = useState('');
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [editFormData, setEditFormData] = useState({
    customer_id: '',
    order_date: '',
    required_date: '',
    expected_dispatch_date: '',
    shipping_address: '',
    notes: '',
    items: [] as Array<{
      id?: string;
      product_id: string;
      packing_type: string;
      no_of_packages: string;
      quantity_dozens: string;
      price_per_dozen: string;
      production_instructions: string;
      details: string;
    }>,
  });
  const [formData, setFormData] = useState({
    customer_id: '',
    order_date: format(new Date(), 'yyyy-MM-dd'),
    required_date: '',
    expected_dispatch_date: '',
    shipping_address: '',
    notes: '',
    items: [] as Array<{
      product_id: string;
      packing_type: string;
      no_of_packages: string;
      quantity_dozens: string;
      price_per_dozen: string;
      production_instructions: string;
      details: string;
    }>,
  });

  const isSuperAdmin = hasRole('super_admin');
  const canCreate = hasModulePermission('sales', 'create');
  const canEdit = true; // All users can edit orders (except deadline — requires approval)
  const canDelete = isSuperAdmin; // Only super_admin can delete orders

  useEffect(() => {
    if (location.state?.openNewOrder && canCreate) {
      setIsDialogOpen(true);
      window.history.replaceState({}, document.title);
    }
  }, [location.state, canCreate]);

  // Fetch orders for domestic segment
  const { data: orders, isLoading } = useQuery({
    queryKey: ['sales-orders', 'domestic'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_orders')
        .select(`
          *,
          customers(name, code, logo_url, billing_customer),
          created_by_user:app_users!sales_orders_created_by_fkey(full_name)
        `)
        .eq('sales_segment', 'domestic')
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

  // Active customer pricing for the customer currently being edited (create or edit dialog).
  // Used to auto-fill price_per_dozen when a product is picked.
  const activeCustomerId = isDialogOpen ? formData.customer_id : (editOrder ? editFormData.customer_id : '');
  const { data: customerPricingRows } = useQuery({
    queryKey: ['domestic-order-customer-pricing', activeCustomerId],
    queryFn: async () => {
      if (!activeCustomerId) return [];
      const today = format(new Date(), 'yyyy-MM-dd');
      const { data, error } = await supabase
        .from('customer_pricing')
        .select('product_id, price_per_dozen, effective_from, effective_to')
        .eq('customer_id', activeCustomerId)
        .eq('is_active', true)
        .lte('effective_from', today);
      if (error) throw error;
      return (data || []).filter((r: any) => !r.effective_to || r.effective_to >= today);
    },
    enabled: !!activeCustomerId,
  });
  // Build a productId → price lookup (latest effective_from wins if multiple)
  const priceForProduct = (productId: string): number => {
    if (!productId || !customerPricingRows?.length) return 0;
    const candidates = customerPricingRows.filter((r: any) => r.product_id === productId);
    if (candidates.length === 0) return 0;
    candidates.sort((a: any, b: any) => (b.effective_from || '').localeCompare(a.effective_from || ''));
    return Number(candidates[0].price_per_dozen) || 0;
  };

  // Fetch ALL order items for inline list view
  const allOrderIds = orders?.map(o => o.id) || [];
  const { data: allOrderItems } = useQuery({
    queryKey: ['all-sales-order-items', 'domestic', allOrderIds.join(',')],
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

  // Fetch customers for domestic segment
  const { data: customers } = useQuery({
    queryKey: ['customers-active', 'domestic'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, code, name, address, payment_terms, billing_customer')
        .eq('is_active', true)
        .eq('sales_segment', 'domestic')
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

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { data: newOrder, error: orderError } = await supabase
        .from('sales_orders')
        .insert({
          order_number: '',
          customer_id: data.customer_id,
          order_date: data.order_date,
          required_date: data.required_date || null,
          expected_dispatch_date: data.expected_dispatch_date || null,
          discount_percent: 0,
          total_amount: 0,
          net_amount: 0,
          shipping_address: data.shipping_address || null,
          notes: data.notes || null,
          created_by: user?.id,
          status: 'confirmed',
          sales_segment: 'domestic',
        })
        .select()
        .single();

      if (orderError) throw orderError;

      if (data.items.length > 0) {
        const items = data.items
          .filter(item => item.product_id && parseInt(item.quantity_dozens) > 0)
          .map(item => {
            const qty = parseInt(item.quantity_dozens) || 0;
            const rate = parseFloat(item.price_per_dozen) || 0;
            return {
              order_id: newOrder.id,
              product_id: item.product_id,
              grade_id: null,
              packing_type: item.packing_type || null,
              quantity_dozens: qty,
              price_per_dozen: rate,
              amount: qty * rate,
              production_instructions: item.production_instructions || null,
              details: item.details || null,
              remarks: null,
            };
          });

        if (items.length > 0) {
          const { error: itemsError } = await supabase
            .from('sales_order_items')
            .insert(items);

          if (itemsError) throw itemsError;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-orders', 'domestic'] });
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
      queryClient.invalidateQueries({ queryKey: ['sales-orders', 'domestic'] });
      toast.success('Status updated');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // First get all order items for this order
      const { data: orderItems } = await supabase
        .from('sales_order_items')
        .select('id')
        .eq('order_id', id);

      // Delete dispatch items linked to these order items
      if (orderItems && orderItems.length > 0) {
        const itemIds = orderItems.map(i => i.id);
        const { error: dispatchItemsError } = await supabase
          .from('sales_dispatch_items')
          .delete()
          .in('order_item_id', itemIds);
        if (dispatchItemsError) throw dispatchItemsError;
      }

      // Delete order items
      const { error: itemsError } = await supabase
        .from('sales_order_items')
        .delete()
        .eq('order_id', id);
      if (itemsError) throw itemsError;

      // Delete the order
      const { error } = await supabase
        .from('sales_orders')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-orders', 'domestic'] });
      toast.success('Order deleted');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Fetch pending deadline change requests for indicator
  const { data: pendingDeadlineRequests } = useQuery({
    queryKey: ['pending-deadline-requests'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deadline_change_requests' as any)
        .select('order_id')
        .eq('status', 'pending');
      if (error) throw error;
      return data as any[];
    },
  });
  const pendingOrderIds = new Set((pendingDeadlineRequests || []).map((r: any) => r.order_id));

  // Deadline change request mutation
  const deadlineRequestMutation = useMutation({
    mutationFn: async ({ orderId, currentDeadline, requestedDeadline, reason }: {
      orderId: string; currentDeadline: string; requestedDeadline: string; reason: string;
    }) => {
      const { error } = await supabase
        .from('deadline_change_requests' as any)
        .insert({
          order_id: orderId,
          requested_by: user?.id,
          current_deadline: currentDeadline,
          requested_deadline: requestedDeadline,
          reason,
        } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-deadline-requests'] });
      toast.success('Deadline change request submitted');
      setDeadlineRequestOrder(null);
      setDeadlineRequestDate('');
      setDeadlineRequestReason('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Edit/update mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof editFormData }) => {
      // Update order header
      const { error } = await supabase
        .from('sales_orders')
        .update({
          customer_id: data.customer_id,
          order_date: data.order_date,
          required_date: data.required_date || null,
          expected_dispatch_date: data.expected_dispatch_date || null,
          shipping_address: data.shipping_address || null,
          notes: data.notes || null,
        })
        .eq('id', id);
      if (error) throw error;

      // Get existing item IDs
      const { data: existingDbItems } = await supabase
        .from('sales_order_items')
        .select('id')
        .eq('order_id', id);
      const existingIds = (existingDbItems || []).map(i => i.id);
      const keepIds = data.items.filter(i => i.id).map(i => i.id!);
      const deleteIds = existingIds.filter(eid => !keepIds.includes(eid));

      // Delete removed items (and their dispatch items first)
      if (deleteIds.length > 0) {
        await supabase.from('sales_dispatch_items').delete().in('order_item_id', deleteIds);
        await supabase.from('sales_order_items').delete().in('id', deleteIds);
      }

      // Update existing and insert new items
      for (const item of data.items) {
        const qty = parseInt(item.quantity_dozens) || 0;
        const rate = parseFloat(item.price_per_dozen) || 0;
        if (!item.product_id || qty <= 0) continue;
        if (item.id) {
          await supabase.from('sales_order_items').update({
            product_id: item.product_id,
            packing_type: item.packing_type,
            quantity_dozens: qty,
            price_per_dozen: rate,
            amount: qty * rate,
            production_instructions: item.production_instructions || null,
            details: item.details || null,
          }).eq('id', item.id);
        } else {
          await supabase.from('sales_order_items').insert([{
            order_id: id,
            product_id: item.product_id,
            packing_type: item.packing_type,
            quantity_dozens: qty,
            price_per_dozen: rate,
            amount: qty * rate,
            production_instructions: item.production_instructions || null,
            details: item.details || null,
          }]);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-orders', 'domestic'] });
      queryClient.invalidateQueries({ queryKey: ['sales-order-items'] });
      toast.success('Order updated');
      setEditOrder(null);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleOpenEdit = async (order: any) => {
    // Load existing order items from allOrderItems
    const existingItems = getOrderItems(order.id);
    const editItems = existingItems.map((item: any) => {
      const packingDozens = getPackingDozens(item.packing_type || 'standard');
      const packages = packingDozens > 0 ? Math.round((item.quantity_dozens || 0) / packingDozens) : 0;
      return {
        id: item.id,
        product_id: item.product_id || '',
        packing_type: item.packing_type || 'standard',
        no_of_packages: packages.toString(),
        quantity_dozens: (item.quantity_dozens || 0).toString(),
        price_per_dozen: (item.price_per_dozen || 0).toString(),
        production_instructions: item.production_instructions || '',
        details: item.details || '',
      };
    });
    setEditFormData({
      customer_id: order.customer_id || '',
      order_date: order.order_date || '',
      required_date: order.required_date || '',
      expected_dispatch_date: order.expected_dispatch_date || '',
      shipping_address: order.shipping_address || '',
      notes: order.notes || '',
      items: editItems,
    });
    setEditOrder(order);
  };

  const addEditItem = () => {
    setEditFormData({
      ...editFormData,
      items: [...editFormData.items, { product_id: '', packing_type: 'standard', no_of_packages: '', quantity_dozens: '', price_per_dozen: '', production_instructions: '', details: '' }],
    });
  };

  const removeEditItem = (index: number) => {
    setEditFormData({
      ...editFormData,
      items: editFormData.items.filter((_, i) => i !== index),
    });
  };

  const updateEditItem = (index: number, field: string, value: string) => {
    const newItems = [...editFormData.items];
    newItems[index] = { ...newItems[index], [field]: value };
    if (field === 'packing_type' || field === 'no_of_packages') {
      const item = newItems[index];
      const packingDozens = getPackingDozens(item.packing_type);
      const packages = parseInt(item.no_of_packages) || 0;
      newItems[index].quantity_dozens = (packingDozens * packages).toString();
    }
    // Auto-fill price from customer_pricing on product change (only if no manual override yet).
    if (field === 'product_id' && value) {
      const existing = parseFloat(newItems[index].price_per_dozen);
      if (!existing || existing <= 0) {
        const lookup = priceForProduct(value);
        if (lookup > 0) newItems[index].price_per_dozen = lookup.toString();
      }
    }
    setEditFormData({ ...editFormData, items: newItems });
  };

  const getEditTotalQuantity = () => {
    return editFormData.items.reduce((sum, item) => sum + (parseInt(item.quantity_dozens) || 0), 0);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editFormData.customer_id) {
      toast.error('Please select a customer');
      return;
    }
    // The order's customer must roll up to a billing customer.
    const selectedCustomer = customers?.find(c => c.id === editFormData.customer_id);
    const billingCustomer = ((selectedCustomer as any)?.billing_customer || '').trim();
    if (!billingCustomer) {
      toast.error(
        `Cannot save order: "${selectedCustomer?.name || 'This customer'}" has no Billing Customer set. ` +
        `Update the customer's billing customer first.`
      );
      return;
    }
    if (!editFormData.expected_dispatch_date) {
      toast.error('Dispatch Deadline is required');
      return;
    }
    const validItems = editFormData.items.filter(item => item.product_id && parseInt(item.quantity_dozens) > 0);
    if (validItems.length === 0) {
      toast.error('Please add at least one item with quantity');
      return;
    }
    const zeroRate = validItems.find(item => !(parseFloat(item.price_per_dozen) > 0));
    if (zeroRate) {
      toast.error('Set Rate/Dz on every line — zero rates would silently skip accounting auto-post.');
      return;
    }
    updateMutation.mutate({ id: editOrder.id, data: editFormData });
  };

  const handlePrintOrder = (order: any, items: any[]) => {
    const customer = order.customers;
    const totalDozens = items.reduce((sum: number, item: any) => sum + (item.quantity_dozens || 0), 0);
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const itemsRows = items.map((item: any, i: number) => `
      <tr>
        <td style="border:1px solid #333;padding:8px 10px;text-align:center;">${i + 1}</td>
        <td style="border:1px solid #333;padding:8px 10px;">${item.products?.code || ''} - ${item.products?.name || ''}</td>
        <td style="border:1px solid #333;padding:8px 10px;text-align:center;">${item.packing_type?.replace(/_/g, ' ') || '-'}</td>
        <td style="border:1px solid #333;padding:8px 10px;text-align:right;font-weight:600;">${item.quantity_dozens}</td>
        <td style="border:1px solid #333;padding:8px 10px;font-style:italic;color:#444;">${item.production_instructions || '-'}</td>
      </tr>
    `).join('');

    printWindow.document.write(`
      <html>
      <head>
        <title>Sales Order - ${order.order_number}</title>
        <style>
          * { margin:0; padding:0; box-sizing:border-box; }
          body { font-family: Arial, sans-serif; padding: 30px; color: #111; }
          .header { text-align: center; border-bottom: 3px solid #111; padding-bottom: 12px; margin-bottom: 20px; }
          .header h1 { font-size: 22px; text-transform: uppercase; letter-spacing: 2px; }
          .header p { font-size: 11px; color: #555; margin-top: 4px; }
          .order-title { font-size: 16px; font-weight: 700; text-align: center; margin-bottom: 16px; background: #f0f0f0; padding: 8px; border: 1px solid #ccc; }
          .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin-bottom: 20px; font-size: 13px; }
          .info-grid .label { font-weight: 600; color: #333; }
          .info-grid .value { }
          table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 13px; }
          th { border: 1px solid #333; padding: 8px 10px; background: #222; color: #fff; text-align: left; font-size: 12px; text-transform: uppercase; }
          .total-row td { font-weight: 700; background: #f5f5f5; }
          .notes { border: 1px solid #ccc; padding: 10px; font-size: 12px; margin-bottom: 20px; background: #fafafa; }
          .notes strong { display: block; margin-bottom: 4px; }
          .footer { margin-top: 40px; display: flex; justify-content: space-between; font-size: 12px; }
          .signature { border-top: 1px solid #333; width: 180px; text-align: center; padding-top: 4px; }
          @media print { body { padding: 15px; } }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Cansport Industries</h1>
          <p>Sales Order / Packing Slip</p>
        </div>
        <div class="order-title">Order: ${order.order_number}</div>
        <div class="info-grid">
          <div><span class="label">Customer:</span> <span class="value">${customer?.name || '-'} (${customer?.code || ''})</span></div>
          <div><span class="label">Order Date:</span> <span class="value">${format(new Date(order.order_date), 'dd MMM yyyy')}</span></div>
          <div><span class="label">Status:</span> <span class="value">${order.status.replace(/_/g, ' ').toUpperCase()}</span></div>
          <div><span class="label">Dispatch Deadline:</span> <span class="value">${order.expected_dispatch_date ? format(new Date(order.expected_dispatch_date), 'dd MMM yyyy') : '-'}</span></div>
          ${order.shipping_address ? `<div style="grid-column:span 2"><span class="label">Shipping Address:</span> <span class="value">${order.shipping_address}</span></div>` : ''}
        </div>
        <table>
          <thead>
            <tr>
              <th style="width:40px;text-align:center;">#</th>
              <th>Product</th>
              <th style="text-align:center;">Packing</th>
              <th style="text-align:right;">Qty (Dz)</th>
              <th>Production Instructions</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRows}
            <tr class="total-row">
              <td colspan="3" style="border:1px solid #333;padding:8px 10px;text-align:right;">TOTAL</td>
              <td style="border:1px solid #333;padding:8px 10px;text-align:right;">${totalDozens}</td>
              <td style="border:1px solid #333;padding:8px 10px;"></td>
            </tr>
          </tbody>
        </table>
        ${order.notes ? `<div class="notes"><strong>Notes:</strong>${order.notes}</div>` : ''}
        <div class="footer">
          <div class="signature">Prepared By</div>
          <div class="signature">Checked By</div>
          <div class="signature">Packing Dept.</div>
        </div>
        <script>window.onload=function(){window.print();}</script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setFormData({
      customer_id: '',
      order_date: format(new Date(), 'yyyy-MM-dd'),
      required_date: '',
      expected_dispatch_date: '',
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
    });
  };

  const addItem = () => {
    setFormData({
      ...formData,
      items: [
        ...formData.items,
        { product_id: '', packing_type: 'standard', no_of_packages: '', quantity_dozens: '', price_per_dozen: '', production_instructions: '', details: '' },
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

    // Auto-calculate quantity_dozens when packing_type or no_of_packages changes
    if (field === 'packing_type' || field === 'no_of_packages') {
      const item = newItems[index];
      const packingDozens = getPackingDozens(item.packing_type);
      const packages = parseInt(item.no_of_packages) || 0;
      newItems[index].quantity_dozens = (packingDozens * packages).toString();
    }

    // Auto-fill price from customer_pricing on product change (only if no manual override yet).
    if (field === 'product_id' && value) {
      const existing = parseFloat(newItems[index].price_per_dozen);
      if (!existing || existing <= 0) {
        const lookup = priceForProduct(value);
        if (lookup > 0) newItems[index].price_per_dozen = lookup.toString();
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
    if (!formData.expected_dispatch_date) {
      toast.error('Dispatch Deadline is required');
      return;
    }
    const validItems = formData.items.filter(item => item.product_id && parseInt(item.quantity_dozens) > 0);
    if (validItems.length === 0) {
      toast.error('Please add at least one item with quantity');
      return;
    }
    const zeroRate = validItems.find(item => !(parseFloat(item.price_per_dozen) > 0));
    if (zeroRate) {
      toast.error('Set Rate/Dz on every line — zero rates would silently skip accounting auto-post.');
      return;
    }
    saveMutation.mutate(formData);
  };

  const getTotalQuantity = () => {
    return formData.items.reduce((sum, item) => sum + (parseInt(item.quantity_dozens) || 0), 0);
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
          title="Sales Orders"
          description="Manage domestic sales orders"
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
                  <SelectItem value="confirmed">Confirmed</SelectItem>
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
                  <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>New Domestic Sales Order</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="space-y-2 sm:col-span-1">
                          <Label>Customer *</Label>
                          <Popover open={customerPopoverOpen} onOpenChange={setCustomerPopoverOpen}>
                            <PopoverTrigger asChild>
                              <Button variant="outline" role="combobox" aria-expanded={customerPopoverOpen} className="w-full justify-between font-normal">
                                {formData.customer_id
                                  ? (() => { const c = customers?.find(c => c.id === formData.customer_id); return c ? `${c.code} - ${c.name}` : 'Select customer'; })()
                                  : 'Select customer'}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[300px] p-0" align="start">
                              <Command>
                                <CommandInput placeholder="Search customer..." />
                                <CommandList>
                                  <CommandEmpty>No customer found.</CommandEmpty>
                                  <CommandGroup>
                                    {customers?.map((c) => (
                                      <CommandItem
                                        key={c.id}
                                        value={`${c.code} ${c.name}`}
                                        onSelect={() => {
                                          handleCustomerChange(c.id);
                                          setCustomerPopoverOpen(false);
                                        }}
                                      >
                                        <Check className={cn("mr-2 h-4 w-4", formData.customer_id === c.id ? "opacity-100" : "opacity-0")} />
                                        {c.code} - {c.name}
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
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
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label>Dispatch Deadline *</Label>
                          <Input
                            type="date"
                            value={formData.expected_dispatch_date}
                            onChange={(e) => setFormData({ ...formData, expected_dispatch_date: e.target.value })}
                            required
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
                                <TableHead>Product *</TableHead>
                                <TableHead>Packing</TableHead>
                                <TableHead>No of Ctn/Bag</TableHead>
                                <TableHead>Qty (Dz) *</TableHead>
                                <TableHead>Rate / Dz *</TableHead>
                                <TableHead>Production Instructions</TableHead>
                                <TableHead>Details</TableHead>
                                <TableHead className="w-12"></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {formData.items.length === 0 ? (
                                <TableRow>
                                  <TableCell colSpan={8} className="text-center py-4 text-muted-foreground">
                                    No items added
                                  </TableCell>
                                </TableRow>
                              ) : (
                                formData.items.map((item, index) => (
                                  <TableRow key={index}>
                                    <TableCell>
                                      <SearchableSelect
                                        value={item.product_id}
                                        onValueChange={(v) => updateItem(index, 'product_id', v)}
                                        placeholder="Select Product"
                                        triggerClassName="w-48"
                                        options={(products || []).map((p: any) => ({
                                          value: p.id, label: p.name, secondary: `(${p.code})`, search: p.code,
                                        }))}
                                      />
                                    </TableCell>
                                    <TableCell>
                                      <Select value={item.packing_type} onValueChange={(v) => updateItem(index, 'packing_type', v)}>
                                        <SelectTrigger className="w-32">
                                          <SelectValue placeholder="Packing" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {PACKING_OPTIONS.map((opt) => (
                                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </TableCell>
                                    <TableCell>
                                      <Input
                                        type="number"
                                        min="1"
                                        value={item.no_of_packages}
                                        onChange={(e) => updateItem(index, 'no_of_packages', e.target.value)}
                                        className="w-20"
                                        placeholder="0"
                                      />
                                    </TableCell>
                                    <TableCell>
                                      <Input
                                        type="number"
                                        min="1"
                                        value={item.quantity_dozens}
                                        readOnly
                                        className="w-24 bg-muted"
                                        placeholder="0"
                                      />
                                    </TableCell>
                                    <TableCell>
                                      <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={item.price_per_dozen}
                                        onChange={(e) => updateItem(index, 'price_per_dozen', e.target.value)}
                                        className={`w-28 ${!(parseFloat(item.price_per_dozen) > 0) ? 'border-red-300' : ''}`}
                                        placeholder="Rs. 0"
                                      />
                                    </TableCell>
                                    <TableCell>
                                      <Input
                                        value={item.production_instructions}
                                        onChange={(e) => updateItem(index, 'production_instructions', e.target.value)}
                                        className="w-40"
                                        placeholder="Instructions..."
                                      />
                                    </TableCell>
                                    <TableCell>
                                      <Input
                                        value={item.details}
                                        onChange={(e) => updateItem(index, 'details', e.target.value)}
                                        className="w-44"
                                        placeholder="Details (prints on invoice)"
                                      />
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
                        {formData.items.length > 0 && (
                          <p className="text-sm text-muted-foreground text-right">
                            Total: {getTotalQuantity()} Dozens
                          </p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label>Notes</Label>
                        <Textarea
                          value={formData.notes}
                          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                          rows={2}
                          placeholder="Additional notes..."
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
                    <TableHead>Order #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Billing Customer</TableHead>
                    <TableHead>Dispatch Deadline</TableHead>
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
                               <div className="font-medium">{order.customers?.name}</div>
                               <div className="text-xs text-muted-foreground">{order.customers?.code}</div>
                             </TableCell>
                             <TableCell className="text-blue-600 font-medium">{(order.customers as any)?.billing_customer || '-'}</TableCell>
                             <TableCell>
                               <div className="flex items-center gap-1">
                                {order.expected_dispatch_date ? (
                                  <span className={
                                    !['dispatched', 'delivered', 'cancelled'].includes(order.status) && 
                                    new Date(order.expected_dispatch_date) < new Date() 
                                      ? 'text-destructive font-semibold' 
                                      : ''
                                  }>
                                    {format(new Date(order.expected_dispatch_date), 'dd MMM yyyy')}
                                    {!['dispatched', 'delivered', 'cancelled'].includes(order.status) && 
                                     new Date(order.expected_dispatch_date) < new Date() && (
                                      <span className="text-xs block">⚠ Late</span>
                                    )}
                                  </span>
                                ) : '-'}
                                {pendingOrderIds.has(order.id) && (
                                  <span title="Deadline change pending"><CalendarClock className="h-4 w-4 text-amber-500" /></span>
                                )}
                               </div>
                              </TableCell>
                             <TableCell onClick={(e) => e.stopPropagation()}>
                              {canEdit && order.status !== 'delivered' && order.status !== 'cancelled' ? (
                                <Select value={order.status} onValueChange={(status) => statusMutation.mutate({ id: order.id, status })}>
                                  <SelectTrigger className="w-36">
                                    <Badge className={STATUS_COLORS[order.status]}>{order.status.replace(/_/g, ' ')}</Badge>
                                  </SelectTrigger>
                                  <SelectContent>
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
                            <TableCell className="text-sm text-muted-foreground">
                              {(order as any).created_by_user?.full_name || '-'}
                            </TableCell>
                            <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex justify-end gap-1">
                                <Button variant="ghost" size="icon" onClick={() => setViewOrder(order)}>
                                  <Eye className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => handlePrintOrder(order, getOrderItems(order.id))} title="Print for Packing">
                                  <Printer className="h-4 w-4" />
                                 </Button>
                                {!['dispatched', 'delivered', 'cancelled'].includes(order.status) && (
                                  <Button variant="ghost" size="icon" onClick={() => {
                                    setDeadlineRequestOrder(order);
                                    setDeadlineRequestDate('');
                                    setDeadlineRequestReason('');
                                  }} title="Request Deadline Change">
                                    <CalendarClock className="h-4 w-4 text-amber-600" />
                                  </Button>
                                )}
                                {canEdit && (
                                  <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(order)}>
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                )}
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
                                          <TableHead className="h-8 text-xs">Packing</TableHead>
                                          <TableHead className="h-8 text-xs text-right">Qty (Dz)</TableHead>
                                          <TableHead className="h-8 text-xs">Instructions</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {items.map((item: any) => (
                                          <TableRow key={item.id} className="border-b-0">
                                            <TableCell className="py-1 text-sm">{item.products?.code} - {item.products?.name}</TableCell>
                                            <TableCell className="py-1 text-sm">{item.packing_type?.replace(/_/g, ' ') || '-'}</TableCell>
                                            <TableCell className="py-1 text-sm text-right">{item.quantity_dozens}</TableCell>
                                            <TableCell className="py-1 text-sm text-muted-foreground">{item.production_instructions || '-'}</TableCell>
                                          </TableRow>
                                        ))}
                                        <TableRow className="border-t">
                                          <TableCell colSpan={3} className="py-1 text-sm font-semibold text-right">Total:</TableCell>
                                          <TableCell className="py-1 text-sm font-semibold text-right">
                                            {items.reduce((sum: number, item: any) => sum + (item.quantity_dozens || 0), 0)}
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
                    <p className="text-muted-foreground">Status</p>
                    <Badge className={STATUS_COLORS[viewOrder.status]}>{viewOrder.status.replace(/_/g, ' ')}</Badge>
                  </div>
                  {viewOrder.required_date && (
                     <div>
                       <p className="text-muted-foreground">Required Date</p>
                       <p className="font-medium">{format(new Date(viewOrder.required_date), 'dd MMM yyyy')}</p>
                     </div>
                   )}
                   {viewOrder.expected_dispatch_date && (
                     <div>
                       <p className="text-muted-foreground">Dispatch Deadline</p>
                       <p className="font-medium">{format(new Date(viewOrder.expected_dispatch_date), 'dd MMM yyyy')}</p>
                     </div>
                   )}
                 </div>
                <div>
                  <h4 className="font-semibold mb-2">Items</h4>
                  <Table>
                    <TableHeader>
                       <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Packing</TableHead>
                        <TableHead className="text-right">Qty (Dz)</TableHead>
                        <TableHead>Instructions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orderItems?.map((item: any) => (
                        <TableRow key={item.id}>
                          <TableCell>{item.products?.code} - {item.products?.name}</TableCell>
                          <TableCell>{item.packing_type || '-'}</TableCell>
                          <TableCell className="text-right">{item.quantity_dozens}</TableCell>
                          <TableCell className="text-muted-foreground">{item.production_instructions || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {viewOrder.notes && (
                  <div>
                    <p className="text-muted-foreground text-sm">Notes</p>
                    <p className="text-sm">{viewOrder.notes}</p>
                  </div>
                )}
                <div className="flex justify-end pt-2">
                  <Button variant="outline" size="sm" onClick={() => handlePrintOrder(viewOrder, orderItems || [])}>
                    <Printer className="h-4 w-4 mr-2" /> Print for Packing
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Edit Order Dialog - Super Admin Only */}
        <Dialog open={!!editOrder} onOpenChange={() => setEditOrder(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Order - {editOrder?.order_number}</DialogTitle>
            </DialogHeader>
            {editOrder && (
              <form onSubmit={handleEditSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Customer *</Label>
                    <Popover open={editCustomerPopoverOpen} onOpenChange={setEditCustomerPopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" role="combobox" aria-expanded={editCustomerPopoverOpen} className="w-full justify-between font-normal">
                          {editFormData.customer_id
                            ? (() => { const c = customers?.find(c => c.id === editFormData.customer_id); return c ? `${c.code} - ${c.name}` : 'Select customer'; })()
                            : 'Select customer'}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[300px] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search customer..." />
                          <CommandList>
                            <CommandEmpty>No customer found.</CommandEmpty>
                            <CommandGroup>
                              {customers?.map((c) => (
                                <CommandItem
                                  key={c.id}
                                  value={`${c.code} ${c.name}`}
                                  onSelect={() => {
                                    setEditFormData({ ...editFormData, customer_id: c.id });
                                    setEditCustomerPopoverOpen(false);
                                  }}
                                >
                                  <Check className={cn("mr-2 h-4 w-4", editFormData.customer_id === c.id ? "opacity-100" : "opacity-0")} />
                                  {c.code} - {c.name}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-2">
                    <Label>Order Date</Label>
                    <Input
                      type="date"
                      value={editFormData.order_date}
                      onChange={(e) => setEditFormData({ ...editFormData, order_date: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Dispatch Deadline *</Label>
                    <Input
                      type="date"
                      value={editFormData.expected_dispatch_date}
                      onChange={(e) => setEditFormData({ ...editFormData, expected_dispatch_date: e.target.value })}
                      required
                      disabled={!isSuperAdmin}
                      className={!isSuperAdmin ? 'bg-muted cursor-not-allowed' : ''}
                    />
                    {!isSuperAdmin && (
                      <p className="text-xs text-muted-foreground">Use the 📅 button on the order row to request a deadline change</p>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Order Items</Label>
                    <Button type="button" variant="default" size="sm" onClick={addEditItem}>
                      <Plus className="h-4 w-4 mr-1" /> Add Item
                    </Button>
                  </div>
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product *</TableHead>
                          <TableHead>Packing</TableHead>
                          <TableHead>No of Ctn/Bag</TableHead>
                          <TableHead>Qty (Dz) *</TableHead>
                          <TableHead>Rate / Dz *</TableHead>
                          <TableHead>Production Instructions</TableHead>
                          <TableHead>Details</TableHead>
                          <TableHead className="w-12"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {editFormData.items.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={8} className="text-center py-4 text-muted-foreground">
                              No items added
                            </TableCell>
                          </TableRow>
                        ) : (
                          editFormData.items.map((item, index) => (
                            <TableRow key={index}>
                              <TableCell>
                                <SearchableSelect
                                  value={item.product_id}
                                  onValueChange={(v) => updateEditItem(index, 'product_id', v)}
                                  placeholder="Select Product"
                                  triggerClassName="w-48"
                                  options={(products || []).map((p: any) => ({
                                    value: p.id, label: p.name, secondary: `(${p.code})`, search: p.code,
                                  }))}
                                />
                              </TableCell>
                              <TableCell>
                                <Select value={item.packing_type} onValueChange={(v) => updateEditItem(index, 'packing_type', v)}>
                                  <SelectTrigger className="w-32">
                                    <SelectValue placeholder="Packing" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {PACKING_OPTIONS.map((opt) => (
                                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  min="1"
                                  value={item.no_of_packages}
                                  onChange={(e) => updateEditItem(index, 'no_of_packages', e.target.value)}
                                  className="w-20"
                                  placeholder="0"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  min="1"
                                  value={item.quantity_dozens}
                                  readOnly
                                  className="w-24 bg-muted"
                                  placeholder="0"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={item.price_per_dozen}
                                  onChange={(e) => updateEditItem(index, 'price_per_dozen', e.target.value)}
                                  className={`w-28 ${!(parseFloat(item.price_per_dozen) > 0) ? 'border-red-300' : ''}`}
                                  placeholder="Rs. 0"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  value={item.production_instructions}
                                  onChange={(e) => updateEditItem(index, 'production_instructions', e.target.value)}
                                  className="w-40"
                                  placeholder="Instructions..."
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  value={item.details}
                                  onChange={(e) => updateEditItem(index, 'details', e.target.value)}
                                  className="w-44"
                                  placeholder="Details (prints on invoice)"
                                />
                              </TableCell>
                              <TableCell>
                                <Button type="button" variant="ghost" size="icon" onClick={() => removeEditItem(index)}>
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  {editFormData.items.length > 0 && (
                    <p className="text-sm text-muted-foreground text-right">
                      Total: {getEditTotalQuantity()} Dozens
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Shipping Address</Label>
                    <Textarea
                      value={editFormData.shipping_address}
                      onChange={(e) => setEditFormData({ ...editFormData, shipping_address: e.target.value })}
                      rows={2}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Textarea
                      value={editFormData.notes}
                      onChange={(e) => setEditFormData({ ...editFormData, notes: e.target.value })}
                      rows={2}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => setEditOrder(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={updateMutation.isPending}>
                    {updateMutation.isPending ? 'Saving...' : 'Update Order'}
                  </Button>
                </div>
              </form>
            )}
          </DialogContent>
        </Dialog>

        {/* Deadline Change Request Dialog */}
        <Dialog open={!!deadlineRequestOrder} onOpenChange={() => { setDeadlineRequestOrder(null); setDeadlineRequestDate(''); setDeadlineRequestReason(''); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Request Deadline Change — {deadlineRequestOrder?.order_number}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Current Deadline: <span className="font-semibold text-foreground">
                  {deadlineRequestOrder?.expected_dispatch_date ? format(new Date(deadlineRequestOrder.expected_dispatch_date), 'dd MMM yyyy') : 'Not set'}
                </span>
              </div>
              <div className="space-y-2">
                <Label>New Requested Deadline *</Label>
                <Input
                  type="date"
                  value={deadlineRequestDate}
                  onChange={(e) => setDeadlineRequestDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Reason for Change *</Label>
                <Textarea
                  value={deadlineRequestReason}
                  onChange={(e) => setDeadlineRequestReason(e.target.value)}
                  placeholder="Explain why the deadline needs to change..."
                  rows={3}
                  required
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setDeadlineRequestOrder(null); setDeadlineRequestDate(''); setDeadlineRequestReason(''); }}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (!deadlineRequestDate) { toast.error('Please select a new deadline date'); return; }
                    if (!deadlineRequestReason.trim()) { toast.error('Please provide a reason'); return; }
                    deadlineRequestMutation.mutate({
                      orderId: deadlineRequestOrder.id,
                      currentDeadline: deadlineRequestOrder.expected_dispatch_date || deadlineRequestDate,
                      requestedDeadline: deadlineRequestDate,
                      reason: deadlineRequestReason.trim(),
                    });
                  }}
                  disabled={deadlineRequestMutation.isPending}
                >
                  {deadlineRequestMutation.isPending ? 'Submitting...' : 'Submit Request'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
