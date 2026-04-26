import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  Package,
  TrendingUp,
  AlertTriangle,
  Factory,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function ProductionPlanningDashboard() {
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  const [selectedWeek, setSelectedWeek] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [stockViewDate, setStockViewDate] = useState<Date>(new Date());
  const [stockViewDepartment, setStockViewDepartment] = useState<string>("all");
  const [isStockCalendarOpen, setIsStockCalendarOpen] = useState(false);
  
  const weekStart = startOfWeek(selectedWeek, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(selectedWeek, { weekStartsOn: 1 });

  // Fetch departments
  const { data: departments } = useQuery({
    queryKey: ["production-departments"],
    queryFn: async () => {
      const { data } = await supabase
        .from("production_departments")
        .select("*")
        .eq("is_active", true)
        .order("sequence_order");
      return data || [];
    },
  });

  // Fetch products for stock tracking (used for product display names)
  const { data: productsData } = useQuery({
    queryKey: ["products-stock"],
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("*")
        .eq("is_active", true)
        .order("code");
      return data || [];
    },
  });

  // Fetch sales orders for demand tracking
  const { data: salesOrders } = useQuery({
    queryKey: ["sales-orders-demand", format(weekStart, "yyyy-MM-dd"), format(weekEnd, "yyyy-MM-dd")],
    queryFn: async () => {
      const { data } = await supabase
        .from("sales_orders")
        .select(`
          *,
          sales_order_items (
            *,
            products (code, name),
            grades (code, name)
          )
        `)
        .gte("required_date", format(weekStart, "yyyy-MM-dd"))
        .lte("required_date", format(weekEnd, "yyyy-MM-dd"))
        .in("status", ["confirmed", "in_progress"]);
      return data || [];
    },
  });

  // Fetch floor inventory stock
  const { data: floorStock } = useQuery({
    queryKey: ["floor-inventory-stock"],
    queryFn: async () => {
      const { data } = await supabase
        .from("floor_inventory_stock")
        .select("*, floor_inventory_locations(name)");
      return data || [];
    },
  });

  // Fetch capacity master
  const { data: capacityData } = useQuery({
    queryKey: ["capacity-master"],
    queryFn: async () => {
      const { data } = await supabase
        .from("capacity_master")
        .select("*, production_departments(name), machines(name, code), products(code, name)")
        .eq("is_active", true);
      return data || [];
    },
  });

  // Fetch daily stock closing data for view
  const { data: stockClosingData, isLoading: stockClosingLoading } = useQuery({
    queryKey: ["daily-stock-closing-view", format(stockViewDate, "yyyy-MM-dd"), stockViewDepartment],
    queryFn: async () => {
      let query = supabase
        .from("daily_stock_closing")
        .select(`
          *,
          planning_items (code, name, unit, threshold_inventory, department_id, costing_value, production_departments(name))
        `)
        .eq("closing_date", format(stockViewDate, "yyyy-MM-dd"));
      
      if (stockViewDepartment !== "all") {
        query = query.eq("department_id", stockViewDepartment);
      }
      
      const { data } = await query.order("created_at");
      return data || [];
    },
  });

  // Group stock closing by department
  const stockClosingByDept = useMemo(() => {
    const grouped: Record<string, { departmentName: string; items: any[] }> = {};
    
    stockClosingData?.forEach((entry: any) => {
      const deptId = entry.planning_items?.department_id || "unknown";
      const deptName = entry.planning_items?.production_departments?.name || "Unknown";
      
      if (!grouped[deptId]) {
        grouped[deptId] = { departmentName: deptName, items: [] };
      }
      grouped[deptId].items.push(entry);
    });
    
    return grouped;
  }, [stockClosingData]);

  // Calculate demand by product
  const demandByProduct = useMemo(() => {
    const demand: Record<string, { productId: string; productCode: string; productName: string; totalDemand: number }> = {};
    
    salesOrders?.forEach((order: any) => {
      order.sales_order_items?.forEach((item: any) => {
        const key = item.product_id;
        if (!demand[key]) {
          demand[key] = {
            productId: key,
            productCode: item.products?.code || "Unknown",
            productName: item.products?.name || "Unknown",
            totalDemand: 0,
          };
        }
        demand[key].totalDemand += Number(item.quantity_dozens) || 0;
      });
    });
    
    return Object.values(demand);
  }, [salesOrders]);

  // Calculate stock summary
  const stockSummary = useMemo(() => {
    const summary: Record<string, number> = {};
    
    floorStock?.forEach((stock: any) => {
      const key = stock.item_name;
      if (!summary[key]) {
        summary[key] = 0;
      }
      summary[key] += Number(stock.quantity) || 0;
    });
    
    return summary;
  }, [floorStock]);

  // Calculate capacity utilization
  const totalCapacityPerDay = useMemo(() => {
    return capacityData?.reduce((sum: number, cap: any) => sum + (Number(cap.capacity_per_day) || 0), 0) || 0;
  }, [capacityData]);

  const totalDemand = demandByProduct.reduce((sum, item) => sum + item.totalDemand, 0);
  const utilizationPercent = totalCapacityPerDay > 0 ? Math.min((totalDemand / (totalCapacityPerDay * 6)) * 100, 100) : 0;

  // Calculate gap analysis
  const gapAnalysis = useMemo(() => {
    return demandByProduct.map((demand) => {
      const stockInHand = stockSummary[demand.productCode] || 0;
      const gap = demand.totalDemand - stockInHand;
      return {
        ...demand,
        stockInHand,
        gap,
        status: gap > 0 ? "shortage" : gap < 0 ? "surplus" : "balanced",
      };
    });
  }, [demandByProduct, stockSummary]);

  const shortageCount = gapAnalysis.filter((g) => g.status === "shortage").length;

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Production Planning"
          description="Weekly capacity planning with stock vs demand tracking"
        />

        <Tabs defaultValue="planning" className="space-y-4">
          <TabsList>
            <TabsTrigger value="planning">Weekly Planning</TabsTrigger>
            <TabsTrigger value="stock-closing">
              <Eye className="h-4 w-4 mr-2" />
              Daily Stock View
            </TabsTrigger>
          </TabsList>

          <TabsContent value="planning" className="space-y-6">
            {/* Week Navigation */}
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedWeek(subWeeks(selectedWeek, 1))}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    <span className="hidden sm:inline">Previous Week</span>
                  </Button>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-muted-foreground" />
                    <span className="text-sm sm:text-lg font-semibold">
                      {format(weekStart, "dd MMM")} - {format(weekEnd, "dd MMM yyyy")}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedWeek(addWeeks(selectedWeek, 1))}
                  >
                    <span className="hidden sm:inline">Next Week</span>
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Summary Cards */}
            <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Demand</CardTitle>
                  <Package className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{totalDemand.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground">Dozens for this week</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Weekly Capacity</CardTitle>
                  <Factory className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{(totalCapacityPerDay * 6).toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground">Dozens (6 days)</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Utilization</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{utilizationPercent.toFixed(1)}%</div>
                  <Progress value={utilizationPercent} className="mt-2" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Shortages</CardTitle>
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-destructive">{shortageCount}</div>
                  <p className="text-xs text-muted-foreground">Products need planning</p>
                </CardContent>
              </Card>
            </div>

            {/* Stock vs Demand Gap Analysis */}
            <Card>
              <CardHeader>
                <CardTitle>Stock vs Demand Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                {gapAnalysis.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No demand data for this week
                  </div>
                ) : (
                  <div className="space-y-4">
                    {gapAnalysis.map((item) => (
                      <div
                        key={item.productId}
                        className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border rounded-lg gap-4"
                      >
                        <div className="flex-1">
                          <div className="font-medium">{item.productCode}</div>
                          <div className="text-sm text-muted-foreground">{item.productName}</div>
                        </div>
                        <div className="grid grid-cols-3 gap-4 sm:gap-8 text-center w-full sm:w-auto">
                          <div>
                            <div className="text-xs sm:text-sm text-muted-foreground">Stock</div>
                            <div className="font-semibold">{item.stockInHand.toLocaleString()}</div>
                          </div>
                          <div>
                            <div className="text-xs sm:text-sm text-muted-foreground">Demand</div>
                            <div className="font-semibold">{item.totalDemand.toLocaleString()}</div>
                          </div>
                          <div>
                            <div className="text-xs sm:text-sm text-muted-foreground">Gap</div>
                            <div
                              className={cn(
                                "font-semibold",
                                item.gap > 0 && "text-destructive",
                                item.gap < 0 && "text-success"
                              )}
                            >
                              {item.gap > 0 ? "+" : ""}{item.gap.toLocaleString()}
                            </div>
                          </div>
                        </div>
                        <Badge
                          variant={
                            item.status === "shortage"
                              ? "destructive"
                              : item.status === "surplus"
                              ? "secondary"
                              : "default"
                          }
                        >
                          {item.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Capacity Master Summary */}
            <Card>
              <CardHeader>
                <CardTitle>Capacity Configuration</CardTitle>
              </CardHeader>
              <CardContent>
                {capacityData?.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No capacity data configured. Go to Capacity Master to set up production capacity.
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {capacityData?.map((cap: any) => (
                      <div key={cap.id} className="p-4 border rounded-lg">
                        <div className="font-medium">
                          {cap.machines?.name || cap.production_departments?.name || "General"}
                        </div>
                        <div className="text-sm text-muted-foreground mb-2">
                          {cap.products?.code} - {cap.products?.name}
                        </div>
                        <div className="flex justify-between text-sm">
                          <span>Per Hour:</span>
                          <span className="font-medium">{cap.capacity_per_hour}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span>Per Day:</span>
                          <span className="font-medium">{cap.capacity_per_day}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="stock-closing" className="space-y-6">
            {/* Filters */}
            <Card>
              <CardContent className="py-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium whitespace-nowrap">Date:</span>
                    <Popover open={isStockCalendarOpen} onOpenChange={setIsStockCalendarOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-[180px] justify-start">
                          <Calendar className="mr-2 h-4 w-4" />
                          {format(stockViewDate, "dd MMM yyyy")}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <CalendarComponent
                          mode="single"
                          selected={stockViewDate}
                          onSelect={(date) => {
                            if (date) {
                              setStockViewDate(date);
                              setIsStockCalendarOpen(false);
                            }
                          }}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium whitespace-nowrap">Department:</span>
                    <Select value={stockViewDepartment} onValueChange={setStockViewDepartment}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="All Departments" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Departments</SelectItem>
                        {departments?.map((dept: any) => (
                          <SelectItem key={dept.id} value={dept.id}>
                            {dept.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Stock Closing Data View */}
            {stockClosingLoading ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  Loading stock closing data...
                </CardContent>
              </Card>
            ) : Object.keys(stockClosingByDept).length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No stock closing data found for {format(stockViewDate, "dd MMM yyyy")}</p>
                </CardContent>
              </Card>
            ) : (
              Object.entries(stockClosingByDept).map(([deptId, { departmentName, items }]) => (
                <Card key={deptId}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">{departmentName}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {/* Desktop Table */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2 px-2 font-medium">Item Code</th>
                            <th className="text-left py-2 px-2 font-medium">Item Name</th>
                            <th className="text-left py-2 px-2 font-medium">Unit</th>
                            <th className="text-right py-2 px-2 font-medium">Closing Qty</th>
                            {isSuperAdmin && <th className="text-right py-2 px-2 font-medium">Stock Value</th>}
                            <th className="text-right py-2 px-2 font-medium">Threshold</th>
                            <th className="text-left py-2 px-2 font-medium">Remarks</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((entry: any) => {
                            const threshold = entry.planning_items?.threshold_inventory || 0;
                            const closingQty = Number(entry.closing_quantity) || 0;
                            const isBelowThreshold = closingQty < threshold;
                            return (
                              <tr key={entry.id} className="border-b last:border-0">
                                <td className="py-2 px-2 font-medium">{entry.planning_items?.code}</td>
                                <td className="py-2 px-2">{entry.planning_items?.name}</td>
                                <td className="py-2 px-2 text-muted-foreground">{entry.planning_items?.unit || "pcs"}</td>
                                <td className={cn("py-2 px-2 text-right font-semibold", isBelowThreshold && "text-destructive")}>{entry.closing_quantity}</td>
                                {isSuperAdmin && (
                                  <td className="py-2 px-2 text-right font-medium">
                                    {((Number(entry.closing_quantity) || 0) * (entry.planning_items?.costing_value || 0)).toFixed(2)}
                                  </td>
                                )}
                                <td className="py-2 px-2 text-right text-muted-foreground">{threshold}</td>
                                <td className="py-2 px-2 text-muted-foreground">{entry.remarks || "-"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 font-semibold bg-muted/50">
                            <td className="py-2 px-2" colSpan={3}>Total</td>
                            <td className="py-2 px-2 text-right">
                              {items.reduce((sum: number, e: any) => sum + (Number(e.closing_quantity) || 0), 0)}
                            </td>
                            {isSuperAdmin && (
                              <td className="py-2 px-2 text-right">
                                {items.reduce((sum: number, e: any) => sum + ((Number(e.closing_quantity) || 0) * (e.planning_items?.costing_value || 0)), 0).toFixed(2)}
                              </td>
                            )}
                            <td className="py-2 px-2 text-right">
                              {items.reduce((sum: number, e: any) => sum + (e.planning_items?.threshold_inventory || 0), 0)}
                            </td>
                            <td className="py-2 px-2"></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {/* Mobile Cards */}
                    <div className="md:hidden space-y-3">
                      {items.map((entry: any) => {
                        const threshold = entry.planning_items?.threshold_inventory || 0;
                        const closingQty = Number(entry.closing_quantity) || 0;
                        const isBelowThreshold = closingQty < threshold;
                        return (
                          <div key={entry.id} className="border rounded-lg p-3">
                            <div className="flex justify-between items-start mb-2">
                              <div>
                                <div className="font-medium">{entry.planning_items?.code}</div>
                                <div className="text-sm text-muted-foreground">{entry.planning_items?.name}</div>
                              </div>
                              <span className="text-xs bg-muted px-2 py-1 rounded">{entry.planning_items?.unit || "pcs"}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-muted-foreground">Closing Qty:</span>
                              <span className={cn("font-semibold", isBelowThreshold && "text-destructive")}>{entry.closing_quantity}</span>
                            </div>
                            {isSuperAdmin && (
                              <div className="flex justify-between items-center">
                                <span className="text-sm text-muted-foreground">Stock Value:</span>
                                <span className="font-medium">
                                  {((Number(entry.closing_quantity) || 0) * (entry.planning_items?.costing_value || 0)).toFixed(2)}
                                </span>
                              </div>
                            )}
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-muted-foreground">Threshold:</span>
                              <span className="text-muted-foreground">{threshold}</span>
                            </div>
                            {entry.remarks && (
                              <div className="text-xs text-muted-foreground mt-2">{entry.remarks}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>
    </ERPLayout>
  );
}
