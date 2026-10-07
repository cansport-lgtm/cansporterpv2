import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
import { Plus, Eye, Printer } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import type { Database } from "@/integrations/supabase/types";
import { postGRNVoucher } from "@/lib/accounting/postGRNVoucher";
import { printGRN } from "@/lib/purchase/printGRN";
import { GRNViewDialog } from "@/components/purchase/GRNViewDialog";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { DEFAULT_SETTINGS, fmtInAt, giDb, type InwardEntry, type InwardSettings } from "@/lib/gateInward";
import { gpDb } from "@/lib/gatePass";
import { fmtRs, grnPayerLabel, printFreightVoucherById, voucherStatusMeta, useGrnFreight } from "@/lib/gatePassFreight";
import { NEW_TRANSPORTER, useTransporters } from "@/components/gate-pass/FreightSection";
import {
  GRNFreightSection, emptyGrnFreight, grnFreightError, grnFreightPayload, isCompanyPaid, supplierBilledAmount,
  type GrnFreightFormState,
} from "@/components/purchase/GRNFreightSection";

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
  { value: "general_supplies", label: "Production Supplies" },
  { value: "spare_maintenance", label: "Spares & Parts" },
];

interface GRNItem {
  po_item_id: string;
  item_id: string | null;
  description: string;
  quantity_ordered: number;
  quantity_already_received: number;
  quantity_remaining: number;
  quantity_received: string;
  unit_price: number;
}

