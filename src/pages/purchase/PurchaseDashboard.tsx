import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Package, ShoppingCart, Truck, Clock, CheckCircle, AlertTriangle } from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import type { Database } from "@/integrations/supabase/types";

type PurchaseCategory = Database["public"]["Enums"]["purchase_category"];

const CATEGORIES: { value: PurchaseCategory; label: string; color: string }[] = [
  { value: "raw_material", label: "Raw Material", color: "#3b82f6" },
  { value: "office_supplies", label: "Office Supplies", color: "#22c55e" },
  { value: "general_supplies", label: "General Supplies", color: "#f59e0b" },
  { value: "spare_maintenance", label: "Spare & Maintenance", color: "#8b5cf6" },
];

export default function PurchaseDashboard() {
  const { hasPurchaseCategoryPermission } = useAuth();

  // Check which categories user can access
  const accessibleCategories = CATEGORIES.filter(cat => 
    hasPurchaseCategoryPermission(cat.value, 'view')
  );

  // Fetch PO summary
  const { data: poSummary } = useQuery({
    queryKey: ['purchase-order-summary'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('id, status, category, total_amount, order_date');
      if (error) throw error;
      return data;
    },
  });

  // Fetch GRN summary
  const { data: grnSummary } = useQuery({
    queryKey: ['grn-summary'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('goods_receipt_notes')
        .select('id, status, total_amount, receipt_date, purchase_orders(category)');
      if (error) throw error;
      return data;
    },
  });

  // Fetch suppliers count
  const { data: suppliersCount } = useQuery({
    queryKey: ['suppliers-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('suppliers')
        .select('id', { count: 'exact' })
        .eq('is_active', true);
      if (error) throw error;
      return count || 0;
    },
  });

  // Filter data by accessible categories
  const filteredPOs = poSummary?.filter(po => 
    accessibleCategories.some(cat => cat.value === po.category)
  ) || [];

  const filteredGRNs = grnSummary?.filter(grn => 
    accessibleCategories.some(cat => cat.value === grn.purchase_orders?.category)
  ) || [];

  // Calculate metrics
  const totalPOs = filteredPOs.length;
  const pendingPOs = filteredPOs.filter(po => ['draft', 'pending_approval'].includes(po.status)).length;
  const approvedPOs = filteredPOs.filter(po => po.status === 'approved').length;
  const totalGRNs = filteredGRNs.length;

  const thisMonthStart = startOfMonth(new Date());
  const thisMonthEnd = endOfMonth(new Date());
  
  const thisMonthPOs = filteredPOs.filter(po => {
    const date = new Date(po.order_date);
    return date >= thisMonthStart && date <= thisMonthEnd;
  });

  const thisMonthValue = thisMonthPOs.reduce((sum, po) => sum + (po.total_amount || 0), 0);

  // Category-wise breakdown
  const categoryData = accessibleCategories.map(cat => {
    const catPOs = filteredPOs.filter(po => po.category === cat.value);
    return {
      name: cat.label,
      value: catPOs.reduce((sum, po) => sum + (po.total_amount || 0), 0),
      count: catPOs.length,
      color: cat.color,
    };
  });

  // Status breakdown
  const statusData = [
    { name: 'Draft', value: filteredPOs.filter(po => po.status === 'draft').length, color: '#64748b' },
    { name: 'Pending', value: filteredPOs.filter(po => po.status === 'pending_approval').length, color: '#f59e0b' },
    { name: 'Approved', value: filteredPOs.filter(po => po.status === 'approved').length, color: '#3b82f6' },
    { name: 'Received', value: filteredPOs.filter(po => po.status === 'received').length, color: '#22c55e' },
  ].filter(d => d.value > 0);

  // Recent POs
  const recentPOs = [...filteredPOs]
    .sort((a, b) => new Date(b.order_date).getTime() - new Date(a.order_date).getTime())
    .slice(0, 5);

  return (
    <ERPLayout>
      <PageHeader
        title="Purchase Dashboard"
        description="Overview of procurement activities"
      />

      {/* Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
        <MetricCard
          title="Total Purchase Orders"
          value={totalPOs}
          icon={ShoppingCart}
        />
        <MetricCard
          title="Pending Approval"
          value={pendingPOs}
          icon={Clock}
          iconColor="text-amber-500"
        />
        <MetricCard
          title="Approved POs"
          value={approvedPOs}
          icon={CheckCircle}
          iconColor="text-green-500"
        />
        <MetricCard
          title="This Month Value"
          value={`Rs. ${(thisMonthValue / 1000).toFixed(1)}K`}
          icon={Package}
          iconColor="text-blue-500"
          description={`${thisMonthPOs.length} orders`}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 mb-6">
        {/* Category Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Category-wise Purchase Value</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={categoryData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tickFormatter={(val) => `Rs. ${(val / 1000).toFixed(0)}K`} />
                <YAxis type="category" dataKey="name" width={120} />
                <Tooltip formatter={(val: number) => `Rs. ${val.toLocaleString()}`} />
                <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]}>
                  {categoryData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>PO Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                  outerRadius={100}
                  dataKey="value"
                >
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Active Suppliers */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" />
              Suppliers Overview
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center p-3 bg-muted rounded-lg">
                <span>Active Suppliers</span>
                <Badge variant="default" className="text-lg">{suppliersCount}</Badge>
              </div>
              <div className="text-sm text-muted-foreground">
                Manage supplier relationships and track performance across purchase categories.
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Purchase Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentPOs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No purchase orders yet</p>
              ) : (
                recentPOs.map(po => (
                  <div key={po.id} className="flex justify-between items-center p-2 border rounded">
                    <div>
                      <span className="font-medium text-sm">
                        {CATEGORIES.find(c => c.value === po.category)?.label}
                      </span>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(po.order_date), 'dd MMM yyyy')}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="font-medium">Rs. {po.total_amount?.toLocaleString()}</span>
                      <Badge variant="outline" className="ml-2 text-xs">{po.status}</Badge>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}