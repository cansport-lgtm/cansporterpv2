import { useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Truck, Package, Clock, CheckCircle, AlertTriangle, BarChart3 } from "lucide-react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-500",
  in_transit: "bg-blue-500",
  delivered: "bg-green-500",
  returned: "bg-red-500",
  acknowledged: "bg-purple-500",
};

const PIE_COLORS = ["#f59e0b", "#3b82f6", "#22c55e", "#ef4444", "#a855f7"];

export default function DomesticDispatchDashboard() {
  const { roles } = useAuth();
  const isSuperAdmin = roles.some(r => r.role === 'super_admin');
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());

  const monthStart = format(startOfMonth(new Date(selectedYear, selectedMonth - 1)), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(new Date(selectedYear, selectedMonth - 1)), "yyyy-MM-dd");

  // Fetch dispatches for selected month
  const { data: dispatches } = useQuery({
    queryKey: ["domestic-dispatch-dashboard", selectedMonth, selectedYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_dispatches")
        .select(`
          *,
          sales_orders(order_number, customers(name, code)),
          sales_dispatch_orders(order_id, sales_orders(order_number, customers(name, code)))
        `)
        .eq("sales_segment", "domestic")
        .gte("dispatch_date", monthStart)
        .lte("dispatch_date", monthEnd)
        .order("dispatch_date", { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  // Fetch dispatch items for value calculation
  const dispatchIds = dispatches?.map((d) => d.id) || [];

  const { data: dispatchItemsData } = useQuery({
    queryKey: ["domestic-dispatch-items-dashboard", dispatchIds],
    queryFn: async () => {
      if (dispatchIds.length === 0) return [];
      const { data, error } = await supabase
        .from("sales_dispatch_items")
        .select("id, dispatch_id, quantity_dozens")
        .in("dispatch_id", dispatchIds);

      if (error) throw error;
      return data;
    },
    enabled: dispatchIds.length > 0,
  });

  // Fetch late orders (orders with expected_dispatch_date passed but not yet dispatched/delivered/cancelled)
  const { data: lateOrders } = useQuery({
    queryKey: ["late-dispatch-orders"],
    queryFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      const { data, error } = await supabase
        .from("sales_orders")
        .select(`
          id, order_number, order_date, expected_dispatch_date, status,
          customers(name, code)
        `)
        .eq("sales_segment", "domestic")
        .lt("expected_dispatch_date", today)
        .not("status", "in", '("dispatched","delivered","cancelled")')
        .order("expected_dispatch_date", { ascending: true });

      if (error) throw error;
      return data;
    },
  });

  // Calculate metrics
  const totalDispatches = dispatches?.length || 0;
  const pendingCount = dispatches?.filter((d) => d.delivery_status === "pending").length || 0;
  const inTransitCount = dispatches?.filter((d) => d.delivery_status === "in_transit").length || 0;
  const deliveredCount = dispatches?.filter((d) => d.delivery_status === "delivered").length || 0;
  const returnedCount = dispatches?.filter((d) => d.delivery_status === "returned").length || 0;
  const acknowledgedCount = dispatches?.filter((d) => d.delivery_status === "acknowledged").length || 0;

  const totalDozens = dispatchItemsData?.reduce((sum, item) => sum + (item.quantity_dozens || 0), 0) || 0;

  const lateCount = lateOrders?.length || 0;

  // Status distribution for pie chart
  const statusData = [
    { name: "Pending", value: pendingCount },
    { name: "In Transit", value: inTransitCount },
    { name: "Delivered", value: deliveredCount },
    { name: "Returned", value: returnedCount },
    { name: "Acknowledged", value: acknowledgedCount },
  ].filter((d) => d.value > 0);

  // Daily dispatch trend
  const dailyTrend = dispatches?.reduce((acc: Record<string, number>, d) => {
    const day = format(new Date(d.dispatch_date), "dd MMM");
    acc[day] = (acc[day] || 0) + 1;
    return acc;
  }, {}) || {};

  const dailyTrendData = Object.entries(dailyTrend).map(([date, count]) => ({ date, dispatches: count }));

  // Customer-wise summary
  const customerSummary = dispatches?.reduce((acc: Record<string, { name: string; count: number; dozens: number }>, d) => {
    let customerName = "Unknown";
    if (d.sales_dispatch_orders?.length > 0) {
      customerName = (d.sales_dispatch_orders[0] as any)?.sales_orders?.customers?.name || "Unknown";
    } else if (d.sales_orders) {
      customerName = (d.sales_orders as any)?.customers?.name || "Unknown";
    }
    if (!acc[customerName]) acc[customerName] = { name: customerName, count: 0, dozens: 0 };
    acc[customerName].count += 1;
    return acc;
  }, {}) || {};

  const customerData = Object.values(customerSummary)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const months = Array.from({ length: 12 }, (_, i) => ({
    value: i + 1,
    label: format(new Date(2024, i), "MMMM"),
  }));

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  const getDaysLate = (expectedDate: string) => {
    const expected = new Date(expectedDate);
    const today = new Date();
    const diffTime = today.getTime() - expected.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Dispatch Dashboard"
          description={isSuperAdmin ? "Domestic dispatch overview and analytics" : "Late dispatch tracking"}
          icon={BarChart3}
          iconColor="bg-orange-500 text-white"
        />

        {isSuperAdmin && (
          <>
            {/* Period Filter */}
            <div className="flex items-center gap-3">
              <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(parseInt(v))}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {months.map((m) => (
                    <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(parseInt(v))}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Metric Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
              <MetricCard title="Total Dispatches" value={totalDispatches} icon={Truck} iconColor="text-primary" />
              <MetricCard title="Pending" value={pendingCount} icon={Clock} iconColor="text-amber-500" />
              <MetricCard title="In Transit" value={inTransitCount} icon={Package} iconColor="text-blue-500" />
              <MetricCard title="Delivered" value={deliveredCount} icon={CheckCircle} iconColor="text-green-500" />
              <MetricCard title="Acknowledged" value={acknowledgedCount} icon={CheckCircle} iconColor="text-purple-500" />
              <MetricCard title="Returned" value={returnedCount} icon={AlertTriangle} iconColor="text-red-500" />
              <MetricCard title="Total Dozens" value={totalDozens.toLocaleString()} icon={Package} iconColor="text-primary" />
              <MetricCard title="Late Dispatches" value={lateCount} icon={AlertTriangle} iconColor="text-destructive" />
            </div>
          </>
        )}

        {/* Late Dispatches Card */}
        {lateOrders && lateOrders.length > 0 && (
          <Card className="border-destructive">
            <CardHeader>
              <CardTitle className="text-base text-destructive flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Late Dispatches ({lateOrders.length} Orders Overdue)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Order Date</TableHead>
                    <TableHead>Dispatch Deadline</TableHead>
                    <TableHead>Days Late</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lateOrders.map((order: any) => {
                    const daysLate = getDaysLate(order.expected_dispatch_date);
                    return (
                      <TableRow key={order.id}>
                        <TableCell className="font-mono font-medium">{order.order_number}</TableCell>
                        <TableCell>
                          <div className="font-medium">{order.customers?.name}</div>
                          <div className="text-xs text-muted-foreground">{order.customers?.code}</div>
                        </TableCell>
                        <TableCell>{format(new Date(order.order_date), "dd MMM yyyy")}</TableCell>
                        <TableCell className="text-destructive font-semibold">
                          {format(new Date(order.expected_dispatch_date), "dd MMM yyyy")}
                        </TableCell>
                        <TableCell>
                          <Badge variant="destructive">{daysLate} {daysLate === 1 ? 'day' : 'days'}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{order.status?.replace(/_/g, ' ')}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {isSuperAdmin && (
          <>
            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Daily Dispatch Trend */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Daily Dispatch Trend</CardTitle>
                </CardHeader>
                <CardContent>
                  {dailyTrendData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={dailyTrendData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="date" className="text-xs" />
                        <YAxis allowDecimals={false} />
                        <Tooltip />
                        <Bar dataKey="dispatches" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-10">No dispatch data for this period</p>
                  )}
                </CardContent>
              </Card>

              {/* Status Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Status Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  {statusData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie data={statusData} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                          {statusData.map((_, index) => (
                            <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Legend />
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-10">No dispatch data for this period</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Top Customers Table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top Customers by Dispatches</CardTitle>
              </CardHeader>
              <CardContent>
                {customerData.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead className="text-right">Dispatches</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {customerData.map((c, i) => (
                        <TableRow key={c.name}>
                          <TableCell>{i + 1}</TableCell>
                          <TableCell className="font-medium">{c.name}</TableCell>
                          <TableCell className="text-right">{c.count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-6">No dispatch data for this period</p>
                )}
              </CardContent>
            </Card>

            {/* Recent Dispatches */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent Dispatches</CardTitle>
              </CardHeader>
              <CardContent>
                {dispatches && dispatches.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Dispatch #</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Vehicle</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dispatches.slice(0, 15).map((d) => {
                        let customerName = "-";
                        if (d.sales_dispatch_orders?.length > 0) {
                          const names = d.sales_dispatch_orders
                            .map((link: any) => link.sales_orders?.customers?.name)
                            .filter(Boolean);
                          customerName = [...new Set(names)].join(", ");
                        } else if (d.sales_orders) {
                          customerName = (d.sales_orders as any)?.customers?.name || "-";
                        }
                        return (
                          <TableRow key={d.id}>
                            <TableCell className="font-medium">{d.dispatch_number || "-"}</TableCell>
                            <TableCell>{format(new Date(d.dispatch_date), "dd MMM yyyy")}</TableCell>
                            <TableCell>{customerName}</TableCell>
                            <TableCell>{d.vehicle_number || "-"}</TableCell>
                            <TableCell>
                              <Badge className={`${STATUS_COLORS[d.delivery_status] || "bg-muted"} text-white`}>
                                {d.delivery_status?.replace("_", " ")}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-6">No dispatches found for this period</p>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </ERPLayout>
  );
}