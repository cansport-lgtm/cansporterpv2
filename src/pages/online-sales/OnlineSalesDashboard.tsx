import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShoppingBag, Truck, RotateCcw, FileText, Wallet, CheckCircle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { format, subDays, startOfMonth, endOfMonth } from "date-fns";
import { formatPKR } from "@/lib/currency";

const PLATFORM_COLORS = ["hsl(var(--primary))", "hsl(var(--accent))", "#f59e0b", "#10b981", "#8b5cf6", "#ef4444"];
const STATUS_COLORS: Record<string, string> = {
  pending: "#f59e0b",
  confirmed: "#3b82f6",
  dispatched: "#8b5cf6",
  delivered: "#10b981",
  returned: "#ef4444",
  cancelled: "#6b7280",
};

export default function OnlineSalesDashboard() {
  const [period, setPeriod] = useState("quarter");
  const [orders, setOrders] = useState<any[]>([]);
  const [_loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [period]);

  const getDateRange = () => {
    const now = new Date();
    if (period === "week") return { from: subDays(now, 7), to: now };
    if (period === "month") return { from: startOfMonth(now), to: endOfMonth(now) };
    if (period === "halfyear") return { from: subDays(now, 180), to: now };
    if (period === "all") return { from: new Date(2000, 0, 1), to: now };
    return { from: subDays(now, 90), to: now };
  };

  const fetchData = async () => {
    setLoading(true);
    const { from, to } = getDateRange();
    const fromStr = format(from, "yyyy-MM-dd");
    const toStr = format(to, "yyyy-MM-dd");

    const { data: ordersData } = await supabase.from("online_orders").select("*").gte("order_date", fromStr).lte("order_date", toStr);

    setOrders(ordersData || []);
    setLoading(false);
  };

  const totalOrders = orders.length;
  const totalValue = orders.reduce((s, o) => s + (o.order_value || 0), 0);
  const confirmedOrders = orders.filter(o => o.status === "confirmed" || o.status === "dispatched" || o.status === "delivered").length;
  // Dispatched is derived from order status, not the (unused) online_dispatches
  // table, which previously made this metric always read ~0.
  const dispatchedStatuses = ["sent_to_courier", "dispatched", "delivered", "return_awaited", "returned"];
  const totalDispatches = orders.filter(o => dispatchedStatuses.includes(o.status)).length;
  // Cohort-correct: returns measured against the orders in this period.
  const totalReturns = orders.filter(o => o.status === "returned" || o.status === "return_awaited").length;
  const returnRate = totalOrders > 0 ? ((totalReturns / totalOrders) * 100).toFixed(1) : "0";
  const codOrders = orders.filter(o => o.payment_mode === "cod").length;
  const prepaidOrders = orders.filter(o => o.payment_mode === "prepaid").length;

  // Platform distribution
  const platformData = Object.entries(
    orders.reduce((acc: Record<string, number>, o) => {
      acc[o.platform] = (acc[o.platform] || 0) + 1;
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value }));

  // Status distribution
  const statusData = Object.entries(
    orders.reduce((acc: Record<string, number>, o) => {
      acc[o.status] = (acc[o.status] || 0) + 1;
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value, fill: STATUS_COLORS[name] || "#6b7280" }));

  // Daily order trend
  const dailyTrend = Object.entries(
    orders.reduce((acc: Record<string, number>, o) => {
      const day = format(new Date(o.order_date), "MMM dd");
      acc[day] = (acc[day] || 0) + 1;
      return acc;
    }, {})
  ).map(([date, count]) => ({ date, orders: count }));

  return (
    <ERPLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <PageHeader
            title="Online Sales Dashboard"
            description="B2C order tracking, dispatch & returns overview"
            icon={ShoppingBag}
            iconColor="bg-emerald-600 text-white"
          />
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">Last 7 Days</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="quarter">Last 90 Days</SelectItem>
              <SelectItem value="halfyear">Last 180 Days</SelectItem>
              <SelectItem value="all">All Time</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <MetricCard title="Total Orders" value={totalOrders} icon={ShoppingBag} />
          <MetricCard title="Order Value" value={formatPKR(totalValue)} icon={Wallet} />
          <MetricCard title="Confirmed" value={confirmedOrders} icon={CheckCircle} />
          <MetricCard title="Dispatched" value={totalDispatches} icon={Truck} />
          <MetricCard title="Returns" value={totalReturns} icon={RotateCcw} />
          <MetricCard title="Return Rate" value={`${returnRate}%`} icon={FileText} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle className="text-sm">Daily Order Trend</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={dailyTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Bar dataKey="orders" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Platform Distribution</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={platformData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                    {platformData.map((_, i) => (
                      <Cell key={i} fill={PLATFORM_COLORS[i % PLATFORM_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Order Status Breakdown</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                    {statusData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Payment Mode Split</CardTitle></CardHeader>
            <CardContent className="flex items-center justify-center h-[250px]">
              <div className="grid grid-cols-2 gap-8 text-center">
                <div>
                  <div className="text-3xl font-bold text-primary">{prepaidOrders}</div>
                  <div className="text-sm text-muted-foreground mt-1">Prepaid</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-amber-500">{codOrders}</div>
                  <div className="text-sm text-muted-foreground mt-1">COD</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </ERPLayout>
  );
}
