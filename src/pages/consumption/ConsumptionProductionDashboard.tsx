import { ERPLayout } from "@/components/layout/ERPLayout";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Factory, Package, TrendingUp, Calendar } from "lucide-react";
import { format, startOfWeek, endOfWeek, subDays, startOfMonth, endOfMonth } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function ConsumptionProductionDashboard() {
  const today = new Date();
  const weekStart = startOfWeek(today, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);

  // Fetch products count
  const { data: productCount } = useQuery({
    queryKey: ["consumption-products-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("consumption_products")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true);
      return count || 0;
    },
  });

  // Fetch BOM count
  const { data: bomCount } = useQuery({
    queryKey: ["consumption-bom-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("consumption_bom")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true);
      return count || 0;
    },
  });

  // Fetch today's production
  const { data: todayProduction } = useQuery({
    queryKey: ["consumption-production-today"],
    queryFn: async () => {
      const { data } = await supabase
        .from("consumption_production_entry")
        .select(`
          id,
          quantity_produced,
          unit,
          product:consumption_products(code, name)
        `)
        .eq("entry_date", format(today, "yyyy-MM-dd"));
      return data || [];
    },
  });

  // Fetch weekly production
  const { data: weeklyProduction } = useQuery({
    queryKey: ["consumption-production-weekly", format(weekStart, "yyyy-MM-dd")],
    queryFn: async () => {
      const { data } = await supabase
        .from("consumption_production_entry")
        .select(`
          product_id,
          quantity_produced,
          unit,
          entry_date,
          product:consumption_products(code, name)
        `)
        .gte("entry_date", format(weekStart, "yyyy-MM-dd"))
        .lte("entry_date", format(weekEnd, "yyyy-MM-dd"));

      // Group by product
      const grouped: Record<string, { code: string; name: string; unit: string; total: number; days: number }> = {};
      const productDays: Record<string, Set<string>> = {};
      
      data?.forEach((item: any) => {
        const id = item.product_id;
        if (!grouped[id]) {
          grouped[id] = {
            code: item.product?.code || "",
            name: item.product?.name || "Unknown",
            unit: item.unit || "pcs",
            total: 0,
            days: 0,
          };
          productDays[id] = new Set();
        }
        grouped[id].total += Number(item.quantity_produced) || 0;
        productDays[id].add(item.entry_date);
      });

      // Set unique days
      Object.keys(grouped).forEach(id => {
        grouped[id].days = productDays[id].size;
      });

      return Object.values(grouped);
    },
  });

  // Fetch monthly production summary
  const { data: monthlyProduction } = useQuery({
    queryKey: ["consumption-production-monthly", format(monthStart, "yyyy-MM-dd")],
    queryFn: async () => {
      const { data } = await supabase
        .from("consumption_production_entry")
        .select(`
          product_id,
          quantity_produced,
          unit,
          entry_date,
          product:consumption_products(code, name)
        `)
        .gte("entry_date", format(monthStart, "yyyy-MM-dd"))
        .lte("entry_date", format(monthEnd, "yyyy-MM-dd"));

      // Group by product
      const grouped: Record<string, { code: string; name: string; unit: string; total: number; days: number }> = {};
      const productDays: Record<string, Set<string>> = {};
      
      data?.forEach((item: any) => {
        const id = item.product_id;
        if (!grouped[id]) {
          grouped[id] = {
            code: item.product?.code || "",
            name: item.product?.name || "Unknown",
            unit: item.unit || "pcs",
            total: 0,
            days: 0,
          };
          productDays[id] = new Set();
        }
        grouped[id].total += Number(item.quantity_produced) || 0;
        productDays[id].add(item.entry_date);
      });

      // Set unique days
      Object.keys(grouped).forEach(id => {
        grouped[id].days = productDays[id].size;
      });

      return Object.values(grouped);
    },
  });

  // Fetch last 7 days production trend
  const { data: productionTrend } = useQuery({
    queryKey: ["consumption-production-trend"],
    queryFn: async () => {
      const { data } = await supabase
        .from("consumption_production_entry")
        .select(`
          entry_date,
          quantity_produced
        `)
        .gte("entry_date", format(subDays(today, 6), "yyyy-MM-dd"))
        .lte("entry_date", format(today, "yyyy-MM-dd"));

      // Group by date
      const byDate: Record<string, number> = {};
      for (let i = 6; i >= 0; i--) {
        const date = format(subDays(today, i), "yyyy-MM-dd");
        byDate[date] = 0;
      }

      data?.forEach((item: any) => {
        byDate[item.entry_date] = (byDate[item.entry_date] || 0) + Number(item.quantity_produced);
      });

      return Object.entries(byDate).map(([date, total]) => ({
        date,
        day: format(new Date(date), "EEE"),
        total,
      }));
    },
  });

  const todayTotal = todayProduction?.reduce((sum, item: any) => sum + Number(item.quantity_produced), 0) || 0;
  const weeklyTotal = weeklyProduction?.reduce((sum, item) => sum + item.total, 0) || 0;
  const monthlyTotal = monthlyProduction?.reduce((sum, item) => sum + item.total, 0) || 0;

  return (
    <ERPLayout>
      <div className="space-y-6">
        <div className="page-header">
          <div>
            <h1 className="page-title">Production Dashboard</h1>
            <p className="page-description">Track production quantities and product-wise output</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Products"
            value={productCount || 0}
            icon={Package}
            description="Active products tracked"
          />
          <MetricCard
            title="BOM Recipes"
            value={bomCount || 0}
            icon={Factory}
            description="Active consumption standards"
          />
          <MetricCard
            title="Today's Production"
            value={todayTotal.toLocaleString()}
            icon={TrendingUp}
            description={`${todayProduction?.length || 0} products`}
          />
          <MetricCard
            title="This Week"
            value={weeklyTotal.toLocaleString()}
            icon={Calendar}
            description={`${format(weekStart, "MMM d")} - ${format(weekEnd, "MMM d")}`}
          />
        </div>

        {/* 7 Day Trend */}
        <Card>
          <CardHeader>
            <CardTitle>Production Trend (Last 7 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end justify-between gap-2 h-32">
              {productionTrend?.map((day) => {
                const maxVal = Math.max(...(productionTrend?.map(d => d.total) || [1])) || 1;
                const height = (day.total / maxVal) * 100;
                return (
                  <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-xs text-muted-foreground">{day.total.toLocaleString()}</span>
                    <div 
                      className="w-full bg-primary/80 rounded-t transition-all"
                      style={{ height: `${Math.max(height, 4)}%` }}
                    />
                    <span className="text-xs font-medium">{day.day}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="today" className="space-y-4">
          <TabsList>
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="weekly">This Week</TabsTrigger>
            <TabsTrigger value="monthly">This Month</TabsTrigger>
          </TabsList>

          <TabsContent value="today">
            <Card>
              <CardHeader>
                <CardTitle>Today's Production ({format(today, "MMM d, yyyy")})</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead>Unit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {todayProduction?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground">
                          No production entries for today
                        </TableCell>
                      </TableRow>
                    ) : (
                      todayProduction?.map((item: any) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-mono">{item.product?.code}</TableCell>
                          <TableCell className="font-medium">{item.product?.name}</TableCell>
                          <TableCell className="text-right">{Number(item.quantity_produced).toLocaleString()}</TableCell>
                          <TableCell>{item.unit}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="weekly">
            <Card>
              <CardHeader>
                <CardTitle>Weekly Production ({format(weekStart, "MMM d")} - {format(weekEnd, "MMM d, yyyy")})</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Total Qty</TableHead>
                      <TableHead className="text-right">Days</TableHead>
                      <TableHead className="text-right">Avg/Day</TableHead>
                      <TableHead>Unit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {weeklyProduction?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                          No production entries for this week
                        </TableCell>
                      </TableRow>
                    ) : (
                      weeklyProduction?.map((item, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-mono">{item.code}</TableCell>
                          <TableCell className="font-medium">{item.name}</TableCell>
                          <TableCell className="text-right">{item.total.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{item.days}</TableCell>
                          <TableCell className="text-right">{item.days > 0 ? (item.total / item.days).toFixed(0) : "-"}</TableCell>
                          <TableCell>{item.unit}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="monthly">
            <Card>
              <CardHeader>
                <CardTitle>Monthly Production ({format(monthStart, "MMMM yyyy")})</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Total Qty</TableHead>
                      <TableHead className="text-right">Days</TableHead>
                      <TableHead className="text-right">Avg/Day</TableHead>
                      <TableHead>Unit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {monthlyProduction?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                          No production entries for this month
                        </TableCell>
                      </TableRow>
                    ) : (
                      monthlyProduction?.map((item, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-mono">{item.code}</TableCell>
                          <TableCell className="font-medium">{item.name}</TableCell>
                          <TableCell className="text-right">{item.total.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{item.days}</TableCell>
                          <TableCell className="text-right">{item.days > 0 ? (item.total / item.days).toFixed(0) : "-"}</TableCell>
                          <TableCell>{item.unit}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </ERPLayout>
  );
}
