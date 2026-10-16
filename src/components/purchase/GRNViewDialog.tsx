import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Paperclip, FileText, Image as ImageIcon, Trash2, Upload, Pencil, Save, X, Printer, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { syncGRNToLedger } from "@/lib/accounting/syncGRNToLedger";
import { printGRN } from "@/lib/purchase/printGRN";
import { gpDb } from "@/lib/gatePass";
import {
  VOUCHER_SELECT, fmtRs, grnPayerLabel, modeLabel, printFreightVoucher, voucherStatusMeta,
  type FreightVoucher, type GrnFreight,
} from "@/lib/gatePassFreight";
import {
  GRNFreightSection, emptyGrnFreight, grnFreightError, grnFreightFromRow, grnFreightPayload, isCompanyPaid,
  type GrnFreightFormState,
} from "@/components/purchase/GRNFreightSection";
const sb = supabase as any;
const ATTACHMENT_BUCKET = "grn-attachments";

interface Attachment {
  id: string;
  grn_id: string;
  kind: "bill" | "stock_photo" | "other";
  file_path: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  created_at: string;
}

function publicUrl(filePath: string): string {
  const { data } = (sb.storage.from(ATTACHMENT_BUCKET).getPublicUrl(filePath)) as { data: { publicUrl: string } };
  return data.publicUrl;
}

function isImage(mime: string | null | undefined, name?: string): boolean {
  if (mime?.startsWith("image/")) return true;
  return !!name?.match(/\.(png|jpe?g|gif|webp|bmp|svg)$/i);
}

interface GRNViewDialogProps {
  grnId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function GRNViewDialog({ grnId, onOpenChange }: GRNViewDialogProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadKind, setUploadKind] = useState<"bill" | "stock_photo">("bill");
  const { user, roles, hasModulePermission } = useAuth();
  const canEdit = hasModulePermission("purchase", "edit");
  const [editMode, setEditMode] = useState(false);
  const [editPrices, setEditPrices] = useState<Record<string, string>>({});
  const [editInvoice, setEditInvoice] = useState<string>("");
  const [freightEdit, setFreightEdit] = useState(false);
  const [freightForm, setFreightForm] = useState<GrnFreightFormState>(emptyGrnFreight());
  const [freightReason, setFreightReason] = useState("");

  // Reset edit state whenever a different GRN is opened/closed.
  useEffect(() => { setEditMode(false); setFreightEdit(false); setFreightReason(""); }, [grnId]);

