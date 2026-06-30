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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Eye, Check, X, ClipboardCheck, Printer, MessageCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { printQCInspection } from "@/lib/purchase/printQCInspection";
import { shareQCInspectionPdf } from "@/lib/purchase/qcInspectionPdf";

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

type ParamType = 'numeric' | 'text' | 'boolean' | 'select';

// A single checkpoint reading captured during inspection. The parameter spec is
// snapshotted onto the reading so historical inspections never change if the
// checkpoint master is later edited.
interface ReadingInput {
  parameter_id: string;
  parameter_name: string;
  parameter_name_ur: string | null;
  parameter_type: ParamType;
  unit: string | null;
  min_value: number | null;
  max_value: number | null;
  expected_value: string | null;
  options: string[] | null;
  is_required: boolean;
  value: string;          // numeric / text / select entry
  value_boolean: boolean; // boolean entry
}

interface QCInspectionItem {
  po_item_id: string;
  item_id: string | null;
  code: string;
  description: string;
  quantity_ordered: number;
  quantity_inspected: string;
  quantity_rejected: string;
  remarks: string;
  readings: ReadingInput[];
}

// Evaluate a reading against its snapshotted spec. Returns true (in spec),
// false (out of spec) or null (not yet entered / no spec to judge).
function evalSpec(r: ReadingInput): boolean | null {
  switch (r.parameter_type) {
    case 'numeric': {
      if (r.value.trim() === '') return null;
      const n = parseFloat(r.value);
      if (Number.isNaN(n)) return null;
      if (r.min_value != null && n < r.min_value) return false;
      if (r.max_value != null && n > r.max_value) return false;
      return true;
    }
    case 'boolean':
      return r.value_boolean === (r.expected_value !== 'false');
    case 'select': {
      if (r.value.trim() === '') return null;
      // First option is the accepted value; anything else is out of spec.
      const accepted = r.options?.[0];
      return accepted ? r.value === accepted : true;
    }
    case 'text': {
      if (!r.expected_value) return r.value.trim() === '' ? null : true; // free text
      if (r.value.trim() === '') return null;
      return r.value.trim().toLowerCase() === r.expected_value.trim().toLowerCase();
    }
    default:
      return null;
  }
}

// Short human-readable acceptance criteria for a reading row.
function specText(r: ReadingInput): string {
  switch (r.parameter_type) {
    case 'numeric': {
      const u = r.unit ? ` ${r.unit}` : '';
      if (r.min_value != null && r.max_value != null) return `${r.min_value} – ${r.max_value}${u}`;
      if (r.min_value != null) return `≥ ${r.min_value}${u}`;
      if (r.max_value != null) return `≤ ${r.max_value}${u}`;
      return 'any';
    }
    case 'boolean':
      return `expected: ${r.expected_value !== 'false' ? 'Yes' : 'No'}`;
    case 'select':
      return r.options?.length ? `accept: ${r.options[0]}` : '';
    case 'text':
      return r.expected_value ? `expected: ${r.expected_value}` : 'free text';
    default:
      return '';
  }
}

// Spec / value formatting for a stored reading row (DB shape) in the view dialog.
function readingSpecText(r: any): string {
  const u = r.unit ? ` ${r.unit}` : '';
  if (r.parameter_type === 'numeric') {
    if (r.min_value != null && r.max_value != null) return `${r.min_value} – ${r.max_value}${u}`;
    if (r.min_value != null) return `≥ ${r.min_value}${u}`;
    if (r.max_value != null) return `≤ ${r.max_value}${u}`;
    return 'any';
  }
  if (r.parameter_type === 'boolean') return `expected: ${r.expected_value !== 'false' ? 'Yes' : 'No'}`;
  if (r.parameter_type === 'text') return r.expected_value ? `expected: ${r.expected_value}` : 'free text';
  return '';
}

