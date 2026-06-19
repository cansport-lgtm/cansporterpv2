import { useEffect, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePackingTypes, dozensForLabel } from "@/hooks/usePackingTypes";
import { toast } from "sonner";
import { Plus, Search, Truck, Eye, X, Printer, Pencil, FileText } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { postDispatchVoucher } from "@/lib/accounting/postDispatchVoucher";
import { postCOGSForDispatch } from "@/lib/accounting/postCOGSForDispatch";
import { createInvoiceForDispatch } from "@/lib/sales/createInvoiceForDispatch";

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-500',
  in_transit: 'bg-blue-500',
  delivered: 'bg-green-500',
  returned: 'bg-red-500',
  acknowledged: 'bg-purple-500',
};

interface OrderItem {
  order_item_id: string;
  order_id: string;
  order_number: string;
  product_code: string;
  product_name: string;
  available_qty: number;
  quantity_dozens: string;
  packages: string;
  packing_type: string;
  customer_name: string;
  customer_code: string;
}

export default function DomesticDispatchPage() {
  const queryClient = useQueryClient();
  const { user, hasModulePermission } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [viewDispatch, setViewDispatch] = useState<any>(null);
  const [editDispatch, setEditDispatch] = useState<any>(null);
  const [editItems, setEditItems] = useState<Array<{ id: string; quantity_dozens: number; packages: number; packing_type: string; num_bags_ctn: number; product_code: string; product_name: string; order_number: string; customer_name: string }>>([]);

  // Packing options with their dozen multipliers
  const { data: packingTypes = [] } = usePackingTypes();
  const [isPrintMode, setIsPrintMode] = useState(false);
  const [formData, setFormData] = useState({
    dispatch_date: format(new Date(), 'yyyy-MM-dd'),
    vehicle_number: '',
    driver_name: '',
    driver_contact: '',
    transporter_name: '',
    delivery_address: '',
    expected_delivery_date: '',
    notes: '',
    items: [] as OrderItem[],
  });

  const canCreate = hasModulePermission('sales', 'create');
  const canEdit = hasModulePermission('sales', 'edit');

  useEffect(() => {
    const onAfterPrint = () => setIsPrintMode(false);
    window.addEventListener('afterprint', onAfterPrint);
    return () => window.removeEventListener('afterprint', onAfterPrint);
  }, []);

  const handlePrint = () => {
    setIsPrintMode(true);
    // Give React a moment to render the compact print view before printing
    window.setTimeout(() => window.print(), 100);
  };

  // Fetch dispatches for domestic segment
  const { data: dispatches, isLoading } = useQuery({
    queryKey: ['sales-dispatches', 'domestic'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_dispatches')
        .select(`
          *,
          sales_orders(order_number, customers(name, code)),
          sales_dispatch_orders(order_id, sales_orders(order_number, customers(name, code)))
        `)
        .eq('sales_segment', 'domestic')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  // Fetch dispatch items for viewing
  const { data: dispatchItems } = useQuery({
    queryKey: ['dispatch-items', viewDispatch?.id],
    queryFn: async () => {
      if (!viewDispatch?.id) return [];
      const { data, error } = await supabase
        .from('sales_dispatch_items')
        .select(`*, sales_order_items!inner(quantity_dozens, order_id, products(code, name), sales_orders(order_number, customers(name, code)))`)
        .eq('dispatch_id', viewDispatch.id);

      if (error) throw error;
      return data;
    },
    enabled: !!viewDispatch?.id,
  });

  // Fetch dispatch items for editing
  const { data: editDispatchItems, refetch: refetchEditItems } = useQuery({
    queryKey: ['edit-dispatch-items', editDispatch?.id],
    queryFn: async () => {
      if (!editDispatch?.id) return [];
      const { data, error } = await supabase
        .from('sales_dispatch_items')
        .select(`*, sales_order_items!inner(quantity_dozens, order_id, products(code, name), sales_orders(order_number, customers(name, code)))`)
        .eq('dispatch_id', editDispatch.id);

      if (error) throw error;
      return data;
    },
    enabled: !!editDispatch?.id,
  });

  // Fetch orders for dispatch (for domestic segment)
  const { data: pendingOrders } = useQuery({
    queryKey: ['orders-for-dispatch', 'domestic'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_orders')
        .select(`id, order_number, shipping_address, customers(name, code, billing_customer)`)
        .eq('sales_segment', 'domestic')
        .in('status', ['confirmed', 'in_production', 'ready', 'partially_dispatched'])
        .order('order_date', { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  // Fetch order items for selected orders
  const { data: orderItems, refetch: refetchOrderItems } = useQuery({
    queryKey: ['order-items-for-dispatch', selectedOrders],
    queryFn: async () => {
      if (selectedOrders.length === 0) return [];
      const { data, error } = await supabase
        .from('sales_order_items')
        .select(`id, order_id, quantity_dozens, quantity_dispatched, price_per_dozen, packing_type, products(code, name), sales_orders(order_number, customers(name, code))`)
        .in('order_id', selectedOrders);

      if (error) throw error;
      return data?.filter(item => (item.quantity_dozens - (item.quantity_dispatched || 0)) > 0);
    },
    enabled: selectedOrders.length > 0,
  });

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData & { selectedOrders: string[] }) => {
      // Create dispatch without order_id (multi-order)
      const { data: newDispatch, error: dispatchError } = await supabase
        .from('sales_dispatches')
        .insert({
          dispatch_number: '',
          order_id: null, // Multi-order dispatch
          dispatch_date: data.dispatch_date,
          vehicle_number: data.vehicle_number || null,
          driver_name: data.driver_name || null,
          driver_contact: data.driver_contact || null,
          transporter_name: data.transporter_name || null,
          delivery_address: data.delivery_address || null,
          expected_delivery_date: data.expected_delivery_date || null,
          notes: data.notes || null,
          dispatched_by: user?.id,
          delivery_status: 'pending',
          sales_segment: 'domestic',
        })
        .select()
        .single();

      if (dispatchError) throw dispatchError;

      // Link orders to dispatch
      if (data.selectedOrders.length > 0) {
        const orderLinks = data.selectedOrders.map(orderId => ({
          dispatch_id: newDispatch.id,
          order_id: orderId,
        }));

        const { error: linkError } = await supabase
          .from('sales_dispatch_orders')
          .insert(orderLinks);

        if (linkError) throw linkError;
      }

      // Insert dispatch items
      if (data.items.length > 0) {
        const items = data.items
          .filter(item => parseFloat(item.quantity_dozens) > 0)
          .map(item => ({
            dispatch_id: newDispatch.id,
            order_item_id: item.order_item_id,
            quantity_dozens: parseFloat(item.quantity_dozens),
            packages: parseInt(item.packages) || 1,
            packing_type: item.packing_type || null,
          }));

        if (items.length > 0) {
          const { error: itemsError } = await supabase
            .from('sales_dispatch_items')
            .insert(items);

          if (itemsError) throw itemsError;
        }
      }

      return newDispatch;
    },
    onSuccess: async (newDispatch: any) => {
      queryClient.invalidateQueries({ queryKey: ['sales-dispatches', 'domestic'] });
      queryClient.invalidateQueries({ queryKey: ['orders-for-dispatch', 'domestic'] });
      queryClient.invalidateQueries({ queryKey: ['domestic-orders-status'] });
      queryClient.invalidateQueries({ queryKey: ['domestic-orders'] });
      queryClient.invalidateQueries({ queryKey: ['domestic-orders-pending-dispatch'] });
      toast.success('Dispatch created');
      handleCloseDialog();

      // Phase 2A: auto-post AR/Sales journal (Dr AR / Cr Sales).
      // Phase 3b: also auto-post COGS journal (Dr COGS / Cr FG).
      // Non-blocking: dispatch is already saved. Failures surface as warnings only.
      if (newDispatch?.id) {
        const arResult = await postDispatchVoucher(newDispatch.id);
        if (arResult.ok && arResult.vouchers && arResult.vouchers.length > 0) {
          toast.success(`AR voucher posted (${arResult.vouchers.length})`);
        } else if (!arResult.ok) {
          toast.error(`AR auto-post failed: ${arResult.error}`);
        }
        if (arResult.skippedNoBilling && arResult.skippedNoBilling.length > 0) {
          const names = arResult.skippedNoBilling.map((s) => s.name).join(", ");
          toast.warning(`AR not posted — no billing customer set for: ${names}`);
        }

        const cogsResult = await postCOGSForDispatch(newDispatch.id);
        if (cogsResult.ok && cogsResult.voucherNumber && !cogsResult.skipped) {
          toast.success(`COGS voucher posted: ${cogsResult.voucherNumber}`);
        } else if (cogsResult.skipped === "perpetual_disabled") {
          // Silent — periodic mode is intentional. COGS will be posted at month-end via /accounting/periodic-cogs.
        } else if (cogsResult.skipped === "zero_cost" && cogsResult.zeroCostProducts?.length) {
          toast.warning(`COGS skipped — products without standard_cost: ${cogsResult.zeroCostProducts.join(", ")}`);
        } else if (!cogsResult.ok) {
          toast.error(`COGS auto-post failed: ${cogsResult.error}`);
        }

        // Every dispatch must produce an invoice — create the draft invoice(s) now.
        const invResult = await createInvoiceForDispatch(newDispatch.id, { createdBy: user?.id });
        if (invResult.ok && invResult.created.length > 0) {
          toast.success(`Invoice created: ${invResult.created.join(", ")}`);
        } else if (!invResult.ok) {
          toast.error(`Invoice auto-create failed: ${invResult.error}. Create it from the Invoices page.`);
        }
        if (invResult.skippedZeroPrice > 0) {
          toast.warning(`${invResult.skippedZeroPrice} invoice(s) skipped — items have no selling price (Rs. 0). Fix prices on the sales order.`);
        }
        queryClient.invalidateQueries({ queryKey: ["domestic-invoices"] });
        queryClient.invalidateQueries({ queryKey: ["invoiceable-dispatches"] });
      }
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
      queryClient.invalidateQueries({ queryKey: ['sales-dispatches', 'domestic'] });
      toast.success('Status updated');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Edit mutation
  const editMutation = useMutation({
    mutationFn: async (data: { id: string; updates: Partial<typeof formData>; items: typeof editItems }) => {
      // Update dispatch header
      const { error } = await supabase
        .from('sales_dispatches')
        .update({
          dispatch_date: data.updates.dispatch_date,
          vehicle_number: data.updates.vehicle_number || null,
          driver_name: data.updates.driver_name || null,
          driver_contact: data.updates.driver_contact || null,
          transporter_name: data.updates.transporter_name || null,
          delivery_address: data.updates.delivery_address || null,
          expected_delivery_date: data.updates.expected_delivery_date || null,
          notes: data.updates.notes || null,
        })
        .eq('id', data.id);
      if (error) throw error;

      // Update dispatch items
      for (const item of data.items) {
        const { error: itemError } = await supabase
          .from('sales_dispatch_items')
          .update({
            quantity_dozens: item.quantity_dozens,
            packages: item.packages,
            packing_type: item.packing_type || null,
          })
          .eq('id', item.id);
        if (itemError) throw itemError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-dispatches', 'domestic'] });
      queryClient.invalidateQueries({ queryKey: ['edit-dispatch-items'] });
      toast.success('Dispatch updated');
      handleCloseEditDialog();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setSelectedOrders([]);
    setFormData({
      dispatch_date: format(new Date(), 'yyyy-MM-dd'),
      vehicle_number: '',
      driver_name: '',
      driver_contact: '',
      transporter_name: '',
      delivery_address: '',
      expected_delivery_date: '',
      notes: '',
      items: [],
    });
  };

  const handleCloseEditDialog = () => {
    setEditDispatch(null);
    setEditItems([]);
  };

  const handleOpenEditDialog = (dispatch: any) => {
    setEditDispatch(dispatch);
  };

  // Load edit items when editDispatchItems changes
  useEffect(() => {
    if (editDispatchItems && editDispatchItems.length > 0) {
      setEditItems(editDispatchItems.map((item: any) => {
        // Try to determine packing type from existing data or default to '12dz ctn'
        const qtyDz = item.quantity_dozens || 0;
        const pkgs = item.packages || 1;
        // Infer packing type from qty/packages ratio
        let packingType = '12dz ctn';
        if (pkgs > 0) {
          const ratio = qtyDz / pkgs;
          if (ratio === 60) packingType = '60dz bag';
          else if (ratio === 20) packingType = '20dz bag';
          else if (ratio === 6) packingType = '6 dz ctn';
          else packingType = '12dz ctn';
        }
        return {
          id: item.id,
          quantity_dozens: qtyDz,
          packages: pkgs,
          packing_type: packingType,
          num_bags_ctn: pkgs,
          product_code: item.sales_order_items?.products?.code || '-',
          product_name: item.sales_order_items?.products?.name || '-',
          order_number: item.sales_order_items?.sales_orders?.order_number || '-',
          customer_name: item.sales_order_items?.sales_orders?.customers?.name || '-',
        };
      }));
    }
  }, [editDispatchItems]);

  const updateEditItem = (index: number, field: 'packing_type' | 'num_bags_ctn', value: string | number) => {
    const newItems = [...editItems];
    const item = { ...newItems[index] };
    
    if (field === 'packing_type') {
      item.packing_type = value as string;
      // Recalculate quantity based on new packing type
      const multiplier = dozensForLabel(value as string, packingTypes, 12);
      item.quantity_dozens = item.num_bags_ctn * multiplier;
    } else if (field === 'num_bags_ctn') {
      item.num_bags_ctn = value as number;
      item.packages = value as number;
      // Recalculate quantity based on packing type
      const multiplier = dozensForLabel(item.packing_type, packingTypes, 12);
      item.quantity_dozens = (value as number) * multiplier;
    }
    
    newItems[index] = item;
    setEditItems(newItems);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editDispatch) return;
    
    const formElements = e.target as HTMLFormElement;
    const updates = {
      dispatch_date: (formElements.elements.namedItem('edit_dispatch_date') as HTMLInputElement)?.value || editDispatch.dispatch_date,
      vehicle_number: (formElements.elements.namedItem('edit_vehicle_number') as HTMLInputElement)?.value || '',
      driver_name: (formElements.elements.namedItem('edit_driver_name') as HTMLInputElement)?.value || '',
      driver_contact: (formElements.elements.namedItem('edit_driver_contact') as HTMLInputElement)?.value || '',
      transporter_name: (formElements.elements.namedItem('edit_transporter_name') as HTMLInputElement)?.value || '',
      delivery_address: (formElements.elements.namedItem('edit_delivery_address') as HTMLTextAreaElement)?.value || '',
      expected_delivery_date: (formElements.elements.namedItem('edit_expected_delivery_date') as HTMLInputElement)?.value || '',
      notes: (formElements.elements.namedItem('edit_notes') as HTMLTextAreaElement)?.value || '',
    };
    
    editMutation.mutate({ id: editDispatch.id, updates, items: editItems });
  };

  const toggleOrderSelection = (orderId: string) => {
    setSelectedOrders(prev => 
      prev.includes(orderId) 
        ? prev.filter(id => id !== orderId)
        : [...prev, orderId]
    );
  };

  const loadOrderItems = () => {
    if (orderItems && orderItems.length > 0) {
      // Sort items by customer name for grouping
      const sortedItems = [...orderItems].sort((a, b) => {
        const customerA = (a.sales_orders as any)?.customers?.name || '';
        const customerB = (b.sales_orders as any)?.customers?.name || '';
        return customerA.localeCompare(customerB);
      });
      
      setFormData(prev => ({
        ...prev,
        items: sortedItems.map(item => {
          const available = item.quantity_dozens - (item.quantity_dispatched || 0);
          const packing = (item as any).packing_type || '';
          const dozens = dozensForLabel(packing, packingTypes);
          const pkgs = dozens > 0 ? available / dozens : 0;
          return {
            order_item_id: item.id,
            order_id: item.order_id,
            order_number: item.sales_orders?.order_number || '-',
            product_code: item.products?.code || '-',
            product_name: (item.products as any)?.name || '-',
            available_qty: available,
            quantity_dozens: available > 0 ? String(available) : '',
            packages: pkgs > 0 ? String(pkgs) : '1',
            packing_type: packing,
            customer_name: (item.sales_orders as any)?.customers?.name || '-',
            customer_code: (item.sales_orders as any)?.customers?.code || '-',
          };
        }),
      }));
    }
  };

  const updateItem = (index: number, field: string, value: string) => {
    const newItems = [...formData.items];
    newItems[index] = { ...newItems[index], [field]: value };
    // Auto-calculate dispatch qty from packing × packages (editable afterwards)
    if (field === 'packing_type' || field === 'packages') {
      const dozens = dozensForLabel(newItems[index].packing_type, packingTypes);
      const pkgs = parseFloat(newItems[index].packages) || 0;
      newItems[index].quantity_dozens = (dozens * pkgs).toString();
    }
    setFormData({ ...formData, items: newItems });
  };

  // Remove a line from THIS dispatch (items not being delivered now). The order
  // stays partially_dispatched so the remaining items can be dispatched later.
  const removeItem = (index: number) => {
    setFormData(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedOrders.length === 0) {
      toast.error('Please select at least one order');
      return;
    }
    const hasItems = formData.items.some(item => parseFloat(item.quantity_dozens) > 0);
    if (!hasItems) {
      toast.error('Please add dispatch quantities');
      return;
    }
    // A dispatch must be able to post to Accounts Receivable — block it if any
    // selected order's customer has no Billing Customer set, otherwise the sale
    // would silently miss the ledger.
    const missingBilling = [...new Set(
      selectedOrders
        .map(id => pendingOrders?.find(o => o.id === id))
        .filter(o => o && !(((o.customers as any)?.billing_customer || '').trim()))
        .map(o => (o!.customers as any)?.name)
        .filter(Boolean)
    )];
    if (missingBilling.length > 0) {
      toast.error(
        `Cannot dispatch: no Billing Customer set for ${missingBilling.join(', ')}. ` +
        `Set it in Sales → Customers first so the sale posts to Accounts Receivable.`
      );
      return;
    }
    // Block zero-price lines — these post COGS but no revenue/AR (the cause of
    // dispatches like DC-00053/54). Fix the price on the sales order first.
    const priceByItemId = new Map((orderItems || []).map((i: any) => [i.id, Number(i.price_per_dozen) || 0]));
    const zeroPriced = formData.items.filter(
      (item) => (parseFloat(item.quantity_dozens) || 0) > 0 && !(((priceByItemId.get(item.order_item_id) as number) || 0) > 0)
    );
    if (zeroPriced.length > 0) {
      toast.error('Cannot dispatch: one or more items have no selling price (Rs. 0). Set the price on the sales order first.');
      return;
    }
    saveMutation.mutate({ ...formData, selectedOrders });
  };

  const getDispatchOrdersDisplay = (dispatch: any) => {
    // Check if it has linked orders (multi-order dispatch)
    if (dispatch.sales_dispatch_orders?.length > 0) {
      const orders = dispatch.sales_dispatch_orders.map((link: any) => link.sales_orders?.order_number).filter(Boolean);
      return orders.join(', ');
    }
    // Fallback to single order
    return dispatch.sales_orders?.order_number || '-';
  };

  const getDispatchCustomersDisplay = (dispatch: any) => {
    // Check if it has linked orders (multi-order dispatch)
    if (dispatch.sales_dispatch_orders?.length > 0) {
      const customers = [...new Set(dispatch.sales_dispatch_orders.map((link: any) => link.sales_orders?.customers?.name).filter(Boolean))];
      return customers.join(', ');
    }
    // Fallback to single order
    return dispatch.sales_orders?.customers?.name || '-';
  };

  const filteredDispatches = dispatches?.filter(d => {
    const orderNumbers = getDispatchOrdersDisplay(d).toLowerCase();
    const customers = getDispatchCustomersDisplay(d).toLowerCase();
    const matchesSearch = 
      d.dispatch_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      orderNumbers.includes(searchTerm.toLowerCase()) ||
      customers.includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || d.delivery_status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const DispatchSheet = ({ dispatch, items }: { dispatch: any; items: any[] }) => {
    const customerGroups = items.reduce((acc: Record<string, any[]>, item: any) => {
      const customerName = item.sales_order_items?.sales_orders?.customers?.name || 'Unknown';
      if (!acc[customerName]) acc[customerName] = [];
      acc[customerName].push(item);
      return acc;
    }, {});

    const grandTotalDz = items.reduce((sum: number, item: any) => sum + (item.quantity_dozens || 0), 0);
    const grandTotalPackages = items.reduce((sum: number, item: any) => sum + (item.packages || 0), 0);

    const qrData = JSON.stringify({
      dispatch: dispatch?.dispatch_number,
      orders: getDispatchOrdersDisplay(dispatch),
      customers: getDispatchCustomersDisplay(dispatch),
      date: dispatch?.dispatch_date,
      vehicle: dispatch?.vehicle_number || '',
      status: dispatch?.delivery_status || '',
    });

    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between border-b pb-4">
          <div className="text-center flex-1">
            <h2 className="text-xl font-bold">Dispatch Sheet</h2>
            <p className="text-sm text-muted-foreground">{dispatch?.dispatch_number}</p>
          </div>
          <div className="flex-shrink-0">
            <QRCodeSVG value={qrData} size={100} />
            <p className="text-[10px] text-muted-foreground text-center mt-1">Scan to track</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Order(s)</p>
            <p className="font-medium">{getDispatchOrdersDisplay(dispatch)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Customer(s)</p>
            <p className="font-medium">{getDispatchCustomersDisplay(dispatch)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Dispatch Date</p>
            <p className="font-medium">{dispatch?.dispatch_date ? format(new Date(dispatch.dispatch_date), 'dd MMM yyyy') : '-'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Status</p>
            <Badge className={`${STATUS_COLORS[dispatch?.delivery_status] ?? ''} print:bg-transparent print:text-foreground print:border print:border-border`}>
              {(dispatch?.delivery_status || '-').replace('_', ' ')}
            </Badge>
          </div>
          <div>
            <p className="text-muted-foreground">Vehicle Number</p>
            <p className="font-medium">{dispatch?.vehicle_number || '-'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Driver</p>
            <p className="font-medium">
              {dispatch?.driver_name || '-'} {dispatch?.driver_contact ? `(${dispatch.driver_contact})` : ''}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Transporter</p>
            <p className="font-medium">{dispatch?.transporter_name || '-'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Expected Delivery</p>
            <p className="font-medium">
              {dispatch?.expected_delivery_date ? format(new Date(dispatch.expected_delivery_date), 'dd MMM yyyy') : '-'}
            </p>
          </div>
        </div>

        {dispatch?.delivery_address && (
          <div className="text-sm">
            <p className="text-muted-foreground">Delivery Address</p>
            <p className="font-medium">{dispatch.delivery_address}</p>
          </div>
        )}

        <div>
          <h4 className="font-semibold mb-2">Dispatched Items (Customer-wise)</h4>
          {Object.entries(customerGroups).map(([customerName, customerItems]) => (
            <div key={customerName} className="border rounded-lg mb-2">
              <div className="bg-muted/50 px-3 py-2 font-semibold text-sm">
                {customerName}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Packing</TableHead>
                    <TableHead className="text-right">Qty (Dz)</TableHead>
                    <TableHead className="text-right">Packages</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(customerItems as any[]).map((item: any) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs">
                        {item.sales_order_items?.sales_orders?.order_number}
                      </TableCell>
                      <TableCell>
                        {item.sales_order_items?.products?.code} - {item.sales_order_items?.products?.name}
                      </TableCell>
                      <TableCell>{item.packing_type || '-'}</TableCell>
                      <TableCell className="text-right">{item.quantity_dozens}</TableCell>
                      <TableCell className="text-right">{item.packages || '-'}</TableCell>
                    </TableRow>
                  ))}

                  <TableRow className="font-semibold bg-muted/30">
                    <TableCell colSpan={3}>Subtotal</TableCell>
                    <TableCell className="text-right">
                      {(customerItems as any[]).reduce((sum: number, item: any) => sum + (item.quantity_dozens || 0), 0)} Dz
                    </TableCell>
                    <TableCell className="text-right">
                      {(customerItems as any[]).reduce((sum: number, item: any) => sum + (item.packages || 0), 0)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          ))}

          <div className="border rounded-lg p-3 bg-primary/5 mt-2">
            <div className="flex justify-between font-bold text-sm">
              <span>Grand Total</span>
              <span>{grandTotalDz} Dz | {grandTotalPackages} Packages</span>
            </div>
          </div>
        </div>

        {dispatch?.notes && (
          <div className="text-sm">
            <p className="text-muted-foreground">Notes</p>
            <p className="font-medium">{dispatch.notes}</p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-8 mt-8 pt-8 border-t">
          <div className="text-center">
            <div className="border-b border-border mb-1 h-12"></div>
            <p className="text-xs">Prepared By</p>
          </div>
          <div className="text-center">
            <div className="border-b border-border mb-1 h-12"></div>
            <p className="text-xs">Checked By</p>
          </div>
          <div className="text-center">
            <div className="border-b border-border mb-1 h-12"></div>
            <p className="text-xs">Received By</p>
          </div>
        </div>
      </div>
    );
  };

  // Fast print path: render ONLY the dispatch sheet. Printing the full page was
  // slow because the old @media-print rule used `visibility:hidden` on every
  // element, which keeps the entire app (list, layout, dialogs) in layout — so
  // the browser had to paginate the whole document. Rendering just the sheet
  // here means there is almost nothing for the browser to lay out.
  if (isPrintMode && viewDispatch) {
    return (
      <div className="p-6 max-w-3xl mx-auto bg-white text-black">
        <style>{`
          @media print {
            @page { margin: 12mm; }
            table { border-collapse: collapse !important; }
            th, td { border: 1px solid #ddd !important; padding: 6px 8px !important; }
            * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          }
        `}</style>
        <div className="flex justify-end mb-4 print:hidden">
          <Button variant="outline" size="sm" onClick={() => setIsPrintMode(false)}>
            <X className="h-4 w-4 mr-2" />
            Close
          </Button>
        </div>
        <div id="dispatch-print-content">
          <DispatchSheet dispatch={viewDispatch} items={dispatchItems ?? []} />
        </div>
      </div>
    );
  }

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader 
          title="Dispatch"
          description="Manage dispatches and track deliveries"
        />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg flex items-center gap-2">
              <Truck className="h-5 w-5" />
              Dispatch List
            </CardTitle>
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
                <Dialog open={isDialogOpen} onOpenChange={(open) => {
                  if (!open) handleCloseDialog();
                  else setIsDialogOpen(true);
                }}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="h-4 w-4 mr-2" />
                      New Dispatch
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Create Dispatch (Multi-Order)</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-4">
                      {/* Order Selection */}
                      <div className="space-y-2">
                        <Label>Select Orders *</Label>
                        <div className="border rounded-lg max-h-48 overflow-y-auto">
                          {pendingOrders?.length === 0 ? (
                            <p className="text-center py-4 text-muted-foreground">No pending orders</p>
                          ) : (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-12"></TableHead>
                                  <TableHead>Order #</TableHead>
                                  <TableHead>Customer</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {pendingOrders?.map((order) => (
                                  <TableRow key={order.id} className="cursor-pointer hover:bg-muted/50" onClick={() => toggleOrderSelection(order.id)}>
                                    <TableCell onClick={(e) => e.stopPropagation()}>
                                      <Checkbox 
                                        checked={selectedOrders.includes(order.id)}
                                        onCheckedChange={() => toggleOrderSelection(order.id)}
                                      />
                                    </TableCell>
                                    <TableCell className="font-mono">{order.order_number}</TableCell>
                                    <TableCell>{order.customers?.name}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          )}
                        </div>
                        {selectedOrders.length > 0 && (
                          <p className="text-sm text-muted-foreground">
                            {selectedOrders.length} order(s) selected
                          </p>
                        )}
                      </div>

                      <div className="grid grid-cols-3 gap-4">
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
                        <div className="flex items-end">
                          <Button 
                            type="button" 
                            variant="outline" 
                            onClick={() => { refetchOrderItems().then(() => loadOrderItems()); }}
                            disabled={selectedOrders.length === 0}
                          >
                            Load Items
                          </Button>
                        </div>
                      </div>

                      {formData.items.length > 0 && (
                        <div className="space-y-2">
                          <Label>Dispatch Items (Customer-wise)</Label>
                          <div className="border rounded-lg overflow-hidden max-h-80 overflow-y-auto">
                            {(() => {
                              // Group items by customer
                              const customerGroups = formData.items.reduce((acc, item, index) => {
                                const key = item.customer_name;
                                if (!acc[key]) acc[key] = [];
                                acc[key].push({ ...item, originalIndex: index });
                                return acc;
                              }, {} as Record<string, (OrderItem & { originalIndex: number })[]>);

                              return Object.entries(customerGroups).map(([customerName, items]) => (
                                <div key={customerName} className="border-b last:border-b-0">
                                  <div className="bg-muted/50 px-3 py-2 font-semibold text-sm flex items-center gap-2">
                                    <span>{customerName}</span>
                                    <Badge variant="outline" className="text-xs">{items[0].customer_code}</Badge>
                                  </div>
                                  <Table>
                                     <TableHeader>
                                      <TableRow>
                                        <TableHead>Order</TableHead>
                                        <TableHead>Product</TableHead>
                                        <TableHead className="w-[120px]">Packing</TableHead>
                                        <TableHead className="text-right">Available</TableHead>
                                        <TableHead className="text-right">Dispatch Qty</TableHead>
                                        <TableHead className="text-right">Packages</TableHead>
                                        <TableHead className="w-12"></TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {items.map((item) => (
                                        <TableRow key={item.originalIndex}>
                                          <TableCell className="font-mono text-xs">{item.order_number}</TableCell>
                                          <TableCell>
                                            <span className="font-mono text-xs">{item.product_code}</span>
                                            {item.product_name && item.product_name !== '-' && (
                                              <span className="text-muted-foreground"> - {item.product_name}</span>
                                            )}
                                          </TableCell>
                                          <TableCell>
                                            <Select
                                              value={item.packing_type}
                                              onValueChange={(value) => updateItem(item.originalIndex, 'packing_type', value)}
                                            >
                                              <SelectTrigger className="h-8 w-[120px]">
                                                <SelectValue />
                                              </SelectTrigger>
                                              <SelectContent>
                                                {packingTypes.map((option) => (
                                                  <SelectItem key={option.id} value={option.label}>{option.label}</SelectItem>
                                                ))}
                                              </SelectContent>
                                            </Select>
                                          </TableCell>
                                          <TableCell className="text-right">{item.available_qty} Dz</TableCell>
                                          <TableCell className="text-right">
                                            <Input
                                              type="number"
                                              min="0"
                                              max={item.available_qty}
                                              value={item.quantity_dozens}
                                              onChange={(e) => updateItem(item.originalIndex, 'quantity_dozens', e.target.value)}
                                              className="w-24 ml-auto"
                                            />
                                          </TableCell>
                                          <TableCell className="text-right">
                                            <Input
                                              type="number"
                                              min="1"
                                              value={item.packages}
                                              onChange={(e) => updateItem(item.originalIndex, 'packages', e.target.value)}
                                              className="w-20 ml-auto"
                                            />
                                          </TableCell>
                                          <TableCell className="text-right">
                                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeItem(item.originalIndex)} title="Remove from this dispatch (deliver later)">
                                              <Trash2 className="h-4 w-4 text-destructive" />
                                            </Button>
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              ));
                            })()}
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label>Vehicle Number</Label>
                          <Input
                            value={formData.vehicle_number}
                            onChange={(e) => setFormData({ ...formData, vehicle_number: e.target.value.toUpperCase() })}
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

                      <div className="space-y-2">
                        <Label>Delivery Address</Label>
                        <Textarea
                          value={formData.delivery_address}
                          onChange={(e) => setFormData({ ...formData, delivery_address: e.target.value })}
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
                    <TableHead>Dispatch #</TableHead>
                    <TableHead>Order(s)</TableHead>
                    <TableHead>Customer(s)</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8">Loading...</TableCell>
                    </TableRow>
                  ) : filteredDispatches?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        No dispatches found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredDispatches?.map((dispatch) => (
                      <TableRow key={dispatch.id}>
                        <TableCell className="font-mono">{dispatch.dispatch_number}</TableCell>
                        <TableCell className="max-w-32 truncate" title={getDispatchOrdersDisplay(dispatch)}>
                          {getDispatchOrdersDisplay(dispatch)}
                        </TableCell>
                        <TableCell className="max-w-32 truncate" title={getDispatchCustomersDisplay(dispatch)}>
                          {getDispatchCustomersDisplay(dispatch)}
                        </TableCell>
                        <TableCell>{format(new Date(dispatch.dispatch_date), 'dd MMM yyyy')}</TableCell>
                        <TableCell>{dispatch.vehicle_number || '-'}</TableCell>
                        <TableCell>
                          {canEdit && dispatch.delivery_status !== 'delivered' ? (
                            <Select
                              value={dispatch.delivery_status}
                              onValueChange={(status) => statusMutation.mutate({
                                id: dispatch.id,
                                status,
                                actualDeliveryDate: status === 'delivered' ? format(new Date(), 'yyyy-MM-dd') : undefined
                              })}
                            >
                              <SelectTrigger className="w-28">
                                <Badge className={STATUS_COLORS[dispatch.delivery_status]}>
                                  {dispatch.delivery_status.replace('_', ' ')}
                                </Badge>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pending">Pending</SelectItem>
                                <SelectItem value="in_transit">In Transit</SelectItem>
                                <SelectItem value="delivered">Delivered</SelectItem>
                                <SelectItem value="returned">Returned</SelectItem>
                                <SelectItem value="acknowledged">Acknowledged</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge className={STATUS_COLORS[dispatch.delivery_status]}>
                              {dispatch.delivery_status.replace('_', ' ')}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right space-x-1">
                          {canEdit && dispatch.delivery_status !== 'delivered' && (
                            <Button variant="ghost" size="icon" onClick={() => handleOpenEditDialog(dispatch)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" onClick={() => setViewDispatch(dispatch)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" asChild title="Create invoice from this dispatch">
                            <Link to={`/domestic/invoices?createFromDispatch=${dispatch.id}`}>
                              <FileText className="h-4 w-4" />
                            </Link>
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

        {/* View Dispatch Dialog */}
        <Dialog open={!!viewDispatch} onOpenChange={() => setViewDispatch(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader className="flex flex-row items-center justify-between">
              <DialogTitle>Dispatch Details - {viewDispatch?.dispatch_number}</DialogTitle>
              <Button variant="outline" size="sm" onClick={handlePrint} className="mr-8">
                <Printer className="h-4 w-4 mr-2" />
                Print
              </Button>
            </DialogHeader>
            {viewDispatch && (
              <div className="space-y-4">
                <DispatchSheet dispatch={viewDispatch} items={dispatchItems ?? []} />
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Edit Dispatch Dialog */}
        <Dialog open={!!editDispatch} onOpenChange={(open) => { if (!open) handleCloseEditDialog(); }}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Dispatch - {editDispatch?.dispatch_number}</DialogTitle>
            </DialogHeader>
            {editDispatch && (
              <form key={editDispatch.id} onSubmit={handleEditSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Dispatch Date</Label>
                    <Input
                      type="date"
                      name="edit_dispatch_date"
                      defaultValue={editDispatch.dispatch_date}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Expected Delivery</Label>
                    <Input
                      type="date"
                      name="edit_expected_delivery_date"
                      defaultValue={editDispatch.expected_delivery_date || ''}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Vehicle Number</Label>
                    <Input
                      name="edit_vehicle_number"
                      defaultValue={editDispatch.vehicle_number || ''}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Driver Name</Label>
                    <Input
                      name="edit_driver_name"
                      defaultValue={editDispatch.driver_name || ''}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Driver Contact</Label>
                    <Input
                      name="edit_driver_contact"
                      defaultValue={editDispatch.driver_contact || ''}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Transporter Name</Label>
                  <Input
                    name="edit_transporter_name"
                    defaultValue={editDispatch.transporter_name || ''}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Delivery Address</Label>
                  <Textarea
                    name="edit_delivery_address"
                    defaultValue={editDispatch.delivery_address || ''}
                    rows={2}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea
                    name="edit_notes"
                    defaultValue={editDispatch.notes || ''}
                    rows={2}
                  />
                </div>

                {/* Edit Items Section */}
                {editItems.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-base font-medium">Dispatch Items</Label>
                    <div className="border rounded-lg overflow-hidden">
                      <div className="max-h-64 overflow-y-auto">
                        <Table>
                          <TableHeader className="bg-muted/50 sticky top-0">
                            <TableRow>
                              <TableHead className="w-[80px]">Order</TableHead>
                              <TableHead className="w-[120px]">Customer</TableHead>
                              <TableHead>Product</TableHead>
                              <TableHead className="w-[120px]">Packing</TableHead>
                              <TableHead className="w-[90px] text-right">No of Ctn/Bag</TableHead>
                              <TableHead className="w-[80px] text-right">Qty (Dz)</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {editItems.map((item, index) => (
                              <TableRow key={item.id}>
                                <TableCell className="font-mono text-xs">{item.order_number}</TableCell>
                                <TableCell className="text-sm truncate max-w-[120px]">{item.customer_name}</TableCell>
                                <TableCell className="text-sm">
                                  <span className="font-mono">{item.product_code}</span>
                                  <span className="text-muted-foreground ml-1">- {item.product_name}</span>
                                </TableCell>
                                <TableCell className="p-2">
                                  <Select
                                    value={item.packing_type}
                                    onValueChange={(value) => updateEditItem(index, 'packing_type', value)}
                                  >
                                    <SelectTrigger className="h-8">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {packingTypes.map((option) => (
                                        <SelectItem key={option.id} value={option.label}>{option.label}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                                <TableCell className="p-2">
                                  <Input
                                    type="number"
                                    min="1"
                                    value={item.num_bags_ctn}
                                    onChange={(e) => updateEditItem(index, 'num_bags_ctn', parseFloat(e.target.value) || 1)}
                                    className="w-full h-8 text-right"
                                  />
                                </TableCell>
                                <TableCell className="p-2 text-right font-medium">
                                  {item.quantity_dozens}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-4 border-t">
                  <Button type="button" variant="outline" onClick={handleCloseEditDialog}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={editMutation.isPending}>
                    {editMutation.isPending ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </form>
            )}
          </DialogContent>
        </Dialog>

      </div>
    </ERPLayout>
  );
}
