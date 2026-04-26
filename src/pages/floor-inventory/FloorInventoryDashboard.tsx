import { useQuery } from "@tanstack/react-query";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LayoutDashboard, Package, ArrowUpDown, MapPin, TrendingUp, TrendingDown, Factory } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format, startOfMonth, endOfMonth, subDays } from "date-fns";

interface DailyProduction {
  date: string;
  item: string;
  quantity: number;
  unit: string;
}

export default function FloorInventoryDashboard() {
  const today = new Date();
  const monthStart = format(startOfMonth(today), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(today), "yyyy-MM-dd");
  const last7Days = format(subDays(today, 6), "yyyy-MM-dd");

  const { data: stockItems = [] } = useQuery({
    queryKey: ["floor-inventory-stock"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("floor_inventory_stock")
        .select("*");
      if (error) throw error;
      return data;
    },
  });

  const { data: locations = [] } = useQuery({
    queryKey: ["floor-inventory-locations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("floor_inventory_locations")
        .select("*")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  const { data: movements = [] } = useQuery({
    queryKey: ["floor-inventory-movements", monthStart, monthEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("floor_inventory_movements")
        .select("*")
        .gte("movement_date", monthStart)
        .lte("movement_date", monthEnd);
      if (error) throw error;
      return data;
    },
  });

  // Fetch production receipts for last 7 days (output items)
  const { data: productionReceipts = [] } = useQuery({
    queryKey: ["floor-inventory-production-receipts", last7Days],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("floor_inventory_movements")
        .select("movement_date, item_name, quantity, unit")
        .eq("reference_type", "production")
        .eq("movement_type", "receipt")
        .gte("movement_date", last7Days)
        .order("movement_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const totalItems = stockItems.length;
  const totalQuantity = stockItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const activeLocations = locations.length;
  const monthlyMovements = movements.length;
  
  const receipts = movements.filter(m => m.movement_type === "receipt");
  const issues = movements.filter(m => m.movement_type === "issue");
  const totalReceived = receipts.reduce((sum, m) => sum + Number(m.quantity || 0), 0);
  const totalIssued = issues.reduce((sum, m) => sum + Number(m.quantity || 0), 0);

  // Group production by date and item
  const dailyProductionMap = new Map<string, DailyProduction[]>();
  productionReceipts.forEach((receipt: any) => {
    const date = receipt.movement_date;
    if (!dailyProductionMap.has(date)) {
      dailyProductionMap.set(date, []);
    }
    const existing = dailyProductionMap.get(date)!.find(p => p.item === receipt.item_name);
    if (existing) {
      existing.quantity += Number(receipt.quantity);
    } else {
      dailyProductionMap.get(date)!.push({
        date,
        item: receipt.item_name,
        quantity: Number(receipt.quantity),
        unit: receipt.unit || "pcs",
      });
    }
  });

  // Convert to sorted array by date descending
  const dailyProductionData = Array.from(dailyProductionMap.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, items]) => ({ date, items }));

  return (
    <ERPLayout>
      <PageHeader
        title="Floor Inventory Dashboard"
        description="Overview of floor-level inventory tracking"
        icon={LayoutDashboard}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Total Items"
          value={totalItems.toString()}
          description="Unique stock items"
          icon={Package}
        />
        <MetricCard
          title="Total Quantity"
          value={totalQuantity.toLocaleString()}
          description="Units on floor"
          icon={Package}
        />
        <MetricCard
          title="Active Locations"
          value={activeLocations.toString()}
          description="Floor locations"
          icon={MapPin}
        />
        <MetricCard
          title="Monthly Movements"
          value={monthlyMovements.toString()}
          description="This month"
          icon={ArrowUpDown}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Receipts This Month
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-primary">
              +{totalReceived.toLocaleString()}
            </div>
            <p className="text-sm text-muted-foreground">
              {receipts.length} receipt transactions
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-destructive" />
              Issues This Month
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-destructive">
              -{totalIssued.toLocaleString()}
            </div>
            <p className="text-sm text-muted-foreground">
              {issues.length} issue transactions
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Day-wise Production */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Factory className="h-5 w-5 text-primary" />
            Day-wise Production (Last 7 Days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dailyProductionData.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No production recorded in the last 7 days</p>
          ) : (
            <div className="space-y-4">
              {dailyProductionData.map(({ date, items }) => (
                <div key={date} className="border rounded-lg p-3">
                  <div className="font-semibold text-sm text-primary mb-2">
                    {format(new Date(date), "dd MMM yyyy (EEEE)")}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {items.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-muted/50 rounded px-3 py-2">
                        <span className="text-sm font-medium truncate">{item.item}</span>
                        <span className="text-sm font-bold text-primary ml-2 whitespace-nowrap">
                          {item.quantity.toLocaleString()} {item.unit}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Stock by Location</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {locations.map((location: any) => {
                const locationStock = stockItems.filter((s: any) => s.location_id === location.id);
                const locationQty = locationStock.reduce((sum, s: any) => sum + Number(s.quantity || 0), 0);
                return (
                  <div key={location.id} className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{location.name}</p>
                      <p className="text-sm text-muted-foreground">{location.code}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{locationQty.toLocaleString()}</p>
                      <p className="text-sm text-muted-foreground">{locationStock.length} items</p>
                    </div>
                  </div>
                );
              })}
              {locations.length === 0 && (
                <p className="text-muted-foreground text-center py-4">No locations found</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Movements</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {movements.slice(0, 5).map((movement: any) => (
                <div key={movement.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                  <div>
                    <p className="font-medium">{movement.movement_number}</p>
                    <p className="text-sm text-muted-foreground">{movement.item_name}</p>
                  </div>
                  <div className="text-right">
                    <p className={`font-semibold ${movement.movement_type === 'receipt' ? 'text-primary' : movement.movement_type === 'issue' ? 'text-destructive' : ''}`}>
                      {movement.movement_type === 'receipt' ? '+' : movement.movement_type === 'issue' ? '-' : ''}{movement.quantity}
                    </p>
                    <p className="text-sm text-muted-foreground capitalize">{movement.movement_type}</p>
                  </div>
                </div>
              ))}
              {movements.length === 0 && (
                <p className="text-muted-foreground text-center py-4">No recent movements</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}