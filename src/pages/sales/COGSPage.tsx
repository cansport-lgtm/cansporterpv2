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
import { Calculator, Search, Eye, DollarSign, TrendingUp, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";

// COGS = quantity_dozens x products.standard_cost. This is the SAME cost master that the
// accounting module posts to the GL/P&L (postCOGSForDispatch), so figures here stay consistent
// with the Profit & Loss statement. Computed live — editing a cost updates everywhere.

const fmt = (n: number) => `Rs. ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const segmentLabel = (s: string) =>
  ({ private_label: "Private Label", domestic: "Sales", export: "Export" } as Record<string, string>)[s] || s;

const STATUS_COLORS: Record<string, string> = {
  costed: "bg-green-500",
  partial: "bg-amber-500",
  uncosted: "bg-slate-400",
};
const STATUS_LABELS: Record<string, string> = {
  costed: "Costed",
  partial: "Partial",
  uncosted: "Uncosted",
};

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
  const { hasModulePermission } = useAuth();
  const canEdit = hasModulePermission("accounting", "edit");

  const [searchTerm, setSearchTerm] = useState("");
  const [segmentFilter, setSegmentFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [monthFilter, setMonthFilter] = useState<string>("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [costMasterSearch, setCostMasterSearch] = useState("");
  const [costDrafts, setCostDrafts] = useState<Record<string, string>>({});

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

  // products.standard_cost is the single cost master (also drives accounting/P&L COGS).
  const { data: products } = useQuery({
    queryKey: ["cogs-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, code, name, grade_id, is_active, standard_cost, grades(code,name)")
        .eq("is_active", true)
        .order("code", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const costMap = useMemo(() => {
    const m = new Map<string, number>();
    (products ?? []).forEach((p: any) => m.set(p.id, Number(p.standard_cost) || 0));
    return m;
  }, [products]);

  const rows = useMemo(() => {
    return (dispatches ?? []).map((d) => {
      const lines = (d.sales_dispatch_items ?? []).map((it) => {
        const oi = it.sales_order_items;
        const qty = Number(it.quantity_dozens) || 0;
        const price = Number(oi?.price_per_dozen) || 0;
        const cost = oi?.product_id ? costMap.get(oi.product_id) ?? 0 : 0;
        return {
          productId: oi?.product_id ?? null,
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
      const costedLines = lines.filter((l) => l.hasCost).length;

      let status: keyof typeof STATUS_LABELS;
      if (lines.length === 0 || costedLines === 0) status = "uncosted";
      else if (costedLines < lines.length) status = "partial";
      else status = "costed";

      const margin = liveSales - liveCogs;
      return {
        d,
        lines,
        liveSales,
        liveCogs,
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
  }, [dispatches, costMap]);

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

  const kpis = useMemo(() => {
    const totalSales = filteredRows.reduce((s, r) => s + r.liveSales, 0);
    const totalCogs = filteredRows.reduce((s, r) => s + r.liveCogs, 0);
    const margin = totalSales - totalCogs;
    const needsAttention = filteredRows.filter((r) => r.status === "uncosted" || r.status === "partial").length;
    return {
      totalSales,
      totalCogs,
      margin,
      marginPct: totalSales > 0 ? (margin / totalSales) * 100 : 0,
      needsAttention,
    };
  }, [filteredRows]);

  const updateCostMutation = useMutation({
    mutationFn: async ({ productId, cost }: { productId: string; cost: number }) => {
      const { error } = await supabase.from("products").update({ standard_cost: cost }).eq("id", productId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cogs-products"] });
      toast.success("Standard cost updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const commitCost = (productId: string, raw: string) => {
    const parsed = parseFloat(raw);
    if (isNaN(parsed) || parsed < 0) return;
    if (parsed === (costMap.get(productId) ?? 0)) return;
    updateCostMutation.mutate({ productId, cost: parsed });
  };

  const costMasterRows = useMemo(() => {
    const term = costMasterSearch.toLowerCase();
    return (products ?? [])
      .map((p: any) => ({
        productId: p.id as string,
        productLabel: `${p.code}${p.name ? ` — ${p.name}` : ""}`,
        gradeLabel: p.grades?.code || p.grades?.name || "—",
        cost: Number(p.standard_cost) || 0,
      }))
      .filter((r) => !term || r.productLabel.toLowerCase().includes(term) || r.gradeLabel.toLowerCase().includes(term));
  }, [products, costMasterSearch]);

  const detailRow = useMemo(() => rows.find((r) => r.d.id === detailId), [rows, detailId]);

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="COGS (Invoice-wise)"
          description="Cost of Goods Sold per dispatch, from product standard cost (same basis as the P&L)"
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
            description="Uncosted / partial dispatches"
          />
        </div>

        <Tabs defaultValue="invoices" className="space-y-4">
          <TabsList>
            <TabsTrigger value="invoices">Invoices / COGS</TabsTrigger>
            <TabsTrigger value="cost-master">Cost Master</TabsTrigger>
          </TabsList>

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
                  <Input type="month" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="w-40" />
                  <Select value={segmentFilter} onValueChange={setSegmentFilter}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="Segment" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Segments</SelectItem>
                      <SelectItem value="private_label">Private Label</SelectItem>
                      <SelectItem value="domestic">Sales</SelectItem>
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
                        <TableHead className="text-right">Detail</TableHead>
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
                            <TableCell className="text-right">{fmt(r.liveCogs)}</TableCell>
                            <TableCell className="text-right">{fmt(r.margin)}</TableCell>
                            <TableCell className="text-right">{r.marginPct.toFixed(1)}%</TableCell>
                            <TableCell>
                              <Badge className={STATUS_COLORS[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="icon" onClick={() => setDetailId(r.d.id)} title="View detail">
                                <Eye className="h-4 w-4" />
                              </Button>
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

          <TabsContent value="cost-master">
            <Card>
              <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 space-y-0">
                <CardTitle className="text-lg">Product Standard Cost (Rs. per dozen)</CardTitle>
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
                <p className="text-xs text-muted-foreground mb-3">
                  This is the same standard cost the accounting module uses to post COGS to the GL / Profit &amp; Loss.
                </p>
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
                          const draft = costDrafts[r.productId];
                          return (
                            <TableRow key={r.productId}>
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
                                  onChange={(e) => setCostDrafts((prev) => ({ ...prev, [r.productId]: e.target.value }))}
                                  onBlur={(e) => {
                                    commitCost(r.productId, e.target.value);
                                    setCostDrafts((prev) => {
                                      const next = { ...prev };
                                      delete next[r.productId];
                                      return next;
                                    });
                                  }}
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

      <Dialog open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>COGS Detail — {detailRow?.d.dispatch_number}</DialogTitle>
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
                    {detailRow.lines.map((l, i) => {
                      const draft = l.productId ? costDrafts[`d:${l.productId}`] : undefined;
                      return (
                        <TableRow key={i} className={l.hasCost ? "" : "bg-amber-50/50"}>
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
                                  onChange={(e) => setCostDrafts((prev) => ({ ...prev, [`d:${l.productId}`]: e.target.value }))}
                                  onBlur={(e) => {
                                    commitCost(l.productId!, e.target.value);
                                    setCostDrafts((prev) => {
                                      const next = { ...prev };
                                      delete next[`d:${l.productId}`];
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
                    <span className="text-muted-foreground">COGS: </span>
                    <span className="font-medium">{fmt(detailRow.liveCogs)}</span>
                  </p>
                </div>
                <Button variant="outline" onClick={() => setDetailId(null)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
