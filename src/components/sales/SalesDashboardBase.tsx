import { useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ShoppingCart, Truck, Users, CalendarDays, CalendarIcon } from "lucide-react";
import { format, endOfMonth, eachDayOfInterval, parseISO, subDays } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

type SalesSegment = Database["public"]["Enums"]["sales_segment"];

const COLORS = ['hsl(var(--primary))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];

const STATUS_COLORS: Record<string, string> = {
  draft: 'hsl(var(--muted-foreground))',
  confirmed: 'hsl(45 93% 47%)',
  in_production: 'hsl(var(--chart-2))',
  ready: 'hsl(var(--chart-3))',
  partially_dispatched: 'hsl(var(--chart-4))',
  dispatched: 'hsl(142 76% 36%)',
  cancelled: 'hsl(0 84% 60%)',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  in_production: 'In Production',
  ready: 'Ready',
  partially_dispatched: 'Partial Dispatch',
  dispatched: 'Dispatched',
  cancelled: 'Cancelled',
};

interface SalesDashboardBaseProps {
  segment: SalesSegment;
  title: string;
}

export default function SalesDashboardBase({ segment, title }: SalesDashboardBaseProps) {
  const { roles } = useAuth();
  const isSalesExecutive = roles.some(r => r.role === 'sales_executive') && !roles.some(r => r.role === 'super_admin');
  
  const today = new Date();
  
  // Metrics filter state
  const [metricsSelectedMonth, setMetricsSelectedMonth] = useState(format(today, 'yyyy-MM'));
  const [metricsSelectedDate, setMetricsSelectedDate] = useState<Date>(subDays(today, 1));
  
  const metricsMonthStart = `${metricsSelectedMonth}-01`;
  const metricsMonthEnd = format(endOfMonth(parseISO(`${metricsSelectedMonth}-01`)), 'yyyy-MM-dd');

  const [chartSelectedMonth, setChartSelectedMonth] = useState(format(today, 'yyyy-MM'));
  const chartStartDate = `${chartSelectedMonth}-01`;
  const chartEndDate = format(endOfMonth(parseISO(`${chartSelectedMonth}-01`)), 'yyyy-MM-dd');

  // Fetch customers for this segment
  const { data: customerCount } = useQuery({
    queryKey: ['customers-count', segment],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('customers')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true)
        .eq('sales_segment', segment);

      if (error) throw error;
      return count || 0;
    },
  });

  // Fetch yesterday's orders (using selected date)
  const selectedDateStr = format(metricsSelectedDate, 'yyyy-MM-dd');
  const { data: selectedDateOrderStats } = useQuery({
    queryKey: ['sales-orders-selected-date', segment, selectedDateStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_orders')
        .select('status, net_amount')
        .eq('sales_segment', segment)
        .eq('order_date', selectedDateStr);

      if (error) throw error;

      return {
        total: data?.length || 0,
        totalValue: data?.reduce((sum, o) => sum + Number(o.net_amount || 0), 0) || 0,
      };
    },
  });

  // Fetch sales orders summary for selected month
  const { data: orderStats } = useQuery({
    queryKey: ['sales-orders-stats', segment, metricsMonthStart, metricsMonthEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_orders')
        .select('status, net_amount')
        .eq('sales_segment', segment)
        .gte('order_date', metricsMonthStart)
        .lte('order_date', metricsMonthEnd);

      if (error) throw error;

      const stats = {
        total: data?.length || 0,
        totalValue: data?.reduce((sum, o) => sum + Number(o.net_amount || 0), 0) || 0,
        byStatus: {} as Record<string, number>,
      };

      data?.forEach(order => {
        stats.byStatus[order.status] = (stats.byStatus[order.status] || 0) + 1;
      });

      return stats;
    },
  });

  // Fetch date-wise sales orders for chart
  const { data: dateWiseOrders } = useQuery({
    queryKey: ['sales-orders-datewise', segment, chartStartDate, chartEndDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_orders')
        .select('order_date, net_amount, status')
        .eq('sales_segment', segment)
        .gte('order_date', chartStartDate)
        .lte('order_date', chartEndDate)
        .order('order_date', { ascending: true });

      if (error) throw error;

      const daysInRange = eachDayOfInterval({
        start: parseISO(chartStartDate),
        end: parseISO(chartEndDate),
      });

      const allStatuses = [...new Set(data?.map(o => o.status) || [])];

      const ordersByDate: Record<string, Record<string, number>> = {};
      daysInRange.forEach(day => {
        const dateKey = format(day, 'yyyy-MM-dd');
        ordersByDate[dateKey] = {};
        allStatuses.forEach(status => {
          ordersByDate[dateKey][status] = 0;
        });
      });

      data?.forEach(order => {
        const date = order.order_date;
        if (ordersByDate[date]) {
          ordersByDate[date][order.status] = (ordersByDate[date][order.status] || 0) + 1;
        }
      });

      return {
        chartData: daysInRange.map(day => ({
          date: format(day, 'dd'),
          fullDate: format(day, 'MMM dd'),
          ...ordersByDate[format(day, 'yyyy-MM-dd')],
        })),
        statuses: allStatuses,
      };
    },
  });

  // Fetch dispatch stats for selected month
  const { data: dispatchStats } = useQuery({
    queryKey: ['sales-dispatch-stats', segment, metricsMonthStart, metricsMonthEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_dispatches')
        .select('delivery_status')
        .eq('sales_segment', segment)
        .gte('dispatch_date', metricsMonthStart)
        .lte('dispatch_date', metricsMonthEnd);

      if (error) throw error;

      const stats = {
        total: data?.length || 0,
        pending: data?.filter(d => d.delivery_status === 'pending').length || 0,
        inTransit: data?.filter(d => d.delivery_status === 'in_transit').length || 0,
        delivered: data?.filter(d => d.delivery_status === 'delivered').length || 0,
      };

      return stats;
    },
  });

  // Order status chart data
  const orderStatusData = Object.entries(orderStats?.byStatus || {}).map(([status, count]) => ({
    name: STATUS_LABELS[status] || status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    value: count,
    status: status,
  }));

  const metricsMonthLabel = format(parseISO(`${metricsSelectedMonth}-01`), 'MMMM yyyy');

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader 
          title={title}
          description={`Overview for ${metricsMonthLabel}`}
        />

        {/* Date/Month Selection Controls */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">Month:</span>
                <Input
                  type="month"
                  value={metricsSelectedMonth}
                  onChange={(e) => setMetricsSelectedMonth(e.target.value)}
                  className="h-9 w-auto text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">Date:</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "h-9 w-[180px] justify-start text-left font-normal",
                        !metricsSelectedDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {metricsSelectedDate ? format(metricsSelectedDate, "PPP") : <span>Pick a date</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={metricsSelectedDate}
                      onSelect={(date) => date && setMetricsSelectedDate(date)}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Metric Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Active Customers"
            value={customerCount || 0}
            icon={Users}
            description="Total active customers"
          />
          <MetricCard
            title={`Orders on ${format(metricsSelectedDate, 'MMM dd')}`}
            value={selectedDateOrderStats?.total || 0}
            icon={ShoppingCart}
            description={isSalesExecutive ? `${selectedDateOrderStats?.total || 0} orders` : `Rs. ${(selectedDateOrderStats?.totalValue || 0).toLocaleString()} value`}
          />
          <MetricCard
            title={`Orders (${format(parseISO(`${metricsSelectedMonth}-01`), 'MMM yyyy')})`}
            value={orderStats?.total || 0}
            icon={ShoppingCart}
            description={isSalesExecutive ? `${orderStats?.total || 0} orders` : `Rs. ${(orderStats?.totalValue || 0).toLocaleString()} total value`}
          />
          <MetricCard
            title="Dispatches"
            value={dispatchStats?.total || 0}
            icon={Truck}
            description={`${dispatchStats?.delivered || 0} delivered, ${dispatchStats?.inTransit || 0} in transit`}
          />
        </div>

        {/* Date-wise Sales Order Chart */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarDays className="h-5 w-5" />
                Monthly Sales Order Generation
              </CardTitle>
              <Input
                type="month"
                value={chartSelectedMonth}
                onChange={(e) => setChartSelectedMonth(e.target.value)}
                className="h-8 w-auto text-xs"
              />
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {dateWiseOrders && dateWiseOrders.chartData.some(d => 
                dateWiseOrders.statuses.some(s => (d as Record<string, unknown>)[s] as number > 0)
              ) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dateWiseOrders.chartData} stackOffset="sign">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" className="text-xs" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis className="text-xs" allowDecimals={false} tick={{ fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                      labelFormatter={(_, payload) => payload[0]?.payload?.fullDate || ''}
                      formatter={(value: number, name: string) => [value, STATUS_LABELS[name] || name]}
                    />
                    <Legend formatter={(value) => STATUS_LABELS[value] || value} wrapperStyle={{ fontSize: '11px' }} />
                    {dateWiseOrders.statuses.map((status) => (
                      <Bar
                        key={status}
                        dataKey={status}
                        stackId="status"
                        fill={STATUS_COLORS[status] || 'hsl(var(--primary))'}
                        name={status}
                        radius={[2, 2, 0, 0]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No orders for selected period
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Order Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Order Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {orderStatusData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={orderStatusData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={5}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {orderStatusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={STATUS_COLORS[entry.status] || COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No orders this month
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
