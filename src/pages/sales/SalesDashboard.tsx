import { useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ShoppingCart, FileText, Truck, Users, CalendarDays, AlertCircle, MapPin, UserCheck, CalendarIcon, PackageCheck } from "lucide-react";
import { format, endOfMonth, eachDayOfInterval, parseISO, subDays } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, AreaChart, Area } from "recharts";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const COLORS = ['hsl(var(--primary))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];

export default function SalesDashboard() {
  const { roles } = useAuth();
  const isSalesExecutive = roles.some(r => r.role === 'sales_executive') && !roles.some(r => r.role === 'super_admin');
  
  const today = new Date();
  
  // Metrics filter state - either month or date mode
  const [metricsFilterMode, setMetricsFilterMode] = useState<"month" | "date">("month");
  const [metricsSelectedMonth, setMetricsSelectedMonth] = useState(format(today, 'yyyy-MM'));
  const [metricsSelectedDate, setMetricsSelectedDate] = useState<Date>(subDays(today, 1));
  
  // Calculate metrics date range based on filter mode
  const metricsStartDate = metricsFilterMode === "date" 
    ? format(metricsSelectedDate, 'yyyy-MM-dd') 
    : `${metricsSelectedMonth}-01`;
  const metricsEndDate = metricsFilterMode === "date" 
    ? format(metricsSelectedDate, 'yyyy-MM-dd') 
    : format(endOfMonth(parseISO(`${metricsSelectedMonth}-01`)), 'yyyy-MM-dd');

  // Chart filter states
  const [chartSelectedMonth, setChartSelectedMonth] = useState(format(today, 'yyyy-MM'));
  const [chartSelectedCustomer, setChartSelectedCustomer] = useState<string>('all');
  const [visitsFilterMode, setVisitsFilterMode] = useState<"date" | "month">("month");
  const [visitsFilterDate, setVisitsFilterDate] = useState(format(today, 'yyyy-MM-dd'));
  const [visitsFilterMonth, setVisitsFilterMonth] = useState(format(today, 'yyyy-MM'));
  const [visitsSelectedCustomer, setVisitsSelectedCustomer] = useState<string>('all');

  // Calculate chart date range (monthly view only)
  const chartStartDate = `${chartSelectedMonth}-01`;
  const chartEndDate = format(endOfMonth(parseISO(`${chartSelectedMonth}-01`)), 'yyyy-MM-dd');

  // Calculate visits chart date range based on filter mode
  const visitsStartDate = visitsFilterMode === "date" ? visitsFilterDate : `${visitsFilterMonth}-01`;
  const visitsEndDate = visitsFilterMode === "date" ? visitsFilterDate : format(endOfMonth(parseISO(`${visitsFilterMonth}-01`)), 'yyyy-MM-dd');

  // Fetch customers for filter
  const { data: customers } = useQuery({
    queryKey: ['customers-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, code, name')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch orders for selected period (works for both date and month modes)
  const { data: periodOrderStats } = useQuery({
    queryKey: ['sales-orders-period', metricsStartDate, metricsEndDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_orders')
        .select('status, net_amount')
        .gte('order_date', metricsStartDate)
        .lte('order_date', metricsEndDate);

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

  // Status colors for chart
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

  // Fetch date-wise sales orders for chart (with filters)
  const { data: dateWiseOrders } = useQuery({
    queryKey: ['sales-orders-datewise', chartStartDate, chartEndDate, chartSelectedCustomer],
    queryFn: async () => {
      let query = supabase
        .from('sales_orders')
        .select('order_date, net_amount, customer_id, status')
        .gte('order_date', chartStartDate)
        .lte('order_date', chartEndDate)
        .order('order_date', { ascending: true });

      if (chartSelectedCustomer !== 'all') {
        query = query.eq('customer_id', chartSelectedCustomer);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Create a map of all days in the range
      const daysInRange = eachDayOfInterval({
        start: parseISO(chartStartDate),
        end: parseISO(chartEndDate),
      });

      // Get all unique statuses
      const allStatuses = [...new Set(data?.map(o => o.status) || [])];

      const ordersByDate: Record<string, Record<string, number>> = {};
      daysInRange.forEach(day => {
        const dateKey = format(day, 'yyyy-MM-dd');
        ordersByDate[dateKey] = {};
        allStatuses.forEach(status => {
          ordersByDate[dateKey][status] = 0;
        });
      });

      // Aggregate orders by date and status
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

  // Fetch quotations summary for selected period
  const { data: quotationStats } = useQuery({
    queryKey: ['sales-quotations-stats', metricsStartDate, metricsEndDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_quotations')
        .select('status, net_amount')
        .gte('quotation_date', metricsStartDate)
        .lte('quotation_date', metricsEndDate);

      if (error) throw error;

      const stats = {
        total: data?.length || 0,
        accepted: data?.filter(q => q.status === 'accepted' || q.status === 'converted').length || 0,
        pending: data?.filter(q => q.status === 'draft' || q.status === 'sent').length || 0,
        totalValue: data?.reduce((sum, q) => sum + Number(q.net_amount || 0), 0) || 0,
      };

      return stats;
    },
  });

  // Fetch dispatch stats for selected period
  const { data: dispatchStats } = useQuery({
    queryKey: ['sales-dispatch-stats', metricsStartDate, metricsEndDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_dispatches')
        .select('delivery_status, sales_dispatch_items(quantity_dozens, rate_per_dozen)')
        .gte('dispatch_date', metricsStartDate)
        .lte('dispatch_date', metricsEndDate);

      if (error) throw error;

      let totalAmount = 0;
      let deliveredAmount = 0;
      let deliveredCount = 0;
      
      data?.forEach(dispatch => {
        const items = (dispatch as any).sales_dispatch_items || [];
        let dispatchTotal = 0;
        items.forEach((item: any) => {
          const itemAmount = Number(item.quantity_dozens || 0) * Number(item.rate_per_dozen || 0);
          dispatchTotal += itemAmount;
        });
        totalAmount += dispatchTotal;
        
        if (dispatch.delivery_status === 'delivered') {
          deliveredCount++;
          deliveredAmount += dispatchTotal;
        }
      });

      const stats = {
        total: data?.length || 0,
        pending: data?.filter(d => d.delivery_status === 'pending').length || 0,
        inTransit: data?.filter(d => d.delivery_status === 'in_transit').length || 0,
        delivered: deliveredCount,
        totalAmount,
        deliveredAmount,
      };

      return stats;
    },
  });

  // Fetch customer visits count for selected period
  const { data: visitsStats } = useQuery({
    queryKey: ['customer-visits-stats', metricsStartDate, metricsEndDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_visits')
        .select('order_taken')
        .gte('visit_date', metricsStartDate)
        .lte('visit_date', metricsEndDate);

      if (error) throw error;

      return {
        total: data?.length || 0,
        withOrders: data?.filter(v => v.order_taken).length || 0,
      };
    },
  });

  // Fetch customers count
  const { data: customerCount } = useQuery({
    queryKey: ['customers-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('customers')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

      if (error) throw error;
      return count || 0;
    },
  });

  // Fetch inactive customers (no orders in last 7 days)
  const sevenDaysAgo = format(subDays(today, 7), 'yyyy-MM-dd');
  const { data: inactiveCustomers } = useQuery({
    queryKey: ['inactive-customers', sevenDaysAgo],
    queryFn: async () => {
      // Get all active customers
      const { data: allCustomers, error: customersError } = await supabase
        .from('customers')
        .select('id, code, name')
        .eq('is_active', true)
        .order('name');

      if (customersError) throw customersError;

      // Get customers with orders in last 7 days
      const { data: recentOrders, error: ordersError } = await supabase
        .from('sales_orders')
        .select('customer_id')
        .gte('order_date', sevenDaysAgo);

      if (ordersError) throw ordersError;

      // Get unique customer IDs with recent orders
      const activeCustomerIds = new Set(recentOrders?.map(o => o.customer_id) || []);

      // Filter to get inactive customers
      const inactive = allCustomers?.filter(c => !activeCustomerIds.has(c.id)) || [];

      return inactive;
    },
  });

  // Fetch area-wise sales data for selected period
  const { data: areaSalesData } = useQuery({
    queryKey: ['area-sales-stats', metricsStartDate, metricsEndDate],
    queryFn: async () => {
      // Get orders with customer info
      const { data: orders, error: ordersError } = await supabase
        .from('sales_orders')
        .select('net_amount, customer_id')
        .gte('order_date', metricsStartDate)
        .lte('order_date', metricsEndDate);

      if (ordersError) throw ordersError;

      // Get customers with area
      const { data: customersData, error: customersError } = await supabase
        .from('customers')
        .select('id, area');

      if (customersError) throw customersError;

      // Create customer id to area map
      const customerAreaMap = new Map<string, string>();
      customersData?.forEach(c => {
        customerAreaMap.set(c.id, (c as any).area || 'Unspecified');
      });

      // Aggregate by area
      const areaStats: Record<string, { orders: number; value: number }> = {};
      orders?.forEach(order => {
        const area = customerAreaMap.get(order.customer_id) || 'Unspecified';
        if (!areaStats[area]) {
          areaStats[area] = { orders: 0, value: 0 };
        }
        areaStats[area].orders += 1;
        areaStats[area].value += Number(order.net_amount || 0);
      });

      // Convert to array and sort by value
      return Object.entries(areaStats)
        .map(([area, stats]) => ({
          area,
          orders: stats.orders,
          value: stats.value,
        }))
        .sort((a, b) => b.value - a.value);
    },
  });

  const metricsLabel = metricsFilterMode === "date" 
    ? format(metricsSelectedDate, 'MMMM dd, yyyy')
    : format(parseISO(`${metricsSelectedMonth}-01`), 'MMMM yyyy');

  // Fetch customer visits for chart
  const { data: visitsChartData } = useQuery({
    queryKey: ['customer-visits-chart', visitsFilterMode, visitsFilterDate, visitsFilterMonth, visitsSelectedCustomer],
    queryFn: async () => {
      let query = supabase
        .from('customer_visits')
        .select('visit_date, visit_type, order_taken, customer_id')
        .gte('visit_date', visitsStartDate)
        .lte('visit_date', visitsEndDate)
        .order('visit_date', { ascending: true });

      if (visitsSelectedCustomer !== 'all') {
        query = query.eq('customer_id', visitsSelectedCustomer);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Create a map of all days in the range
      const daysInRange = eachDayOfInterval({
        start: parseISO(visitsStartDate),
        end: parseISO(visitsEndDate),
      });

      const visitsByDate: Record<string, { visits: number; ordersGenerated: number }> = {};
      daysInRange.forEach(day => {
        const dateKey = format(day, 'yyyy-MM-dd');
        visitsByDate[dateKey] = { visits: 0, ordersGenerated: 0 };
      });

      // Aggregate visits by date
      data?.forEach(visit => {
        const date = visit.visit_date;
        if (visitsByDate[date]) {
          visitsByDate[date].visits += 1;
          if (visit.order_taken) {
            visitsByDate[date].ordersGenerated += 1;
          }
        }
      });

      return daysInRange.map(day => ({
        date: format(day, 'dd'),
        fullDate: format(day, 'MMM dd'),
        visits: visitsByDate[format(day, 'yyyy-MM-dd')].visits,
        ordersGenerated: visitsByDate[format(day, 'yyyy-MM-dd')].ordersGenerated,
      }));
    },
  });

  // Order status chart data
  const orderStatusData = Object.entries(periodOrderStats?.byStatus || {}).map(([status, count]) => ({
    name: STATUS_LABELS[status] || status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    value: count,
    status: status,
  }));

  // Dispatch status chart data
  const dispatchStatusData = [
    { name: 'Pending', value: dispatchStats?.pending || 0 },
    { name: 'In Transit', value: dispatchStats?.inTransit || 0 },
    { name: 'Delivered', value: dispatchStats?.delivered || 0 },
  ].filter(d => d.value > 0);

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader 
          title="Sales Dashboard" 
          description={`Overview for ${metricsLabel}`}
        />

        {/* Date/Month Selection Controls */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">Filter by:</span>
                <div className="flex rounded-md border">
                  <Button
                    variant={metricsFilterMode === "month" ? "default" : "ghost"}
                    size="sm"
                    className="rounded-r-none"
                    onClick={() => setMetricsFilterMode("month")}
                  >
                    Month
                  </Button>
                  <Button
                    variant={metricsFilterMode === "date" ? "default" : "ghost"}
                    size="sm"
                    className="rounded-l-none"
                    onClick={() => setMetricsFilterMode("date")}
                  >
                    Date
                  </Button>
                </div>
              </div>
              
              {metricsFilterMode === "month" ? (
                <Input
                  type="month"
                  value={metricsSelectedMonth}
                  onChange={(e) => setMetricsSelectedMonth(e.target.value)}
                  className="h-9 w-auto text-sm"
                />
              ) : (
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
              )}
            </div>
          </CardContent>
        </Card>

        {/* Metric Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <MetricCard
            title="Active Customers"
            value={customerCount || 0}
            icon={Users}
            description="Total active customers"
          />
          <MetricCard
            title="Total Visits"
            value={visitsStats?.total || 0}
            icon={UserCheck}
            description={`${visitsStats?.withOrders || 0} with orders`}
          />
          <MetricCard
            title={metricsFilterMode === "date" ? `Orders on ${format(metricsSelectedDate, 'MMM dd')}` : `Orders (${format(parseISO(`${metricsSelectedMonth}-01`), 'MMM yyyy')})`}
            value={periodOrderStats?.total || 0}
            icon={ShoppingCart}
            description={isSalesExecutive ? `${periodOrderStats?.total || 0} orders` : `Rs. ${(periodOrderStats?.totalValue || 0).toLocaleString()} value`}
          />
          <MetricCard
            title="Quotations"
            value={quotationStats?.total || 0}
            icon={FileText}
            description={`${quotationStats?.accepted || 0} accepted, ${quotationStats?.pending || 0} pending`}
          />
          <MetricCard
            title="Dispatches"
            value={dispatchStats?.total || 0}
            icon={Truck}
            description={`${dispatchStats?.pending || 0} pending, ${dispatchStats?.inTransit || 0} in transit`}
          />
          <MetricCard
            title="Dispatch Value"
            value={`Rs. ${(dispatchStats?.totalAmount || 0).toLocaleString()}`}
            icon={Truck}
            description="Total dispatched amount"
          />
          <MetricCard
            title="Delivered"
            value={dispatchStats?.delivered || 0}
            icon={PackageCheck}
            description="Orders delivered"
          />
          <MetricCard
            title="Delivered Value"
            value={`Rs. ${(dispatchStats?.deliveredAmount || 0).toLocaleString()}`}
            icon={PackageCheck}
            description="Delivered amount"
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
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  type="month"
                  value={chartSelectedMonth}
                  onChange={(e) => setChartSelectedMonth(e.target.value)}
                  className="h-8 w-auto text-xs"
                />
                <Select value={chartSelectedCustomer} onValueChange={setChartSelectedCustomer}>
                  <SelectTrigger className="h-8 w-[180px] text-xs">
                    <SelectValue placeholder="All Customers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Customers</SelectItem>
                    {customers?.map(customer => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.code} - {customer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
                    <XAxis 
                      dataKey="date" 
                      className="text-xs"
                      tick={{ fontSize: 10 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis 
                      className="text-xs" 
                      allowDecimals={false}
                      tick={{ fontSize: 10 }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                      labelFormatter={(_, payload) => payload[0]?.payload?.fullDate || ''}
                      formatter={(value: number, name: string) => [
                        value,
                        STATUS_LABELS[name] || name
                      ]}
                    />
                    <Legend 
                      formatter={(value) => STATUS_LABELS[value] || value}
                      wrapperStyle={{ fontSize: '11px' }}
                    />
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

        {/* Charts */}
        <div className="grid gap-6 md:grid-cols-2">
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

          {/* Dispatch Status */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dispatch Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                {dispatchStatusData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dispatchStatusData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="name" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))', 
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }}
                      />
                      <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Count" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    No dispatches this month
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Customer Visits Chart */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <UserCheck className="h-5 w-5" />
                Customer Visits
              </CardTitle>
              <div className="flex items-center gap-2">
                <Select value={visitsFilterMode} onValueChange={(v) => setVisitsFilterMode(v as "date" | "month")}>
                  <SelectTrigger className="h-8 w-[90px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date">Date</SelectItem>
                    <SelectItem value="month">Month</SelectItem>
                  </SelectContent>
                </Select>
                {visitsFilterMode === "date" ? (
                  <Input
                    type="date"
                    value={visitsFilterDate}
                    onChange={(e) => setVisitsFilterDate(e.target.value)}
                    className="h-8 w-auto text-xs"
                  />
                ) : (
                  <Input
                    type="month"
                    value={visitsFilterMonth}
                    onChange={(e) => setVisitsFilterMonth(e.target.value)}
                    className="h-8 w-auto text-xs"
                  />
                )}
                <Select value={visitsSelectedCustomer} onValueChange={setVisitsSelectedCustomer}>
                  <SelectTrigger className="h-8 w-[180px] text-xs">
                    <SelectValue placeholder="All Customers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Customers</SelectItem>
                    {customers?.map(customer => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.code} - {customer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {visitsChartData && visitsChartData.some(d => d.visits > 0) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={visitsChartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis 
                      dataKey="date" 
                      className="text-xs"
                      tick={{ fontSize: 10 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis 
                      className="text-xs" 
                      allowDecimals={false}
                      tick={{ fontSize: 10 }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                      labelFormatter={(_, payload) => payload[0]?.payload?.fullDate || ''}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Area 
                      type="monotone" 
                      dataKey="visits" 
                      stackId="1"
                      stroke="hsl(var(--primary))" 
                      fill="hsl(var(--primary))" 
                      fillOpacity={0.6}
                      name="Total Visits"
                    />
                    <Area 
                      type="monotone" 
                      dataKey="ordersGenerated" 
                      stackId="2"
                      stroke="hsl(142 76% 36%)" 
                      fill="hsl(142 76% 36%)" 
                      fillOpacity={0.6}
                      name="Orders Generated"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <div className="text-center">
                    <UserCheck className="h-12 w-12 mx-auto mb-2 opacity-30" />
                    <p>No visits recorded for this month</p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Area-wise Sales */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Area-wise Sales
              <Badge variant="secondary" className="ml-2">
                {format(today, 'MMMM yyyy')}
              </Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Sales distribution by customer area
            </p>
          </CardHeader>
          <CardContent>
            {areaSalesData && areaSalesData.length > 0 ? (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={areaSalesData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis type="number" className="text-xs" tickFormatter={(value) => `Rs. ${(value / 1000).toFixed(0)}K`} />
                    <YAxis type="category" dataKey="area" className="text-xs" width={100} />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                      formatter={(value: number, name: string) => {
                        if (name === 'value') return [`Rs. ${value.toLocaleString()}`, 'Sales Value'];
                        return [value, 'Orders'];
                      }}
                    />
                    <Legend />
                    {!isSalesExecutive && (
                      <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} name="Sales Value" />
                    )}
                    <Bar dataKey="orders" fill="hsl(var(--chart-2))" radius={[0, 4, 4, 0]} name="Orders" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground">
                <div className="text-center">
                  <MapPin className="h-12 w-12 mx-auto mb-2 opacity-30" />
                  <p>No sales data for this month</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              Inactive Customers
              <Badge variant="secondary" className="ml-2">
                {inactiveCustomers?.length || 0}
              </Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Customers with no orders in the last 7 days
            </p>
          </CardHeader>
          <CardContent>
            {inactiveCustomers && inactiveCustomers.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {inactiveCustomers.map((customer) => (
                  <div 
                    key={customer.id} 
                    className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors"
                  >
                    <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
                      <Users className="h-5 w-5 text-amber-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium truncate">{customer.name}</div>
                      <div className="text-xs text-muted-foreground">{customer.code}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-2 opacity-30" />
                <p>All customers have placed orders recently!</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
