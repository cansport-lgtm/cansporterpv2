import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { OrderStatusBadge } from "./DistributorOrdersPage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Truck, Download, PackageCheck, CheckCircle2, Printer, ChevronDown, ChevronRight, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import * as XLSX from "xlsx";
import { DispatchSheetPrintView } from "@/components/distributor/DispatchSheetPrintView";
import {
  DispatchConsolidatedPrintView,
  type ConsolidatedRequest,
} from "@/components/distributor/DispatchConsolidatedPrintView";
import { Checkbox } from "@/components/ui/checkbox";

const ALL = "ALL";

interface OrderRow {
  id: string;
  order_number: string | null;
  status: string;
  order_date: string;
  required_date: string | null;
  total_amount: number;
  distributor_id: string;
  dispatched_at: string | null;
  delivered_at: string | null;
  distributor_customers: { name: string; code: string | null } | null;
  distributors: { name: string; code: string | null } | null;
}

interface SheetItem {
  product_name: string;
  unit: string | null;
  quantity: number;
  company_product_id: string | null;
  distributor_orders: { id: string; distributor_id: string; status: string } | null;
}

interface SheetRow {
  key: string;
  product: string;
  unit: string;
  quantity: number;
  orders: number;
  distributors: number;
  mapped: boolean;
}

