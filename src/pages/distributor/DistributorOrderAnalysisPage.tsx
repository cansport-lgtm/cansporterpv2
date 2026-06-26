import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
} from "recharts";
import { BarChart3, ShoppingCart, TrendingUp, Wallet, ClipboardCheck } from "lucide-react";
import { format, parseISO, subDays } from "date-fns";

const STATUS_COLORS: Record<string, string> = {
  draft: "hsl(var(--muted-foreground))",
  submitted: "hsl(var(--chart-2))",
  approved: "hsl(var(--chart-3))",
  rejected: "hsl(var(--destructive))",
  dispatched: "hsl(var(--chart-4))",
  delivered: "hsl(var(--chart-5))",
  cancelled: "hsl(var(--border))",
};

const BAR_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

const PERIODS = [
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "180", label: "Last 6 months" },
  { value: "365", label: "Last 12 months" },
  { value: "all", label: "All time" },
];

const VALUE_STATUSES = ["approved", "dispatched", "delivered"];

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

const money = (n: number) => `Rs. ${Math.round(n).toLocaleString()}`;

interface OrderRow {
  id: string;
  status: string;
  order_date: string;
  total_amount: number;
  customer_id: string;
  distributor_customers: { name: string } | null;
}

interface ItemRow {
  order_id: string;
  product_name: string;
  quantity: number;
  amount: number;
}

