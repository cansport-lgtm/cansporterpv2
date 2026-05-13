import { useState } from "react";
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
import { Plus, Eye } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import type { Database } from "@/integrations/supabase/types";
import { postGRNVoucher } from "@/lib/accounting/postGRNVoucher";

type PurchaseCategory = Database["public"]["Enums"]["purchase_category"];

interface Column<T> {
  key: keyof T | string;
  header: string;
  render?: (item: T) => React.ReactNode;
  className?: string;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-500',
  completed: 'bg-green-500',
  cancelled: 'bg-red-500',
};

const CATEGORIES: { value: PurchaseCategory; label: string }[] = [
  { value: "raw_material", label: "Raw Material" },
  { value: "office_supplies", label: "Office Supplies" },
  { value: "general_supplies", label: "General Supplies" },
  { value: "spare_maintenance", label: "Spare & Maintenance" },
];

interface GRNItem {
  po_item_id: string;
  item_id: string | null;
  description: string;
  quantity_ordered: number;
  quantity_received: string;
  unit_price: number;
}

export default function GoodsReceiptPage() {
  const queryClient = useQueryClient();
  const { user, hasModulePermission, hasPurchaseCategoryPermission } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewGRN, setViewGRN] = useState<any>(null);
  const [selectedPO, setSelectedPO] = useState<any>(null);
  const [formData, setFormData] = useState({
    purchase_order_id: '',
    receipt_date: format(new Date(), 'yyyy-MM-dd'),
    invoice_number: '',
    invoice_date: '',
    invoice_amount: '',
    notes: '',
    items: [] as GRNItem[],
  });

  const canCreate = hasModulePermission('purchase', 'create');

  // Fetch GRNs
  const { data: grns, isLoading } = useQuery({
    queryKey: ['goods-receipt-notes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('goods_receipt_notes')
        .select(`
          *,
          purchase_orders(po_number, category),
          suppliers(name, code),
          received_by_user:app_users!goods_receipt_notes_received_by_fkey(full_name)
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Fetch GRN items for viewing
  const { data: grnItems } = useQuery({
    queryKey: ['grn-items', viewGRN?.id],
    queryFn: async () => {
      if (!viewGRN?.id) return [];
      const { data, error } = await supabase
        .from('grn_items')
        .select(`*, items(code, name)`)
        .eq('grn_id', viewGRN.id);
      if (error) throw error;
      return data;
    },
    enabled: !!viewGRN?.id,
  });

  // Fetch approved POs that haven't been fully received
  const { data: purchaseOrders } = useQuery({
    queryKey: ['approved-purchase-orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(`
          *,
          suppliers(name, code)
        `)
        .in('status', ['approved', 'ordered', 'partially_received'])
        .order('order_date', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Fetch PO items when PO is selected
  const { data: poItems } = useQuery({
    queryKey: ['po-items-for-grn', selectedPO?.id],
    queryFn: async () => {
      if (!selectedPO?.id) return [];
      const { data, error } = await supabase
        .from('purchase_order_items')
        .select(`*, items(code, name)`)
        .eq('order_id', selectedPO.id);
      if (error) throw error;
      return data;
    },
    enabled: !!selectedPO?.id,
  });

  // Check category permission
  const canAccessCategory = (category: PurchaseCategory) => {
    return hasPurchaseCategoryPermission(category, 'view');
  };

  // Filter GRNs by user's category permissions
  const filteredGRNs = grns?.filter(grn => {
    const category = grn.purchase_orders?.category;
    return category && canAccessCategory(category as PurchaseCategory);
  });

  // Filter POs by user's category permissions
  const filteredPOs = purchaseOrders?.filter(po => canAccessCategory(po.category as PurchaseCategory));

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const totalAmount = data.items.reduce((sum, item) => {
        return sum + (parseFloat(item.quantity_received) || 0) * item.unit_price;
      }, 0);

      const { data: newGRN, error: grnError } = await supabase
        .from('goods_receipt_notes')
        .insert({
          grn_number: '', // Auto-generated
          purchase_order_id: data.purchase_order_id,
          supplier_id: selectedPO.supplier_id,
          receipt_date: data.receipt_date,
          invoice_number: data.invoice_number || null,
          invoice_date: data.invoice_date || null,
          invoice_amount: data.invoice_amount ? parseFloat(data.invoice_amount) : null,
          total_amount: totalAmount,
          notes: data.notes || null,
          received_by: user?.id,
          status: 'completed',
        })
        .select()
        .single();

      if (grnError) throw grnError;

      // Insert GRN items
      const itemsToInsert = data.items
        .filter(item => parseFloat(item.quantity_received) > 0)
        .map(item => ({
          grn_id: newGRN.id,
          po_item_id: item.po_item_id,
          item_id: item.item_id,
          description: item.description,
          quantity_ordered: item.quantity_ordered,
          quantity_received: parseFloat(item.quantity_received),
          unit_price: item.unit_price,
          amount: parseFloat(item.quantity_received) * item.unit_price,
        }));

      if (itemsToInsert.length > 0) {
        const { error: itemsError } = await supabase
          .from('grn_items')
          .insert(itemsToInsert);
        if (itemsError) throw itemsError;
      }

      // Update PO status
      const { error: poError } = await supabase
        .from('purchase_orders')
        .update({ status: 'received' })
        .eq('id', data.purchase_order_id);
      if (poError) console.error('Failed to update PO status:', poError);

      return newGRN;
    },
    onSuccess: async (newGRN: any) => {
      queryClient.invalidateQueries({ queryKey: ['goods-receipt-notes'] });
      queryClient.invalidateQueries({ queryKey: ['approved-purchase-orders'] });
      toast.success('Goods receipt created');
      resetForm();

      // Phase 2B: auto-post AP/Inventory voucher (gated by VITE_ENABLE_ACC_AUTOPOST).
      // Non-blocking: GRN is already saved. Failures surface as warnings only.
      if (newGRN?.id) {
        const result = await postGRNVoucher(newGRN.id);
        if (result.ok && result.voucherNumber && !result.skipped) {
          toast.success(`Accounting voucher posted: ${result.voucherNumber}`);
        } else if (!result.ok) {
          toast.error(`Accounting auto-post failed: ${result.error}. Use Purchase Reconciliation to repost.`);
        }
      }
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create goods receipt');
    },
  });

  const resetForm = () => {
    setFormData({
      purchase_order_id: '',
      receipt_date: format(new Date(), 'yyyy-MM-dd'),
      invoice_number: '',
      invoice_date: '',
      invoice_amount: '',
      notes: '',
      items: [],
    });
    setSelectedPO(null);
    setDialogOpen(false);
  };

  const handlePOSelect = (poId: string) => {
    const po = purchaseOrders?.find(p => p.id === poId);
    setSelectedPO(po);
    setFormData({ ...formData, purchase_order_id: poId, items: [] });
  };

  // When PO items are loaded, populate form items
  const loadPOItems = () => {
    if (poItems && poItems.length > 0) {
      const items: GRNItem[] = poItems.map((item: any) => ({
        po_item_id: item.id,
        item_id: item.item_id,
        description: item.description || item.items?.name || '',
        quantity_ordered: item.quantity,
        quantity_received: (item.quantity - (item.quantity_received || 0)).toString(),
        unit_price: item.unit_price,
      }));
      setFormData(prev => ({ ...prev, items }));
    }
  };

  const updateItemQty = (index: number, value: string) => {
    const newItems = [...formData.items];
    newItems[index] = { ...newItems[index], quantity_received: value };
    setFormData({ ...formData, items: newItems });
  };

  const totalAmount = formData.items.reduce((sum, item) => {
    return sum + (parseFloat(item.quantity_received) || 0) * item.unit_price;
  }, 0);

  const columns: Column<any>[] = [
    { key: 'grn_number', header: 'GRN #' },
    {
      key: 'purchase_order_id',
      header: 'PO #',
      render: (grn) => grn.purchase_orders?.po_number || '-',
    },
    {
      key: 'supplier_id',
      header: 'Supplier',
      render: (grn) => grn.suppliers?.name || '-',
    },
    {
      key: 'receipt_date',
      header: 'Receipt Date',
      render: (grn) => format(new Date(grn.receipt_date), 'dd/MM/yyyy'),
    },
    {
      key: 'invoice_number',
      header: 'Invoice #',
      render: (grn) => grn.invoice_number || '-',
    },
    {
      key: 'total_amount',
      header: 'Amount',
      render: (grn) => `Rs. ${grn.total_amount?.toLocaleString() || 0}`,
    },
    {
      key: 'status',
      header: 'Status',
      render: (grn) => (
        <Badge className={STATUS_COLORS[grn.status] || 'bg-gray-500'}>
          {grn.status}
        </Badge>
      ),
    },
    {
      key: 'id',
      header: 'Actions',
      render: (grn) => (
        <Button variant="ghost" size="icon" onClick={() => setViewGRN(grn)}>
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <ERPLayout>
      <PageHeader
        title="Goods Receipt"
        description="Record goods received against purchase orders"
      >
        {canCreate && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => { resetForm(); setDialogOpen(true); }}>
                <Plus className="mr-2 h-4 w-4" /> New GRN
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create Goods Receipt Note</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Purchase Order *</Label>
                    <Select
                      value={formData.purchase_order_id}
                      onValueChange={handlePOSelect}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select PO" />
                      </SelectTrigger>
                      <SelectContent>
                        {filteredPOs?.map(po => (
                          <SelectItem key={po.id} value={po.id}>
                            {po.po_number} - {po.suppliers?.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Receipt Date *</Label>
                    <Input
                      type="date"
                      value={formData.receipt_date}
                      onChange={(e) => setFormData({ ...formData, receipt_date: e.target.value })}
                    />
                  </div>
                </div>

                {selectedPO && (
                  <div className="p-3 bg-muted rounded-md text-sm">
                    <div><strong>Supplier:</strong> {selectedPO.suppliers?.name}</div>
                    <div><strong>Category:</strong> {CATEGORIES.find(c => c.value === selectedPO.category)?.label}</div>
                    <div><strong>PO Date:</strong> {format(new Date(selectedPO.order_date), 'dd/MM/yyyy')}</div>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Invoice Number</Label>
                    <Input
                      value={formData.invoice_number}
                      onChange={(e) => setFormData({ ...formData, invoice_number: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Invoice Date</Label>
                    <Input
                      type="date"
                      value={formData.invoice_date}
                      onChange={(e) => setFormData({ ...formData, invoice_date: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Invoice Amount</Label>
                    <Input
                      type="number"
                      value={formData.invoice_amount}
                      onChange={(e) => setFormData({ ...formData, invoice_amount: e.target.value })}
                    />
                  </div>
                </div>

                {/* Items */}
                {selectedPO && (
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label>Items</Label>
                      {poItems && poItems.length > 0 && formData.items.length === 0 && (
                        <Button type="button" variant="outline" size="sm" onClick={loadPOItems}>
                          Load PO Items
                        </Button>
                      )}
                    </div>
                    
                    {formData.items.length > 0 && (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Item</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead className="text-right">Ordered</TableHead>
                            <TableHead className="text-right w-32">Receiving</TableHead>
                            <TableHead className="text-right">Unit Price</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {formData.items.map((item, index) => (
                            <TableRow key={index}>
                              <TableCell>{poItems?.find((p: any) => p.id === item.po_item_id)?.items?.code || '-'}</TableCell>
                              <TableCell>{item.description}</TableCell>
                              <TableCell className="text-right">{item.quantity_ordered}</TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  value={item.quantity_received}
                                  onChange={(e) => updateItemQty(index, e.target.value)}
                                  className="text-right"
                                />
                              </TableCell>
                              <TableCell className="text-right">Rs. {item.unit_price?.toLocaleString()}</TableCell>
                              <TableCell className="text-right font-medium">
                                Rs. {((parseFloat(item.quantity_received) || 0) * item.unit_price).toLocaleString()}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}

                    {formData.items.length > 0 && (
                      <div className="text-right font-semibold text-lg pt-2">
                        Total: Rs. {totalAmount.toLocaleString()}
                      </div>
                    )}
                  </div>
                )}

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
                    disabled={!formData.purchase_order_id || formData.items.length === 0 || saveMutation.isPending}
                  >
                    {saveMutation.isPending ? 'Creating...' : 'Create GRN'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </PageHeader>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={filteredGRNs || []}
        />
      )}

      {/* View GRN Dialog */}
      <Dialog open={!!viewGRN} onOpenChange={() => setViewGRN(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Goods Receipt: {viewGRN?.grn_number}</DialogTitle>
          </DialogHeader>
          {viewGRN && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><strong>PO #:</strong> {viewGRN.purchase_orders?.po_number}</div>
                <div><strong>Supplier:</strong> {viewGRN.suppliers?.name}</div>
                <div><strong>Receipt Date:</strong> {format(new Date(viewGRN.receipt_date), 'dd/MM/yyyy')}</div>
                <div><strong>Invoice #:</strong> {viewGRN.invoice_number || '-'}</div>
                <div><strong>Invoice Amount:</strong> {viewGRN.invoice_amount ? `Rs. ${viewGRN.invoice_amount.toLocaleString()}` : '-'}</div>
                <div><strong>Total Received:</strong> Rs. {viewGRN.total_amount?.toLocaleString()}</div>
              </div>

              {grnItems && grnItems.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Ordered</TableHead>
                      <TableHead className="text-right">Received</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {grnItems.map((item: any) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.items?.code || '-'}</TableCell>
                        <TableCell>{item.description || item.items?.name}</TableCell>
                        <TableCell className="text-right">{item.quantity_ordered}</TableCell>
                        <TableCell className="text-right">{item.quantity_received}</TableCell>
                        <TableCell className="text-right">Rs. {item.unit_price?.toLocaleString()}</TableCell>
                        <TableCell className="text-right">Rs. {item.amount?.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {viewGRN.notes && (
                <div>
                  <strong>Notes:</strong>
                  <p className="text-muted-foreground">{viewGRN.notes}</p>
                </div>
              )}

              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setViewGRN(null)}>Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}