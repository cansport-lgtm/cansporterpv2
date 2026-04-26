import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardList, Package, CheckCircle, Clock, AlertTriangle, TrendingUp } from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { useState, useMemo } from "react";
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
} from "recharts";

const STATUS_COLORS: Record<string, string> = {
  draft: "#94a3b8",
  in_progress: "#3b82f6",
  completed: "#22c55e",
  cancelled: "#ef4444",
  pending: "#f59e0b",
};

export default function ProductionOrderDashboard() {
  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const [selectedCustomer, setSelectedCustomer] = useState<string>("all");

  // Generate last 12 months for filter
  const monthOptions = useMemo(() => {
    const months = [];
    for (let i = 0; i < 12; i++) {
      const date = subMonths(new Date(), i);
      months.push({
        value: format(date, "yyyy-MM"),
        label: format(date, "MMMM yyyy"),
      });
    }
    return months;
  }, []);

  // Fetch customers for filter
  const { data: customers = [] } = useQuery({
    queryKey: ["customers-filter"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch production orders with items
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["production-orders-dashboard", selectedMonth, selectedCustomer],
    queryFn: async () => {
      const startDate = startOfMonth(new Date(selectedMonth + "-01"));
      const endDate = endOfMonth(new Date(selectedMonth + "-01"));

      let query = supabase
        .from("production_orders")
        .select(`
          *,
          customers(name, code),
          production_order_items(
            id,
            product_id,
            grade_id,
            quantity_dozens,
            packing_type,
            quantity_produced,
            remarks,
            products(name, code),
            grades(name, code)
          )
        `)
        .gte("order_date", format(startDate, "yyyy-MM-dd"))
        .lte("order_date", format(endDate, "yyyy-MM-dd"))
        .order("created_at", { ascending: false });

      if (selectedCustomer !== "all") {
        query = query.eq("customer_id", selectedCustomer);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  // Calculate metrics
  const metrics = useMemo(() => {
    const totalOrders = orders.length;
    const statusCounts: Record<string, number> = {};
    let totalQuantityOrdered = 0;
    let totalQuantityProduced = 0;
    const gradeWiseData: Record<string, { ordered: number; produced: number }> = {};
    const customerWiseData: Record<string, { ordered: number; count: number }> = {};

    orders.forEach((order: any) => {
      // Status counts
      statusCounts[order.status] = (statusCounts[order.status] || 0) + 1;

      // Customer wise
      const customerName = order.customers?.name || "Unknown";
      if (!customerWiseData[customerName]) {
        customerWiseData[customerName] = { ordered: 0, count: 0 };
      }
      customerWiseData[customerName].count += 1;

      // Items aggregation
      order.production_order_items?.forEach((item: any) => {
        const qty = item.quantity_dozens || 0;
        const produced = item.quantity_produced || 0;
        totalQuantityOrdered += qty;
        totalQuantityProduced += produced;

        customerWiseData[customerName].ordered += qty;

        // Grade wise
        const gradeName = item.grades?.name || "Unknown";
        if (!gradeWiseData[gradeName]) {
          gradeWiseData[gradeName] = { ordered: 0, produced: 0 };
        }
        gradeWiseData[gradeName].ordered += qty;
        gradeWiseData[gradeName].produced += produced;
      });
    });

    const completionRate = totalQuantityOrdered > 0
      ? Math.round((totalQuantityProduced / totalQuantityOrdered) * 100)
      : 0;

    return {
      totalOrders,
      statusCounts,
      totalQuantityOrdered,
      totalQuantityProduced,
      completionRate,
      gradeWiseData,
      customerWiseData,
    };
  }, [orders]);

  // Prepare chart data
  const statusChartData = useMemo(() => {
    return Object.entries(metrics.statusCounts).map(([status, count]) => ({
      name: status.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase()),
      value: count,
      status,
    }));
  }, [metrics.statusCounts]);

  const gradeChartData = useMemo(() => {
    return Object.entries(metrics.gradeWiseData).map(([grade, data]) => ({
      grade,
      ordered: data.ordered,
      produced: data.produced,
      pending: Math.max(0, data.ordered - data.produced),
      progress: data.ordered > 0 ? Math.round((data.produced / data.ordered) * 100) : 0,
    }));
  }, [metrics.gradeWiseData]);

  const customerChartData = useMemo(() => {
    return Object.entries(metrics.customerWiseData)
      .map(([customer, data]) => ({
        customer: customer.length > 15 ? customer.substring(0, 15) + "..." : customer,
        fullName: customer,
        ordered: data.ordered,
        orders: data.count,
      }))
      .sort((a, b) => b.ordered - a.ordered)
      .slice(0, 10);
  }, [metrics.customerWiseData]);

  return (
    <ERPLayout>
      <PageHeader
        title="Production Order Dashboard"
        description="Overview of production orders and progress"
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="w-48">
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger>
              <SelectValue placeholder="Select Month" />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map((month) => (
                <SelectItem key={month.value} value={month.value}>
                  {month.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-48">
          <Select value={selectedCustomer} onValueChange={setSelectedCustomer}>
            <SelectTrigger>
              <SelectValue placeholder="All Customers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Customers</SelectItem>
              {customers.map((customer: any) => (
                <SelectItem key={customer.id} value={customer.id}>
                  {customer.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Total Orders"
          value={metrics.totalOrders}
          icon={ClipboardList}
          description="Orders this month"
        />
        <MetricCard
          title="Qty Ordered (Dz)"
          value={metrics.totalQuantityOrdered.toLocaleString()}
          icon={Package}
          description="Total dozens ordered"
        />
        <MetricCard
          title="Qty Produced (Dz)"
          value={metrics.totalQuantityProduced.toLocaleString()}
          icon={CheckCircle}
          description="Total dozens produced"
        />
        <MetricCard
          title="Completion Rate"
          value={`${metrics.completionRate}%`}
          icon={TrendingUp}
          description="Production progress"
        />
      </div>

      {/* Status Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Draft</span>
              <Badge variant="secondary">{metrics.statusCounts["draft"] || 0}</Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">In Progress</span>
              <Badge className="bg-blue-500">{metrics.statusCounts["in_progress"] || 0}</Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Completed</span>
              <Badge className="bg-green-500">{metrics.statusCounts["completed"] || 0}</Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Cancelled</span>
              <Badge variant="destructive">{metrics.statusCounts["cancelled"] || 0}</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Order Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Order Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {statusChartData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={STATUS_COLORS[entry.status] || "#64748b"}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Grade-wise Production */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Grade-wise Order vs Production</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={gradeChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="grade" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="ordered" name="Ordered (Dz)" fill="#3b82f6" />
                  <Bar dataKey="produced" name="Produced (Dz)" fill="#22c55e" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Grade-wise Progress Chart */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Grade-wise Order Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {gradeChartData.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">No order data available</p>
            ) : (
              gradeChartData.map((item) => (
                <div key={item.grade} className="space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="font-medium">{item.grade}</span>
                    <span className="text-muted-foreground">
                      {item.produced.toLocaleString()} / {item.ordered.toLocaleString()} Dz ({item.progress}%)
                    </span>
                  </div>
                  <div className="h-3 w-full bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        item.progress >= 100
                          ? "bg-green-500"
                          : item.progress >= 50
                          ? "bg-blue-500"
                          : item.progress >= 25
                          ? "bg-amber-500"
                          : "bg-red-500"
                      }`}
                      style={{ width: `${Math.min(item.progress, 100)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Customer-wise Orders */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top 10 Customers by Order Quantity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={customerChartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="customer" type="category" width={120} />
                <Tooltip
                  formatter={(value: number, name: string) => [
                    `${value.toLocaleString()} ${name === "ordered" ? "Dz" : ""}`,
                    name === "ordered" ? "Quantity" : "Orders",
                  ]}
                  labelFormatter={(label) => {
                    const item = customerChartData.find((c) => c.customer === label);
                    return item?.fullName || label;
                  }}
                />
                <Bar dataKey="ordered" name="Qty Ordered" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </ERPLayout>
  );
}