export default function DistributorOrderAnalysisPage() {
  const { getDistributorScope, canViewPrices } = useAuth();
  const { isCompany, distributorId } = getDistributorScope();
  const showPrices = canViewPrices();

  const [selectedDistributor, setSelectedDistributor] = useState<string | null>(distributorId);
  const [period, setPeriod] = useState("90");
  const activeDistributorId = isCompany ? selectedDistributor : distributorId;

  const sinceISO = useMemo(
    () => (period === "all" ? null : format(subDays(new Date(), Number(period)), "yyyy-MM-dd")),
    [period]
  );

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

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["distributor_order_analysis", activeDistributorId, sinceISO],
    enabled: !!activeDistributorId,
    queryFn: async () => {
      let q = supabase
        .from("distributor_orders")
        .select("id, status, order_date, total_amount, customer_id, distributor_customers(name)")
        .eq("distributor_id", activeDistributorId as string)
        .order("order_date", { ascending: true });
      if (sinceISO) q = q.gte("order_date", sinceISO);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as OrderRow[];
    },
  });

  const orderIds = orders.map((o) => o.id);

  const { data: items = [] } = useQuery({
    queryKey: ["distributor_order_analysis_items", orderIds.join(",")],
    enabled: orderIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributor_order_items")
        .select("order_id, product_name, quantity, amount")
        .in("order_id", orderIds);
      if (error) throw error;
      return data as ItemRow[];
    },
  });

  // ---- Derived analytics ----
  const kpis = useMemo(() => {
    const totalOrders = orders.length;
    const totalValue = orders.reduce((s, o) => s + Number(o.total_amount || 0), 0);
    const confirmedValue = orders
      .filter((o) => VALUE_STATUSES.includes(o.status))
      .reduce((s, o) => s + Number(o.total_amount || 0), 0);
    const avgValue = totalOrders ? totalValue / totalOrders : 0;
    const pending = orders.filter((o) => o.status === "submitted").length;
    const totalQty = items.reduce((s, i) => s + Number(i.quantity || 0), 0);
    return { totalOrders, totalValue, confirmedValue, avgValue, pending, totalQty };
  }, [orders, items]);

  const trend = useMemo(() => {
    const map = new Map<string, { key: string; label: string; orders: number; value: number }>();
    orders.forEach((o) => {
      if (!o.order_date) return;
      const d = parseISO(o.order_date);
      const key = format(d, "yyyy-MM");
      const label = format(d, "MMM yyyy");
      const cur = map.get(key) ?? { key, label, orders: 0, value: 0 };
      cur.orders += 1;
      cur.value += Number(o.total_amount || 0);
      map.set(key, cur);
    });
    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [orders]);

  const byStatus = useMemo(() => {
    const map = new Map<string, number>();
    orders.forEach((o) => map.set(o.status, (map.get(o.status) ?? 0) + 1));
    return Array.from(map.entries()).map(([status, count]) => ({ status, count }));
  }, [orders]);

  const topCustomers = useMemo(() => {
    const map = new Map<string, { name: string; orders: number; value: number }>();
    orders.forEach((o) => {
      const name = o.distributor_customers?.name ?? "—";
      const cur = map.get(name) ?? { name, orders: 0, value: 0 };
      cur.orders += 1;
      cur.value += Number(o.total_amount || 0);
      map.set(name, cur);
    });
    return Array.from(map.values())
      .sort((a, b) => (showPrices ? b.value - a.value : b.orders - a.orders))
      .slice(0, 8);
  }, [orders, showPrices]);

  const topProducts = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; value: number }>();
    items.forEach((i) => {
      const cur = map.get(i.product_name) ?? { name: i.product_name, qty: 0, value: 0 };
      cur.qty += Number(i.quantity || 0);
      cur.value += Number(i.amount || 0);
      map.set(i.product_name, cur);
    });
    return Array.from(map.values())
      .sort((a, b) => (showPrices ? b.value - a.value : b.qty - a.qty))
      .slice(0, 8);
  }, [items, showPrices]);

  return (
    <ERPLayout>
      <PageHeader
        title="Order Analysis"
        description="Sales order trends, value and top performers for the distributor module."
        icon={BarChart3}
        iconColor="bg-amber-500 text-white"
      />

      <div className="space-y-6">
        {/* Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {isCompany && (
            <div className="w-full sm:w-72">
              <Select value={selectedDistributor ?? ""} onValueChange={(v) => setSelectedDistributor(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a distributor..." />
                </SelectTrigger>
                <SelectContent>
                  {distributors.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name} ({d.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="w-full sm:w-48 sm:ml-auto">
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {!activeDistributorId ? (
          <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
            {isCompany
              ? "Select a distributor to view their order analysis."
              : "Your account is not linked to a distributor. Contact your administrator."}
          </div>
        ) : isLoading ? (
          <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">Loading…</div>
        ) : orders.length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
            No orders found for the selected period.
          </div>
        ) : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard title="Total Orders" value={kpis.totalOrders} icon={ShoppingCart} />
              {showPrices ? (
                <>
                  <MetricCard title="Total Order Value" value={money(kpis.totalValue)} icon={Wallet} />
                  <MetricCard
                    title="Confirmed Value"
                    value={money(kpis.confirmedValue)}
                    icon={TrendingUp}
                    description="Approved, dispatched & delivered"
                  />
                  <MetricCard title="Avg Order Value" value={money(kpis.avgValue)} icon={BarChart3} />
                </>
              ) : (
                <>
                  <MetricCard title="Total Quantity" value={kpis.totalQty.toLocaleString()} icon={TrendingUp} />
                  <MetricCard title="Pending Approval" value={kpis.pending} icon={ClipboardCheck} />
                </>
              )}
            </div>

            {/* Trend + status */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base">
                    {showPrices ? "Orders & Value over time" : "Orders over time"}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trend} margin={{ left: 4, right: 8, top: 4, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                        <YAxis
                          yAxisId="left"
                          tick={{ fontSize: 11 }}
                          stroke="hsl(var(--muted-foreground))"
                          allowDecimals={false}
                        />
                        {showPrices && (
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            tick={{ fontSize: 11 }}
                            stroke="hsl(var(--muted-foreground))"
                            tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
                          />
                        )}
                        <Tooltip
                          contentStyle={tooltipStyle}
                          formatter={(value: number, name: string) =>
                            name === "value" ? [money(Number(value)), "Value"] : [value, "Orders"]
                          }
                        />
                        <Line
                          yAxisId="left"
                          type="monotone"
                          dataKey="orders"
                          name="orders"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2}
                          dot={{ r: 3 }}
                        />
                        {showPrices && (
                          <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="value"
                            name="value"
                            stroke="hsl(var(--chart-3))"
                            strokeWidth={2}
                            dot={{ r: 3 }}
                          />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Orders by Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={byStatus}
                          dataKey="count"
                          nameKey="status"
                          cx="50%"
                          cy="50%"
                          innerRadius={45}
                          outerRadius={80}
                          paddingAngle={2}
                        >
                          {byStatus.map((entry, index) => (
                            <Cell
                              key={entry.status}
                              fill={STATUS_COLORS[entry.status] || BAR_COLORS[index % BAR_COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: "12px" }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Top customers + products */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Top Customers</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topCustomers} layout="vertical" margin={{ left: 8, right: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                        <XAxis
                          type="number"
                          tick={{ fontSize: 11 }}
                          stroke="hsl(var(--muted-foreground))"
                          tickFormatter={(v) => (showPrices ? `${Math.round(Number(v) / 1000)}k` : String(v))}
                        />
                        <YAxis
                          type="category"
                          dataKey="name"
                          width={110}
                          tick={{ fontSize: 11 }}
                          stroke="hsl(var(--muted-foreground))"
                        />
                        <Tooltip
                          contentStyle={tooltipStyle}
                          formatter={(value: number) =>
                            showPrices ? [money(Number(value)), "Value"] : [value, "Orders"]
                          }
                        />
                        <Bar
                          dataKey={showPrices ? "value" : "orders"}
                          fill="hsl(var(--primary))"
                          radius={[0, 4, 4, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Top Products</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-xs text-muted-foreground">
                          <th className="py-2 text-left font-medium">Product</th>
                          <th className="py-2 text-right font-medium">Qty</th>
                          {showPrices && <th className="py-2 text-right font-medium">Value</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {topProducts.length === 0 ? (
                          <tr>
                            <td colSpan={showPrices ? 3 : 2} className="py-6 text-center text-muted-foreground">
                              No product lines in this period.
                            </td>
                          </tr>
                        ) : (
                          topProducts.map((p) => (
                            <tr key={p.name} className="border-b last:border-0">
                              <td className="py-2">{p.name}</td>
                              <td className="py-2 text-right">{p.qty.toLocaleString()}</td>
                              {showPrices && <td className="py-2 text-right font-medium">{money(p.value)}</td>}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </ERPLayout>
  );
}