  const { data: grn } = useQuery({
    queryKey: ["grn-view-dialog", grnId],
    queryFn: async () => {
      if (!grnId) return null;
      const { data, error } = await sb
        .from("goods_receipt_notes")
        .select(`*, suppliers(name, code), purchase_orders(po_number, category), gate_inward:gate_inward_entries!goods_receipt_notes_gate_inward_id_fkey(entry_number, vehicle_number, driver_name, in_at, challan_number)`)
        .eq("id", grnId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!grnId,
  });

  const { data: items } = useQuery({
    queryKey: ["grn-view-dialog-items", grnId],
    queryFn: async () => {
      if (!grnId) return [];
      const { data, error } = await sb
        .from("grn_items")
        .select(`*, items(code, name)`)
        .eq("grn_id", grnId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!grnId,
  });

  const { data: attachments } = useQuery({
    queryKey: ["grn-attachments", grnId],
    queryFn: async () => {
      if (!grnId) return [];
      const { data, error } = await sb
        .from("grn_attachments")
        .select("*")
        .eq("grn_id", grnId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as Attachment[];
    },
    enabled: !!grnId,
  });

  // Freight: who paid for the vehicle, and the inward voucher (20261014120000_grn_freight.sql).
  const { data: freight, isLoading: freightLoading } = useQuery<GrnFreight | null>({
    queryKey: ["grn-freight", grnId],
    queryFn: async () => {
      const { data, error } = await gpDb.from("grn_freight").select("*").eq("grn_id", grnId).maybeSingle();
      if (error) return null; // migration not applied yet, or no access
      return data;
    },
    enabled: !!grnId,
  });
  const { data: sharedGrn } = useQuery<{ grn_number: string } | null>({
    queryKey: ["grn-freight-shared", freight?.shared_grn_id],
    queryFn: async () => {
      const { data } = await sb.from("goods_receipt_notes").select("grn_number").eq("id", freight!.shared_grn_id).maybeSingle();
      return data;
    },
    enabled: !!freight?.shared_grn_id,
  });
  const { data: vouchers = [] } = useQuery<FreightVoucher[]>({
    queryKey: ["gate-pass-freight-vouchers", "grn", grnId],
    queryFn: async () => {
      const { data, error } = await gpDb.from("gate_pass_freight_vouchers").select(VOUCHER_SELECT)
        .eq("grn_id", grnId).order("created_at", { ascending: false });
      if (error) return [];
      return data ?? [];
    },
    enabled: !!grnId,
  });
  const liveVoucher = vouchers.find((v) => v.status !== "cancelled");
  const cancelledVouchers = vouchers.filter((v) => v.status === "cancelled");
  const isFreightManager = roles.some((r) => ["super_admin", "purchase_manager", "gate_pass_manager"].includes(r.role));
  const canEditFreight = !!grn && hasModulePermission("purchase", "create") &&
    (!freight || grn.received_by === user?.id || isFreightManager);

  const freightMutation = useMutation({
    mutationFn: async () => {
      if (!grnId) throw new Error("No GRN");
      const problem = grnFreightError(freightForm);
      if (problem) throw new Error(problem);
      const { error } = await gpDb.rpc("grn_freight_save", {
        p_grn_id: grnId, p_data: grnFreightPayload(freightForm, { reason: freightReason }),
      });
      if (error) throw error;
      // The GRN total (supplier-billed freight) and the recovery may have changed.
      return await syncGRNToLedger(grnId);
    },
    onSuccess: (sync: any) => {
      queryClient.invalidateQueries({ queryKey: ["grn-freight", grnId] });
      queryClient.invalidateQueries({ queryKey: ["gate-pass-freight-vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["grn-freight-by-grn"] });
      queryClient.invalidateQueries({ queryKey: ["grn-view-dialog", grnId] });
      queryClient.invalidateQueries({ queryKey: ["goods-receipt-notes"] });
      queryClient.invalidateQueries({ queryKey: ["gate-pass-transporters"] });
      if (sync && !sync.ok) {
        toast({ title: "Freight saved, but GL sync failed", description: sync.error, variant: "destructive" });
      } else {
        toast({ title: "Freight saved" });
      }
      setFreightEdit(false);
      setFreightReason("");
    },
    onError: (e: any) => toast({ title: "Could not save freight", description: e.message, variant: "destructive" }),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!grnId) throw new Error("No GRN id");
      const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${grnId}/${crypto.randomUUID()}-${cleanName}`;
      const { error: uploadErr } = await sb.storage
        .from(ATTACHMENT_BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type || undefined });
      if (uploadErr) throw uploadErr;

      const { error: insertErr } = await sb.from("grn_attachments").insert({
        grn_id: grnId,
        kind: uploadKind,
        file_path: path,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || null,
      });
      if (insertErr) {
        // best-effort cleanup so we don't leave orphan files
        await sb.storage.from(ATTACHMENT_BUCKET).remove([path]);
        throw insertErr;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grn-attachments", grnId] });
      toast({ title: "Attachment uploaded" });
    },
    onError: (e: any) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (a: Attachment) => {
      await sb.storage.from(ATTACHMENT_BUCKET).remove([a.file_path]);
      const { error } = await sb.from("grn_attachments").delete().eq("id", a.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grn-attachments", grnId] });
      toast({ title: "Attachment removed" });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  // ── Edit purchase prices ────────────────────────────────────────────────
  const startEdit = () => {
    const map: Record<string, string> = {};
    (items || []).forEach((it: any) => { map[it.id] = String(it.unit_price ?? 0); });
    setEditPrices(map);
    setEditInvoice(grn?.invoice_amount != null ? String(grn.invoice_amount) : "");
    setEditMode(true);
  };

  const livePrice = (it: any) =>
    editMode ? (parseFloat(editPrices[it.id] ?? String(it.unit_price ?? 0)) || 0) : Number(it.unit_price || 0);
  const liveSubtotal = (items || []).reduce(
    (s: number, it: any) => s + Number(it.quantity_received || 0) * livePrice(it), 0);
  const liveTotal = liveSubtotal + Number(grn?.transportation_cost || 0);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!grnId || !grn) throw new Error("No GRN");
      const list = items || [];
      for (const it of list) {
        const p = parseFloat(editPrices[it.id] ?? String(it.unit_price ?? 0));
        if (!(p >= 0)) throw new Error("Unit price cannot be negative");
      }
      // Update each line's unit_price + amount
      for (const it of list) {
        const price = parseFloat(editPrices[it.id] ?? String(it.unit_price ?? 0)) || 0;
        const qty = Number(it.quantity_received || 0);
        const { error } = await sb.from("grn_items").update({ unit_price: price, amount: qty * price }).eq("id", it.id);
        if (error) throw error;
      }
      // Recompute header total + invoice amount
      const subtotal = list.reduce(
        (s: number, it: any) => s + Number(it.quantity_received || 0) * (parseFloat(editPrices[it.id] ?? String(it.unit_price ?? 0)) || 0), 0);
      const total = subtotal + Number(grn.transportation_cost || 0);
      const invAmt = editInvoice.trim() === "" ? null : (parseFloat(editInvoice) || 0);
      const { error: hErr } = await sb.from("goods_receipt_notes").update({ total_amount: total, invoice_amount: invAmt }).eq("id", grnId);
      if (hErr) throw hErr;
      // Keep the auto-posted AP/Inventory voucher in step with the new amount.
      return await syncGRNToLedger(grnId);
    },
    onSuccess: (sync: any) => {
      queryClient.invalidateQueries({ queryKey: ["grn-view-dialog", grnId] });
      queryClient.invalidateQueries({ queryKey: ["grn-view-dialog-items", grnId] });
      queryClient.invalidateQueries({ queryKey: ["goods-receipt-notes"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-vouchers"] });
      if (sync?.updated) {
        toast({ title: "Prices updated", description: `GL synced: ${sync.updated.voucherNumber} → Rs. ${Number(sync.updated.to).toLocaleString()}` });
      } else if (sync && !sync.ok) {
        toast({ title: "Saved, but GL sync failed", description: sync.error, variant: "destructive" });
      } else {
        toast({ title: "Prices updated" });
      }
      setEditMode(false);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const handleFilesPicked = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((f) => uploadMutation.mutate(f));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const bills = (attachments || []).filter((a) => a.kind === "bill");
  const photos = (attachments || []).filter((a) => a.kind === "stock_photo");

  return (
    <Dialog open={!!grnId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Goods Receipt: {grn?.grn_number || "—"}</DialogTitle>
        </DialogHeader>
        {grn && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><strong>PO #:</strong> {grn.purchase_orders?.po_number || "—"}</div>
              <div><strong>Supplier:</strong> {grn.suppliers?.name || "—"}</div>
              <div><strong>Receipt Date:</strong> {grn.receipt_date ? format(new Date(grn.receipt_date), "dd/MM/yyyy") : "—"}</div>
              <div><strong>Invoice #:</strong> {grn.invoice_number || "—"}</div>
              {grn.gate_inward && (
                <div className="col-span-2">
                  <strong>Gate in:</strong> {grn.gate_inward.entry_number} · vehicle {grn.gate_inward.vehicle_number}
                  {grn.gate_inward.driver_name ? ` · ${grn.gate_inward.driver_name}` : ""} · in {format(new Date(grn.gate_inward.in_at), "dd/MM/yyyy HH:mm")}
                  {grn.gate_inward.challan_number ? ` · challan ${grn.gate_inward.challan_number}` : ""}
                </div>
              )}
              <div className="flex items-center gap-2">
                <strong>Invoice Amount:</strong>
                {editMode ? (
                  <Input type="number" min={0} step="0.01" className="h-8 w-36 text-sm" value={editInvoice} placeholder="(none)" onChange={(e) => setEditInvoice(e.target.value)} />
                ) : (grn.invoice_amount ? `Rs. ${Number(grn.invoice_amount).toLocaleString()}` : "—")}
              </div>
              {Number(grn.transportation_cost || 0) > 0 && (
                <div><strong>Freight on supplier's bill:</strong> Rs. {Number(grn.transportation_cost).toLocaleString()}</div>
              )}
              <div><strong>Total Received:</strong> Rs. {Number(editMode ? liveTotal : (grn.total_amount || 0)).toLocaleString()}</div>
            </div>

            {items && items.length > 0 && (
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
                  {items.map((item: any) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.items?.code || "—"}</TableCell>
                      <TableCell>{item.description || item.items?.name}</TableCell>
                      <TableCell className="text-right">{item.quantity_ordered}</TableCell>
                      <TableCell className="text-right">{item.quantity_received}</TableCell>
                      <TableCell className="text-right">
                        {editMode ? (
                          <Input
                            type="number" min={0} step="0.01"
                            className="h-8 w-28 text-right text-sm ml-auto"
                            value={editPrices[item.id] ?? String(item.unit_price ?? 0)}
                            onChange={(e) => setEditPrices((m) => ({ ...m, [item.id]: e.target.value }))}
                          />
                        ) : `Rs. ${Number(item.unit_price || 0).toLocaleString()}`}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">Rs. {Number(Number(item.quantity_received || 0) * livePrice(item) || 0).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {/* Freight */}
            <div className="border-t pt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2"><Truck className="h-4 w-4" /><strong>Freight</strong></div>
                <div className="flex gap-2">
                  {liveVoucher && (
                    <Button size="sm" variant="outline" onClick={() => printFreightVoucher(liveVoucher)}>
                      <Printer className="h-4 w-4 mr-1" /> Freight voucher
                    </Button>
                  )}
                  {canEditFreight && !freightEdit && (
                    <Button size="sm" variant="outline" onClick={() => {
                      setFreightForm(grnFreightFromRow(freight, grn.transportation_cost));
                      setFreightEdit(true);
                    }}>
                      <Pencil className="h-4 w-4 mr-1" /> {freight ? "Change" : "Record freight"}
                    </Button>
                  )}
                </div>
              </div>

              {freightEdit ? (
                <div className="space-y-3 rounded-lg border p-3">
                  <GRNFreightSection value={freightForm} onChange={setFreightForm} currentGrnId={grnId ?? undefined} idPrefix="grnv-fr" />
                  {freight && (
                    <div className="space-y-1">
                      <Label htmlFor="grnv-fr-reason">Reason for the change *</Label>
                      <Textarea id="grnv-fr-reason" rows={2} value={freightReason} onChange={(e) => setFreightReason(e.target.value)} />
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    An unpaid voucher is corrected (or cancelled when the company no longer pays). A paid voucher must be cancelled by a manager first.
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setFreightEdit(false)} disabled={freightMutation.isPending}>Back</Button>
                    <Button size="sm" onClick={() => freightMutation.mutate()} disabled={freightMutation.isPending}>
                      {freightMutation.isPending ? "Saving…" : "Save freight"}
                    </Button>
                  </div>
                </div>
              ) : freightLoading ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : !freight ? (
                <p className="text-amber-700">
                  Freight not recorded on this GRN{Number(grn.transportation_cost || 0) > 0 ? ` (transportation Rs. ${Number(grn.transportation_cost).toLocaleString()} on the bill)` : ""}.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <span className="text-muted-foreground">Who paid</span><span className="font-medium">{grnPayerLabel(freight.payer)}</span>
                  {freight.payer === "supplier_billed" && (
                    <><span className="text-muted-foreground">On supplier's bill</span><span className="font-medium">{fmtRs(freight.amount)}</span></>
                  )}
                  {freight.payer === "other_grn" && (
                    <><span className="text-muted-foreground">Recorded on</span><span className="font-medium">{sharedGrn?.grn_number ?? "—"}</span></>
                  )}
                  {isCompanyPaid(freight.payer) && (
                    <>
                      <span className="text-muted-foreground">Mode</span><span className="font-medium">{modeLabel(freight.mode)}</span>
                      <span className="text-muted-foreground">Transporter</span><span className="font-medium">{freight.transporter_name}</span>
                      <span className="text-muted-foreground">Amount paid</span><span className="font-semibold">{fmtRs(freight.amount)}</span>
                      {freight.vehicle_number && (<><span className="text-muted-foreground">Vehicle · driver</span><span>{[freight.vehicle_number, freight.driver_name, freight.driver_contact].filter(Boolean).join(" · ")}</span></>)}
                      {freight.booking_ref && (<><span className="text-muted-foreground">Ride / bilty no.</span><span>{freight.booking_ref}</span></>)}
                    </>
                  )}
                  {freight.note && (<><span className="text-muted-foreground">Note</span><span>{freight.note}</span></>)}
                </div>
              )}

              {!freightEdit && freight && isCompanyPaid(freight.payer) && !liveVoucher && (
                <p className="text-amber-700">No live voucher for this GRN{cancelledVouchers.length ? ` (${cancelledVouchers.length} cancelled)` : ""}. Use Change to make one.</p>
              )}
              {!freightEdit && liveVoucher && (
                <div className="rounded-lg border p-2 flex items-center justify-between gap-2">
                  <div>
                    <span className="font-mono font-semibold">{liveVoucher.voucher_number}</span>
                    <span className="text-xs text-muted-foreground"> · {fmtRs(liveVoucher.amount)} to {liveVoucher.transporter_name}
                      {liveVoucher.status === "paid" && ` · paid ${liveVoucher.paid_date ? format(new Date(liveVoucher.paid_date), "dd/MM/yyyy") : ""}`}
                      {liveVoucher.recover_from_supplier && " · recover from supplier"}
                    </span>
                  </div>
                  <Badge variant={voucherStatusMeta(liveVoucher.status).variant}>{voucherStatusMeta(liveVoucher.status).label}</Badge>
                </div>
              )}
              {!freightEdit && cancelledVouchers.map((v) => (
                <div key={v.id} className="text-xs text-muted-foreground">
                  {v.voucher_number} cancelled{v.cancelled_at ? ` ${format(new Date(v.cancelled_at), "dd/MM/yyyy")}` : ""}: {v.cancel_reason}
                </div>
              ))}
            </div>

            {grn.notes && (
              <div>
                <strong>Notes:</strong>
                <p className="text-muted-foreground">{grn.notes}</p>
              </div>
            )}

            {/* Attachments (bill + stock photos) */}
            <div className="border-t pt-3 space-y-3">
              <div className="flex items-center gap-2">
                <Paperclip className="h-4 w-4" />
                <strong>Attachments</strong>
                <span className="text-xs text-muted-foreground">({attachments?.length || 0})</span>
              </div>

              {/* Upload control */}
              <div className="flex items-center gap-2 flex-wrap">
                <Select value={uploadKind} onValueChange={(v) => setUploadKind(v as "bill" | "stock_photo")}>
                  <SelectTrigger className="w-[160px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bill">Supplier Bill</SelectItem>
                    <SelectItem value="stock_photo">Stock Photo</SelectItem>
                  </SelectContent>
                </Select>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  accept={uploadKind === "stock_photo" ? "image/*" : "image/*,application/pdf"}
                  onChange={(e) => handleFilesPicked(e.target.files)}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={uploadMutation.isPending}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-3 w-3 mr-1" />
                  {uploadMutation.isPending ? "Uploading…" : "Upload"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {uploadKind === "bill" ? "PDF or image of the supplier invoice." : "Photos of the received stock."}
                </span>
              </div>

              {bills.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Bill ({bills.length})</div>
                  <ul className="space-y-1">
                    {bills.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-2 text-sm bg-muted/40 px-2 py-1 rounded">
                        <a
                          href={publicUrl(a.file_path)}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-2 hover:underline truncate"
                        >
                          {isImage(a.mime_type, a.file_name)
                            ? <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                            : <FileText className="h-3.5 w-3.5 shrink-0" />}
                          <span className="truncate">{a.file_name}</span>
                        </a>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          title="Remove"
                          onClick={() => deleteMutation.mutate(a)}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {photos.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Stock Photos ({photos.length})</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {photos.map((a) => (
                      <div key={a.id} className="relative group border rounded overflow-hidden bg-muted/40">
                        {isImage(a.mime_type, a.file_name) ? (
                          <a href={publicUrl(a.file_path)} target="_blank" rel="noreferrer" title={a.file_name}>
                            <img
                              src={publicUrl(a.file_path)}
                              alt={a.file_name}
                              className="w-full h-24 object-cover"
                            />
                          </a>
                        ) : (
                          <a
                            href={publicUrl(a.file_path)}
                            target="_blank"
                            rel="noreferrer"
                            className="flex flex-col items-center justify-center h-24 text-xs text-muted-foreground"
                          >
                            <FileText className="h-6 w-6 mb-1" />
                            <span className="truncate px-1 max-w-full">{a.file_name}</span>
                          </a>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 absolute top-0.5 right-0.5 bg-background/80 hover:bg-background"
                          title="Remove"
                          onClick={() => deleteMutation.mutate(a)}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!bills.length && !photos.length && (
                <div className="text-xs text-muted-foreground italic">
                  No attachments yet. Use the upload button above to add the supplier bill or stock photos.
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              {editMode ? (
                <>
                  <Button variant="outline" onClick={() => setEditMode(false)} disabled={saveMutation.isPending}>
                    <X className="h-4 w-4 mr-1" /> Cancel
                  </Button>
                  <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                    <Save className="h-4 w-4 mr-1" /> {saveMutation.isPending ? "Saving…" : "Save Prices"}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    title="Print GRN (quantities only, no prices)"
                    onClick={() =>
                      grnId && printGRN(grnId).catch((e: any) =>
                        toast({ title: "Failed to print GRN", description: e.message, variant: "destructive" }))
                    }
                  >
                    <Printer className="h-4 w-4 mr-1" /> Print
                  </Button>
                  {canEdit && (
                    <Button variant="outline" onClick={startEdit}>
                      <Pencil className="h-4 w-4 mr-1" /> Edit Prices
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
                </>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
