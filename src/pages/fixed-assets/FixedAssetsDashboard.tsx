import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Factory, Box, TrendingDown, DollarSign } from "lucide-react";
import { format } from "date-fns";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

const CATEGORY_LABELS: Record<string, string> = {
  office_assets: "Office Assets",
  production_machinery: "Production Machinery",
  molds_dies: "Molds & Dies",
  machine_spare_parts: "Machine Spare Parts",
};

const CATEGORY_COLORS: Record<string, string> = {
  office_assets: "#8b5cf6",
  production_machinery: "#3b82f6",
  molds_dies: "#10b981",
  machine_spare_parts: "#f59e0b",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  under_maintenance: "Under Maintenance",
  disposed: "Disposed",
  written_off: "Written Off",
  sold: "Sold",
};

export default function FixedAssetsDashboard() {
  const [activeTab, setActiveTab] = useState("overview");

  // Fetch all assets
  const { data: assets = [] } = useQuery({
    queryKey: ["fixed-assets-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fixed_assets")
        .select("*, production_departments(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Calculate metrics
  const activeAssets = assets.filter((a) => a.status === "active");
  const totalPurchaseValue = assets.reduce((sum, a) => sum + (Number(a.purchase_price) || 0), 0);
  const totalCurrentValue = assets.reduce((sum, a) => sum + (Number(a.current_value) || 0), 0);
  const depreciation = totalPurchaseValue - totalCurrentValue;

  // Category distribution for pie chart
  const categoryData = Object.entries(
    assets.reduce((acc, asset) => {
      const cat = asset.category as string;
      if (!acc[cat]) acc[cat] = { count: 0, value: 0 };
      acc[cat].count += 1;
      acc[cat].value += Number(asset.current_value) || 0;
      return acc;
    }, {} as Record<string, { count: number; value: number }>)
  ).map(([key, val]) => ({
    name: CATEGORY_LABELS[key] || key,
    count: val.count,
    value: val.value,
    color: CATEGORY_COLORS[key] || "#94a3b8",
  }));

  // Status distribution
  const statusData = Object.entries(
    assets.reduce((acc, asset) => {
      const status = asset.status as string;
      if (!acc[status]) acc[status] = 0;
      acc[status] += 1;
      return acc;
    }, {} as Record<string, number>)
  ).map(([key, count]) => ({
    name: STATUS_LABELS[key] || key,
    count,
  }));

  // Recent valuations
  const { data: recentValuations = [] } = useQuery({
    queryKey: ["recent-valuations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("asset_valuations")
        .select("*, fixed_assets(asset_code, name)")
        .order("valuation_date", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
  });

  return (
    <ERPLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Fixed Assets Dashboard</h1>
          <p className="text-muted-foreground">Overview of all company fixed assets</p>
        </div>

        {/* Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <Box className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Assets</p>
                  <p className="text-2xl font-bold">{assets.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/10">
                  <Factory className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Active Assets</p>
                  <p className="text-2xl font-bold">{activeAssets.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-violet-500/10">
                  <DollarSign className="h-5 w-5 text-violet-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Current Value</p>
                  <p className="text-2xl font-bold">₹{totalCurrentValue.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10">
                  <TrendingDown className="h-5 w-5 text-amber-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Depreciation</p>
                  <p className="text-2xl font-bold">₹{depreciation.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="valuations">Recent Valuations</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Category Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Assets by Category</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={categoryData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          dataKey="count"
                          nameKey="name"
                          label={({ name, count }) => `${name}: ${count}`}
                        >
                          {categoryData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Status Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Assets by Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={statusData} layout="vertical">
                        <XAxis type="number" />
                        <YAxis type="category" dataKey="name" width={120} />
                        <Tooltip />
                        <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Value by Category */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Current Value by Category</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={categoryData}>
                      <XAxis dataKey="name" />
                      <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} />
                      <Tooltip formatter={(v: number) => `₹${v.toLocaleString()}`} />
                      <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]}>
                        {categoryData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="valuations">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent Valuations</CardTitle>
              </CardHeader>
              <CardContent>
                {recentValuations.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No valuations recorded yet</p>
                ) : (
                  <div className="space-y-3">
                    {recentValuations.map((val: any) => (
                      <div
                        key={val.id}
                        className="flex items-center justify-between p-3 rounded-lg border bg-muted/30"
                      >
                        <div>
                          <p className="font-medium">
                            {val.fixed_assets?.asset_code} - {val.fixed_assets?.name}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {format(new Date(val.valuation_date), "dd MMM yyyy")}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-muted-foreground line-through">
                            ₹{Number(val.previous_value || 0).toLocaleString()}
                          </p>
                          <p className="font-semibold text-primary">
                            ₹{Number(val.new_value).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </ERPLayout>
  );
}
