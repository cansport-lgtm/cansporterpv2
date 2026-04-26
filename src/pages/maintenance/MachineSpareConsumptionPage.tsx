import { useState, useEffect } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Search, Cog, Package, IndianRupee, Calendar } from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface MachineConsumption {
  id: string;
  machine_code: string;
  machine_name: string;
  total_issues: number;
  total_quantity: number;
  total_cost: number;
  spare_parts: SparePartDetail[];
}

interface SparePartDetail {
  spare_part_name: string;
  spare_part_code: string;
  quantity: number;
  cost: number;
  issue_date: string;
}

interface Machine {
  id: string;
  code: string;
  name: string;
}

export default function MachineSpareConsumptionPage() {
  const [machineConsumption, setMachineConsumption] = useState<MachineConsumption[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedMachine, setSelectedMachine] = useState<string>("__all__");
  const [dateRange, setDateRange] = useState<string>("this_month");

  useEffect(() => {
    fetchData();
  }, [dateRange, selectedMachine]);

  const getDateRange = () => {
    const today = new Date();
    switch (dateRange) {
      case "this_month":
        return {
          start: format(startOfMonth(today), "yyyy-MM-dd"),
          end: format(endOfMonth(today), "yyyy-MM-dd"),
        };
      case "last_month":
        const lastMonth = subMonths(today, 1);
        return {
          start: format(startOfMonth(lastMonth), "yyyy-MM-dd"),
          end: format(endOfMonth(lastMonth), "yyyy-MM-dd"),
        };
      case "last_3_months":
        return {
          start: format(startOfMonth(subMonths(today, 2)), "yyyy-MM-dd"),
          end: format(endOfMonth(today), "yyyy-MM-dd"),
        };
      case "last_6_months":
        return {
          start: format(startOfMonth(subMonths(today, 5)), "yyyy-MM-dd"),
          end: format(endOfMonth(today), "yyyy-MM-dd"),
        };
      case "all":
      default:
        return { start: null, end: null };
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch machines list
      const { data: machinesData } = await supabase
        .from("machines")
        .select("id, code, name")
        .eq("is_active", true)
        .order("name");
      if (machinesData) setMachines(machinesData);

      // Build query for spare part issues
      let query = supabase
        .from("spare_part_issues")
        .select(`
          id,
          issue_date,
          quantity_issued,
          total_cost,
          machine_id,
          machines(id, code, name),
          spare_parts(code, name)
        `)
        .not("machine_id", "is", null)
        .order("issue_date", { ascending: false });

      // Apply date filter
      const { start, end } = getDateRange();
      if (start && end) {
        query = query.gte("issue_date", start).lte("issue_date", end);
      }

      // Apply machine filter
      if (selectedMachine && selectedMachine !== "__all__") {
        query = query.eq("machine_id", selectedMachine);
      }

      const { data: issuesData, error } = await query;
      if (error) throw error;

      // Group by machine
      const machineMap: Record<string, MachineConsumption> = {};

      issuesData?.forEach((issue: any) => {
        if (!issue.machines) return;

        const machineId = issue.machine_id;
        if (!machineMap[machineId]) {
          machineMap[machineId] = {
            id: machineId,
            machine_code: issue.machines.code,
            machine_name: issue.machines.name,
            total_issues: 0,
            total_quantity: 0,
            total_cost: 0,
            spare_parts: [],
          };
        }

        machineMap[machineId].total_issues += 1;
        machineMap[machineId].total_quantity += issue.quantity_issued;
        machineMap[machineId].total_cost += issue.total_cost || 0;
        machineMap[machineId].spare_parts.push({
          spare_part_name: issue.spare_parts?.name || "-",
          spare_part_code: issue.spare_parts?.code || "-",
          quantity: issue.quantity_issued,
          cost: issue.total_cost || 0,
          issue_date: issue.issue_date,
        });
      });

      // Sort by total cost descending
      const sortedConsumption = Object.values(machineMap).sort(
        (a, b) => b.total_cost - a.total_cost
      );

      setMachineConsumption(sortedConsumption);
    } catch (error) {
      console.error("Error fetching data:", error);
      toast.error("Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  const filteredData = machineConsumption.filter(
    (m) =>
      m.machine_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.machine_code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Calculate totals
  const totalMachines = filteredData.length;
  const totalIssues = filteredData.reduce((sum, m) => sum + m.total_issues, 0);
  const totalQuantity = filteredData.reduce((sum, m) => sum + m.total_quantity, 0);
  const totalCost = filteredData.reduce((sum, m) => sum + m.total_cost, 0);

  // Chart data (top 10 machines by cost)
  const chartData = filteredData.slice(0, 10).map((m) => ({
    name: m.machine_code,
    cost: m.total_cost,
    fullName: m.machine_name,
  }));

  const COLORS = [
    "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
    "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6", "#8b5cf6",
  ];

  const columns = [
    {
      key: "machine_code",
      header: "Machine Code",
      className: "font-medium",
    },
    {
      key: "machine_name",
      header: "Machine Name",
    },
    {
      key: "total_issues",
      header: "Issues",
      className: "text-center",
      render: (row: MachineConsumption) => (
        <span className="bg-muted px-2 py-1 rounded text-sm font-medium">
          {row.total_issues}
        </span>
      ),
    },
    {
      key: "total_quantity",
      header: "Total Qty",
      className: "text-center",
      render: (row: MachineConsumption) => row.total_quantity,
    },
    {
      key: "total_cost",
      header: "Total Cost",
      className: "text-right",
      render: (row: MachineConsumption) => (
        <span className="font-semibold text-amber-600">
          Rs. {row.total_cost.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
        </span>
      ),
    },
  ];

  const expandedRowRender = (item: MachineConsumption) => (
    <div className="p-4 bg-muted/20">
      <h4 className="font-semibold text-sm mb-3">Spare Parts Used</h4>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 px-3">Date</th>
              <th className="text-left py-2 px-3">Part Code</th>
              <th className="text-left py-2 px-3">Part Name</th>
              <th className="text-center py-2 px-3">Qty</th>
              <th className="text-right py-2 px-3">Cost</th>
            </tr>
          </thead>
          <tbody>
            {item.spare_parts.map((part, idx) => (
              <tr key={idx} className="border-b border-muted">
                <td className="py-2 px-3">{format(new Date(part.issue_date), "dd MMM yyyy")}</td>
                <td className="py-2 px-3 text-muted-foreground">{part.spare_part_code}</td>
                <td className="py-2 px-3">{part.spare_part_name}</td>
                <td className="py-2 px-3 text-center">{part.quantity}</td>
                <td className="py-2 px-3 text-right font-medium">
                  Rs. {part.cost.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <ERPLayout>
      <PageHeader
        title="Machine-wise Spare Parts Consumption"
        description="View spare parts consumption by machine"
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Cog className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalMachines}</p>
                <p className="text-xs text-muted-foreground">Machines</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Package className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalIssues}</p>
                <p className="text-xs text-muted-foreground">Total Issues</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                <Calendar className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalQuantity}</p>
                <p className="text-xs text-muted-foreground">Total Quantity</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <IndianRupee className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  Rs. {totalCost.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </p>
                <p className="text-xs text-muted-foreground">Total Cost</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Machines Chart */}
      {chartData.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Top 10 Machines by Spare Parts Cost</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    type="number"
                    tickFormatter={(value) => `Rs.${(value / 1000).toFixed(0)}k`}
                  />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={80}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    formatter={(value: number) => [
                      `Rs. ${value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
                      "Cost",
                    ]}
                    labelFormatter={(label, payload) =>
                      payload?.[0]?.payload?.fullName || label
                    }
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
                    {chartData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search machines..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={selectedMachine} onValueChange={setSelectedMachine}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Machines" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Machines</SelectItem>
            {machines.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.code} - {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={dateRange} onValueChange={setDateRange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select period" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="this_month">This Month</SelectItem>
            <SelectItem value="last_month">Last Month</SelectItem>
            <SelectItem value="last_3_months">Last 3 Months</SelectItem>
            <SelectItem value="last_6_months">Last 6 Months</SelectItem>
            <SelectItem value="all">All Time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Data Table */}
      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : (
        <DataTable
          columns={columns}
          data={filteredData}
          emptyMessage="No spare parts consumption data found"
          expandedRowRender={expandedRowRender}
        />
      )}
    </ERPLayout>
  );
}
