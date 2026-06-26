import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Minus,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

/**
 * Menu-card order builder for distributor salesmen.
 *
 * Products are shown as a tappable menu; tapping a card adds it to the
 * customer's order cart. After review, the salesman saves a draft or submits
 * the order for approval. It persists to the exact same tables/columns as
 * OrderEditorDialog (which is kept for the manager approvals flow).
 */

interface CartLine {
  distributor_product_id: string;
  product_name: string;
  code: string | null;
  company_product_id: string | null;
  unit: string | null;
  quantity: number;
  price: number;
  remarks: string;
  itemId?: string; // existing distributor_order_items.id when editing
}

interface DistributorOrderMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  distributorId: string;
  orderId: string | null; // null = new order
  onSaved?: () => void;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

export function DistributorOrderMenu({
  open,
  onOpenChange,
  distributorId,
  orderId,
  onSaved,
}: DistributorOrderMenuProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [customerId, setCustomerId] = useState("");
  const [orderDate, setOrderDate] = useState(todayISO);
  const [requiredDate, setRequiredDate] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<string>("draft");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [unitFilter, setUnitFilter] = useState<string>("all");
  const [step, setStep] = useState<"menu" | "review">("menu");
  const [cartOpenMobile, setCartOpenMobile] = useState(false);

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
        .select("id, name, code, price, unit, company_product_id, image_url")
        .eq("distributor_id", distributorId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Load an existing order for edit/view.
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

  // Reset / hydrate the form when the dialog opens.
  useEffect(() => {
    if (!open) return;
    setStep("menu");
    setSearch("");
    setUnitFilter("all");
    setCartOpenMobile(false);
    if (orderId && existing) {
      setCustomerId(existing.header.customer_id);
      setOrderDate(existing.header.order_date);
      setRequiredDate(existing.header.required_date ?? "");
      setNotes(existing.header.notes ?? "");
      setStatus(existing.header.status);
      setCart(
        existing.items.map((it) => ({
          itemId: it.id,
          distributor_product_id: it.distributor_product_id ?? "",
          product_name: it.product_name,
          code: null,
          company_product_id: it.company_product_id,
          unit: it.unit,
          quantity: Number(it.quantity ?? 0),
          price: Number(it.price ?? 0),
          remarks: it.remarks ?? "",
        }))
      );
    } else if (!orderId) {
      setCustomerId("");
      setOrderDate(todayISO());
      setRequiredDate("");
      setNotes("");
      setStatus("draft");
      setCart([]);
    }
  }, [open, orderId, existing]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const readOnly = ["approved", "dispatched", "delivered", "cancelled"].includes(status);

  const units = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => p.unit && set.add(p.unit));
    return Array.from(set);
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const matchesUnit = unitFilter === "all" || p.unit === unitFilter;
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.code ?? "").toLowerCase().includes(q);
      return matchesUnit && matchesSearch;
    });
  }, [products, search, unitFilter]);

  const cartByProduct = useMemo(() => {
    const map = new Map<string, CartLine>();
    cart.forEach((l) => l.distributor_product_id && map.set(l.distributor_product_id, l));
    return map;
  }, [cart]);

  const total = useMemo(
    () => cart.reduce((s, l) => s + (l.quantity || 0) * (l.price || 0), 0),
    [cart]
  );
  const totalUnits = useMemo(
    () => cart.reduce((s, l) => s + (l.quantity || 0), 0),
    [cart]
  );

  const addProduct = (productId: string) => {
    if (readOnly) return;
    const existingLine = cartByProduct.get(productId);
    if (existingLine) {
      setQty(productId, existingLine.quantity + 1);
      return;
    }
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    setCart((prev) => [
      ...prev,
      {
        distributor_product_id: p.id,
        product_name: p.name,
        code: p.code,
        company_product_id: p.company_product_id ?? null,
        unit: p.unit,
        quantity: 1,
        price: Number(p.price ?? 0),
        remarks: "",
      },
    ]);
  };

  const setQty = (productId: string, qty: number) => {
    if (readOnly) return;
    if (qty <= 0) {
      setCart((prev) => prev.filter((l) => l.distributor_product_id !== productId));
      return;
    }
    setCart((prev) =>
      prev.map((l) => (l.distributor_product_id === productId ? { ...l, quantity: qty } : l))
    );
  };

  const setPrice = (productId: string, price: number) => {
    if (readOnly) return;
    setCart((prev) =>
      prev.map((l) => (l.distributor_product_id === productId ? { ...l, price } : l))
    );
  };

  const removeLine = (productId: string) =>
    setCart((prev) => prev.filter((l) => l.distributor_product_id !== productId));

  const validLines = () => cart.filter((l) => l.distributor_product_id && l.quantity > 0);

  const persist = useMutation({
    mutationFn: async (submit: boolean) => {
      if (!customerId) throw new Error("Select a customer");
      const filled = validLines();
      if (filled.length === 0) throw new Error("Add at least one product with quantity");
      const zeroPriced = filled.find((l) => !(l.price > 0));
      if (zeroPriced) throw new Error(`Set a price for "${zeroPriced.product_name}"`);

      const totalAmount = filled.reduce((s, l) => s + l.quantity * l.price, 0);

      let targetId = orderId;

      if (!orderId) {
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
          headerPatch.rejection_reason = null;
          headerPatch.rejected_by = null;
          headerPatch.rejected_at = null;
        }
        const { error } = await supabase
          .from("distributor_orders")
          .update(headerPatch)
          .eq("id", orderId);
        if (error) throw error;
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
        quantity: l.quantity,
        price: l.price,
        amount: l.quantity * l.price,
        remarks: l.remarks.trim() || null,
      }));
      const { error: itemsError } = await supabase
        .from("distributor_order_items")
        .insert(itemRows);
      if (itemsError) throw itemsError;
    },
    onSuccess: (_data, submit) => {
      queryClient.invalidateQueries({ queryKey: ["distributor_orders"] });
      queryClient.invalidateQueries({ queryKey: ["distributor_order_edit", orderId] });
      toast.success(submit ? "Order submitted for approval" : "Order saved");
      onOpenChange(false);
      onSaved?.();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Failed to save order"),
  });

  const canSubmit = status === "draft" || status === "rejected" || !orderId;
  const customerName = customers.find((c) => c.id === customerId)?.name;

  if (!open) return null;

  const title = orderId ? `Order ${existing?.header.order_number ?? ""}` : "New Order";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header: order meta */}
      <div className="border-b bg-card">
        <div className="flex items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{title}</h1>
            {readOnly && <Badge variant="outline">View only</Badge>}
          </div>
          <div className="ml-auto hidden sm:block text-sm text-muted-foreground">
            {step === "menu" ? "Build the order from the menu" : "Review & post"}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t px-4 py-3 sm:grid-cols-3">
          <div className="col-span-2 space-y-1 sm:col-span-1">
            <Label className="text-xs text-muted-foreground">Customer *</Label>
            <SearchableSelect
              value={customerId}
              onValueChange={setCustomerId}
              options={customers.map((c) => ({
                value: c.id,
                label: c.name,
                secondary: c.code ?? "",
              }))}
              placeholder="Select customer…"
              disabled={readOnly}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Order Date</Label>
            <Input
              type="date"
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
              disabled={readOnly}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Required Date</Label>
            <Input
              type="date"
              value={requiredDate}
              onChange={(e) => setRequiredDate(e.target.value)}
              disabled={readOnly}
            />
          </div>
        </div>
      </div>

      {step === "menu" ? (
        <div className="flex min-h-0 flex-1">
          {/* Product menu */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b bg-card px-4 py-3">
              <div className="relative min-w-[180px] flex-1">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Search products by name or code…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {units.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setUnitFilter("all")}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      unitFilter === "all"
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground"
                    }`}
                  >
                    All
                  </button>
                  {units.map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setUnitFilter(u)}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        unitFilter === u
                          ? "border-primary bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground"
                      }`}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid flex-1 content-start gap-3 overflow-auto p-4 pb-28 sm:pb-4 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))] sm:[grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
              {filteredProducts.length === 0 ? (
                <div className="col-span-full py-12 text-center text-muted-foreground">
                  No products found.
                </div>
              ) : (
                filteredProducts.map((p) => {
                  const line = cartByProduct.get(p.id);
                  return (
                    <div
                      key={p.id}
                      className={`relative flex flex-col gap-2 rounded-xl border bg-card p-3 transition-shadow hover:shadow-md ${
                        line ? "border-primary ring-1 ring-primary" : ""
                      }`}
                    >
                      {line && (
                        <span className="absolute right-2 top-2 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground">
                          {line.quantity}
                        </span>
                      )}
                      {p.image_url ? (
                        <img
                          src={p.image_url}
                          alt={p.name}
                          loading="lazy"
                          className="h-24 w-full rounded-lg border object-cover"
                        />
                      ) : (
                        <div className="flex h-24 items-center justify-center rounded-lg bg-gradient-to-br from-primary/10 to-primary/5 text-xl font-bold text-primary">
                          {(p.code || p.name).slice(0, 3).toUpperCase()}
                        </div>
                      )}
                      {p.code && (
                        <div className="text-xs font-medium text-muted-foreground">{p.code}</div>
                      )}
                      <div className="min-h-[2.2rem] text-sm font-semibold leading-tight">
                        {p.name}
                      </div>
                      <div className="text-sm font-bold text-primary">
                        Rs. {Number(p.price ?? 0).toLocaleString()}
                        {p.unit ? <span className="text-xs font-normal text-muted-foreground"> / {p.unit}</span> : null}
                      </div>
                      {line ? (
                        <div className="mt-auto flex items-center justify-between rounded-lg bg-muted p-1">
                          <Button
                            type="button"
                            variant="secondary"
                            size="icon"
                            className="h-8 w-8"
                            disabled={readOnly}
                            onClick={() => setQty(p.id, line.quantity - 1)}
                          >
                            <Minus className="h-4 w-4" />
                          </Button>
                          <input
                            className="w-12 bg-transparent text-center text-sm font-bold outline-none"
                            inputMode="numeric"
                            value={line.quantity}
                            disabled={readOnly}
                            onChange={(e) => setQty(p.id, parseInt(e.target.value) || 0)}
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            size="icon"
                            className="h-8 w-8"
                            disabled={readOnly}
                            onClick={() => setQty(p.id, line.quantity + 1)}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          className="mt-auto"
                          size="sm"
                          disabled={readOnly}
                          onClick={() => addProduct(p.id)}
                        >
                          <Plus className="mr-1 h-4 w-4" /> Add to order
                        </Button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Cart */}
          <div
            className={`flex w-full flex-col border-l bg-card sm:w-[360px] ${
              cartOpenMobile ? "fixed inset-0 z-40 sm:static" : "hidden sm:flex"
            }`}
          >
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <ShoppingCart className="h-4 w-4" />
              <h2 className="flex-1 font-semibold">Customer Order</h2>
              <Badge variant="secondary">
                {cart.length} item{cart.length !== 1 ? "s" : ""}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="sm:hidden"
                onClick={() => setCartOpenMobile(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 space-y-2 overflow-auto p-3">
              {cart.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
                  <ShoppingCart className="h-10 w-10 opacity-30" />
                  <p>Tap products from the menu to build the customer's order.</p>
                </div>
              ) : (
                cart.map((line) => (
                  <div
                    key={line.distributor_product_id}
                    className="space-y-2 rounded-lg border p-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{line.product_name}</div>
                        {line.code && (
                          <div className="text-xs text-muted-foreground">{line.code}</div>
                        )}
                      </div>
                      {!readOnly && (
                        <button
                          type="button"
                          className="text-destructive"
                          onClick={() => removeLine(line.distributor_product_id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          disabled={readOnly}
                          onClick={() => setQty(line.distributor_product_id, line.quantity - 1)}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <input
                          className="h-7 w-12 rounded-md border bg-background text-center text-sm"
                          inputMode="numeric"
                          value={line.quantity}
                          disabled={readOnly}
                          onChange={(e) =>
                            setQty(line.distributor_product_id, parseInt(e.target.value) || 0)
                          }
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          disabled={readOnly}
                          onClick={() => setQty(line.distributor_product_id, line.quantity + 1)}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">Rs.</span>
                        <input
                          className="h-7 w-20 rounded-md border bg-background px-2 text-right text-sm"
                          inputMode="decimal"
                          value={line.price}
                          disabled={readOnly}
                          onChange={(e) =>
                            setPrice(line.distributor_product_id, parseFloat(e.target.value) || 0)
                          }
                        />
                      </div>
                    </div>
                    <div className="flex justify-between border-t pt-1.5 text-sm">
                      <span className="text-muted-foreground">Amount</span>
                      <span className="font-semibold">
                        Rs. {(line.quantity * line.price).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-3 border-t p-4">
              <div className="flex items-center justify-between text-lg font-bold">
                <span>Total</span>
                <span>Rs. {total.toLocaleString()}</span>
              </div>
              <Button
                className="h-12 w-full text-base"
                disabled={cart.length === 0 || !customerId}
                onClick={() => setStep("review")}
              >
                {readOnly ? "Review Order" : "Checkout & Review"} →
              </Button>
              {!customerId && cart.length > 0 && (
                <p className="text-center text-xs text-destructive">
                  Select a customer to continue.
                </p>
              )}
            </div>
          </div>

          {/* Mobile cart bar */}
          {!cartOpenMobile && (
            <button
              type="button"
              onClick={() => setCartOpenMobile(true)}
              className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between bg-primary px-4 py-3 text-primary-foreground sm:hidden"
            >
              <span className="flex items-center gap-2 font-medium">
                <ShoppingCart className="h-4 w-4" />
                {cart.length} item{cart.length !== 1 ? "s" : ""}
              </span>
              <span className="font-semibold">View Cart · Rs. {total.toLocaleString()}</span>
            </button>
          )}
        </div>
      ) : (
        /* Review step */
        <div className="flex-1 overflow-auto bg-muted/30">
          <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
            <div className="rounded-xl border bg-card p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Order Details
              </h3>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <div className="text-xs text-muted-foreground">Customer</div>
                  <div className="font-semibold">{customerName ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Order Date</div>
                  <div className="font-semibold">{orderDate || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Required Date</div>
                  <div className="font-semibold">{requiredDate || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Items</div>
                  <div className="font-semibold">{cart.length}</div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border bg-card p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Items
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="py-2 text-left font-medium">Product</th>
                      <th className="py-2 text-right font-medium">Qty</th>
                      <th className="py-2 text-right font-medium">Price</th>
                      <th className="py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((line) => (
                      <tr key={line.distributor_product_id} className="border-b last:border-0">
                        <td className="py-2">
                          {line.code ? `${line.code} — ` : ""}
                          {line.product_name}
                        </td>
                        <td className="py-2 text-right">
                          {line.quantity}
                          {line.unit ? ` ${line.unit}` : ""}
                        </td>
                        <td className="py-2 text-right">Rs. {line.price.toLocaleString()}</td>
                        <td className="py-2 text-right font-medium">
                          Rs. {(line.quantity * line.price).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex justify-between border-t pt-3 text-lg font-bold">
                <span>Total ({totalUnits} units)</span>
                <span>Rs. {total.toLocaleString()}</span>
              </div>
            </div>

            <div className="rounded-xl border bg-card p-4">
              <Label className="text-xs text-muted-foreground">Notes</Label>
              <Textarea
                className="mt-1"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={readOnly}
                rows={2}
                placeholder="Special instructions for this order…"
              />
            </div>

            {status === "rejected" && existing?.header.rejection_reason && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <span className="font-medium text-destructive">Rejected: </span>
                {existing.header.rejection_reason}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer actions for the review step */}
      {step === "review" && (
        <div className="border-t bg-card px-4 py-3">
          <div className="mx-auto flex max-w-3xl flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setStep("menu")}
            >
              <ArrowLeft className="mr-1 h-4 w-4" /> Back to menu
            </Button>
            {readOnly ? (
              <Button className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="secondary"
                  className="w-full sm:w-auto"
                  onClick={() => persist.mutate(false)}
                  disabled={persist.isPending}
                >
                  Save Draft
                </Button>
                {canSubmit && (
                  <Button
                    className="h-12 w-full text-base sm:h-10 sm:w-auto sm:text-sm"
                    onClick={() => persist.mutate(true)}
                    disabled={persist.isPending}
                  >
                    Post &amp; Submit for Approval
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