export default function GoodsReceiptPage() {
  const queryClient = useQueryClient();
  const { user, hasModulePermission, hasPurchaseCategoryPermission } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewGRNId, setViewGRNId] = useState<string | null>(null);
  const [selectedPO, setSelectedPO] = useState<any>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [formData, setFormData] = useState({
    purchase_order_id: '',
    gate_inward_id: '',
    receipt_date: format(new Date(), 'yyyy-MM-dd'),
    invoice_number: '',
    invoice_date: '',
    invoice_amount: '',
    notes: '',
    items: [] as GRNItem[],
  });
  // Who paid for the vehicle (docs/GRN_FREIGHT_VOUCHER_PLAN.md).
  const [freight, setFreight] = useState<GrnFreightFormState>(emptyGrnFreight());
  const { data: transporters = [] } = useTransporters();

  const canCreate = hasModulePermission('purchase', 'create');

  // Fetch GRNs
  const { data: grns, isLoading } = useQuery({
    queryKey: ['goods-receipt-notes'],
    queryFn: async () => {
      // giDb: the gate_inward_entries relation is not in the generated types.
      const { data, error } = await giDb
        .from('goods_receipt_notes')
        .select(`
          *,
          purchase_orders(po_number, category),
          suppliers(name, code),
          received_by_user:app_users!goods_receipt_notes_received_by_fkey(full_name),
          gate_inward:gate_inward_entries!goods_receipt_notes_gate_inward_id_fkey(entry_number, vehicle_number, in_at)
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
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

  // QC-accepted quantities per PO line (raw material only). Used to pre-fill the
  // receiving quantities so only inspected & accepted material is received.
  const { data: qcAccepted } = useQuery({
    queryKey: ['qc-accepted-for-po', selectedPO?.id],
    queryFn: async () => {
      const map: Record<string, number> = {};
      if (!selectedPO?.id || selectedPO.category !== 'raw_material') return map;
      const { data, error } = await (supabase as any)
        .from('purchase_qc_inspections')
        .select('purchase_qc_inspection_items(po_item_id, quantity_accepted)')
        .eq('purchase_order_id', selectedPO.id)
        .eq('status', 'approved');
      if (error) throw error;
      (data || []).forEach((insp: any) => {
        (insp.purchase_qc_inspection_items || []).forEach((it: any) => {
          if (!it.po_item_id) return;
          map[it.po_item_id] = (map[it.po_item_id] || 0) + Number(it.quantity_accepted || 0);
        });
      });
      return map;
    },
    enabled: !!selectedPO?.id,
  });

  // Gate Inward: the vehicles recorded at the gate for this PO and not yet received.
  // A GRN names the entry it receives against; required per category when the
  // super admin has switched it on (gate_inward_settings).
  const { data: inwardSettings = DEFAULT_SETTINGS } = useQuery<InwardSettings>({
    queryKey: ['gate-inward-settings'],
    queryFn: async () => {
      const { data, error } = await giDb.from('gate_inward_settings').select('*').maybeSingle();
      if (error) return DEFAULT_SETTINGS; // table missing until the migration is applied
      return data ?? DEFAULT_SETTINGS;
    },
  });
  const { data: inwardEntries = [] } = useQuery<InwardEntry[]>({
    queryKey: ['gate-inward', 'for-po', selectedPO?.id],
    enabled: !!selectedPO?.id,
    queryFn: async () => {
      const { data, error } = await giDb
        .from('v_gate_inward_register')
        .select('*')
        .eq('purchase_order_id', selectedPO.id)
        .eq('entry_kind', 'purchase')
        .eq('status', 'at_gate')
        .order('in_at');
      if (error) return [];
      return data ?? [];
    },
  });
  const inwardRequired = !!selectedPO && inwardSettings.require_for_grn &&
    inwardSettings.require_for_categories.includes(selectedPO.category);
  const chosenInward = inwardEntries.find((e) => e.id === formData.gate_inward_id);

  // Opened from an inward entry ("Make GRN"): preselect its PO and the entry.
  const ginParam = searchParams.get('gin');
  useEffect(() => {
    if (!ginParam || !purchaseOrders) return;
    (async () => {
      const { data } = await giDb.from('gate_inward_entries').select('id, purchase_order_id, challan_number, entry_date, vehicle_number, driver_name, driver_contact, transporter_name').eq('id', ginParam).maybeSingle();
      if (!data?.purchase_order_id) return;
      const po = purchaseOrders.find((p) => p.id === data.purchase_order_id);
      if (!po) { toast.error('That purchase order is not open for receiving (check QC and status).'); return; }
      setSelectedPO(po);
      setFormData((f) => ({
        ...f,
        purchase_order_id: po.id,
        gate_inward_id: data.id,
        receipt_date: data.entry_date ?? f.receipt_date,
        invoice_number: f.invoice_number || data.challan_number || '',
        items: [],
      }));
      prefillFreight(data);
      setDialogOpen(true);
      setSearchParams({}, { replace: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ginParam, purchaseOrders]);

  // The vehicle, driver and transporter the gate recorded go into the freight.
  const prefillFreight = (e: { vehicle_number?: string | null; driver_name?: string | null; driver_contact?: string | null; transporter_name?: string | null } | undefined) => {
    if (!e) return;
    setFreight((fr) => {
      const known = e.transporter_name
        ? transporters.find((t) => t.name.trim().toLowerCase() === e.transporter_name!.trim().toLowerCase())
        : undefined;
      return {
        ...fr,
        vehicle_number: fr.vehicle_number || e.vehicle_number || '',
        driver_name: fr.driver_name || e.driver_name || '',
        driver_contact: fr.driver_contact || e.driver_contact || '',
        ...(!fr.transporter_id && e.transporter_name
          ? known
            ? { transporter_id: known.id, mode: fr.mode || known.default_mode, amount: fr.amount || (known.default_rate ? String(known.default_rate) : '') }
            : { transporter_id: NEW_TRANSPORTER, new_name: e.transporter_name }
          : {}),
      };
    });
  };

  const pickInward = (id: string) => {
    const e = inwardEntries.find((x) => x.id === id);
    setFormData((f) => ({
      ...f,
      gate_inward_id: id,
      receipt_date: e?.entry_date ?? f.receipt_date,
      invoice_number: f.invoice_number || e?.challan_number || '',
    }));
    prefillFreight(e);
  };

  // Check category permission
  const canAccessCategory = (category: PurchaseCategory) => {
    return hasPurchaseCategoryPermission(category, 'view');
  };

  // Filter GRNs by user's category permissions
  const filteredGRNs = grns?.filter(grn => {
    const category = grn.purchase_orders?.category;
    return category && canAccessCategory(category as PurchaseCategory);
  });

  // Filter POs by user's category permissions, and apply the QC gate:
  // raw-material POs only become receivable once their quality inspection has
  // passed (qc_status === 'passed'). Other categories are exempt.
  const filteredPOs = purchaseOrders?.filter(po =>
    canAccessCategory(po.category as PurchaseCategory) &&
    (po.category !== 'raw_material' || (po as any).qc_status === 'passed')
  );

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      // Block over-receipt: each line may receive at most its outstanding qty.
      for (const item of data.items) {
        const qty = parseFloat(item.quantity_received) || 0;
        if (qty > item.quantity_remaining + 0.001) {
          throw new Error(
            `"${item.description}": receiving ${qty} exceeds remaining quantity ${item.quantity_remaining}`
          );
        }
      }
      if (!data.items.some(item => (parseFloat(item.quantity_received) || 0) > 0)) {
        throw new Error('Enter a received quantity for at least one item');
      }
      if (inwardRequired && !data.gate_inward_id) {
        throw new Error('Choose the gate inward entry this delivery came in on');
      }
      const freightProblem = grnFreightError(freight);
      if (freightProblem) throw new Error(freightProblem);

      const itemsSubtotal = data.items.reduce((sum, item) => {
        return sum + (parseFloat(item.quantity_received) || 0) * item.unit_price;
      }, 0);
      // Only freight the supplier billed is part of the GRN total (his payable).
      const transportationCost = supplierBilledAmount(freight);
      const totalAmount = itemsSubtotal + transportationCost;

      const { data: newGRN, error: grnError } = await supabase
        .from('goods_receipt_notes')
        .insert({
          grn_number: '', // Auto-generated
          purchase_order_id: data.purchase_order_id,
          gate_inward_id: data.gate_inward_id || null,
          supplier_id: selectedPO.supplier_id,
          receipt_date: data.receipt_date,
          invoice_number: data.invoice_number || null,
          invoice_date: data.invoice_date || null,
          invoice_amount: data.invoice_amount ? parseFloat(data.invoice_amount) : null,
          transportation_cost: transportationCost,
          total_amount: totalAmount,
          notes: data.notes || null,
          received_by: user?.id,
          status: 'completed',
        } as any)
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

      // Update PO status: 'received' only when every line is now fully
      // received, otherwise 'partially_received' so the balance stays
      // receivable. The DB trigger (recalc_po_receipt_status) computes the
      // same answer from grn_items; this write is a belt-and-braces no-op
      // when the trigger has already run.
      const fullyReceived = (poItems || []).every((poItem) => {
        const receivedNow = data.items.find(i => i.po_item_id === poItem.id);
        const total = Number(poItem.quantity_received || 0) +
          (receivedNow ? parseFloat(receivedNow.quantity_received) || 0 : 0);
        return total + 0.001 >= Number(poItem.quantity);
      });
      const { error: poError } = await supabase
        .from('purchase_orders')
        .update({ status: fullyReceived ? 'received' : 'partially_received' })
        .eq('id', data.purchase_order_id);
      if (poError) console.error('Failed to update PO status:', poError);

      // Freight: the voucher (FV-…) is made here when the company paid. The GRN
      // is already saved, so a failure is reported, not thrown.
      let voucherId: string | null = null;
      let freightFailed: string | null = null;
      const { data: fv, error: frError } = await gpDb.rpc('grn_freight_save', {
        p_grn_id: newGRN.id, p_data: grnFreightPayload(freight),
      });
      if (frError) freightFailed = frError.message;
      else voucherId = fv ?? null;

      return { ...newGRN, voucherId, freightFailed };
    },
    onSuccess: async (newGRN: any) => {
      queryClient.invalidateQueries({ queryKey: ['goods-receipt-notes'] });
      queryClient.invalidateQueries({ queryKey: ['approved-purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['gate-inward'] });
      queryClient.invalidateQueries({ queryKey: ['grn-freight-by-grn'] });
      queryClient.invalidateQueries({ queryKey: ['gate-pass-freight-vouchers'] });
      queryClient.invalidateQueries({ queryKey: ['gate-pass-transporters'] });
      toast.success('Goods receipt created');
      if (newGRN?.freightFailed) {
        toast.error(`Freight not recorded: ${newGRN.freightFailed}. Open the GRN to record it.`);
      } else if (newGRN?.voucherId) {
        const id = newGRN.voucherId as string;
        toast.success('Freight voucher made for the driver / transporter', {
          duration: 15000,
          action: { label: 'Print voucher', onClick: () => printFreightVoucherById(id).catch((e: any) => toast.error(e.message || 'Failed to print voucher')) },
        });
      }
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
      gate_inward_id: '',
      receipt_date: format(new Date(), 'yyyy-MM-dd'),
      invoice_number: '',
      invoice_date: '',
      invoice_amount: '',
      notes: '',
      items: [],
    });
    setFreight(emptyGrnFreight());
    setSelectedPO(null);
    setDialogOpen(false);
  };

  const handlePOSelect = (poId: string) => {
    const po = purchaseOrders?.find(p => p.id === poId);
    setSelectedPO(po);
    setFormData({ ...formData, purchase_order_id: poId, gate_inward_id: '', items: [] });
  };

  // When PO items are loaded, populate form items. Fully received lines are
  // left out so a follow-up (partial) GRN only offers the outstanding balance.
  const loadPOItems = () => {
    if (poItems && poItems.length > 0) {
      const isRawMaterial = selectedPO?.category === 'raw_material';
      const items: GRNItem[] = poItems
        .filter((item) => Number(item.quantity) - Number(item.quantity_received || 0) > 0.001)
        .map((item: any) => {
          const alreadyReceived = Number(item.quantity_received || 0);
          const remaining = Number(item.quantity) - alreadyReceived;
          // For raw material, default to the QC-accepted quantity not yet
          // received (capped at the outstanding quantity). For other
          // categories, default to the remaining qty.
          const accepted = qcAccepted?.[item.id];
          const acceptedOutstanding = accepted !== undefined ? accepted - alreadyReceived : remaining;
          const defaultQty = isRawMaterial
            ? Math.max(0, Math.min(acceptedOutstanding, remaining))
            : remaining;
          return {
            po_item_id: item.id,
            item_id: item.item_id,
            description: item.description || item.items?.name || '',
            quantity_ordered: item.quantity,
            quantity_already_received: alreadyReceived,
            quantity_remaining: remaining,
            quantity_received: defaultQty.toString(),
            unit_price: item.unit_price,
          };
        });
      setFormData(prev => ({ ...prev, items }));
    }
  };

  const updateItemQty = (index: number, value: string) => {
    const newItems = [...formData.items];
    newItems[index] = { ...newItems[index], quantity_received: value };
    setFormData({ ...formData, items: newItems });
  };

  const itemsSubtotal = formData.items.reduce((sum, item) => {
    return sum + (parseFloat(item.quantity_received) || 0) * item.unit_price;
  }, 0);
  const transportationCost = supplierBilledAmount(freight);
  const totalAmount = itemsSubtotal + transportationCost;
  const freightProblem = grnFreightError(freight);
  const grnFreight = useGrnFreight((filteredGRNs || []).map((g: any) => g.id));
  const hasOverReceipt = formData.items.some(
    item => (parseFloat(item.quantity_received) || 0) > item.quantity_remaining + 0.001
  );

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
      key: 'gate_inward',
      header: 'Gate in',
      render: (grn) => grn.gate_inward
        ? <span title={`Vehicle ${grn.gate_inward.vehicle_number} · in ${fmtInAt(grn.gate_inward.in_at)}`} className="font-mono text-xs">{grn.gate_inward.entry_number}</span>
        : <span className="text-muted-foreground">-</span>,
    },
    {
      key: 'freight',
      header: 'Freight',
      render: (grn) => {
        const f = grnFreight.get(grn.id);
        if (!f) return <span className="text-muted-foreground text-xs">—</span>;
        if (!isCompanyPaid(f.payer)) {
          return <span className="text-xs">{f.payer === 'other_grn' ? `On ${f.shared_grn_number ?? 'another GRN'}` : grnPayerLabel(f.payer)}</span>;
        }
        const st = voucherStatusMeta(f.voucher_status);
        return (
          <div className="text-xs whitespace-nowrap">
            {f.voucher_id ? (
              <button type="button" className="font-mono text-primary hover:underline" title="Print freight voucher"
                onClick={() => printFreightVoucherById(f.voucher_id!).catch((e: any) => toast.error(e.message || 'Failed to print voucher'))}>
                {f.voucher_number}
              </button>
            ) : <span className="text-amber-700">no voucher</span>}
            {' '}<Badge variant={st.variant} className="text-[10px] px-1.5 py-0">{st.label}</Badge>
            <div className="text-muted-foreground">{fmtRs(f.amount)} · {f.transporter_name}</div>
          </div>
        );
      },
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
        <div className="flex">
          <Button variant="ghost" size="icon" onClick={() => setViewGRNId(grn.id)}>
            <Eye className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Print GRN (quantities only, no prices)"
            onClick={() => printGRN(grn.id).catch((e: any) => toast.error(e.message || 'Failed to print GRN'))}
          >
            <Printer className="h-4 w-4" />
          </Button>
        </div>
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
                    <SearchableSelect
                      value={formData.purchase_order_id}
                      onValueChange={handlePOSelect}
                      placeholder="Select PO"
                      options={(filteredPOs || []).map(po => ({
                        value: po.id,
                        label: po.po_number,
                        secondary: po.suppliers?.name ? `- ${po.suppliers.name}` : undefined,
                        search: `${po.suppliers?.name || ''} ${po.suppliers?.code || ''}`,
                      }))}
                    />
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
                  <div className="space-y-2">
                    <Label>Gate inward entry {inwardRequired ? '*' : ''}</Label>
                    {inwardEntries.length === 0 ? (
                      <div className={`text-sm rounded-md p-2 ${inwardRequired ? 'bg-destructive/10 text-destructive' : 'text-muted-foreground bg-muted'}`}>
                        {inwardRequired
                          ? 'No vehicle has been recorded at the gate for this PO. The gate must make the inward entry before this GRN can be saved.'
                          : 'No vehicle recorded at the gate for this PO.'}
                      </div>
                    ) : (
                      <SearchableSelect
                        value={formData.gate_inward_id}
                        onValueChange={pickInward}
                        placeholder="Which vehicle is this GRN for?"
                        sortAlpha={false}
                        options={inwardEntries.map((e) => ({
                          value: e.id,
                          label: e.entry_number,
                          secondary: `· ${e.vehicle_number} · in ${fmtInAt(e.in_at)}${e.challan_number ? ` · challan ${e.challan_number}` : ''}`,
                          search: `${e.vehicle_number} ${e.challan_number ?? ''} ${e.driver_name ?? ''}`,
                        }))}
                      />
                    )}
                    {chosenInward && (
                      <div className="text-xs text-muted-foreground">
                        Vehicle {chosenInward.vehicle_number}{chosenInward.driver_name ? ` · ${chosenInward.driver_name}` : ''} · in {fmtInAt(chosenInward.in_at)}
                        {chosenInward.packages_count != null ? ` · ${chosenInward.packages_count} packages on the challan` : ''} · recorded by {chosenInward.created_by_name ?? '—'}
                      </div>
                    )}
                  </div>
                )}

                {selectedPO && (
                  <div className="p-3 bg-muted rounded-md text-sm">
                    <div><strong>Supplier:</strong> {selectedPO.suppliers?.name}</div>
                    <div><strong>Category:</strong> {CATEGORIES.find(c => c.value === selectedPO.category)?.label}</div>
                    <div><strong>PO Date:</strong> {format(new Date(selectedPO.order_date), 'dd/MM/yyyy')}</div>
                    {selectedPO.category === 'raw_material' && (
                      <div className="flex items-center gap-1">
                        <strong>QC:</strong>
                        <Badge className="bg-green-500">inspection passed</Badge>
                      </div>
                    )}
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

                <div className="space-y-2 rounded-lg border p-3">
                  <div>
                    <Label>Freight *</Label>
                    <p className="text-xs text-muted-foreground">
                      Who paid for the vehicle that brought these goods. When the company paid the driver or transporter, a freight voucher is made with this GRN for the cashier to pay.
                    </p>
                  </div>
                  <GRNFreightSection value={freight} onChange={setFreight} />
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
                            <TableHead className="text-right">Received</TableHead>
                            <TableHead className="text-right">Remaining</TableHead>
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
                              <TableCell className="text-right">{item.quantity_already_received}</TableCell>
                              <TableCell className="text-right">{item.quantity_remaining}</TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  min="0"
                                  max={item.quantity_remaining}
                                  value={item.quantity_received}
                                  onChange={(e) => updateItemQty(index, e.target.value)}
                                  className={`text-right ${
                                    (parseFloat(item.quantity_received) || 0) > item.quantity_remaining + 0.001
                                      ? 'border-destructive text-destructive'
                                      : ''
                                  }`}
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
                      <div className="space-y-1 pt-2 text-right text-sm">
                        {hasOverReceipt && (
                          <div className="text-destructive">
                            Receiving quantity cannot exceed the remaining quantity
                          </div>
                        )}
                        <div className="text-muted-foreground">
                          Subtotal: Rs. {itemsSubtotal.toLocaleString()}
                        </div>
                        {transportationCost > 0 && (
                          <div className="text-muted-foreground">
                            Freight on supplier's bill: Rs. {transportationCost.toLocaleString()}
                          </div>
                        )}
                        <div className="font-semibold text-lg text-foreground">
                          Total: Rs. {totalAmount.toLocaleString()}
                        </div>
                        {isCompanyPaid(freight.payer) && parseFloat(freight.amount) > 0 && (
                          <div className="text-xs text-muted-foreground">
                            {freight.payer === 'company_recover'
                              ? `Freight Rs. ${Number(freight.amount).toLocaleString()} paid by us is deducted from the supplier's payable`
                              : `Freight Rs. ${Number(freight.amount).toLocaleString()} paid by us — on a freight voucher, not in this total`}
                          </div>
                        )}
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
                    disabled={!formData.purchase_order_id || formData.items.length === 0 || hasOverReceipt || saveMutation.isPending || (inwardRequired && !formData.gate_inward_id) || !!freightProblem}
                    title={freightProblem ?? undefined}
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

      <GRNViewDialog
        grnId={viewGRNId}
        onOpenChange={(o) => !o && setViewGRNId(null)}
      />

    </ERPLayout>
  );
}