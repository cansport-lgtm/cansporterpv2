import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Lock, Plus, Printer, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { stockCategoryMeta, type StockCategoryFilterValue } from "@/lib/stockCategories";
import {
  blankCompanyForm,
  blankLine,
  deleteDraft,
  fetchCompanyProducts,
  fetchOrderDetail,
  logPrinted,
  saveCompanyOrder,
  saveRemarks,
  setStatus,
  statusVariant,
  validateCompanyForm,
  type CjoForm,
  type PljoDetail,
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

const LINE_CONTROL = "h-12 w-full text-base";

/** Packings most used on company orders: listed first in the Packing picker. */
const PINNED_PACKINGS = ["12 Dz CTN", "20 Dz Bag", "60 Dz Bag"];

function toForm(d: PljoDetail): CjoForm {
  const o = d.order;
  return {
    id: o.id,
    order_date: o.order_date,
    required_by_date: o.required_by_date ?? "",
    priority: o.priority,
    remarks: o.remarks ?? "",
    lines: d.lines.map((l) => ({ ...l })),
  };
}

/** Adds the saved value as an option when it is no longer in the active list. */
function withSaved(options: SearchableSelectOption[], id: string | undefined, label: string | undefined) {
  if (!id || options.some((o) => o.value === id)) return options;
  return [...options, { value: id, label: `${label || "—"} (not available)` }];
}

export function CompanyJobOrderDialog({ orderId, onOpenChange, canEdit }: Props) {
  const qc = useQueryClient();
  const [currentId, setCurrentId] = useState<string | null>(orderId);
  const [form, setForm] = useState<CjoForm>(blankCompanyForm());
  const [category, setCategory] = useState<StockCategoryFilterValue>("all");
  const [tab, setTab] = useState("details");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [confirm, setConfirm] = useState<"close" | "delete" | null>(null);

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

  const { data: products = [] } = useQuery({ queryKey: ["cjo-products"], queryFn: fetchCompanyProducts });
  const { data: packingTypes = [] } = usePackingTypes();
  const packingOptions = useMemo(() => {
    const rank = (label: string) => {
      const i = PINNED_PACKINGS.indexOf(label);
      return i === -1 ? PINNED_PACKINGS.length : i;
    };
    // Stable sort: the rest keep the master's order.
    return [...packingTypes]
      .sort((a, b) => rank(a.label) - rank(b.label))
      .map((p) => ({ value: p.id, label: p.label }));
  }, [packingTypes]);

  // ---------------------------------------------------------- state
  const order = detail?.order ?? null;
  const status = order?.status ?? "Draft";
  const inWindow = canEdit(order);
  const draftEditable = status === "Draft" && inWindow;
  const remarksEditable = status === "Issued" && inWindow;
  const savedLine = (id?: string) => detail?.lines.find((l) => l.id === id);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const productOptions = useMemo(
    () =>
      products
        .filter((p) => category === "all" || p.stock_category === category)
        .map((p) => ({
          value: p.id,
          label: `${p.code} — ${p.name}`,
          secondary: [p.grade_name, stockCategoryMeta(p.stock_category).shortLabel].filter(Boolean).join(" · "),
        })),
    [products, category],
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
      const problem = validateCompanyForm(form);
      if (problem) throw new Error(problem);

      wrote.current = false;
      const id = await saveCompanyOrder(form, detail?.lines ?? [], (savedId) => {
        if (!form.id) createdId.current = savedId;
        wrote.current = true;
      });
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
      // Part of the save may have gone through: show what the database now
      // holds. Otherwise keep the user's unsaved edits.
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
    mutationFn: () => deleteDraft(currentId!, detail?.attachments ?? []),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pljo-list"] });
      toast.success("Draft deleted");
      setConfirm(null);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const print = async () => {
    if (!currentId) return;
    const fresh = await fetchOrderDetail(currentId);
    printPrivateLabelJobOrder(fresh);
    logPrinted(currentId)
      .then(() => qc.invalidateQueries({ queryKey: ["pljo-log", currentId] }))
      .catch(() => undefined);
  };

  const busy = save.isPending || changeStatus.isPending || remove.isPending;
  const totalQty = form.lines.reduce((t, l) => t + (Number(l.quantity) || 0), 0);
  const title = order ? order.pl_job_order_number : "New Company Product Job Order";

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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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

              {/* Lines */}
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <Label className="text-sm">Products &amp; packing *</Label>
                  {draftEditable && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Select value={category} onValueChange={(v) => setCategory(v as StockCategoryFilterValue)}>
                        <SelectTrigger className="h-9 w-48">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All sellable</SelectItem>
                          <SelectItem value="standard">Standard</SelectItem>
                          <SelectItem value="final_ball">Standard (Final Ball)</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, blankLine(f.lines.length)] }))}
                      >
                        <Plus className="mr-1 h-4 w-4" /> Add product
                      </Button>
                    </div>
                  )}
                </div>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8">#</TableHead>
                        <TableHead className="min-w-[280px]">Product</TableHead>
                        <TableHead className="min-w-[120px]">Grade</TableHead>
                        <TableHead className="w-32">Qty (Dz)</TableHead>
                        <TableHead className="min-w-[180px]">Packing</TableHead>
                        <TableHead className="min-w-[180px]">Remarks</TableHead>
                        {draftEditable && <TableHead className="w-10" />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {form.lines.map((l, i) => {
                        const saved = savedLine(l.id);
                        const product = productById.get(l.product_id);
                        const grade = product?.grade_name ?? (saved?.product_id === l.product_id ? saved?.product_grade : "");
                        return (
                          <TableRow key={l.id ?? `new-${i}`}>
                            <TableCell>{i + 1}</TableCell>
                            <TableCell>
                              {draftEditable ? (
                                <SearchableSelect
                                  value={l.product_id}
                                  onValueChange={(v) => setLine(i, { product_id: v })}
                                  options={withSaved(
                                    productOptions,
                                    saved?.product_id || undefined,
                                    saved && `${saved.product_code} — ${saved.product_name}`,
                                  )}
                                  placeholder="Product"
                                  triggerClassName={LINE_CONTROL}
                                />
                              ) : (
                                <span>
                                  <span className="font-mono text-xs text-muted-foreground">{saved?.product_code}</span>{" "}
                                  {saved?.product_name}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>{grade || "—"}</TableCell>
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
                                    packingOptions,
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
                {draftEditable && products.length === 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    No active company products in a sellable stock category. Add them on Products (own SKU) with a
                    Standard planning item.
                  </p>
                )}
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
                ? "The draft, its lines and log are removed. Its number is not reused."
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
