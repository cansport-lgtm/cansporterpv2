import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, ImagePlus, Lock, Plus, Printer, Send, Trash2, X, Ban, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SearchableSelect, type SearchableSelectOption } from "@/components/shared/SearchableSelect";
import { usePackingTypes } from "@/hooks/usePackingTypes";
import { PrivateLabelJobOrderLog } from "@/components/planning/PrivateLabelJobOrderLog";
import {
  blankForm,
  blankLine,
  checkFile,
  copyCustomerLogo,
  deleteDraft,
  fetchColors,
  fetchOrderDetail,
  fetchSizes,
  isImage,
  logPrinted,
  publicUrl,
  removeAttachment,
  saveOrder,
  saveRemarks,
  setStatus,
  statusVariant,
  uploadAttachment,
  validateForm,
  type PljoAttachment,
  type PljoDetail,
  type PljoForm,
  type PljoLine,
  type PljoOrder,
  type PljoPriority,
} from "@/lib/privateLabelJobOrder";
import { printPrivateLabelJobOrder } from "@/lib/privateLabelJobOrderPrint";

interface Props {
  /** null = new order. The page mounts this dialog only while it is open. */
  orderId: string | null;
  onOpenChange: (open: boolean) => void;
  /** Edit window check (production operators: 48h from creation). */
  canEdit: (order: Pick<PljoOrder, "created_at"> | null) => boolean;
}

// Bigger controls on the size lines.
const LINE_CONTROL = "h-12 w-full text-base";

function ColorName({ name, swatch }: { name?: string; swatch?: string | null }) {
  if (!name) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-2">
      {swatch && <span className="h-3.5 w-3.5 rounded-full border" style={{ backgroundColor: swatch }} />}
      {name}
    </span>
  );
}

/** Logo chosen before the order has an id; uploaded right after the first save. */
type PendingLogo = { file: File } | { url: string; label: string } | null;

function toForm(d: PljoDetail): PljoForm {
  const o = d.order;
  return {
    id: o.id,
    order_date: o.order_date,
    required_by_date: o.required_by_date ?? "",
    customer_id: o.customer_id,
    // Empty = "Same as customer" (ticked).
    billing_customer_id: o.billing_customer_id === o.customer_id ? "" : o.billing_customer_id,
    grade_id: o.grade_id,
    brand_name: o.brand_name ?? "",
    customer_po_ref: o.customer_po_ref ?? "",
    priority: o.priority,
    remarks: o.remarks ?? "",
    lines: d.lines.map((l) => ({ ...l })),
  };
}

/** Adds the saved value as an option when it is no longer in the active list. */
function withSaved(options: SearchableSelectOption[], id: string | undefined, label: string | undefined) {
  if (!id || options.some((o) => o.value === id)) return options;
  return [...options, { value: id, label: `${label || "—"} (inactive)` }];
}

