import { useState, useEffect, useMemo } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { 
  Package, 
  PackagePlus, 
  PackageMinus, 
  TrendingUp, 
  TrendingDown,
  Warehouse,
  AlertTriangle
} from "lucide-react";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Legend,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell
} from "recharts";
import { format, startOfMonth, endOfMonth, subMonths, eachMonthOfInterval } from "date-fns";

interface SparePart {
  id: string;
  code: string;
  name: string;
  category: string | null;
  current_stock: number;
  minimum_stock: number;
  unit_cost: number | null;
  created_at: string;
}

interface SparePartIssue {
  id: string;
  issue_date: string;
  spare_part_id: string;
  quantity_issued: number;
  total_cost: number | null;
  spare_parts?: { name: string; code: string; category: string | null };
}

const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];

export default function SparePartsDashboard() {
  const [spareParts, setSpareParts] = useState<SparePart[]>([]);
  const [issues, setIssues] = useState<SparePartIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear().toString());

  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 5 }, (_, i) => (currentYear - i).toString());
  }, []);

  useEffect(() => {
    fetchData();
  }, [yearFilter]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const yearStart = `${yearFilter}-01-01`;
      const yearEnd = `${yearFilter}-12-31`;

      // Fetch spare parts
      const { data: partsData, error: partsError } = await supabase
        .from("spare_parts")
        .select("*")
        .eq("is_active", true)
        .order("created_at");

      if (partsError) throw partsError;
      if (partsData) setSpareParts(partsData);

      // Fetch issues for the selected year
      const { data: issuesData, error: issuesError } = await supabase
        .from("spare_part_issues")
        .select(`
          *,
          spare_parts(name, code, category)
        `)
        .gte("issue_date", yearStart)
        .lte("issue_date", yearEnd)
        .order("issue_date");

      if (issuesError) throw issuesError;
      if (issuesData) setIssues(issuesData);

    } catch (error) {
      console.error("Error fetching data:", error);
      toast.error("Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  };

  // Calculate summary metrics
  const summaryMetrics = useMemo(() => {
    const totalParts = spareParts.length;
    const totalStockValue = spareParts.reduce((sum, p) => sum + (p.current_stock * (p.unit_cost || 0)), 0);
    const totalStockQty = spareParts.reduce((sum, p) => sum + p.current_stock, 0);
    const lowStockCount = spareParts.filter(p => p.current_stock <= p.minimum_stock).length;
    const outOfStockCount = spareParts.filter(p => p.current_stock === 0).length;
    
    // This month's data
    const currentMonth = new Date();
    const monthStart = format(startOfMonth(currentMonth), "yyyy-MM-dd");
    const monthEnd = format(endOfMonth(currentMonth), "yyyy-MM-dd");
    
    const thisMonthIssues = issues.filter(i => i.issue_date >= monthStart && i.issue_date <= monthEnd);
    const thisMonthUsageQty = thisMonthIssues.reduce((sum, i) => sum + i.quantity_issued, 0);
    const thisMonthUsageValue = thisMonthIssues.reduce((sum, i) => sum + (i.total_cost || 0), 0);
    
    // Last month's data for comparison
    const lastMonth = subMonths(currentMonth, 1);
    const lastMonthStart = format(startOfMonth(lastMonth), "yyyy-MM-dd");
    const lastMonthEnd = format(endOfMonth(lastMonth), "yyyy-MM-dd");
    
    const lastMonthIssues = issues.filter(i => i.issue_date >= lastMonthStart && i.issue_date <= lastMonthEnd);
    const lastMonthUsageValue = lastMonthIssues.reduce((sum, i) => sum + (i.total_cost || 0), 0);
    
    const usageTrend = lastMonthUsageValue > 0 
      ? ((thisMonthUsageValue - lastMonthUsageValue) / lastMonthUsageValue) * 100 
      : 0;

    // Calculate additions this month (parts created this month)
    const thisMonthAdditions = spareParts.filter(p => {
      const createdDate = p.created_at.split("T")[0];
      return createdDate >= monthStart && createdDate <= monthEnd;
    });
    const thisMonthAdditionCount = thisMonthAdditions.length;

    return {
      totalParts,
      totalStockValue,
      totalStockQty,
      lowStockCount,
      outOfStockCount,
      thisMonthUsageQty,
      thisMonthUsageValue,
      usageTrend,
      thisMonthAdditionCount
    };
  }, [spareParts, issues]);

  // Monthly trend data
  const monthlyData = useMemo(() => {
    const months = eachMonthOfInterval({
      start: new Date(parseInt(yearFilter), 0, 1),
      end: new Date(parseInt(yearFilter), 11, 31)
    });

    return months.map(month => {
      const monthStart = format(startOfMonth(month), "yyyy-MM-dd");
      const monthEnd = format(endOfMonth(month), "yyyy-MM-dd");
      const monthLabel = format(month, "MMM");

      // Additions (parts created in this month)
      const addedParts = spareParts.filter(p => {
        const createdDate = p.created_at.split("T")[0];
        return createdDate >= monthStart && createdDate <= monthEnd;
      });
      const additions = addedParts.length;
      const additionValue = addedParts.reduce((sum, p) => sum + (p.current_stock * (p.unit_cost || 0)), 0);

      // Usage (issues in this month)
      const monthIssues = issues.filter(i => i.issue_date >= monthStart && i.issue_date <= monthEnd);
      const usage = monthIssues.reduce((sum, i) => sum + i.quantity_issued, 0);
      const usageValue = monthIssues.reduce((sum, i) => sum + (i.total_cost || 0), 0);

      return {
        month: monthLabel,
        additions,
        additionValue,
        usage,
        usageValue
      };
    });
  }, [spareParts, issues, yearFilter]);

  // Category-wise usage data
  const categoryUsageData = useMemo(() => {
    const categoryMap = new Map<string, { value: number; count: number }>();
    
    issues.forEach(issue => {
      const category = issue.spare_parts?.category || "Uncategorized";
      const existing = categoryMap.get(category) || { value: 0, count: 0 };
      categoryMap.set(category, {
        value: existing.value + (issue.total_cost || 0),
        count: existing.count + issue.quantity_issued
      });
    });

    return Array.from(categoryMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [issues]);

  // Top consumed parts
  const topConsumedParts = useMemo(() => {
    const partMap = new Map<string, { name: string; code: string; qty: number; value: number }>();
    
    issues.forEach(issue => {
      const key = issue.spare_part_id;
      const existing = partMap.get(key);
      if (existing) {
        existing.qty += issue.quantity_issued;
        existing.value += (issue.total_cost || 0);
      } else {
        partMap.set(key, {
          name: issue.spare_parts?.name || "Unknown",
          code: issue.spare_parts?.code || "",
          qty: issue.quantity_issued,
          value: issue.total_cost || 0
        });
      }
    });

    return Array.from(partMap.values())
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [issues]);

  // Low stock items
  const lowStockItems = useMemo(() => {
    return spareParts
      .filter(p => p.current_stock <= p.minimum_stock)
      .sort((a, b) => a.current_stock - b.current_stock)
      .slice(0, 10);
  }, [spareParts]);

  if (loading) {
    return (
      <ERPLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Loading dashboard...</div>
        </div>
      </ERPLayout>
    );
  }

  return (
    <ERPLayout>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <PageHeader
          title="Spare Parts Dashboard"
          description="Monthly addition and usage analytics"
        />
        <Select value={yearFilter} onValueChange={setYearFilter}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            {years.map(year => (
              <SelectItem key={year} value={year}>{year}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Package className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Parts</p>
                <p className="text-2xl font-bold">{summaryMetrics.totalParts}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Package className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Stock Qty</p>
                <p className="text-2xl font-bold">{summaryMetrics.totalStockQty.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-emerald-500/10 to-green-500/5 border-emerald-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/20">
                <Warehouse className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Current Stock Value</p>
                <p className="text-2xl font-bold text-emerald-600">
                  ₹{summaryMetrics.totalStockValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <PackageMinus className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">This Month Usage</p>
                <p className="text-2xl font-bold">₹{(summaryMetrics.thisMonthUsageValue / 1000).toFixed(1)}K</p>
                {summaryMetrics.usageTrend !== 0 && (
                  <div className={`flex items-center gap-1 text-xs ${summaryMetrics.usageTrend > 0 ? "text-red-500" : "text-green-500"}`}>
                    {summaryMetrics.usageTrend > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {Math.abs(summaryMetrics.usageTrend).toFixed(1)}% vs last month
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10">
                <AlertTriangle className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Low Stock Alert</p>
                <p className="text-2xl font-bold">{summaryMetrics.lowStockCount}</p>
                <p className="text-xs text-muted-foreground">{summaryMetrics.outOfStockCount} out of stock</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Monthly Usage Trend */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <PackageMinus className="h-4 w-4 text-amber-500" />
              Monthly Usage (Quantity & Value)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: "hsl(var(--card))", 
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px"
                    }}
                    formatter={(value: number, name: string) => {
                      if (name === "usageValue") return [`₹${value.toFixed(0)}`, "Value"];
                      return [value, "Quantity"];
                    }}
                  />
                  <Legend />
                  <Bar yAxisId="left" dataKey="usage" name="Quantity" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="right" dataKey="usageValue" name="Value (₹)" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Monthly Additions */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <PackagePlus className="h-4 w-4 text-green-500" />
              Monthly Additions (New Parts Added)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlyData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: "hsl(var(--card))", 
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px"
                    }}
                  />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="additions" 
                    name="New Parts Added" 
                    stroke="hsl(var(--chart-3))" 
                    strokeWidth={2}
                    dot={{ fill: "hsl(var(--chart-3))" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Category-wise Usage */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Usage by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryUsageData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                    labelLine={false}
                  >
                    {categoryUsageData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: number) => [`₹${value.toFixed(2)}`, "Value"]}
                    contentStyle={{ 
                      backgroundColor: "hsl(var(--card))", 
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px"
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Top Consumed Parts */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Top 10 Consumed Parts (by Value)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[250px] overflow-y-auto">
              {topConsumedParts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No consumption data for {yearFilter}</p>
              ) : (
                topConsumedParts.map((part, index) => (
                  <div key={index} className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-medium text-muted-foreground w-5">{index + 1}</span>
                      <div>
                        <p className="text-sm font-medium">{part.name}</p>
                        <p className="text-xs text-muted-foreground">{part.code}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">₹{part.value.toFixed(2)}</p>
                      <p className="text-xs text-muted-foreground">{part.qty} pcs</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Low Stock Alert Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Low Stock Items (Reorder Required)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {lowStockItems.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">All items are above minimum stock level</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium">Code</th>
                    <th className="text-left py-2 px-3 font-medium">Name</th>
                    <th className="text-left py-2 px-3 font-medium">Category</th>
                    <th className="text-right py-2 px-3 font-medium">Current</th>
                    <th className="text-right py-2 px-3 font-medium">Minimum</th>
                    <th className="text-right py-2 px-3 font-medium">Shortage</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStockItems.map((item) => (
                    <tr key={item.id} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="py-2 px-3 font-mono text-xs">{item.code}</td>
                      <td className="py-2 px-3">{item.name}</td>
                      <td className="py-2 px-3 text-muted-foreground">{item.category || "-"}</td>
                      <td className={`py-2 px-3 text-right font-medium ${item.current_stock === 0 ? "text-red-500" : "text-amber-500"}`}>
                        {item.current_stock}
                      </td>
                      <td className="py-2 px-3 text-right">{item.minimum_stock}</td>
                      <td className="py-2 px-3 text-right text-red-500 font-medium">
                        {item.minimum_stock - item.current_stock}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </ERPLayout>
  );
}
