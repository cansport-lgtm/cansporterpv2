import { useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { format, endOfMonth, parseISO, eachDayOfInterval, startOfMonth, subDays } from "date-fns";
import {
  MapPin,
  Calendar as CalendarIcon,
  Plus,
  AlertCircle,
  ShoppingCart,
  Eye,
  Trash2,
  UserX,
} from "lucide-react";
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
  Legend,
} from "recharts";


const VISIT_TYPES = ["regular", "follow_up", "complaint", "new_business", "collection"];
const VISIT_TYPE_LABELS: Record<string, string> = {
  regular: "Regular Visit",
  follow_up: "Follow-up",
  complaint: "Complaint Resolution",
  new_business: "New Business",
  collection: "Collection",
};

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

interface CustomerVisit {
  id: string;
  visit_number: string;
  visit_date: string;
  customer_id: string;
  salesman_id: string | null;
  visit_type: string;
  purpose: string | null;
  outcome: string | null;
  follow_up_required: boolean;
  follow_up_date: string | null;
  next_action: string | null;
  order_taken: boolean;
  order_value: number | null;
  feedback: string | null;
  status: string;
  created_at: string;
  customers?: { id: string; code: string; name: string };
  app_users?: { id: string; full_name: string };
}

export default function CustomerVisitDashboard() {
  const { user, roles } = useAuth();
  const queryClient = useQueryClient();
  const isSuperAdmin = roles.some((r) => r.role === "super_admin");
  const today = new Date();
  const [filterMode, setFilterMode] = useState<"date" | "month">("month");
  const [selectedMonth, setSelectedMonth] = useState(format(today, "yyyy-MM"));
  const [filterDate, setFilterDate] = useState(format(today, "yyyy-MM-dd"));
  const [selectedSalesman, setSelectedSalesman] = useState<string>("all");
  const [chartCustomer, setChartCustomer] = useState<string>("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedVisit, setSelectedVisit] = useState<CustomerVisit | null>(null);

  const handleViewVisit = (visit: CustomerVisit) => {
    setSelectedVisit(visit);
    setViewDialogOpen(true);
  };

  // Form state
  const [formData, setFormData] = useState({
    visit_date: format(today, "yyyy-MM-dd"),
    customer_id: "",
    visit_type: "regular",
    purpose: "",
    outcome: "",
    follow_up_required: false,
    follow_up_date: "",
    next_action: "",
    order_taken: false,
    order_value: "",
    feedback: "",
  });

  const monthStart = `${selectedMonth}-01`;
  const monthEnd = format(endOfMonth(parseISO(`${selectedMonth}-01`)), "yyyy-MM-dd");
  
  // Calculate date range based on filter mode
  const dateRangeStart = filterMode === "date" ? filterDate : monthStart;
  const dateRangeEnd = filterMode === "date" ? filterDate : monthEnd;

  // Fetch customers (private label only)
  const { data: customers } = useQuery({
    queryKey: ["pl-customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, code, name")
        .eq("is_active", true)
        .eq("sales_segment", "private_label")
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch salesmen
  const { data: salesmen } = useQuery({
    queryKey: ["salesmen"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_users")
        .select("id, full_name")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch visits with filters
  const { data: visits, isLoading } = useQuery({
    queryKey: ["customer-visits", filterMode, filterDate, monthStart, monthEnd, selectedSalesman],
    queryFn: async () => {
      let query = supabase
        .from("customer_visits")
        .select(
          `
          *,
          customers:customer_id (id, code, name),
          app_users:salesman_id (id, full_name)
        `
        )
        .gte("visit_date", dateRangeStart)
        .lte("visit_date", dateRangeEnd)
        .order("visit_date", { ascending: false });

      if (selectedSalesman !== "all") {
        query = query.eq("salesman_id", selectedSalesman);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data as unknown as CustomerVisit[]) || [];
    },
  });

  // Stats calculations
  const stats = {
    totalVisits: visits?.length || 0,
    ordersGenerated: visits?.filter((v) => v.order_taken).length || 0,
    followUpsRequired: visits?.filter((v) => v.follow_up_required).length || 0,
    todayVisits: visits?.filter((v) => v.visit_date === format(today, "yyyy-MM-dd")).length || 0,
  };

  // Fetch monthly date-wise visits for chart (with customer filter)
  const { data: monthlyVisitsData } = useQuery({
    queryKey: ["monthly-visits-chart", selectedMonth, chartCustomer],
    queryFn: async () => {
      let query = supabase
        .from("customer_visits")
        .select("visit_date, order_taken")
        .gte("visit_date", monthStart)
        .lte("visit_date", monthEnd);

      if (chartCustomer !== "all") {
        query = query.eq("customer_id", chartCustomer);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  // Process monthly chart data
  const monthlyChartData = (() => {
    const monthDate = parseISO(`${selectedMonth}-01`);
    const days = eachDayOfInterval({
      start: startOfMonth(monthDate),
      end: endOfMonth(monthDate),
    });

    return days.map((day) => {
      const dateStr = format(day, "yyyy-MM-dd");
      const dayVisits = monthlyVisitsData?.filter((v) => v.visit_date === dateStr) || [];
      return {
        date: format(day, "dd"),
        visits: dayVisits.length,
        orders: dayVisits.filter((v) => v.order_taken).length,
      };
    });
  })();

  // Fetch customers not visited in last 10 days
  const tenDaysAgo = format(subDays(today, 10), "yyyy-MM-dd");
  const { data: notVisitedCustomers } = useQuery({
    queryKey: ["customers-not-visited", tenDaysAgo],
    queryFn: async () => {
      // Get all private label customers
      const { data: allCustomers, error: custError } = await supabase
        .from("customers")
        .select("id, code, name, area")
        .eq("is_active", true)
        .eq("sales_segment", "private_label")
        .order("name");
      if (custError) throw custError;

      // Get customers with recent visits (last 10 days)
      const { data: recentVisits, error: visitError } = await supabase
        .from("customer_visits")
        .select("customer_id, visit_date")
        .gte("visit_date", tenDaysAgo)
        .order("visit_date", { ascending: false });
      if (visitError) throw visitError;

      // Get last visit date for all customers
      const { data: lastVisits, error: lastError } = await supabase
        .from("customer_visits")
        .select("customer_id, visit_date")
        .order("visit_date", { ascending: false });
      if (lastError) throw lastError;

      const recentlyVisitedIds = new Set(recentVisits?.map((v) => v.customer_id) || []);
      const lastVisitMap = new Map<string, string>();
      lastVisits?.forEach((v) => {
        if (!lastVisitMap.has(v.customer_id)) {
          lastVisitMap.set(v.customer_id, v.visit_date);
        }
      });

      return (
        allCustomers
          ?.filter((c) => !recentlyVisitedIds.has(c.id))
          .map((c) => ({
            ...c,
            lastVisitDate: lastVisitMap.get(c.id) || null,
          })) || []
      );
    },
  });

  // Chart data - visits by type
  const visitsByType = VISIT_TYPES.map((type) => ({
    name: VISIT_TYPE_LABELS[type],
    value: visits?.filter((v) => v.visit_type === type).length || 0,
  })).filter((d) => d.value > 0);

  // Chart data - visits by salesman
  const visitsBySalesman =
    salesmen
      ?.map((s) => ({
        name: s.full_name,
        visits: visits?.filter((v) => v.salesman_id === s.id).length || 0,
        orders: visits?.filter((v) => v.salesman_id === s.id && v.order_taken).length || 0,
      }))
      .filter((d) => d.visits > 0)
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 10) || [];

  // Create visit mutation
  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { error } = await supabase.from("customer_visits").insert([
        {
          visit_number: "", // Auto-generated by trigger
          visit_date: data.visit_date,
          customer_id: data.customer_id,
          salesman_id: user?.id || null,
          visit_type: data.visit_type,
          purpose: data.purpose || null,
          outcome: data.outcome || null,
          follow_up_required: data.follow_up_required,
          follow_up_date: data.follow_up_date || null,
          next_action: data.next_action || null,
          order_taken: data.order_taken,
          order_value: data.order_value ? parseFloat(data.order_value) : null,
          feedback: data.feedback || null,
          status: "completed",
        },
      ]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-visits"] });
      toast.success("Visit recorded successfully");
      setIsDialogOpen(false);
      resetForm();
    },
    onError: (error: Error) => {
      toast.error("Failed to record visit: " + error.message);
    },
  });

  // Delete visit mutation (super_admin only)
  const deleteMutation = useMutation({
    mutationFn: async (visitId: string) => {
      const { error } = await supabase
        .from("customer_visits")
        .delete()
        .eq("id", visitId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-visits"] });
      toast.success("Visit deleted successfully");
    },
    onError: (error: Error) => {
      toast.error("Failed to delete visit: " + error.message);
    },
  });

  const handleDeleteVisit = (visitId: string) => {
    if (window.confirm("Are you sure you want to delete this visit record?")) {
      deleteMutation.mutate(visitId);
    }
  };

  const resetForm = () => {
    setFormData({
      visit_date: format(today, "yyyy-MM-dd"),
      customer_id: "",
      visit_type: "regular",
      purpose: "",
      outcome: "",
      follow_up_required: false,
      follow_up_date: "",
      next_action: "",
      order_taken: false,
      order_value: "",
      feedback: "",
    });
  };

  const handleSubmit = () => {
    if (!formData.customer_id) {
      toast.error("Please select a customer");
      return;
    }
    createMutation.mutate(formData);
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Customer Visit Dashboard"
          description="Track and manage salesman customer visits"
          action={{
            label: "Record Visit",
            onClick: () => setIsDialogOpen(true),
            icon: Plus,
          }}
        />

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Select value={filterMode} onValueChange={(v) => setFilterMode(v as "date" | "month")}>
              <SelectTrigger className="h-9 w-[90px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date">Date</SelectItem>
                <SelectItem value="month">Month</SelectItem>
              </SelectContent>
            </Select>
            {filterMode === "date" ? (
              <Input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="h-9 w-auto"
              />
            ) : (
              <Input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="h-9 w-auto"
              />
            )}
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-sm">Salesman:</Label>
            <Select value={selectedSalesman} onValueChange={setSelectedSalesman}>
              <SelectTrigger className="h-9 w-[180px]">
                <SelectValue placeholder="All Salesmen" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Salesmen</SelectItem>
                {salesmen?.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Metric Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Total Visits"
            value={stats.totalVisits}
            icon={MapPin}
            description="This month"
          />
          <MetricCard
            title="Today's Visits"
            value={stats.todayVisits}
            icon={CalendarIcon}
            description="Recorded today"
          />
          <MetricCard
            title="Orders Generated"
            value={stats.ordersGenerated}
            icon={ShoppingCart}
            description="From visits"
          />
          <MetricCard
            title="Follow-ups Required"
            value={stats.followUpsRequired}
            icon={AlertCircle}
            description="Pending action"
          />
        </div>

        {/* Monthly Visits Chart */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <CardTitle className="text-base">Monthly Customer Visits</CardTitle>
              <div className="flex items-center gap-2">
                <Input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="h-8 w-[140px]"
                />
                <Select value={chartCustomer} onValueChange={setChartCustomer}>
                  <SelectTrigger className="h-8 w-[180px]">
                    <SelectValue placeholder="All Customers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Customers</SelectItem>
                    {customers?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.code} - {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              {monthlyChartData.some((d) => d.visits > 0) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyChartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div className="rounded-lg border bg-background p-2 shadow-md">
                            <p className="text-sm font-medium">Day {label}</p>
                            {payload.map((p, i) => (
                              <p key={i} className="text-xs" style={{ color: p.color }}>
                                {p.name}: {p.value}
                              </p>
                            ))}
                          </div>
                        );
                      }}
                    />
                    <Legend />
                    <Bar dataKey="visits" fill="hsl(var(--primary))" name="Visits" />
                    <Bar dataKey="orders" fill="hsl(var(--chart-2))" name="Orders" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No visits recorded for this month
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Charts */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Visits by Type */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Visits by Type</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[280px]">
                {visitsByType.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={visitsByType}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={5}
                        dataKey="value"
                        label={({ name, value }) => `${name}: ${value}`}
                      >
                        {visitsByType.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    No visits recorded
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Visits by Salesman */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Performance by Salesman</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[280px]">
                {visitsBySalesman.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={visitsBySalesman} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="visits" fill="hsl(var(--primary))" name="Visits" />
                      <Bar dataKey="orders" fill="hsl(var(--chart-2))" name="Orders" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    No data available
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Customers Not Visited in Last 10 Days */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <UserX className="h-4 w-4 text-destructive" />
                Customers Not Visited (Last 10 Days)
              </CardTitle>
              <Badge variant="destructive">{notVisitedCustomers?.length || 0}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {notVisitedCustomers && notVisitedCustomers.length > 0 ? (
              <div className="max-h-[300px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Customer Name</TableHead>
                      <TableHead>Area</TableHead>
                      <TableHead>Last Visit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {notVisitedCustomers.map((customer) => (
                      <TableRow key={customer.id}>
                        <TableCell className="font-mono text-xs">{customer.code}</TableCell>
                        <TableCell>{customer.name}</TableCell>
                        <TableCell>{customer.area || "-"}</TableCell>
                        <TableCell>
                          {customer.lastVisitDate ? (
                            <span className="text-muted-foreground">
                              {format(parseISO(customer.lastVisitDate), "dd-MMM-yyyy")}
                            </span>
                          ) : (
                            <span className="text-destructive text-xs">Never visited</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                All customers visited in the last 10 days
              </div>
            )}
          </CardContent>
        </Card>

        {/* Visit List */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Visits</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Visit #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Salesman</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Purpose</TableHead>
                    <TableHead>Order</TableHead>
                    <TableHead>Follow-up</TableHead>
                    <TableHead className="w-[80px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                        Loading...
                      </TableCell>
                    </TableRow>
                  ) : visits && visits.length > 0 ? (
                    visits.slice(0, 20).map((visit) => (
                      <TableRow key={visit.id}>
                        <TableCell className="font-mono text-xs">{visit.visit_number}</TableCell>
                        <TableCell>{format(parseISO(visit.visit_date), "dd-MMM-yyyy")}</TableCell>
                        <TableCell>
                          {visit.customers?.code} - {visit.customers?.name}
                        </TableCell>
                        <TableCell>{visit.app_users?.full_name || "-"}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {VISIT_TYPE_LABELS[visit.visit_type] || visit.visit_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {visit.purpose || "-"}
                        </TableCell>
                        <TableCell>
                          {visit.order_taken ? (
                            <Badge className="bg-green-600 text-white">Yes</Badge>
                          ) : (
                            <Badge variant="secondary">No</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {visit.follow_up_required ? (
                            <Badge variant="destructive">Required</Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleViewVisit(visit)}
                              className="h-8 w-8 p-0"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {isSuperAdmin && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteVisit(visit.id)}
                                className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                disabled={deleteMutation.isPending}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                        No visits found for this period
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Record Visit Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Record Customer Visit</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Visit Date *</Label>
                  <Input
                    type="date"
                    value={formData.visit_date}
                    onChange={(e) => setFormData({ ...formData, visit_date: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Visit Type *</Label>
                  <Select
                    value={formData.visit_type}
                    onValueChange={(v) => setFormData({ ...formData, visit_type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VISIT_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {VISIT_TYPE_LABELS[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Customer *</Label>
                <Select
                  value={formData.customer_id}
                  onValueChange={(v) => setFormData({ ...formData, customer_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.code} - {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Purpose</Label>
                <Textarea
                  value={formData.purpose}
                  onChange={(e) => setFormData({ ...formData, purpose: e.target.value })}
                  placeholder="Purpose of the visit..."
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label>Outcome</Label>
                <Textarea
                  value={formData.outcome}
                  onChange={(e) => setFormData({ ...formData, outcome: e.target.value })}
                  placeholder="Visit outcome..."
                  rows={2}
                />
              </div>

              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={formData.order_taken}
                    onCheckedChange={(v) => setFormData({ ...formData, order_taken: v })}
                  />
                  <Label>Order Taken</Label>
                </div>
                {formData.order_taken && (
                  <div className="flex items-center gap-2">
                    <Label>Value (Rs.)</Label>
                    <Input
                      type="number"
                      value={formData.order_value}
                      onChange={(e) => setFormData({ ...formData, order_value: e.target.value })}
                      className="w-32"
                      placeholder="0"
                    />
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.follow_up_required}
                  onCheckedChange={(v) => setFormData({ ...formData, follow_up_required: v })}
                />
                <Label>Follow-up Required</Label>
              </div>

              {formData.follow_up_required && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Follow-up Date</Label>
                    <Input
                      type="date"
                      value={formData.follow_up_date}
                      onChange={(e) => setFormData({ ...formData, follow_up_date: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Next Action</Label>
                    <Input
                      value={formData.next_action}
                      onChange={(e) => setFormData({ ...formData, next_action: e.target.value })}
                      placeholder="Action required"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>Customer Feedback</Label>
                <Textarea
                  value={formData.feedback}
                  onChange={(e) => setFormData({ ...formData, feedback: e.target.value })}
                  placeholder="Any feedback from customer..."
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={createMutation.isPending}>
                {createMutation.isPending ? "Saving..." : "Save Visit"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* View Visit Dialog */}
        <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Visit Details - {selectedVisit?.visit_number}</DialogTitle>
            </DialogHeader>
            {selectedVisit && (
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground text-xs">Visit Date</Label>
                    <p className="font-medium">{format(parseISO(selectedVisit.visit_date), "dd-MMM-yyyy")}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Visit Type</Label>
                    <Badge variant="outline" className="mt-1">
                      {VISIT_TYPE_LABELS[selectedVisit.visit_type] || selectedVisit.visit_type}
                    </Badge>
                  </div>
                </div>

                <div>
                  <Label className="text-muted-foreground text-xs">Customer</Label>
                  <p className="font-medium">
                    {selectedVisit.customers?.code} - {selectedVisit.customers?.name}
                  </p>
                </div>

                <div>
                  <Label className="text-muted-foreground text-xs">Salesman</Label>
                  <p className="font-medium">{selectedVisit.app_users?.full_name || "-"}</p>
                </div>

                <div>
                  <Label className="text-muted-foreground text-xs">Purpose</Label>
                  <p className="text-sm">{selectedVisit.purpose || "-"}</p>
                </div>

                <div>
                  <Label className="text-muted-foreground text-xs">Outcome</Label>
                  <p className="text-sm">{selectedVisit.outcome || "-"}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground text-xs">Order Taken</Label>
                    <div className="mt-1">
                      {selectedVisit.order_taken ? (
                        <Badge className="bg-green-600 text-white">Yes</Badge>
                      ) : (
                        <Badge variant="secondary">No</Badge>
                      )}
                    </div>
                  </div>
                  {selectedVisit.order_taken && selectedVisit.order_value && (
                    <div>
                      <Label className="text-muted-foreground text-xs">Order Value</Label>
                      <p className="font-medium">₹{selectedVisit.order_value.toLocaleString()}</p>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground text-xs">Follow-up Required</Label>
                    <div className="mt-1">
                      {selectedVisit.follow_up_required ? (
                        <Badge variant="destructive">Required</Badge>
                      ) : (
                        <span className="text-muted-foreground">No</span>
                      )}
                    </div>
                  </div>
                  {selectedVisit.follow_up_required && selectedVisit.follow_up_date && (
                    <div>
                      <Label className="text-muted-foreground text-xs">Follow-up Date</Label>
                      <p className="font-medium">{format(parseISO(selectedVisit.follow_up_date), "dd-MMM-yyyy")}</p>
                    </div>
                  )}
                </div>

                {selectedVisit.next_action && (
                  <div>
                    <Label className="text-muted-foreground text-xs">Next Action</Label>
                    <p className="text-sm">{selectedVisit.next_action}</p>
                  </div>
                )}

                {selectedVisit.feedback && (
                  <div>
                    <Label className="text-muted-foreground text-xs">Customer Feedback</Label>
                    <p className="text-sm">{selectedVisit.feedback}</p>
                  </div>
                )}

                <div>
                  <Label className="text-muted-foreground text-xs">Created At</Label>
                  <p className="text-sm text-muted-foreground">
                    {format(parseISO(selectedVisit.created_at), "dd-MMM-yyyy HH:mm")}
                  </p>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