export function PrivateLabelJobOrderDialog({ orderId, onOpenChange, canEdit }: Props) {
  const qc = useQueryClient();
  const [currentId, setCurrentId] = useState<string | null>(orderId);
  const [form, setForm] = useState<PljoForm>(blankForm());
  const [pendingLogo, setPendingLogo] = useState<PendingLogo>(null);
  const [tab, setTab] = useState("details");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [confirm, setConfirm] = useState<"close" | "delete" | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const artworkInput = useRef<HTMLInputElement>(null);

  const createdId = useRef<string | null>(null);
  // Set once a save has written something, so a later failure re-syncs from the database.
  const wrote = useRef(false);

  // ---------------------------------------------------------- data
  const { data: detail } = useQuery({
    queryKey: ["pljo-detail", currentId],
    queryFn: () => fetchOrderDetail(currentId!),
    enabled: !!currentId,
  });

  useEffect(() => {
    if (detail) setForm(toForm(detail));
  }, [detail]);

  const { data: customers = [] } = useQuery({
    queryKey: ["pljo-customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, code, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: grades = [] } = useQuery({
    queryKey: ["pljo-grades"],
    queryFn: async () => {
      const { data, error } = await supabase.from("grades").select("id, name, code").eq("is_active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: customerLogos = [] } = useQuery({
    queryKey: ["pljo-customer-logos", form.customer_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_logos")
        .select("id, logo_url, label, is_primary")
        .eq("customer_id", form.customer_id)
        .order("is_primary", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!form.customer_id,
  });

  const { data: sizes = [] } = useQuery({ queryKey: ["pljo-sizes"], queryFn: () => fetchSizes() });
  const { data: colors = [] } = useQuery({ queryKey: ["pljo-colors"], queryFn: () => fetchColors() });
  const { data: packingTypes = [] } = usePackingTypes();

  // ---------------------------------------------------------- state
  const order = detail?.order ?? null;
  const status = order?.status ?? "Draft";
  const inWindow = canEdit(order);
  const draftEditable = status === "Draft" && inWindow;
  const remarksEditable = status === "Issued" && inWindow;
  const attachments = detail?.attachments ?? [];
  const logo = attachments.find((a) => a.kind === "logo") ?? null;
  const artwork = attachments.filter((a) => a.kind === "artwork");
  const savedLine = (id?: string) => detail?.lines.find((l) => l.id === id);

  const customerOptions = withSaved(
    customers.map((c) => ({ value: c.id, label: c.name, secondary: c.code ?? undefined })),
    order?.customer_id,
    order?.customers?.name,
  );
  const billingOptions = withSaved(
    customerOptions,
    order?.billing_customer_id,
    order?.billing_customer?.name,
  );
  const billingSame = !form.billing_customer_id;
  const gradeOptions = withSaved(
    grades.map((g) => ({ value: g.id, label: g.name, secondary: g.code ?? undefined })),
    order?.grade_id,
    order?.grades?.name,
  );
  const sizeOptions = useMemo(
    () => sizes.map((s) => ({ value: s.id, label: s.name })),
    [sizes],
  );
  const colorOptions = useMemo(
    () => colors.map((c) => ({ value: c.id, label: c.name })),
    [colors],
  );

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["pljo-list"] });
    qc.invalidateQueries({ queryKey: ["pljo-detail", currentId] });
    qc.invalidateQueries({ queryKey: ["pljo-log", currentId] });
  };

  const setLine = (i: number, patch: Partial<PljoLine>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  // ---------------------------------------------------------- mutations
  const save = useMutation({
    mutationFn: async (issue: boolean) => {
      const problem = validateForm(form);
      if (problem) throw new Error(problem);
      if (issue && !logo && !pendingLogo) throw new Error("Upload the logo before issuing");

      wrote.current = false;
      const id = await saveOrder(form, detail?.lines ?? [], (savedId) => {
        if (!form.id) createdId.current = savedId;
        wrote.current = true;
      });
      if (pendingLogo) {
        if ("file" in pendingLogo) await uploadAttachment(id, pendingLogo.file, "logo", attachments);
        else await copyCustomerLogo(id, pendingLogo.url, attachments);
        setPendingLogo(null);
      }
      if (issue) await setStatus(id, "Issued");
      return id;
    },
    onSuccess: (id, issue) => {
      setCurrentId(id);
      qc.invalidateQueries({ queryKey: ["pljo-list"] });
      qc.invalidateQueries({ queryKey: ["pljo-detail", id] });
      qc.invalidateQueries({ queryKey: ["pljo-log", id] });
      toast.success(issue ? "Job order issued" : "Draft saved");
    },
    onError: (e: Error) => {
      // Part of the save may have gone through (e.g. a new order exists but a
      // later step failed): show what the database now holds. Otherwise keep
      // the user's unsaved edits.
      if (createdId.current) setCurrentId(createdId.current);
      if (wrote.current) refresh();
      toast.error(e.message);
    },
  });

  const remarksSave = useMutation({
    mutationFn: () => saveRemarks(currentId!, form.remarks),
    onSuccess: () => {
      refresh();
      toast.success("Remarks saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const changeStatus = useMutation({
    mutationFn: ({ to, reason }: { to: "Closed" | "Cancelled"; reason?: string }) => setStatus(currentId!, to, reason),
    onSuccess: (_, { to }) => {
      refresh();
      setCancelOpen(false);
      setConfirm(null);
      toast.success(to === "Closed" ? "Job order closed" : "Job order cancelled");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => deleteDraft(currentId!, attachments),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pljo-list"] });
      toast.success("Draft deleted");
      setConfirm(null);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const fileMutation = useMutation({
    mutationFn: async (
      a:
        | { op: "upload"; file: File; kind: "logo" | "artwork" }
        | { op: "customer"; url: string }
        | { op: "remove"; att: PljoAttachment },
    ) => {
      if (a.op === "upload") await uploadAttachment(currentId!, a.file, a.kind, attachments);
      else if (a.op === "customer") await copyCustomerLogo(currentId!, a.url, attachments);
      else await removeAttachment(a.att);
    },
    onSuccess: () => refresh(),
    onError: (e: Error) => {
      refresh();
      toast.error(e.message);
    },
  });

  const onPickFile = (kind: "logo" | "artwork", file: File | undefined) => {
    if (!file) return;
    const problem = checkFile(file);
    if (problem) {
      toast.error(problem);
      return;
    }
    if (currentId) fileMutation.mutate({ op: "upload", file, kind });
    else if (kind === "logo") setPendingLogo({ file });
  };

  const onUseCustomerLogo = (url: string, label: string) => {
    if (currentId) fileMutation.mutate({ op: "customer", url });
    else setPendingLogo({ url, label });
  };

  const print = async () => {
    if (!currentId) return;
    const fresh = await fetchOrderDetail(currentId);
    printPrivateLabelJobOrder(fresh);
    logPrinted(currentId)
      .then(() => qc.invalidateQueries({ queryKey: ["pljo-log", currentId] }))
      .catch(() => undefined);
  };

  const busy = save.isPending || fileMutation.isPending || changeStatus.isPending || remove.isPending;

  // ---------------------------------------------------------- totals
  const totalQty = form.lines.reduce((t, l) => t + (Number(l.quantity) || 0), 0);

  // ---------------------------------------------------------- logo preview
  const pendingSrc = useMemo(
    () => (pendingLogo && "file" in pendingLogo ? URL.createObjectURL(pendingLogo.file) : null),
    [pendingLogo],
  );
  useEffect(() => () => {
    if (pendingSrc) URL.revokeObjectURL(pendingSrc);
  }, [pendingSrc]);

  const logoPreview = (() => {
    if (pendingLogo) {
      if ("file" in pendingLogo)
        return { src: pendingSrc!, name: pendingLogo.file.name, img: isImage(pendingLogo.file.type), pending: true };
      return { src: pendingLogo.url, name: pendingLogo.label, img: true, pending: true };
    }
    if (logo) return { src: publicUrl(logo.file_path), name: logo.file_name, img: isImage(logo.mime_type), pending: false };
    return null;
  })();

  const title = order ? order.pl_job_order_number : "New Private Label Job Order";

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {title}
              {order && <Badge variant={statusVariant(status)}>{status}</Badge>}
              {order && !inWindow && (
                <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                  <Lock className="h-3 w-3" /> Edit window passed
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="log" disabled={!currentId}>
                Log
              </TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="space-y-5">
              {/* Header */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="sm:col-span-2">
                  <Label>Customer (brand owner) *</Label>
                  <SearchableSelect
                    value={form.customer_id}
                    onValueChange={(v) => setForm({ ...form, customer_id: v })}
                    options={customerOptions}
                    placeholder="Select customer"
                    disabled={!draftEditable}
                  />
                </div>
                <div className="sm:col-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label>Billing customer *</Label>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox
                        checked={billingSame}
                        disabled={!draftEditable}
                        onCheckedChange={(c) =>
                          setForm({ ...form, billing_customer_id: c ? "" : form.customer_id })
                        }
                      />
                      Same as customer
                    </label>
                  </div>
                  <SearchableSelect
                    value={billingSame ? form.customer_id : form.billing_customer_id}
                    onValueChange={(v) => setForm({ ...form, billing_customer_id: v === form.customer_id ? "" : v })}
                    options={billingOptions}
                    placeholder="Select billing customer"
                    disabled={!draftEditable || billingSame}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label>Grade (ball) *</Label>
                  <SearchableSelect
                    value={form.grade_id}
                    onValueChange={(v) => setForm({ ...form, grade_id: v })}
                    options={gradeOptions}
                    placeholder="Select grade"
                    disabled={!draftEditable}
                  />
                </div>
                <div>
                  <Label>Brand name</Label>
                  <Input
                    value={form.brand_name}
                    onChange={(e) => setForm({ ...form, brand_name: e.target.value })}
                    disabled={!draftEditable}
                  />
                </div>
                <div>
                  <Label>Customer PO / Ref</Label>
                  <Input
                    value={form.customer_po_ref}
                    onChange={(e) => setForm({ ...form, customer_po_ref: e.target.value })}
                    disabled={!draftEditable}
                  />
                </div>
                <div>
                  <Label>Order date *</Label>
                  <Input
                    type="date"
                    value={form.order_date}
                    onChange={(e) => setForm({ ...form, order_date: e.target.value })}
                    disabled={!draftEditable}
                  />
                </div>
                <div>
                  <Label>Required by</Label>
                  <Input
                    type="date"
                    value={form.required_by_date}
                    onChange={(e) => setForm({ ...form, required_by_date: e.target.value })}
                    disabled={!draftEditable}
                  />
                </div>
                <div>
                  <Label>Priority</Label>
                  <Select
                    value={form.priority}
                    onValueChange={(v) => setForm({ ...form, priority: v as PljoPriority })}
                    disabled={!draftEditable}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Logo */}
              <div className="rounded-md border p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <Label className="text-sm">Logo {status === "Draft" && "(required to issue)"}</Label>
                  {draftEditable && (
                    <div className="flex flex-wrap gap-2">
                      <input
                        ref={logoInput}
                        type="file"
                        accept="image/png,image/jpeg,image/svg+xml,image/webp,application/pdf"
                        className="hidden"
                        onChange={(e) => {
                          onPickFile("logo", e.target.files?.[0]);
                          e.target.value = "";
                        }}
                      />
                      <Button size="sm" variant="outline" onClick={() => logoInput.current?.click()} disabled={busy}>
                        <ImagePlus className="mr-1 h-4 w-4" /> {logoPreview ? "Replace logo" : "Upload logo"}
                      </Button>
                      {logoPreview && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => (logoPreview.pending ? setPendingLogo(null) : logo && fileMutation.mutate({ op: "remove", att: logo }))}
                        >
                          <X className="mr-1 h-4 w-4" /> Remove
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-start gap-4">
                  {logoPreview ? (
                    <a href={logoPreview.src} target="_blank" rel="noreferrer" className="block">
                      {logoPreview.img ? (
                        <img
                          src={logoPreview.src}
                          alt="Logo"
                          className="h-24 max-w-[220px] rounded border bg-white object-contain p-1"
                        />
                      ) : (
                        <span className="flex items-center gap-1 text-sm underline">
                          <FileText className="h-4 w-4" /> {logoPreview.name}
                        </span>
                      )}
                      {logoPreview.pending && (
                        <span className="text-xs text-muted-foreground">Uploads when you save</span>
                      )}
                    </a>
                  ) : (
                    <p className="text-sm text-muted-foreground">No logo yet</p>
                  )}

                  {draftEditable && customerLogos.length > 0 && (
                    <div>
                      <p className="mb-1 text-xs text-muted-foreground">Or use one of the customer's logos:</p>
                      <div className="flex flex-wrap gap-2">
                        {customerLogos.map((cl) => (
                          <button
                            key={cl.id}
                            type="button"
                            disabled={busy}
                            title={cl.label ?? "Customer logo"}
                            onClick={() => onUseCustomerLogo(cl.logo_url, cl.label ?? "Customer logo")}
                            className="rounded border bg-white p-1 hover:ring-2 hover:ring-primary"
                          >
                            <img src={cl.logo_url} alt={cl.label ?? "logo"} className="h-12 w-16 object-contain" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Artwork (optional extra files) */}
                {currentId && (draftEditable || artwork.length > 0) && (
                  <div className="mt-3 border-t pt-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">Artwork / other files:</span>
                      {artwork.map((a) => (
                        <span key={a.id} className="flex items-center gap-1 rounded border px-2 py-0.5 text-xs">
                          <a href={publicUrl(a.file_path)} target="_blank" rel="noreferrer" className="underline">
                            {a.file_name}
                          </a>
                          {draftEditable && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => fileMutation.mutate({ op: "remove", att: a })}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </span>
                      ))}
                      {draftEditable && (
                        <>
                          <input
                            ref={artworkInput}
                            type="file"
                            accept="image/png,image/jpeg,image/svg+xml,image/webp,application/pdf"
                            className="hidden"
                            onChange={(e) => {
                              onPickFile("artwork", e.target.files?.[0]);
                              e.target.value = "";
                            }}
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7"
                            disabled={busy}
                            onClick={() => artworkInput.current?.click()}
                          >
                            <Paperclip className="mr-1 h-3.5 w-3.5" /> Add file
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Lines */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Label className="text-sm">Sizes &amp; packing *</Label>
                  {draftEditable && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, blankLine(f.lines.length)] }))}
                    >
                      <Plus className="mr-1 h-4 w-4" /> Add size
                    </Button>
                  )}
                </div>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8">#</TableHead>
                        <TableHead className="min-w-[180px]">Size</TableHead>
                        <TableHead className="min-w-[180px]">Color</TableHead>
                        <TableHead className="w-32">Qty (Dz)</TableHead>
                        <TableHead className="min-w-[180px]">Packing</TableHead>
                        <TableHead className="min-w-[180px]">Remarks</TableHead>
                        {draftEditable && <TableHead className="w-10" />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {form.lines.map((l, i) => {
                        const saved = savedLine(l.id);
                        return (
                          <TableRow key={l.id ?? `new-${i}`}>
                            <TableCell>{i + 1}</TableCell>
                            <TableCell>
                              {draftEditable ? (
                                <SearchableSelect
                                  value={l.size_id}
                                  onValueChange={(v) => setLine(i, { size_id: v })}
                                  options={withSaved(sizeOptions, saved?.size_id, saved?.size_name)}
                                  placeholder="Size"
                                  sortAlpha={false}
                                  triggerClassName={LINE_CONTROL}
                                />
                              ) : (
                                saved?.size_name
                              )}
                            </TableCell>
                            <TableCell>
                              {draftEditable ? (
                                <SearchableSelect
                                  value={l.color_id}
                                  onValueChange={(v) => setLine(i, { color_id: v })}
                                  options={withSaved(colorOptions, saved?.color_id || undefined, saved?.color_name)}
                                  placeholder="Color"
                                  sortAlpha={false}
                                  triggerClassName={LINE_CONTROL}
                                />
                              ) : (
                                <ColorName name={saved?.color_name} swatch={saved?.color_swatch} />
                              )}
                            </TableCell>
                            <TableCell>
                              {draftEditable ? (
                                <Input
                                  type="number"
                                  min={0}
                                  value={l.quantity}
                                  onChange={(e) => setLine(i, { quantity: e.target.value })}
                                  className={LINE_CONTROL}
                                />
                              ) : (
                                Number(l.quantity).toLocaleString()
                              )}
                            </TableCell>
                            <TableCell>
                              {draftEditable ? (
                                <SearchableSelect
                                  value={l.packing_type_id}
                                  onValueChange={(v) => setLine(i, { packing_type_id: v })}
                                  options={withSaved(
                                    packingTypes.map((p) => ({ value: p.id, label: p.label })),
                                    saved?.packing_type_id,
                                    saved?.packing_label,
                                  )}
                                  placeholder="Packing"
                                  sortAlpha={false}
                                  triggerClassName={LINE_CONTROL}
                                />
                              ) : (
                                saved?.packing_label
                              )}
                            </TableCell>
                            <TableCell>
                              {draftEditable ? (
                                <Input
                                  value={l.remarks}
                                  onChange={(e) => setLine(i, { remarks: e.target.value })}
                                  className={LINE_CONTROL}
                                />
                              ) : (
                                l.remarks
                              )}
                            </TableCell>
                            {draftEditable && (
                              <TableCell>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-10 w-10"
                                  aria-label="Remove line"
                                  disabled={form.lines.length === 1}
                                  onClick={() =>
                                    setForm((f) => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }))
                                  }
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })}
                      <TableRow className="bg-muted/40 font-medium">
                        <TableCell />
                        <TableCell>Total</TableCell>
                        <TableCell />
                        <TableCell>{totalQty.toLocaleString()} Dz</TableCell>
                        <TableCell />
                        <TableCell />
                        {draftEditable && <TableCell />}
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div>
                <Label>Remarks</Label>
                <Textarea
                  rows={2}
                  value={form.remarks}
                  onChange={(e) => setForm({ ...form, remarks: e.target.value })}
                  disabled={!draftEditable && !remarksEditable}
                />
              </div>

              {order?.status === "Cancelled" && order.cancel_reason && (
                <p className="text-sm text-destructive">Cancelled: {order.cancel_reason}</p>
              )}
            </TabsContent>

            <TabsContent value="log">{currentId && <PrivateLabelJobOrderLog orderId={currentId} />}</TabsContent>
          </Tabs>

          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {order && status === "Draft" && inWindow && (
                <Button variant="ghost" className="text-destructive" onClick={() => setConfirm("delete")} disabled={busy}>
                  <Trash2 className="mr-1 h-4 w-4" /> Delete draft
                </Button>
              )}
              {order && (status === "Draft" || status === "Issued") && inWindow && (
                <Button variant="ghost" onClick={() => setCancelOpen(true)} disabled={busy}>
                  <Ban className="mr-1 h-4 w-4" /> Cancel order
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {order && status !== "Draft" && (
                <Button variant="outline" onClick={print}>
                  <Printer className="mr-1 h-4 w-4" /> Print
                </Button>
              )}
              {remarksEditable && (
                <Button variant="outline" onClick={() => remarksSave.mutate()} disabled={remarksSave.isPending}>
                  Save remarks
                </Button>
              )}
              {order && status === "Issued" && inWindow && (
                <Button variant="outline" onClick={() => setConfirm("close")} disabled={busy}>
                  <Lock className="mr-1 h-4 w-4" /> Close
                </Button>
              )}
              {draftEditable && (
                <>
                  <Button variant="outline" onClick={() => save.mutate(false)} disabled={busy}>
                    Save draft
                  </Button>
                  <Button onClick={() => save.mutate(true)} disabled={busy}>
                    <Send className="mr-1 h-4 w-4" /> Save &amp; Issue
                  </Button>
                </>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel {order?.pl_job_order_number}?</AlertDialogTitle>
            <AlertDialogDescription>A cancelled job order can't be changed or reopened.</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="Reason (required)"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={!cancelReason.trim() || changeStatus.isPending}
              onClick={(e) => {
                e.preventDefault();
                changeStatus.mutate({ to: "Cancelled", reason: cancelReason });
              }}
            >
              Cancel order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "delete" ? "Delete this draft?" : `Close ${order?.pl_job_order_number}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "delete"
                ? "The draft, its lines, logo and log are removed. Its number is not reused."
                : "A closed job order can't be changed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (confirm === "delete") remove.mutate();
                else changeStatus.mutate({ to: "Closed" });
              }}
            >
              {confirm === "delete" ? "Delete" : "Close order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