function readingValueText(r: any): string {
  if (r.parameter_type === 'numeric') return r.value_number != null ? `${r.value_number}${r.unit ? ` ${r.unit}` : ''}` : '—';
  if (r.parameter_type === 'boolean') return r.value_boolean ? 'Yes' : 'No';
  return r.value_text || '—';
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

  // Checkpoint readings for the viewed inspection, grouped by inspection line.
  const { data: viewReadings } = useQuery({
    queryKey: ['purchase-qc-inspection-readings', viewId, (viewItems || []).length],
    queryFn: async () => {
      const map: Record<string, any[]> = {};
      const itemIds = (viewItems || []).map((i: any) => i.id);
      if (itemIds.length === 0) return map;
      const { data, error } = await sb
        .from('purchase_qc_inspection_readings')
        .select('*')
        .in('inspection_item_id', itemIds);
      if (error) throw error;
      (data || []).forEach((r: any) => {
        (map[r.inspection_item_id] = map[r.inspection_item_id] || []).push(r);
      });
      return map;
    },
    enabled: !!viewId && (viewItems || []).length > 0,
  });

  // Checkpoint definitions for the PO's raw-material items, grouped by item_id.
  const { data: paramsByItem } = useQuery({
    queryKey: ['qc-params-for-po', selectedPO?.id, (poItems || []).length],
    queryFn: async () => {
      const map: Record<string, any[]> = {};
      const itemIds = [...new Set((poItems || []).map((i: any) => i.item_id).filter(Boolean))];
      if (itemIds.length === 0) return map;
      const { data, error } = await sb
        .from('raw_material_qc_parameters')
        .select('*')
        .in('item_id', itemIds)
        .eq('is_active', true)
        .order('sequence_order');
      if (error) throw error;
      (data || []).forEach((p: any) => {
        (map[p.item_id] = map[p.item_id] || []).push(p);
      });
      return map;
    },
    enabled: !!selectedPO?.id && (poItems || []).length > 0,
  });

  const buildReadings = (itemId: string | null): ReadingInput[] => {
    const defs = (itemId && paramsByItem?.[itemId]) || [];
    return defs.map((p: any) => ({
      parameter_id: p.id,
      parameter_name: p.parameter_name,
      parameter_name_ur: p.parameter_name_ur ?? null,
      parameter_type: (p.parameter_type || 'numeric') as ParamType,
      unit: p.unit ?? null,
      min_value: p.min_value ?? null,
      max_value: p.max_value ?? null,
      expected_value: p.expected_value ?? null,
      options: Array.isArray(p.options) ? p.options : null,
      is_required: p.is_required ?? true,
      value: '',
      value_boolean: p.parameter_type === 'boolean' ? (p.expected_value !== 'false') : false,
    }));
  };

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
        readings: buildReadings(item.item_id),
      }));
      setFormData(prev => ({ ...prev, items }));
    }
  };

  const updateItem = (index: number, field: keyof QCInspectionItem, value: string) => {
    const newItems = [...formData.items];
    newItems[index] = { ...newItems[index], [field]: value };
    setFormData({ ...formData, items: newItems });
  };

  const updateReading = (itemIndex: number, readingIndex: number, patch: Partial<ReadingInput>) => {
    const newItems = [...formData.items];
    const readings = [...newItems[itemIndex].readings];
    readings[readingIndex] = { ...readings[readingIndex], ...patch };
    newItems[itemIndex] = { ...newItems[itemIndex], readings };
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
        const { data: insertedItems, error: itemsError } = await sb
          .from('purchase_qc_inspection_items')
          .insert(itemsToInsert)
          .select('id, po_item_id');
        if (itemsError) throw itemsError;

        // Persist the checkpoint readings against each inserted inspection line.
        const idByPoItem: Record<string, string> = {};
        (insertedItems || []).forEach((row: any) => { idByPoItem[row.po_item_id] = row.id; });

        const readingsToInsert: any[] = [];
        for (const it of data.items) {
          const inspectionItemId = idByPoItem[it.po_item_id];
          if (!inspectionItemId) continue;
          for (const r of it.readings) {
            const withinSpec = evalSpec(r);
            readingsToInsert.push({
              inspection_item_id: inspectionItemId,
              parameter_id: r.parameter_id,
              parameter_name: r.parameter_name,
              parameter_name_ur: r.parameter_name_ur,
              parameter_type: r.parameter_type,
              unit: r.unit,
              min_value: r.min_value,
              max_value: r.max_value,
              expected_value: r.expected_value,
              value_number: r.parameter_type === 'numeric' && r.value.trim() !== '' ? parseFloat(r.value) : null,
              value_text: (r.parameter_type === 'text' || r.parameter_type === 'select') && r.value.trim() !== '' ? r.value.trim() : null,
              value_boolean: r.parameter_type === 'boolean' ? r.value_boolean : null,
              is_within_spec: withinSpec,
              is_required: r.is_required,
            });
          }
        }

        if (readingsToInsert.length > 0) {
          const { error: readingsError } = await sb
            .from('purchase_qc_inspection_readings')
            .insert(readingsToInsert);
          if (readingsError) throw readingsError;
        }
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

  const handlePrint = async (id: string) => {
    try {
      await printQCInspection(id);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to prepare print');
    }
  };

  const [sharingId, setSharingId] = useState<string | null>(null);
  const handleShare = async (id: string) => {
    setSharingId(id);
    const t = toast.loading('Preparing PDF…');
    try {
      const result = await shareQCInspectionPdf(id);
      toast.dismiss(t);
      if (result === 'downloaded') {
        toast.success('PDF downloaded — attach it in WhatsApp');
      } else if (result === 'shared') {
        toast.success('Shared');
      }
    } catch (e: any) {
      toast.dismiss(t);
      toast.error(e?.message || 'Failed to share PDF');
    } finally {
      setSharingId(null);
    }
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
        <div className="flex">
          <Button variant="ghost" size="icon" onClick={() => setViewId(i.id)} title="View">
            <Eye className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => handlePrint(i.id)} title="Print">
            <Printer className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-green-600 hover:text-green-700"
            onClick={() => handleShare(i.id)}
            disabled={sharingId === i.id}
            title="Share PDF on WhatsApp"
          >
            <MessageCircle className="h-4 w-4" />
          </Button>
        </div>
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

                    {formData.items.map((item, index) => (
                      <div key={index} className="rounded-lg border p-3 space-y-3">
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="font-medium">
                            {item.description}
                            {item.code && <span className="text-muted-foreground"> ({item.code})</span>}
                          </div>
                          <div className="text-xs text-muted-foreground">Ordered: {item.quantity_ordered}</div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Inspected</Label>
                            <Input type="number" min="0" step="0.01" value={item.quantity_inspected}
                              onChange={(e) => updateItem(index, 'quantity_inspected', e.target.value)} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Rejected</Label>
                            <Input type="number" min="0" step="0.01" value={item.quantity_rejected}
                              onChange={(e) => updateItem(index, 'quantity_rejected', e.target.value)} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Accepted</Label>
                            <div className="h-10 flex items-center font-medium">{accepted(item)}</div>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Remarks</Label>
                            <Input value={item.remarks}
                              onChange={(e) => updateItem(index, 'remarks', e.target.value)} placeholder="Optional" />
                          </div>
                        </div>

                        {/* Quality checkpoints for this raw material */}
                        {item.readings.length > 0 ? (
                          <div className="rounded-md border bg-muted/30 p-2 space-y-2">
                            <div className="text-xs font-semibold text-muted-foreground">Quality Checkpoints</div>
                            {item.readings.map((r, ri) => {
                              const spec = evalSpec(r);
                              return (
                                <div key={ri} className="grid grid-cols-12 items-center gap-2 text-sm">
                                  <div className="col-span-4">
                                    <div className="flex items-center gap-1">
                                      {r.parameter_name}
                                      {r.is_required && <span className="text-destructive">*</span>}
                                      {r.unit && <span className="text-xs text-muted-foreground">({r.unit})</span>}
                                    </div>
                                    {r.parameter_name_ur && (
                                      <div className="text-xs text-muted-foreground" dir="rtl" lang="ur">
                                        {r.parameter_name_ur}
                                      </div>
                                    )}
                                  </div>
                                  <div className="col-span-4 text-xs text-muted-foreground">{specText(r)}</div>
                                  <div className="col-span-3">
                                    {r.parameter_type === 'boolean' ? (
                                      <Select value={r.value_boolean ? 'true' : 'false'}
                                        onValueChange={(v) => updateReading(index, ri, { value_boolean: v === 'true' })}>
                                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="true">Yes</SelectItem>
                                          <SelectItem value="false">No</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    ) : r.parameter_type === 'select' ? (
                                      <Select value={r.value || undefined}
                                        onValueChange={(v) => updateReading(index, ri, { value: v })}>
                                        <SelectTrigger className="h-8"><SelectValue placeholder="Select" /></SelectTrigger>
                                        <SelectContent>
                                          {(r.options || []).map((o) => (
                                            <SelectItem key={o} value={o}>{o}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    ) : (
                                      <Input
                                        className="h-8"
                                        type={r.parameter_type === 'numeric' ? 'number' : 'text'}
                                        step="any"
                                        value={r.value}
                                        onChange={(e) => updateReading(index, ri, { value: e.target.value })}
                                        placeholder="Reading"
                                      />
                                    )}
                                  </div>
                                  <div className="col-span-1 text-center">
                                    {spec === null ? (
                                      <span className="text-muted-foreground text-xs">—</span>
                                    ) : spec ? (
                                      <Badge className="bg-green-500">OK</Badge>
                                    ) : (
                                      <Badge className="bg-red-500">Out</Badge>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground italic">
                            No quality checkpoints defined for this raw material. Add them under Purchase → QC Checkpoints.
                          </div>
                        )}
                      </div>
                    ))}

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
                <div className="space-y-3">
                  {viewItems.map((it: any) => {
                    const readings = viewReadings?.[it.id] || [];
                    return (
                      <div key={it.id} className="rounded-lg border p-3 space-y-2">
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="font-medium text-sm">
                            {it.description || it.items?.name}
                            {it.items?.code && <span className="text-muted-foreground"> ({it.items.code})</span>}
                          </div>
                          <div className="flex gap-4 text-xs">
                            <span className="text-muted-foreground">Inspected: <span className="text-foreground">{it.quantity_inspected}</span></span>
                            <span className="text-green-600">Accepted: {it.quantity_accepted}</span>
                            <span className="text-destructive">Rejected: {it.quantity_rejected}</span>
                          </div>
                        </div>
                        {it.remarks && <div className="text-xs text-muted-foreground">Remarks: {it.remarks}</div>}

                        {readings.length > 0 && (
                          <div className="rounded-md border bg-muted/30 overflow-hidden">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-xs text-muted-foreground">
                                  <th className="text-left font-medium p-2">Checkpoint</th>
                                  <th className="text-left font-medium p-2">Spec</th>
                                  <th className="text-left font-medium p-2">Reading</th>
                                  <th className="text-center font-medium p-2">Result</th>
                                </tr>
                              </thead>
                              <tbody>
                                {readings.map((r: any) => (
                                  <tr key={r.id} className="border-t">
                                    <td className="p-2">
                                      {r.parameter_name}{r.is_required ? ' *' : ''}
                                      {r.parameter_name_ur && (
                                        <div className="text-xs text-muted-foreground" dir="rtl" lang="ur">
                                          {r.parameter_name_ur}
                                        </div>
                                      )}
                                    </td>
                                    <td className="p-2 text-xs text-muted-foreground">{readingSpecText(r)}</td>
                                    <td className="p-2">{readingValueText(r)}</td>
                                    <td className="p-2 text-center">
                                      {r.is_within_spec == null
                                        ? <span className="text-muted-foreground text-xs">—</span>
                                        : r.is_within_spec
                                          ? <Badge className="bg-green-500">OK</Badge>
                                          : <Badge className="bg-red-500">Out</Badge>}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {viewInspection.notes && (
                <div>
                  <strong>Notes:</strong>
                  <p className="text-muted-foreground">{viewInspection.notes}</p>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" className="sm:mr-auto" onClick={() => handlePrint(viewInspection.id)}>
                  <Printer className="h-4 w-4 mr-1" /> Print
                </Button>
                <Button
                  variant="outline"
                  className="text-green-600 hover:text-green-700 hover:bg-green-50 border-green-200"
                  onClick={() => handleShare(viewInspection.id)}
                  disabled={sharingId === viewInspection.id}
                  title="Share this report as a PDF on WhatsApp"
                >
                  <MessageCircle className="h-4 w-4 mr-1" /> WhatsApp
                </Button>
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
