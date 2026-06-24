import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface LineRow {
  id?: string;
  distributor_product_id: string;
  product_name: string;
  company_product_id: string | null;
  unit: string | null;
  quantity: string;
  price: string;
  remarks: string;
}

const emptyLine = (): LineRow => ({
  distributor_product_id: "",
  product_name: "",
  company_product_id: null,
  unit: null,
  quantity: "",
  price: "",
  remarks: "",
});

interface OrderEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  distributorId: string;
  orderId: string | null; // null = new order
  /** When true (manager editing a submitted order), allow saving without reverting status. */
  managerEdit?: boolean;
  onSaved?: () => void;
}

export function OrderEditorDialog({
  open,
  onOpenChange,
  distributorId,
  orderId,
  managerEdit = false,
  onSaved,
}: OrderEditorDialogProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [customerId, setCustomerId] = useState("");
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [requiredDate, setRequiredDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineRow[]>([emptyLine()]);
  const [status, setStatus] = useState<string>("draft");

  const { data: customers = [] } = useQuery({
    queryKey: ["distributor_customers_active", distributorId],
    enabled: open && !!distributorId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributor_customers")
        .select("id, name, code")
        .eq("distributor_id", distributorId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["distributor_products_active", distributorId],
    enabled: open && !!distributorId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributor_products")
        .select("id, name, code, price, unit, company_product_id")
        .eq("distributor_id", distributorId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Load an existing order for edit.
  const { data: existing } = useQuery({
    queryKey: ["distributor_order_edit", orderId],
    enabled: open && !!orderId,
    queryFn: async () => {
      const { data: header, error } = await supabase
        .from("distributor_orders")
        .select("*")
        .eq("id", orderId as string)
        .single();
      if (error) throw error;
      const { data: items, error: itemsError } = await supabase
        .from("distributor_order_items")
        .select("*")
        .eq("order_id", orderId as string)
        .order("created_at");
      if (itemsError) throw itemsError;
      return { header, items };
    },
  });

  // Reset form when the dialog opens.
  useEffect(() => {
    if (!open) return;
    if (orderId && existing) {
      setCustomerId(existing.header.customer_id);
      setOrderDate(existing.header.order_date);
      setRequiredDate(existing.header.required_date ?? "");
      setNotes(existing.header.notes ?? "");
      setStatus(existing.header.status);
      setLines(
        existing.items.length
          ? existing.items.map((it) => ({
              id: it.id,
              distributor_product_id: it.distributor_product_id ?? "",
              product_name: it.product_name,
              company_product_id: it.company_product_id,
              unit: it.unit,
              quantity: String(it.quantity ?? ""),
              price: String(it.price ?? ""),
              remarks: it.remarks ?? "",
            }))
          : [emptyLine()]
      );
    } else if (!orderId) {
      setCustomerId("");
      setOrderDate(new Date().toISOString().slice(0, 10));
      setRequiredDate("");
      setNotes("");
      setStatus("draft");
      setLines([emptyLine()]);
    }
  }, [open, orderId, existing]);

  const readOnly = ["approved", "dispatched", "delivered", "cancelled"].includes(status);

  const setLineProduct = (idx: number, productId: string) => {
    const p = products.find((x) => x.id === productId);
    setLines((prev) =>
      prev.map((row, i) =>
        i === idx
          ? {
              ...row,
              distributor_product_id: productId,
              product_name: p?.name ?? row.product_name,
              company_product_id: p?.company_product_id ?? null,
              unit: p?.unit ?? null,
              price: p ? String(p.price ?? "") : row.price,
            }
          : row
      )
    );
  };

  const updateLine = (idx: number, patch: Partial<LineRow>) =>
    setLines((prev) => prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)));

  const removeLine = (idx: number) =>
    setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const total = useMemo(
    () =>
      lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.price) || 0), 0),
    [lines]
  );

  const validLines = () =>
    lines.filter((l) => l.distributor_product_id && Number(l.quantity) > 0);

  const persist = useMutation({
    mutationFn: async (submit: boolean) => {
      if (!customerId) throw new Error("Select a customer");
      const filled = validLines();
      if (filled.length === 0) throw new Error("Add at least one product line with quantity");

      const totalAmount = filled.reduce(
        (s, l) => s + (Number(l.quantity) || 0) * (Number(l.price) || 0),
        0
      );

      let targetId = orderId;

      if (!orderId) {
        // Create new header (auto-numbered by trigger).
        const newStatus = submit ? "submitted" : "draft";
        const { data: inserted, error } = await supabase
          .from("distributor_orders")
          .insert({
            distributor_id: distributorId,
            customer_id: customerId,
            order_date: orderDate,
            required_date: requiredDate || null,
            notes: notes.trim() || null,
            status: newStatus,
            total_amount: totalAmount,
            created_by: user?.id ?? null,
            submitted_at: submit ? new Date().toISOString() : null,
          })
          .select("id")
          .single();
        if (error) throw error;
        targetId = inserted.id;
      } else {
        // Update header. Submitting a draft/rejected order flips it to submitted.
        const headerPatch: Record<string, unknown> = {
          customer_id: customerId,
          order_date: orderDate,
          required_date: requiredDate || null,
          notes: notes.trim() || null,
          total_amount: totalAmount,
        };
        if (submit) {
          headerPatch.status = "submitted";
          headerPatch.submitted_at = new Date().toISOString();
          // Clear any prior rejection when resubmitting.
          headerPatch.rejection_reason = null;
          headerPatch.rejected_by = null;
          headerPatch.rejected_at = null;
        }
        const { error } = await supabase
          .from("distributor_orders")
          .update(headerPatch)
          .eq("id", orderId);
        if (error) throw error;
        // Replace items wholesale (simplest correct approach for small line counts).
        const { error: delError } = await supabase
          .from("distributor_order_items")
          .delete()
          .eq("order_id", orderId);
        if (delError) throw delError;
      }

      const itemRows = filled.map((l) => ({
        order_id: targetId as string,
        distributor_product_id: l.distributor_product_id || null,
        company_product_id: l.company_product_id,
        product_name: l.product_name,
        unit: l.unit,
        quantity: Number(l.quantity) || 0,
        price: Number(l.price) || 0,
        amount: (Number(l.quantity) || 0) * (Number(l.price) || 0),
        remarks: l.remarks.trim() || null,
      }));
      const { error: itemsError } = await supabase.from("distributor_order_items").insert(itemRows);
      if (itemsError) throw itemsError;
    },
    onSuccess: (_data, submit) => {
      queryClient.invalidateQueries({ queryKey: ["distributor_orders"] });
      queryClient.invalidateQueries({ queryKey: ["distributor_order_edit", orderId] });
      toast.success(submit ? "Order submitted for approval" : "Order saved");
      onOpenChange(false);
      onSaved?.();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to save order"),
  });

  // Available footer actions depend on the order state.
  const canSubmit = !managerEdit && (status === "draft" || status === "rejected" || !orderId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>
            {orderId ? `Order ${existing?.header.order_number ?? ""}` : "New Order"}
          </DialogTitle>
          <DialogDescription>
            {readOnly
              ? "This order is locked and cannot be edited."
              : "Select a customer, add product lines, then save a draft or submit for approval."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 max-h-[65vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2 sm:col-span-1">
              <Label>Customer *</Label>
              <SearchableSelect
                value={customerId}
                onValueChange={setCustomerId}
                options={customers.map((c) => ({ value: c.id, label: c.name, secondary: c.code ?? "" }))}
                placeholder="Select customer…"
                disabled={readOnly}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="order_date">Order Date</Label>
              <Input id="order_date" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} disabled={readOnly} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="required_date">Required Date</Label>
              <Input id="required_date" type="date" value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} disabled={readOnly} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Products</Label>
              {!readOnly && (
                <Button type="button" variant="outline" size="sm" onClick={() => setLines((p) => [...p, emptyLine()])}>
                  <Plus className="h-3 w-3 mr-1" /> Add Line
                </Button>
              )}
            </div>
            <div className="space-y-2">
              {lines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end border rounded-md p-2">
                  <div className="col-span-12 sm:col-span-5 space-y-1">
                    <Label className="text-xs text-muted-foreground">Product</Label>
                    <SearchableSelect
                      value={line.distributor_product_id}
                      onValueChange={(v) => setLineProduct(idx, v)}
                      options={products.map((p) => ({ value: p.id, label: p.name, secondary: p.code ?? "" }))}
                      placeholder="Select product…"
                      disabled={readOnly}
                    />
                  </div>
                  <div className="col-span-4 sm:col-span-2 space-y-1">
                    <Label className="text-xs text-muted-foreground">Qty</Label>
                    <Input type="number" inputMode="decimal" value={line.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} disabled={readOnly} />
                  </div>
                  <div className="col-span-4 sm:col-span-2 space-y-1">
                    <Label className="text-xs text-muted-foreground">Price</Label>
                    <Input type="number" inputMode="decimal" value={line.price} onChange={(e) => updateLine(idx, { price: e.target.value })} disabled={readOnly} />
                  </div>
                  <div className="col-span-3 sm:col-span-2 space-y-1">
                    <Label className="text-xs text-muted-foreground">Amount</Label>
                    <Input value={((Number(line.quantity) || 0) * (Number(line.price) || 0)).toLocaleString()} readOnly className="bg-muted/50" />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    {!readOnly && (
                      <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(idx)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end pt-1">
              <div className="text-sm">
                <span className="text-muted-foreground mr-2">Total</span>
                <span className="font-semibold">{total.toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={readOnly} rows={2} />
          </div>

          {status === "rejected" && existing?.header.rejection_reason && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <span className="font-medium text-destructive">Rejected: </span>
              {existing.header.rejection_reason}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {!readOnly && (
            <>
              <Button variant="secondary" onClick={() => persist.mutate(false)} disabled={persist.isPending}>
                {managerEdit ? "Save Changes" : "Save Draft"}
              </Button>
              {canSubmit && (
                <Button onClick={() => persist.mutate(true)} disabled={persist.isPending}>
                  Submit for Approval
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
