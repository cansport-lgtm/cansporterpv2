import { useMemo, useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Calculator, Search, Eye, RefreshCw, DollarSign, TrendingUp, Percent, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";

// ---- Helpers ----
const NULL_GRADE = "00000000-0000-0000-0000-000000000000";
const costKey = (productId: string | null | undefined, gradeId: string | null | undefined) =>
  `${productId ?? "none"}|${gradeId ?? "none"}`;
const fmt = (n: number) => `Rs. ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const segmentLabel = (s: string) =>
  ({ private_label: "Private Label", domestic: "Domestic", export: "Export" } as Record<string, string>)[s] || s;

const STATUS_COLORS: Record<string, string> = {
  costed: "bg-green-500",
  partial: "bg-amber-500",
  uncosted: "bg-slate-400",
  stale: "bg-blue-500",
};
const STATUS_LABELS: Record<string, string> = {
  costed: "Costed",
  partial: "Partial",
  uncosted: "Uncosted",
  stale: "Stale",
};

// ---- Query result shapes (hand-typed for the nested select) ----
interface OrderItemRel {
  product_id: string | null;
  grade_id: string | null;
  price_per_dozen: number | null;
  products: { code: string | null; name: string | null } | null;
  grades: { code: string | null; name: string | null } | null;
  sales_orders: { order_number: string | null; customers: { name: string | null; code: string | null } | null } | null;
}
interface DispatchItemRel {
  id: string;
  quantity_dozens: number | null;
  sales_order_items: OrderItemRel | null;
}
interface CogsDispatch {
  id: string;
  dispatch_number: string;
  dispatch_date: string;
  delivery_status: string;
  sales_segment: string;
  order_id: string | null;
  sales_orders: { order_number: string | null; customers: { name: string | null; code: string | null } | null } | null;
  sales_dispatch_items: DispatchItemRel[] | null;
}

export default function COGSPage() {
  const queryClient = useQueryClient();
  const { user, hasModulePermission } = useAuth();
  const canEdit = hasModulePermission("sales", "edit");

  const [searchTerm, setSearchTerm] = useState("");
  const [segmentFilter, setSegmentFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [monthFilter, setMonthFilter] = useState<string>("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [costMasterSearch, setCostMasterSearch] = useState("");
  const [costDrafts, setCostDrafts] = useState<Record<string, string>>({});

  // ---- Queries ----
  const { data: dispatches, isLoading } = useQuery({
    queryKey: ["cogs-dispatches", segmentFilter],
    queryFn: async () => {
      let q = supabase
        .from("sales_dispatches")
        .select(`
          id, dispatch_number, dispatch_date, delivery_status, sales_segment, order_id,
          sales_orders ( order_number, customers ( name, code ) ),
          sales_dispatch_items (
            id, quantity_dozens,
            sales_order_items (
              product_id, grade_id, price_per_dozen,
              products ( code, name ),
              grades ( code, name ),
              sales_orders ( order_number, customers ( name, code ) )
            )
          )
        `)
        .order("dispatch_date", { ascending: false });
      if (segmentFilter !== "all") q = q.eq("sales_segment", segmentFilter as never);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as CogsDispatch[];
    },
  });

  const { data: standardCosts } = useQuery({
    queryKey: ["standard-costs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("standard_costs")
        .select("id, product_id, grade_id, cost_per_dozen, is_active, products(code,name), grades(code,name)");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: cogsSnapshots } = useQuery({
    queryKey: ["dispatch-cogs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dispatch_item_cogs")
        .select("dispatch_id, dispatch_item_id, cost_per_dozen_snapshot, cogs_amount");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: products } = useQuery({
    queryKey: ["products-for-cogs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, code, name, grade_id, is_active, grades(code,name)")
        .eq("is_active", true)
        .order("code", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  // ---- Lookup maps ----
  const costMap = useMemo(() => {
    const m = new Map<string, number>();
    (standardCosts ?? []).forEach((c) => {
      if (c.is_active) m.set(costKey(c.product_id, c.grade_id), Number(c.cost_per_dozen) || 0);
    });
    return m;
  }, [standardCosts]);

  const snapshotByDispatch = useMemo(() => {
    const m = new Map<string, { total: number; lineCount: number; anyZero: boolean }>();
    (cogsSnapshots ?? []).forEach((s) => {
      const cur = m.get(s.dispatch_id) ?? { total: 0, lineCount: 0, anyZero: false };
      cur.total += Number(s.cogs_amount) || 0;
      cur.lineCount += 1;
      if ((Number(s.cost_per_dozen_snapshot) || 0) === 0) cur.anyZero = true;
      m.set(s.dispatch_id, cur);
    });
    return m;
  }, [cogsSnapshots]);

  // ---- Per-dispatch derived rows ----
  const rows = useMemo(() => {
    return (dispatches ?? []).map((d) => {
      const lines = (d.sales_dispatch_items ?? []).map((it) => {
        const oi = it.sales_order_items;
        const qty = Number(it.quantity_dozens) || 0;
        const price = Number(oi?.price_per_dozen) || 0;
        const cost = costMap.get(costKey(oi?.product_id, oi?.grade_id)) ?? 0;
        return {
          dispatchItemId: it.id,
          productId: oi?.product_id ?? null,
          gradeId: oi?.grade_id ?? null,
          productLabel: oi?.products?.code
            ? `${oi.products.code}${oi.products.name ? ` — ${oi.products.name}` : ""}`
            : "—",
          gradeLabel: oi?.grades?.code || oi?.grades?.name || "—",
          qty,
          price,
          cost,
          lineSales: qty * price,
          lineCogs: qty * cost,
          hasCost: cost > 0,
        };
      });
      const liveSales = lines.reduce((s, l) => s + l.lineSales, 0);
      const liveCogs = lines.reduce((s, l) => s + l.lineCogs, 0);
      const snap = snapshotByDispatch.get(d.id);
      const hasSnapshot = !!snap;
      const savedCogs = snap?.total ?? 0;
      const displayCogs = hasSnapshot ? savedCogs : liveCogs;

      let status: keyof typeof STATUS_LABELS;
      if (!hasSnapshot) {
        status = "uncosted";
      } else if (Math.round(liveCogs) !== Math.round(savedCogs)) {
        status = "stale"; // standard cost changed since last Update
      } else if (snap!.lineCount < lines.length || snap!.anyZero) {
        status = "partial";
      } else {
        status = "costed";
      }

      const margin = liveSales - displayCogs;
      return {
        d,
        lines,
        liveSales,
        liveCogs,
        hasSnapshot,
        displayCogs,
        status,
        margin,
        marginPct: liveSales > 0 ? (margin / liveSales) * 100 : 0,
        customer:
          d.sales_orders?.customers?.name ||
          (d.sales_dispatch_items ?? [])
            .map((it) => it.sales_order_items?.sales_orders?.customers?.name)
            .find(Boolean) ||
          "—",
      };
    });
  }, [dispatches, costMap, snapshotByDispatch]);

  const filteredRows = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return rows.filter((r) => {
      const matchesSearch =
        !term ||
        r.d.dispatch_number?.toLowerCase().includes(term) ||
        r.d.sales_orders?.order_number?.toLowerCase().includes(term) ||
        r.customer.toLowerCase().includes(term);
      const matchesStatus = statusFilter === "all" || r.status === statusFilter;
      const matchesMonth = !monthFilter || (r.d.dispatch_date || "").startsWith(monthFilter);
      return matchesSearch && matchesStatus && matchesMonth;
    });
  }, [rows, searchTerm, statusFilter, monthFilter]);

  // ---- KPIs ----
  const kpis = useMemo(() => {
    const totalSales = filteredRows.reduce((s, r) => s + r.liveSales, 0);
    const totalCogs = filteredRows.reduce((s, r) => s + r.displayCogs, 0);
    const margin = totalSales - totalCogs;
    const needsAttention = filteredRows.filter((r) => r.status === "uncosted" || r.status === "partial" || r.status === "stale").length;
    return {
      totalSales,
      totalCogs,
      margin,
      marginPct: totalSales > 0 ? (margin / totalSales) * 100 : 0,
      needsAttention,
    };
  }, [filteredRows]);

  // ---- Mutations ----
  const recomputeMutation = useMutation({
    mutationFn: async (dispatchId: string) => {
      const { error } = await supabase.rpc("recompute_dispatch_cogs", {
        p_dispatch_id: dispatchId,
        p_user: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dispatch-cogs"] });
      toast.success("COGS updated for dispatch");
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setUpdatingId(null),
  });

  const upsertCostMutation = useMutation({
    mutationFn: async ({ productId, gradeId, cost }: { productId: string; gradeId: string | null; cost: number }) => {
      const { error } = await supabase.rpc("upsert_standard_cost", {
        p_product: productId,
        p_grade: gradeId, // pass null (not undefined) so the param isn't stripped from the request
        p_cost: cost,
        p_user: user?.id ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["standard-costs"] });
      toast.success("Standard cost saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleUpdate = (dispatchId: string) => {
    setUpdatingId(dispatchId);
    recomputeMutation.mutate(dispatchId);
  };

  // ---- Cost Master rows (products ∪ existing standard costs) ----
  const costMasterRows = useMemo(() => {
    const map = new Map<
      string,
      { productId: string; gradeId: string | null; productLabel: string; gradeLabel: string; cost: number }
    >();
    (products ?? []).forEach((p) => {
      const k = costKey(p.id, p.grade_id);
      map.set(k, {
        productId: p.id,
        gradeId: p.grade_id,
        productLabel: `${p.code}${p.name ? ` — ${p.name}` : ""}`,
        gradeLabel: p.grades?.code || p.grades?.name || "—",
        cost: costMap.get(k) ?? 0,
      });
    });
    (standardCosts ?? []).forEach((c) => {
      const k = costKey(c.product_id, c.grade_id);
      if (!map.has(k) && c.product_id) {
        map.set(k, {
          productId: c.product_id,
          gradeId: c.grade_id,
          productLabel: c.products?.code ? `${c.products.code}${c.products.name ? ` — ${c.products.name}` : ""}` : "—",
          gradeLabel: c.grades?.code || c.grades?.name || "—",
          cost: Number(c.cost_per_dozen) || 0,
        });
      }
    });
    const term = costMasterSearch.toLowerCase();
    return Array.from(map.values())
      .filter((r) => !term || r.productLabel.toLowerCase().includes(term) || r.gradeLabel.toLowerCase().includes(term))
      .sort((a, b) => a.productLabel.localeCompare(b.productLabel));
  }, [products, standardCosts, costMap, costMasterSearch]);

  const commitCost = (productId: string, gradeId: string | null, raw: string) => {
    const k = costKey(productId, gradeId);
    const parsed = parseFloat(raw);
    if (isNaN(parsed) || parsed < 0) return;
    const existing = costMap.get(k) ?? 0;
    if (parsed === existing) return;
    upsertCostMutation.mutate({ productId, gradeId, cost: parsed });
    setCostDrafts((prev) => {
      const next = { ...prev };
      delete next[k];
      return next;
    });
  };

  const detailRow = useMemo(() => filteredRows.find((r) => r.d.id === detailId) || rows.find((r) => r.d.id === detailId), [filteredRows, rows, detailId]);

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="COGS"
          description="Cost of Goods Sold by dispatch invoice"
          icon={Calculator}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard title="Total Sales" value={fmt(kpis.totalSales)} icon={DollarSign} />
          <MetricCard title="Total COGS" value={fmt(kpis.totalCogs)} icon={Calculator} iconColor="text-amber-500" />
          <MetricCard
            title="Gross Margin"
            value={fmt(kpis.margin)}
            icon={TrendingUp}
            iconColor="text-green-600"
            description={`${kpis.marginPct.toFixed(1)}% margin`}
          />
          <MetricCard
            title="Needs Costing"
            value={kpis.needsAttention}
            icon={AlertTriangle}
            iconColor="text-red-500"
            description="Uncosted / partial / stale"
          />
        </div>

        <Tabs defaultValue="invoices" className="space-y-4">
          <TabsList>
            <TabsTrigger value="invoices">Invoices / COGS</TabsTrigger>
            <TabsTrigger value="cost-master">Cost Master</TabsTrigger>
          </TabsList>

          {/* ---- Invoices / COGS ---- */}
          <TabsContent value="invoices">
            <Card>
              <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 space-y-0">
                <CardTitle className="text-lg">Dispatch Invoices</CardTitle>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search dispatch / customer..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9 w-56"
                    />
                  </div>
                  <Input
                    type="month"
                    value={monthFilter}
                    onChange={(e) => setMonthFilter(e.target.value)}
                    className="w-40"
                  />
                  <Select value={segmentFilter} onValueChange={setSegmentFilter}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="Segment" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Segments</SelectItem>
                      <SelectItem value="private_label">Private Label</SelectItem>
                      <SelectItem value="domestic">Domestic</SelectItem>
                      <SelectItem value="export">Export</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-36">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="uncosted">Uncosted</SelectItem>
                      <SelectItem value="partial">Partial</SelectItem>
                      <SelectItem value="stale">Stale</SelectItem>
                      <SelectItem value="costed">Costed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                <div className="border rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Dispatch #</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Segment</TableHead>
                        <TableHead className="text-right">Lines</TableHead>
                        <TableHead className="text-right">Sales</TableHead>
                        <TableHead className="text-right">COGS</TableHead>
                        <TableHead className="text-right">Margin</TableHead>
                        <TableHead className="text-right">Margin %</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isLoading ? (
                        <TableRow>
                          <TableCell colSpan={11} className="text-center py-8">Loading...</TableCell>
                        </TableRow>
                      ) : filteredRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                            No dispatches found
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredRows.map((r) => (
                          <TableRow key={r.d.id}>
                            <TableCell className="font-mono">{r.d.dispatch_number}</TableCell>
                            <TableCell>{r.d.dispatch_date ? format(new Date(r.d.dispatch_date), "dd MMM yyyy") : "—"}</TableCell>
                            <TableCell>{r.customer}</TableCell>
                            <TableCell>{segmentLabel(r.d.sales_segment)}</TableCell>
                            <TableCell className="text-right">{r.lines.length}</TableCell>
                            <TableCell className="text-right">{fmt(r.liveSales)}</TableCell>
                            <TableCell className={`text-right ${r.hasSnapshot ? "" : "text-muted-foreground italic"}`}>
                              {fmt(r.displayCogs)}
                            </TableCell>
                            <TableCell className="text-right">{fmt(r.margin)}</TableCell>
                            <TableCell className="text-right">{r.marginPct.toFixed(1)}%</TableCell>
                            <TableCell>
                              <Badge className={STATUS_COLORS[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button variant="ghost" size="icon" onClick={() => setDetailId(r.d.id)} title="View detail">
                                  <Eye className="h-4 w-4" />
                                </Button>
                                {canEdit && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={updatingId === r.d.id}
                                    onClick={() => handleUpdate(r.d.id)}
                                  >
                                    <RefreshCw className={`h-3.5 w-3.5 mr-1 ${updatingId === r.d.id ? "animate-spin" : ""}`} />
                                    Update
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---- Cost Master ---- */}
          <TabsContent value="cost-master">
            <Card>
              <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 space-y-0">
                <CardTitle className="text-lg">Standard Cost Master (per dozen)</CardTitle>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search product / grade..."
                    value={costMasterSearch}
                    onChange={(e) => setCostMasterSearch(e.target.value)}
                    className="pl-9 w-64"
                  />
                </div>
              </CardHeader>
              <CardContent>
                <div className="border rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Grade</TableHead>
                        <TableHead className="text-right w-48">Cost / Dozen (Rs.)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {costMasterRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                            No products found
                          </TableCell>
                        </TableRow>
                      ) : (
                        costMasterRows.map((r) => {
                          const k = costKey(r.productId, r.gradeId);
                          const draft = costDrafts[k];
                          return (
                            <TableRow key={k}>
                              <TableCell>{r.productLabel}</TableCell>
                              <TableCell>{r.gradeLabel}</TableCell>
                              <TableCell className="text-right">
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  disabled={!canEdit}
                                  value={draft !== undefined ? draft : r.cost === 0 ? "" : String(r.cost)}
                                  placeholder="0"
                                  className="w-40 ml-auto text-right"
                                  onChange={(e) => setCostDrafts((prev) => ({ ...prev, [k]: e.target.value }))}
                                  onBlur={(e) => commitCost(r.productId, r.gradeId, e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                  }}
                                />
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* ---- Detail dialog ---- */}
      <Dialog open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              COGS Detail — {detailRow?.d.dispatch_number}
            </DialogTitle>
          </DialogHeader>
          {detailRow && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Customer</p>
                  <p className="font-medium">{detailRow.customer}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Date</p>
                  <p className="font-medium">
                    {detailRow.d.dispatch_date ? format(new Date(detailRow.d.dispatch_date), "dd MMM yyyy") : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Segment</p>
                  <p className="font-medium">{segmentLabel(detailRow.d.sales_segment)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <Badge className={STATUS_COLORS[detailRow.status]}>{STATUS_LABELS[detailRow.status]}</Badge>
                </div>
              </div>

              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Grade</TableHead>
                      <TableHead className="text-right">Qty (Dz)</TableHead>
                      <TableHead className="text-right">Std Cost/Dz</TableHead>
                      <TableHead className="text-right">Line COGS</TableHead>
                      <TableHead className="text-right">Sales/Dz</TableHead>
                      <TableHead className="text-right">Line Sales</TableHead>
                      {canEdit && <TableHead className="text-right">Set Cost</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detailRow.lines.map((l) => {
                      const k = costKey(l.productId, l.gradeId);
                      const draft = costDrafts[`detail:${k}`];
                      return (
                        <TableRow key={l.dispatchItemId} className={l.hasCost ? "" : "bg-amber-50/50"}>
                          <TableCell>{l.productLabel}</TableCell>
                          <TableCell>{l.gradeLabel}</TableCell>
                          <TableCell className="text-right">{l.qty}</TableCell>
                          <TableCell className="text-right">{l.cost ? fmt(l.cost) : <span className="text-amber-600">—</span>}</TableCell>
                          <TableCell className="text-right">{fmt(l.lineCogs)}</TableCell>
                          <TableCell className="text-right">{fmt(l.price)}</TableCell>
                          <TableCell className="text-right">{fmt(l.lineSales)}</TableCell>
                          {canEdit && (
                            <TableCell className="text-right">
                              {l.productId ? (
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={draft !== undefined ? draft : l.cost === 0 ? "" : String(l.cost)}
                                  placeholder="0"
                                  className="w-28 ml-auto text-right h-8"
                                  onChange={(e) =>
                                    setCostDrafts((prev) => ({ ...prev, [`detail:${k}`]: e.target.value }))
                                  }
                                  onBlur={(e) => {
                                    commitCost(l.productId!, l.gradeId, e.target.value);
                                    setCostDrafts((prev) => {
                                      const next = { ...prev };
                                      delete next[`detail:${k}`];
                                      return next;
                                    });
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                  }}
                                />
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="text-sm space-y-1">
                  <p>
                    <span className="text-muted-foreground">Sales: </span>
                    <span className="font-medium">{fmt(detailRow.liveSales)}</span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Saved COGS: </span>
                    <span className="font-medium">{fmt(detailRow.displayCogs)}</span>
                    {Math.round(detailRow.liveCogs) !== Math.round(detailRow.hasSnapshot ? detailRow.displayCogs : detailRow.liveCogs) && (
                      <span className="text-blue-600"> (live: {fmt(detailRow.liveCogs)})</span>
                    )}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setDetailId(null)}>
                    Close
                  </Button>
                  {canEdit && (
                    <Button
                      disabled={updatingId === detailRow.d.id}
                      onClick={() => handleUpdate(detailRow.d.id)}
                    >
                      <RefreshCw className={`h-4 w-4 mr-2 ${updatingId === detailRow.d.id ? "animate-spin" : ""}`} />
                      Update COGS
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
