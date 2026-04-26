import { useQuery } from "@tanstack/react-query";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/shared/MetricCard";
import {
  Package,
  Warehouse,
  ArrowRightLeft,
  AlertTriangle,
  PackageCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
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
} from "recharts";

const COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];

export default function InventoryDashboard() {
  // Fetch inventory locations
  const { data: locations = [] } = useQuery({
    queryKey: ["inventory-locations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_locations")
        .select("*")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  // Fetch inventory stock summary
  const { data: stockSummary = [] } = useQuery({
    queryKey: ["inventory-stock-summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_stock")
        .select("*");
      if (error) throw error;
      return data;
    },
  });

  // Fetch recent movements
  const { data: recentMovements = [] } = useQuery({
    queryKey: ["recent-movements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_movements")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });

  // Fetch WIP inventory
  const { data: wipInventory = [] } = useQuery({
    queryKey: ["wip-inventory-summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wip_inventory")
        .select("*, production_departments(name), grades(name)")
        .eq("status", "in_process");
      if (error) throw error;
      return data;
    },
  });

  // Calculate metrics
  const totalLocations = locations.length;
  const totalStockItems = stockSummary.length;
  const lowStockItems = stockSummary.filter(
    (s: any) => s.quantity <= s.reorder_level && s.reorder_level > 0
  ).length;
  const totalMovements = recentMovements.length;

  // Calculate stock by type
  const stockByType = stockSummary.reduce((acc: Record<string, number>, item: any) => {
    const type = item.item_type || "unknown";
    acc[type] = (acc[type] || 0) + Number(item.quantity);
    return acc;
  }, {} as Record<string, number>);

  const stockByTypeData = Object.entries(stockByType).map(([name, value]) => ({
    name: name.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase()),
    value,
  }));

  // Calculate movements by type
  const movementsByType = recentMovements.reduce((acc: Record<string, number>, movement: any) => {
    const type = movement.movement_type || "unknown";
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const movementsByTypeData = Object.entries(movementsByType).map(
    ([name, value]) => ({
      name: name.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase()),
      count: value,
    })
  );

  return (
    <ERPLayout>
      <PageHeader
        title="Store & Inventory Dashboard"
        description="Overview of inventory, stock levels, and movements"
        icon={Warehouse}
      />

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
        <MetricCard
          title="Storage Locations"
          value={totalLocations}
          icon={Warehouse}
          trend={{ value: 0, isPositive: true }}
        />
        <MetricCard
          title="Stock Items"
          value={totalStockItems}
          icon={Package}
          trend={{ value: 0, isPositive: true }}
        />
        <MetricCard
          title="Low Stock Alerts"
          value={lowStockItems}
          icon={AlertTriangle}
          trend={{ value: lowStockItems, isPositive: lowStockItems === 0 }}
        />
        <MetricCard
          title="Recent Movements"
          value={totalMovements}
          icon={ArrowRightLeft}
          trend={{ value: 0, isPositive: true }}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2 mb-6">
        {/* Stock Distribution by Type */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stock Distribution by Type</CardTitle>
          </CardHeader>
          <CardContent>
            {stockByTypeData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={stockByTypeData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) =>
                      `${name} ${(percent * 100).toFixed(0)}%`
                    }
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {stockByTypeData.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={COLORS[index % COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[250px] text-muted-foreground">
                No stock data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Movements by Type */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Movement Types</CardTitle>
          </CardHeader>
          <CardContent>
            {movementsByTypeData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={movementsByTypeData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(var(--primary))" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[250px] text-muted-foreground">
                No movement data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* WIP Inventory Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <PackageCheck className="h-5 w-5 text-primary" />
            Work In Progress Inventory
          </CardTitle>
        </CardHeader>
        <CardContent>
          {wipInventory.length > 0 ? (
            <div className="space-y-4">
              {wipInventory.slice(0, 5).map((wip: any) => (
                <div
                  key={wip.id}
                  className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                >
                  <div>
                    <p className="font-medium">{wip.grades?.name || "Unknown Grade"}</p>
                    <p className="text-sm text-muted-foreground">
                      {wip.production_departments?.name || "Unknown Dept"} • {wip.process_stage || "N/A"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{wip.closing_qty || 0} units</p>
                    <p className="text-sm text-muted-foreground">
                      {format(new Date(wip.entry_date), "dd MMM yyyy")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              No WIP inventory entries
            </div>
          )}
        </CardContent>
      </Card>
    </ERPLayout>
  );
}