function OrderItemsExpand({ orderId, showPrices }: { orderId: string; showPrices: boolean }) {
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["distributor_dispatch_order_items", orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributor_order_items")
        .select("id, product_name, quantity, unit, price, amount, quantity_dispatched, remarks")
        .eq("order_id", orderId)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Loading lines…</div>;
  if (!items.length) return <div className="p-4 text-sm text-muted-foreground">No lines.</div>;

  return (
    <div className="p-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-muted-foreground">
            <th className="py-1">Product</th>
            <th className="py-1">Qty</th>
            <th className="py-1">Dispatched</th>
            <th className="py-1">Unit</th>
            {showPrices && <th className="py-1">Amount</th>}
            <th className="py-1">Remarks</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-t">
              <td className="py-1">{it.product_name}</td>
              <td className="py-1">{Number(it.quantity ?? 0).toLocaleString()}</td>
              <td className="py-1">{Number(it.quantity_dispatched ?? 0).toLocaleString()}</td>
              <td className="py-1">{it.unit ?? "—"}</td>
              {showPrices && <td className="py-1">{Number(it.amount ?? 0).toLocaleString()}</td>}
              <td className="py-1">{it.remarks ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MobileOrderCard({
  o,
  isAll,
  showPrices,
  selected,
  onToggleSelect,
  onPrint,
  onShare,
  onDispatch,
  onDeliver,
  dispatching,
  delivering,
}: {
  o: OrderRow;
  isAll: boolean;
  showPrices: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onPrint: () => void;
  onShare: () => void;
  onDispatch: () => void;
  onDeliver: () => void;
  dispatching: boolean;
  delivering: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-xl p-3 space-y-2 bg-card shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Checkbox checked={selected} onCheckedChange={onToggleSelect} className="mt-1" aria-label="Select order" />
          <div>
            <div className="font-mono font-semibold text-primary text-sm">{o.order_number ?? "—"}</div>
            <div className="text-xs text-muted-foreground">
              {o.order_date}
              {o.required_date ? ` · req ${o.required_date}` : ""}
            </div>
          </div>
        </div>
        <OrderStatusBadge status={o.status} />
      </div>

      <div>
        <div className="font-medium text-sm">{o.distributor_customers?.name ?? "—"}</div>
        {isAll && <div className="text-xs text-muted-foreground">{o.distributors?.name ?? "—"}</div>}
      </div>

      {showPrices && (
        <div className="text-sm font-bold">{Number(o.total_amount ?? 0).toLocaleString()}</div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs font-medium text-violet-600"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} Order lines
      </button>
      {open && (
        <div className="rounded-lg border bg-muted/30">
          <OrderItemsExpand orderId={o.id} showPrices={showPrices} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
        <Button variant="outline" size="sm" onClick={onPrint}>
          <Printer className="h-3 w-3 mr-1" /> Dispatch Sheet
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-green-700 border-green-600/40 hover:bg-green-50"
          onClick={onShare}
        >
          <MessageCircle className="h-3 w-3 mr-1" /> WhatsApp
        </Button>
        {o.status === "approved" && (
          <Button
            size="sm"
            className="bg-violet-600 hover:bg-violet-700 text-white"
            onClick={onDispatch}
            disabled={dispatching}
          >
            <Truck className="h-3 w-3 mr-1" /> Mark Dispatched
          </Button>
        )}
        {o.status === "dispatched" && (
          <Button
            size="sm"
            className="bg-teal-600 hover:bg-teal-700 text-white"
            onClick={onDeliver}
            disabled={delivering}
          >
            <CheckCircle2 className="h-3 w-3 mr-1" /> Mark Delivered
          </Button>
        )}
        {o.status === "delivered" && (
          <span className="text-xs text-muted-foreground">
            {o.delivered_at ? `Delivered ${format(new Date(o.delivered_at), "dd MMM yyyy")}` : "Delivered"}
          </span>
        )}
      </div>
    </div>
  );
}

export default function DistributorDispatchPage() {
  const queryClient = useQueryClient();
  const { user, canViewPrices, getDistributorScope } = useAuth();
  const { isCompany, distributorId } = getDistributorScope();
  const showPrices = canViewPrices();

  // Company staff (super_admin) default to the company-wide "All Distributors"
  // oversight view; a distributor user is locked to their own distributor.
  const [selected, setSelected] = useState<string>(isCompany ? ALL : distributorId ?? "");
  const scopeId = isCompany ? selected : distributorId ?? "";
  const isAll = scopeId === ALL;
  const hasScope = scopeId !== "";

  const [orderStatus, setOrderStatus] = useState<"approved" | "dispatched" | "delivered">("approved");
  const [orderAction, setOrderAction] = useState<{ id: string; mode: "print" | "share" } | null>(null);
  const [printRequest, setPrintRequest] = useState<ConsolidatedRequest | null>(null);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());

  const { data: distributors = [] } = useQuery({
    queryKey: ["distributors-active"],
    enabled: isCompany,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributors")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Company catalog names for any distributor product mapped to a real SKU, so
  // differently-named distributor products that map to the same SKU aggregate together.
  const { data: companyProducts = [] } = useQuery({
    queryKey: ["company-products-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, code, name")
        .order("name");
      if (error) throw error;
      return data;
    },
  });
  const companyMap = useMemo(() => {
    const m = new Map<string, { code: string | null; name: string }>();
    companyProducts.forEach((p) => m.set(p.id, { code: p.code, name: p.name }));
    return m;
  }, [companyProducts]);

  // Dispatch requirement: every approved (not-yet-dispatched) order line.
  const { data: sheetItems = [], isLoading: sheetLoading } = useQuery({
    queryKey: ["distributor_dispatch_sheet", scopeId],
    enabled: hasScope,
    queryFn: async () => {
      let q = supabase
        .from("distributor_order_items")
        .select("product_name, unit, quantity, company_product_id, distributor_orders!inner(id, distributor_id, status)")
        .eq("distributor_orders.status", "approved");
      if (!isAll) q = q.eq("distributor_orders.distributor_id", scopeId);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as SheetItem[];
    },
  });

  const sheet = useMemo<SheetRow[]>(() => {
    const map = new Map<string, { product: string; unit: string; quantity: number; orders: Set<string>; distributors: Set<string>; mapped: boolean }>();
    for (const it of sheetItems) {
      const unit = it.unit ?? "";
      const mapped = !!it.company_product_id;
      const key = mapped ? `c:${it.company_product_id}|${unit}` : `n:${it.product_name}|${unit}`;
      let label = it.product_name;
      if (mapped) {
        const cp = companyMap.get(it.company_product_id as string);
        if (cp) label = cp.code ? `${cp.code} — ${cp.name}` : cp.name;
      }
      const row = map.get(key) ?? { product: label, unit, quantity: 0, orders: new Set<string>(), distributors: new Set<string>(), mapped };
      row.quantity += Number(it.quantity ?? 0);
      if (it.distributor_orders?.id) row.orders.add(it.distributor_orders.id);
      if (it.distributor_orders?.distributor_id) row.distributors.add(it.distributor_orders.distributor_id);
      map.set(key, row);
    }
    return Array.from(map.entries())
      .map(([key, r]) => ({
        key,
        product: r.product,
        unit: r.unit || "—",
        quantity: r.quantity,
        orders: r.orders.size,
        distributors: r.distributors.size,
        mapped: r.mapped,
      }))
      .sort((a, b) => a.product.localeCompare(b.product));
  }, [sheetItems, companyMap]);

  const exportSheet = () => {
    if (!sheet.length) {
      toast.error("Nothing to export");
      return;
    }
    const scopeName = isAll
      ? "All_Distributors"
      : (distributors.find((d) => d.id === scopeId)?.code ?? "Distributor");
    const rows = sheet.map((r) => ({
      Product: r.product,
      Unit: r.unit,
      "Total Qty": r.quantity,
      Orders: r.orders,
      ...(isAll ? { Distributors: r.distributors } : {}),
      Mapped: r.mapped ? "Yes" : "No",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Dispatch Sheet");
    XLSX.writeFile(wb, `Dispatch_Sheet_${scopeName}_${format(new Date(), "yyyyMMdd")}.xlsx`);
  };

  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ["distributor_dispatch_orders", scopeId, orderStatus],
    enabled: hasScope,
    queryFn: async () => {
      let q = supabase
        .from("distributor_orders")
        .select("id, order_number, status, order_date, required_date, total_amount, distributor_id, dispatched_at, delivered_at, distributor_customers(name, code), distributors(name, code)")
        .eq("status", orderStatus)
        .order("order_date", { ascending: true });
      if (!isAll) q = q.eq("distributor_id", scopeId);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as OrderRow[];
    },
  });

  const dispatchMutation = useMutation({
    mutationFn: async (order: OrderRow) => {
      // Mark every line fully dispatched (quantity_dispatched = quantity).
      const { data: items, error: itemsErr } = await supabase
        .from("distributor_order_items")
        .select("id, quantity")
        .eq("order_id", order.id);
      if (itemsErr) throw itemsErr;
      await Promise.all(
        (items ?? []).map((it) =>
          supabase
            .from("distributor_order_items")
            .update({ quantity_dispatched: it.quantity })
            .eq("id", it.id)
        )
      );
      const { error } = await supabase
        .from("distributor_orders")
        .update({
          status: "dispatched",
          dispatched_by: user?.id ?? null,
          dispatched_at: new Date().toISOString(),
        })
        .eq("id", order.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distributor_dispatch_orders"] });
      queryClient.invalidateQueries({ queryKey: ["distributor_dispatch_sheet"] });
      toast.success("Order marked dispatched");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to dispatch order"),
  });

  const deliverMutation = useMutation({
    mutationFn: async (order: OrderRow) => {
      const { error } = await supabase
        .from("distributor_orders")
        .update({ status: "delivered", delivered_at: new Date().toISOString() })
        .eq("id", order.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distributor_dispatch_orders"] });
      toast.success("Order marked delivered");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to update order"),
  });

  const toggleOrder = (id: string) =>
    setSelectedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allVisibleSelected = orders.length > 0 && orders.every((o) => selectedOrders.has(o.id));
  const toggleSelectAll = () =>
    setSelectedOrders((prev) =>
      allVisibleSelected ? new Set() : new Set(orders.map((o) => o.id))
    );

  const orderColumns = [
    {
      key: "select",
      header: "",
      render: (o: OrderRow) => (
        <Checkbox
          checked={selectedOrders.has(o.id)}
          onCheckedChange={() => toggleOrder(o.id)}
          aria-label={`Select ${o.order_number ?? "order"}`}
        />
      ),
    },
    { key: "order_number", header: "Order #", render: (o: OrderRow) => o.order_number ?? "—" },
    ...(isAll
      ? [{ key: "distributor", header: "Distributor", render: (o: OrderRow) => o.distributors?.name ?? "—" }]
      : []),
    { key: "customer", header: "Customer", render: (o: OrderRow) => o.distributor_customers?.name ?? "—" },
    { key: "order_date", header: "Order Date" },
    { key: "required_date", header: "Required", render: (o: OrderRow) => o.required_date ?? "—" },
    { key: "status", header: "Status", render: (o: OrderRow) => <OrderStatusBadge status={o.status} /> },
    ...(showPrices
      ? [{ key: "total_amount", header: "Total", render: (o: OrderRow) => Number(o.total_amount ?? 0).toLocaleString() }]
      : []),
    {
      key: "actions",
      header: "Actions",
      render: (o: OrderRow) => (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOrderAction({ id: o.id, mode: "print" })}
            title="Print / save dispatch sheet as PDF"
          >
            <Printer className="h-3 w-3 mr-1" /> Dispatch Sheet
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-green-700 border-green-600/40 hover:bg-green-50"
            onClick={() => setOrderAction({ id: o.id, mode: "share" })}
            title="Share dispatch sheet on WhatsApp"
          >
            <MessageCircle className="h-3 w-3 mr-1" /> WhatsApp
          </Button>
          {o.status === "approved" && (
            <Button
              size="sm"
              className="bg-violet-600 hover:bg-violet-700 text-white"
              onClick={() => dispatchMutation.mutate(o)}
              disabled={dispatchMutation.isPending}
            >
              <Truck className="h-3 w-3 mr-1" /> Mark Dispatched
            </Button>
          )}
          {o.status === "dispatched" && (
            <Button
              size="sm"
              className="bg-teal-600 hover:bg-teal-700 text-white"
              onClick={() => deliverMutation.mutate(o)}
              disabled={deliverMutation.isPending}
            >
              <CheckCircle2 className="h-3 w-3 mr-1" /> Mark Delivered
            </Button>
          )}
          {o.status === "delivered" && (
            <span className="text-sm text-muted-foreground">
              {o.delivered_at ? `Delivered ${format(new Date(o.delivered_at), "dd MMM yyyy")}` : "Delivered"}
            </span>
          )}
        </div>
      ),
    },
  ];

  const totalUnits = sheet.reduce((s, r) => s + r.quantity, 0);
  const scopeLabel = isAll
    ? "All Distributors"
    : distributors.find((d) => d.id === scopeId)?.name ?? "Distributor";

  return (
    <ERPLayout>
      <PageHeader
        title="Dispatch"
        description="Aggregate approved-order requirements into a dispatch sheet, then mark orders dispatched and delivered."
        icon={Truck}
      />

      <div className="space-y-6">
        {isCompany && (
          <div className="w-full sm:w-80">
            <Select value={selected} onValueChange={(v) => { setSelected(v); setSelectedOrders(new Set()); }}>
              <SelectTrigger>
                <SelectValue placeholder="Select a distributor..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All Distributors (company-wide)</SelectItem>
                {distributors.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name} ({d.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {!hasScope ? (
          <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
            {isCompany
              ? "Select a distributor (or All Distributors) to view dispatch requirements."
              : "Your account is not linked to a distributor. Contact your administrator."}
          </div>
        ) : (
          <>
            {/* Dispatch Sheet (aggregated requirements) */}
            <Card>
              <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <PackageCheck className="h-5 w-5 text-violet-500" /> Dispatch Sheet — Requirements
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    {sheet.length} product{sheet.length === 1 ? "" : "s"} · {totalUnits.toLocaleString()} total units across approved orders
                    {isAll ? " (all distributors)" : ""}.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    className="flex-1 sm:flex-none bg-violet-600 hover:bg-violet-700 text-white"
                    onClick={() => setPrintRequest({ scopeId, label: scopeLabel, mode: "print" })}
                    disabled={!sheet.length}
                  >
                    <Printer className="h-4 w-4 mr-1" /> Print All Approved
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 sm:flex-none text-green-700 border-green-600/40 hover:bg-green-50"
                    onClick={() => setPrintRequest({ scopeId, label: scopeLabel, mode: "share" })}
                    disabled={!sheet.length}
                  >
                    <MessageCircle className="h-4 w-4 mr-1" /> WhatsApp
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={exportSheet} disabled={!sheet.length}>
                    <Download className="h-4 w-4 mr-1" /> Export Excel
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {sheetLoading ? (
                  <div className="p-4 text-sm text-muted-foreground">Loading requirements…</div>
                ) : !sheet.length ? (
                  <div className="p-4 text-sm text-muted-foreground">No approved orders awaiting dispatch.</div>
                ) : (
                  <>
                    {/* Desktop table */}
                    <Table className="hidden md:table">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product</TableHead>
                          <TableHead>Unit</TableHead>
                          <TableHead className="text-right">Total Qty</TableHead>
                          <TableHead className="text-right">Orders</TableHead>
                          {isAll && <TableHead className="text-right">Distributors</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sheet.map((r) => (
                          <TableRow key={r.key}>
                            <TableCell className="font-medium">{r.product}</TableCell>
                            <TableCell>{r.unit}</TableCell>
                            <TableCell className="text-right">{r.quantity.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{r.orders}</TableCell>
                            {isAll && <TableCell className="text-right">{r.distributors}</TableCell>}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>

                    {/* Mobile cards */}
                    <div className="md:hidden space-y-2">
                      {sheet.map((r) => (
                        <div key={r.key} className="flex items-center justify-between gap-2 rounded-lg border bg-card p-3">
                          <div className="min-w-0">
                            <div className="font-medium text-sm truncate">{r.product}</div>
                            <div className="text-xs text-muted-foreground">
                              {r.unit} · {r.orders} order{r.orders === 1 ? "" : "s"}
                              {isAll ? ` · ${r.distributors} distributor${r.distributors === 1 ? "" : "s"}` : ""}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-bold">{r.quantity.toLocaleString()}</div>
                            <div className="text-xs text-muted-foreground">qty</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Orders to dispatch / track */}
            <Card>
              <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Truck className="h-5 w-5 text-violet-500" /> Orders
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  {selectedOrders.size > 0 && (
                    <>
                      <Button
                        size="sm"
                        className="flex-1 sm:flex-none bg-violet-600 hover:bg-violet-700 text-white"
                        onClick={() =>
                          setPrintRequest({
                            orderIds: [...selectedOrders],
                            label: `${selectedOrders.size} selected order${selectedOrders.size === 1 ? "" : "s"}`,
                            mode: "print",
                          })
                        }
                      >
                        <Printer className="h-4 w-4 mr-1" /> Print ({selectedOrders.size})
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 sm:flex-none text-green-700 border-green-600/40 hover:bg-green-50"
                        onClick={() =>
                          setPrintRequest({
                            orderIds: [...selectedOrders],
                            label: `${selectedOrders.size} selected order${selectedOrders.size === 1 ? "" : "s"}`,
                            mode: "share",
                          })
                        }
                      >
                        <MessageCircle className="h-4 w-4 mr-1" /> WhatsApp ({selectedOrders.size})
                      </Button>
                    </>
                  )}
                  <div className="w-full sm:w-44">
                    <Select
                      value={orderStatus}
                      onValueChange={(v) => {
                        setOrderStatus(v as typeof orderStatus);
                        setSelectedOrders(new Set());
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="approved">To Dispatch (approved)</SelectItem>
                        <SelectItem value="dispatched">Dispatched</SelectItem>
                        <SelectItem value="delivered">Delivered</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {orders.length > 0 && (
                  <div className="flex items-center gap-2 pb-3 text-sm text-muted-foreground">
                    <Checkbox
                      checked={allVisibleSelected}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all orders"
                    />
                    <span>
                      {selectedOrders.size > 0
                        ? `${selectedOrders.size} selected — print one bulk dispatch sheet`
                        : "Select orders to print one sheet for multiple customers"}
                    </span>
                    {selectedOrders.size > 0 && (
                      <Button variant="ghost" size="sm" onClick={() => setSelectedOrders(new Set())}>
                        Clear
                      </Button>
                    )}
                  </div>
                )}

                {/* Desktop table */}
                <div className="hidden md:block">
                  <DataTable
                    columns={orderColumns}
                    data={orders}
                    emptyMessage={ordersLoading ? "Loading..." : "No orders in this state"}
                    expandedRowRender={(o) => <OrderItemsExpand orderId={o.id} showPrices={showPrices} />}
                  />
                </div>

                {/* Mobile cards */}
                <div className="md:hidden space-y-3">
                  {orders.length === 0 ? (
                    <div className="text-center py-8 text-sm text-muted-foreground">
                      {ordersLoading ? "Loading..." : "No orders in this state"}
                    </div>
                  ) : (
                    orders.map((o) => (
                      <MobileOrderCard
                        key={o.id}
                        o={o}
                        isAll={isAll}
                        showPrices={showPrices}
                        selected={selectedOrders.has(o.id)}
                        onToggleSelect={() => toggleOrder(o.id)}
                        onPrint={() => setOrderAction({ id: o.id, mode: "print" })}
                        onShare={() => setOrderAction({ id: o.id, mode: "share" })}
                        onDispatch={() => dispatchMutation.mutate(o)}
                        onDeliver={() => deliverMutation.mutate(o)}
                        dispatching={dispatchMutation.isPending}
                        delivering={deliverMutation.isPending}
                      />
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Print via hidden iframe (printDocument) — these render nothing in the page. */}
      <DispatchSheetPrintView
        orderId={orderAction?.id ?? null}
        mode={orderAction?.mode}
        onAfterPrint={() => setOrderAction(null)}
      />
      <DispatchConsolidatedPrintView
        request={printRequest}
        allValue={ALL}
        onAfterPrint={() => setPrintRequest(null)}
      />
    </ERPLayout>
  );
}
