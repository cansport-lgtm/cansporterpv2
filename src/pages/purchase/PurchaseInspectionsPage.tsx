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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Eye, Check, X, ClipboardCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { SearchableSelect } from "@/components/shared/SearchableSelect";

// New QC tables aren't in the generated client types union the same way the
// rest of the module is queried, so use a loosely-typed handle (mirrors the
// pattern already used in GRNViewDialog).
const sb = supabase as any;

interface Column<T> {
  key: keyof T | string;
  header: string;
  render?: (item: T) => React.ReactNode;
  className?: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-500',
  approved: 'bg-green-500',
  rejected: 'bg-red-500',
};

const RESULT_COLORS: Record<string, string> = {
  pass: 'bg-green-500',
  partial: 'bg-amber-500',
  fail: 'bg-red-500',
};

interface QCInspectionItem {
  po_item_id: string;
  item_id: string | null;
  code: string;
  description: string;
  quantity_ordered: number;
  quantity_inspected: string;
  quantity_rejected: string;
  remarks: string;
}

export default function PurchaseInspectionsPage() {
  const queryClient = useQueryClient();
  const { user, hasPurchaseCategoryPermission } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [selectedPO, setSelectedPO] = useState<any>(null);
  const [formData, setFormData] = useState({
    purchase_order_id: '',
    inspection_date: format(new Date(), 'yyyy-MM-dd'),
    notes: '',
    items: [] as QCInspectionItem[],
  });

  // QC inspection is a raw-material control. Creating a reading needs create
  // rights on raw material; signing it off needs approve rights (separation of
  // duties — the inspector records, the QC/purchase manager approves).
  const canCreate = hasPurchaseCategoryPermission('raw_material', 'create');
  const canApprove = hasPurchaseCategoryPermission('raw_material', 'approve');

  // Fetch inspections
  const { data: inspections, isLoading } = useQuery({
    queryKey: ['purchase-qc-inspections'],
    queryFn: async () => {
      const { data, error } = await sb
        .from('purchase_qc_inspections')
        .select(`
          *,
          purchase_orders(po_number, category),
          suppliers(name, code)
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Raw-material POs awaiting QC (approved/ordered/partially_received, qc pending).
  const { data: pendingPOs } = useQuery({
    queryKey: ['qc-pending-purchase-orders'],
    queryFn: async () => {
      const { data, error } = await sb
        .from('purchase_orders')
        .select(`*, suppliers(name, code)`)
        .eq('category', 'raw_material')
        .eq('qc_status', 'pending')
        .in('status', ['approved', 'ordered', 'partially_received'])
        .order('order_date', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // POs that already carry an open or approved inspection — keep them out of the
  // "new inspection" picker so we don't create duplicate readings.
  const { data: inspectedPoIds } = useQuery({
    queryKey: ['qc-inspected-po-ids'],
    queryFn: async () => {
      const { data, error } = await sb
        .from('purchase_qc_inspections')
        .select('purchase_order_id, status')
        .in('status', ['pending', 'approved']);
      if (error) throw error;
      return new Set((data || []).map((r: any) => r.purchase_order_id));
    },
  });

  const selectablePOs = (pendingPOs || []).filter(
    (po: any) => !inspectedPoIds?.has(po.id),
  );

  // PO items for the selected PO
  const { data: poItems } = useQuery({
    queryKey: ['qc-po-items', selectedPO?.id],
    queryFn: async () => {
      if (!selectedPO?.id) return [];
      const { data, error } = await sb
        .from('purchase_order_items')
        .select(`*, items(code, name)`)
        .eq('order_id', selectedPO.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedPO?.id,
  });

  // Detail view: header + items
  const { data: viewInspection } = useQuery({
    queryKey: ['purchase-qc-inspection', viewId],
    queryFn: async () => {
      if (!viewId) return null;
      const { data, error } = await sb
        .from('purchase_qc_inspections')
        .select(`*, purchase_orders(po_number, category), suppliers(name, code)`)
        .eq('id', viewId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!viewId,
  });

  const { data: viewItems } = useQuery({
    queryKey: ['purchase-qc-inspection-items', viewId],
    queryFn: async () => {
      if (!viewId) return [];
      const { data, error } = await sb
        .from('purchase_qc_inspection_items')
        .select(`*, items(code, name)`)
        .eq('inspection_id', viewId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!viewId,
  });

  const handlePOSelect = (poId: string) => {
    const po = selectablePOs.find((p: any) => p.id === poId);
    setSelectedPO(po || null);
    setFormData({ ...formData, purchase_order_id: poId, items: [] });
  };

  const loadPOItems = () => {
    if (poItems && poItems.length > 0) {
      const items: QCInspectionItem[] = poItems.map((item: any) => ({
        po_item_id: item.id,
        item_id: item.item_id,
        code: item.items?.code || '-',
        description: item.description || item.items?.name || '',
        quantity_ordered: Number(item.quantity),
        quantity_inspected: String(item.quantity),
        quantity_rejected: '0',
        remarks: '',
      }));
      setFormData(prev => ({ ...prev, items }));
    }
  };

  const updateItem = (index: number, field: keyof QCInspectionItem, value: string) => {
    const newItems = [...formData.items];
    newItems[index] = { ...newItems[index], [field]: value };
    setFormData({ ...formData, items: newItems });
  };

  const accepted = (it: QCInspectionItem) =>
    Math.max(0, (parseFloat(it.quantity_inspected) || 0) - (parseFloat(it.quantity_rejected) || 0));

  // Save (creates a pending inspection)
  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      // Validate per-line quantities before writing anything.
      for (const it of data.items) {
        const insp = parseFloat(it.quantity_inspected) || 0;
        const rej = parseFloat(it.quantity_rejected) || 0;
        if (insp < 0 || rej < 0) throw new Error('Quantities cannot be negative');
        if (rej > insp) throw new Error(`Rejected qty cannot exceed inspected qty for ${it.description || it.code}`);
      }

      const { data: newInsp, error: inspError } = await sb
        .from('purchase_qc_inspections')
        .insert({
          qc_number: '', // auto-generated
          purchase_order_id: data.purchase_order_id,
          supplier_id: selectedPO.supplier_id,
          inspection_date: data.inspection_date,
          status: 'pending',
          inspected_by: user?.id,
          notes: data.notes || null,
        })
        .select()
        .single();
      if (inspError) throw inspError;

      const itemsToInsert = data.items.map(it => {
        const insp = parseFloat(it.quantity_inspected) || 0;
        const rej = parseFloat(it.quantity_rejected) || 0;
        const acc = Math.max(0, insp - rej);
        return {
          inspection_id: newInsp.id,
          po_item_id: it.po_item_id,
          item_id: it.item_id,
          description: it.description,
          quantity_ordered: it.quantity_ordered,
          quantity_inspected: insp,
          quantity_accepted: acc,
          quantity_rejected: rej,
          result: acc > 0 ? 'pass' : 'fail',
          remarks: it.remarks || null,
        };
      });

      if (itemsToInsert.length > 0) {
        const { error: itemsError } = await sb
          .from('purchase_qc_inspection_items')
          .insert(itemsToInsert);
        if (itemsError) throw itemsError;
      }

      return newInsp;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-qc-inspections'] });
      queryClient.invalidateQueries({ queryKey: ['qc-inspected-po-ids'] });
      toast.success('Inspection recorded — pending approval');
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to record inspection');
    },
  });

  // Approve: sign off, set result, unlock (or block) the PO for goods receipt.
  const approveMutation = useMutation({
    mutationFn: async (inspectionId: string) => {
      const { data: items, error: itemsErr } = await sb
        .from('purchase_qc_inspection_items')
        .select('quantity_accepted, quantity_rejected')
        .eq('inspection_id', inspectionId);
      if (itemsErr) throw itemsErr;

      const totalAccepted = (items || []).reduce((s: number, r: any) => s + Number(r.quantity_accepted || 0), 0);
      const totalRejected = (items || []).reduce((s: number, r: any) => s + Number(r.quantity_rejected || 0), 0);
      const result = totalAccepted <= 0 ? 'fail' : (totalRejected > 0 ? 'partial' : 'pass');

      const { data: insp, error: updErr } = await sb
        .from('purchase_qc_inspections')
        .update({
          status: 'approved',
          result,
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', inspectionId)
        .select('purchase_order_id')
        .single();
      if (updErr) throw updErr;

      // Open or close the goods-receipt gate on the PO.
      const { error: poErr } = await sb
        .from('purchase_orders')
        .update({ qc_status: totalAccepted > 0 ? 'passed' : 'failed' })
        .eq('id', insp.purchase_order_id);
      if (poErr) throw poErr;

      return { result };
    },
    onSuccess: ({ result }) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-qc-inspections'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-qc-inspection', viewId] });
      queryClient.invalidateQueries({ queryKey: ['qc-pending-purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['approved-purchase-orders'] });
      toast.success(
        result === 'fail'
          ? 'Inspection approved — all material rejected, goods receipt stays blocked'
          : 'Inspection approved — goods receipt unlocked',
      );
      setViewId(null);
    },
    onError: (error: any) => toast.error(error.message || 'Failed to approve inspection'),
  });

  // Reject the inspection itself (e.g. wrong readings) — leaves the PO pending
  // so a fresh inspection can be recorded.
  const rejectMutation = useMutation({
    mutationFn: async (inspectionId: string) => {
      const { error } = await sb
        .from('purchase_qc_inspections')
        .update({ status: 'rejected', result: null, approved_by: user?.id, approved_at: new Date().toISOString() })
        .eq('id', inspectionId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-qc-inspections'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-qc-inspection', viewId] });
      queryClient.invalidateQueries({ queryKey: ['qc-inspected-po-ids'] });
      toast.success('Inspection rejected — record a new inspection to proceed');
      setViewId(null);
    },
    onError: (error: any) => toast.error(error.message || 'Failed to reject inspection'),
  });

  const resetForm = () => {
    setFormData({
      purchase_order_id: '',
      inspection_date: format(new Date(), 'yyyy-MM-dd'),
      notes: '',
      items: [],
    });
    setSelectedPO(null);
    setDialogOpen(false);
  };

  const columns: Column<any>[] = [
    { key: 'qc_number', header: 'QC #' },
    {
      key: 'purchase_order_id',
      header: 'PO #',
      render: (i) => i.purchase_orders?.po_number || '-',
    },
    {
      key: 'supplier_id',
      header: 'Supplier',
      render: (i) => i.suppliers?.name || '-',
    },
    {
      key: 'inspection_date',
      header: 'Date',
      render: (i) => format(new Date(i.inspection_date), 'dd/MM/yyyy'),
    },
    {
      key: 'result',
      header: 'Result',
      render: (i) => i.result
        ? <Badge className={RESULT_COLORS[i.result] || 'bg-gray-500'}>{i.result}</Badge>
        : <span className="text-muted-foreground">-</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (i) => (
        <Badge className={STATUS_COLORS[i.status] || 'bg-gray-500'}>{i.status}</Badge>
      ),
    },
    {
      key: 'id',
      header: 'Actions',
      render: (i) => (
        <Button variant="ghost" size="icon" onClick={() => setViewId(i.id)}>
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  const totalAccepted = formData.items.reduce((s, it) => s + accepted(it), 0);
  const totalRejected = formData.items.reduce((s, it) => s + (parseFloat(it.quantity_rejected) || 0), 0);

  return (
    <ERPLayout>
      <PageHeader
        title="Quality Inspection"
        description="Inspect and approve incoming raw material before goods receipt"
      >
        {canCreate && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => { resetForm(); setDialogOpen(true); }}>
                <Plus className="mr-2 h-4 w-4" /> New Inspection
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>New Quality Inspection</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Purchase Order *</Label>
                    <SearchableSelect
                      value={formData.purchase_order_id}
                      onValueChange={handlePOSelect}
                      placeholder="Select raw material PO"
                      options={selectablePOs.map((po: any) => ({
                        value: po.id,
                        label: po.po_number,
                        secondary: po.suppliers?.name ? `- ${po.suppliers.name}` : undefined,
                        search: `${po.suppliers?.name || ''} ${po.suppliers?.code || ''}`,
                      }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Inspection Date *</Label>
                    <Input
                      type="date"
                      value={formData.inspection_date}
                      onChange={(e) => setFormData({ ...formData, inspection_date: e.target.value })}
                    />
                  </div>
                </div>

                {selectablePOs.length === 0 && (
                  <div className="text-sm text-muted-foreground italic">
                    No approved raw material purchase orders are awaiting inspection.
                  </div>
                )}

                {selectedPO && (
                  <div className="p-3 bg-muted rounded-md text-sm">
                    <div><strong>Supplier:</strong> {selectedPO.suppliers?.name}</div>
                    <div><strong>PO Date:</strong> {format(new Date(selectedPO.order_date), 'dd/MM/yyyy')}</div>
                  </div>
                )}

                {selectedPO && (
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label>Inspection Readings</Label>
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
                            <TableHead className="text-right w-28">Inspected</TableHead>
                            <TableHead className="text-right w-28">Rejected</TableHead>
                            <TableHead className="text-right">Accepted</TableHead>
                            <TableHead className="w-40">Remarks</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {formData.items.map((item, index) => (
                            <TableRow key={index}>
                              <TableCell>{item.code}</TableCell>
                              <TableCell>{item.description}</TableCell>
                              <TableCell className="text-right">{item.quantity_ordered}</TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={item.quantity_inspected}
                                  onChange={(e) => updateItem(index, 'quantity_inspected', e.target.value)}
                                  className="text-right"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={item.quantity_rejected}
                                  onChange={(e) => updateItem(index, 'quantity_rejected', e.target.value)}
                                  className="text-right"
                                />
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                {accepted(item)}
                              </TableCell>
                              <TableCell>
                                <Input
                                  value={item.remarks}
                                  onChange={(e) => updateItem(index, 'remarks', e.target.value)}
                                  placeholder="Optional"
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}

                    {formData.items.length > 0 && (
                      <div className="flex justify-end gap-6 pt-2 text-sm">
                        <span className="text-muted-foreground">
                          Accepted: <span className="font-semibold text-foreground">{totalAccepted}</span>
                        </span>
                        <span className="text-muted-foreground">
                          Rejected: <span className="font-semibold text-foreground">{totalRejected}</span>
                        </span>
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
                    {saveMutation.isPending ? 'Saving...' : 'Submit Inspection'}
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
        <DataTable columns={columns} data={inspections || []} />
      )}

      {/* View / approve dialog */}
      <Dialog open={!!viewId} onOpenChange={(o) => !o && setViewId(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5" />
              Quality Inspection: {viewInspection?.qc_number || '—'}
            </DialogTitle>
          </DialogHeader>
          {viewInspection && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><strong>PO #:</strong> {viewInspection.purchase_orders?.po_number || '—'}</div>
                <div><strong>Supplier:</strong> {viewInspection.suppliers?.name || '—'}</div>
                <div><strong>Date:</strong> {format(new Date(viewInspection.inspection_date), 'dd/MM/yyyy')}</div>
                <div className="flex items-center gap-2">
                  <strong>Status:</strong>
                  <Badge className={STATUS_COLORS[viewInspection.status] || 'bg-gray-500'}>
                    {viewInspection.status}
                  </Badge>
                  {viewInspection.result && (
                    <Badge className={RESULT_COLORS[viewInspection.result] || 'bg-gray-500'}>
                      {viewInspection.result}
                    </Badge>
                  )}
                </div>
              </div>

              {viewItems && viewItems.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Inspected</TableHead>
                      <TableHead className="text-right">Accepted</TableHead>
                      <TableHead className="text-right">Rejected</TableHead>
                      <TableHead>Remarks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {viewItems.map((it: any) => (
                      <TableRow key={it.id}>
                        <TableCell>{it.items?.code || '—'}</TableCell>
                        <TableCell>{it.description || it.items?.name}</TableCell>
                        <TableCell className="text-right">{it.quantity_inspected}</TableCell>
                        <TableCell className="text-right text-green-600 font-medium">{it.quantity_accepted}</TableCell>
                        <TableCell className="text-right text-destructive font-medium">{it.quantity_rejected}</TableCell>
                        <TableCell>{it.remarks || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {viewInspection.notes && (
                <div>
                  <strong>Notes:</strong>
                  <p className="text-muted-foreground">{viewInspection.notes}</p>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t">
                {viewInspection.status === 'pending' && canApprove && (
                  <>
                    <Button
                      variant="outline"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
                      onClick={() => rejectMutation.mutate(viewInspection.id)}
                      disabled={rejectMutation.isPending || approveMutation.isPending}
                    >
                      <X className="h-4 w-4 mr-1" /> Reject
                    </Button>
                    <Button
                      onClick={() => approveMutation.mutate(viewInspection.id)}
                      disabled={approveMutation.isPending || rejectMutation.isPending}
                    >
                      <Check className="h-4 w-4 mr-1" /> Approve
                    </Button>
                  </>
                )}
                <Button variant="outline" onClick={() => setViewId(null)}>Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
