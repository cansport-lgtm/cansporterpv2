import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, endOfMonth, parseISO, isAfter, eachDayOfInterval, isWithinInterval } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { 
  Wallet, 
  Receipt, 
  Zap, 
  TrendingUp, 
  AlertTriangle, 
  Clock, 
  FileWarning,
  DollarSign,
  CalendarIcon,
  ChevronDown,
  ChevronRight
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart as RePieChart, Cell, Pie, Legend } from "recharts";

const COLORS = ['hsl(var(--primary))', 'hsl(var(--secondary))', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export default function ExpenseDashboard() {
  const currentDate = new Date();
  const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
  const [categoryFromDate, setCategoryFromDate] = useState<Date | undefined>(undefined);
  const [categoryToDate, setCategoryToDate] = useState<Date | undefined>(undefined);

  const monthStart = startOfMonth(new Date(selectedYear, selectedMonth - 1));
  const monthEnd = endOfMonth(new Date(selectedYear, selectedMonth - 1));

  // Fetch petty cash entries
  const { data: pettyCashEntries = [] } = useQuery({
    queryKey: ["petty-cash-entries", selectedYear, selectedMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("petty_cash_entries")
        .select("*, expense_categories(*)")
        .gte("entry_date", format(monthStart, "yyyy-MM-dd"))
        .lte("entry_date", format(monthEnd, "yyyy-MM-dd"));
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch general expenses
  const { data: generalExpenses = [] } = useQuery({
    queryKey: ["general-expenses", selectedYear, selectedMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("general_expenses")
        .select("*, expense_categories(*), production_departments(*)")
        .gte("expense_date", format(monthStart, "yyyy-MM-dd"))
        .lte("expense_date", format(monthEnd, "yyyy-MM-dd"));
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch utility bills
  const { data: utilityBills = [] } = useQuery({
    queryKey: ["utility-bills", selectedYear, selectedMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("utility_bills")
        .select("*, utility_types(*)")
        .gte("bill_date", format(monthStart, "yyyy-MM-dd"))
        .lte("bill_date", format(monthEnd, "yyyy-MM-dd"));
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch budgets
  const { data: budgets = [] } = useQuery({
    queryKey: ["expense-budgets", selectedYear, selectedMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expense_budgets")
        .select("*, expense_categories(*), utility_types(*), production_departments(*)")
        .eq("budget_year", selectedYear)
        .eq("budget_month", selectedMonth);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch budget alerts
  const { data: budgetAlerts = [] } = useQuery({
    queryKey: ["budget-alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("budget_alerts")
        .select("*, expense_budgets(*, expense_categories(*), utility_types(*))")
        .eq("is_acknowledged", false)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
  });

  // Calculate metrics
  const metrics = useMemo(() => {
    const pettyCashTotal = pettyCashEntries
      .filter(e => e.entry_type === "expense")
      .reduce((sum, e) => sum + Number(e.amount), 0);

    const generalExpenseTotal = generalExpenses
      .reduce((sum, e) => sum + Number(e.total_amount), 0);

    const utilityTotal = utilityBills
      .reduce((sum, b) => sum + Number(b.total_amount), 0);

    const pendingApprovals = [
      ...pettyCashEntries.filter(e => e.approval_status === "pending"),
      ...generalExpenses.filter(e => e.approval_status === "pending"),
    ].length;

    const missingReceipts = [
      ...pettyCashEntries.filter(e => !e.receipt_url && e.entry_type === "expense"),
      ...generalExpenses.filter(e => !e.attachment_url),
    ].length;

    const overdueBills = utilityBills.filter(b => 
      b.payment_status !== "paid" && isAfter(new Date(), parseISO(b.due_date))
    ).length;

    const totalBudget = budgets.reduce((sum, b) => sum + Number(b.budget_amount), 0);
    const totalActual = pettyCashTotal + generalExpenseTotal + utilityTotal;
    const budgetUtilization = totalBudget > 0 ? (totalActual / totalBudget) * 100 : 0;

    return {
      pettyCashTotal,
      generalExpenseTotal,
      utilityTotal,
      totalExpenses: pettyCashTotal + generalExpenseTotal + utilityTotal,
      pendingApprovals,
      missingReceipts,
      overdueBills,
      totalBudget,
      budgetUtilization,
    };
  }, [pettyCashEntries, generalExpenses, utilityBills, budgets]);

  // Category expenses list month selector
  const [catListMonth, setCatListMonth] = useState(currentDate.getMonth() + 1);
  const [catListYear, setCatListYear] = useState(currentDate.getFullYear());

  const catListStart = startOfMonth(new Date(catListYear, catListMonth - 1));
  const catListEnd = endOfMonth(new Date(catListYear, catListMonth - 1));

  // Fetch data for category list (separate from dashboard month)
  const { data: catListPettyCash = [] } = useQuery({
    queryKey: ["cat-list-petty", catListYear, catListMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("petty_cash_entries")
        .select("*, expense_categories(*)")
        .gte("entry_date", format(catListStart, "yyyy-MM-dd"))
        .lte("entry_date", format(catListEnd, "yyyy-MM-dd"))
        .eq("entry_type", "expense");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: catListGeneral = [] } = useQuery({
    queryKey: ["cat-list-general", catListYear, catListMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("general_expenses")
        .select("*, expense_categories(*)")
        .gte("expense_date", format(catListStart, "yyyy-MM-dd"))
        .lte("expense_date", format(catListEnd, "yyyy-MM-dd"));
      if (error) throw error;
      return data || [];
    },
  });

  const { data: catListUtilities = [] } = useQuery({
    queryKey: ["cat-list-utilities", catListYear, catListMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("utility_bills")
        .select("*, utility_types(*)")
        .gte("bill_date", format(catListStart, "yyyy-MM-dd"))
        .lte("bill_date", format(catListEnd, "yyyy-MM-dd"));
      if (error) throw error;
      return data || [];
    },
  });

  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const categoryExpensesList = useMemo(() => {
    const categoryMap = new Map<string, { source: string; count: number; amount: number; entries: Array<{ date: string; description: string; amount: number; source: string; refNumber: string }> }>();

    catListPettyCash.forEach(e => {
      const name = e.expense_categories?.name || "Uncategorized";
      const existing = categoryMap.get(name) || { source: "Petty Cash", count: 0, amount: 0, entries: [] };
      existing.count += 1;
      existing.amount += Number(e.amount);
      existing.source = existing.entries.length > 0 && existing.source !== "Petty Cash" ? "Mixed" : "Petty Cash";
      existing.entries.push({ date: e.entry_date, description: e.description || "-", amount: Number(e.amount), source: "Petty Cash", refNumber: e.entry_number || "-" });
      categoryMap.set(name, existing);
    });

    catListGeneral.forEach(e => {
      const name = e.expense_categories?.name || "Uncategorized";
      const existing = categoryMap.get(name) || { source: "General", count: 0, amount: 0, entries: [] };
      existing.count += 1;
      existing.amount += Number(e.total_amount);
      if (existing.entries.length > 0 && existing.source !== "General") existing.source = "Mixed";
      else existing.source = "General";
      existing.entries.push({ date: e.expense_date, description: e.description || "-", amount: Number(e.total_amount), source: "General", refNumber: e.expense_number || "-" });
      categoryMap.set(name, existing);
    });

    catListUtilities.forEach(b => {
      const name = `Utility - ${b.utility_types?.name || "Other"}`;
      const existing = categoryMap.get(name) || { source: "Utility", count: 0, amount: 0, entries: [] };
      existing.count += 1;
      existing.amount += Number(b.total_amount);
      existing.entries.push({ date: b.bill_date, description: `${b.utility_types?.name || "Utility"} Bill`, amount: Number(b.total_amount), source: "Utility", refNumber: b.bill_number || "-" });
      categoryMap.set(name, existing);
    });

    const list = Array.from(categoryMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.amount - a.amount);

    const total = list.reduce((s, i) => s + i.amount, 0);
    return { list, total };
  }, [catListPettyCash, catListGeneral, catListUtilities]);

  // Category-wise spending (with optional date filter)
  const categorySpending = useMemo(() => {
    const categoryMap = new Map<string, number>();
    
    const filterByDateRange = (dateStr: string) => {
      if (!categoryFromDate && !categoryToDate) return true;
      const date = parseISO(dateStr);
      if (categoryFromDate && categoryToDate) {
        return isWithinInterval(date, { start: categoryFromDate, end: categoryToDate });
      }
      if (categoryFromDate) return date >= categoryFromDate;
      if (categoryToDate) return date <= categoryToDate;
      return true;
    };

    pettyCashEntries
      .filter(e => e.entry_type === "expense" && filterByDateRange(e.entry_date))
      .forEach(e => {
        const name = e.expense_categories?.name || "Uncategorized";
        categoryMap.set(name, (categoryMap.get(name) || 0) + Number(e.amount));
      });

    generalExpenses
      .filter(e => filterByDateRange(e.expense_date))
      .forEach(e => {
        const name = e.expense_categories?.name || "Uncategorized";
        categoryMap.set(name, (categoryMap.get(name) || 0) + Number(e.total_amount));
      });

    return Array.from(categoryMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 7);
  }, [pettyCashEntries, generalExpenses, categoryFromDate, categoryToDate]);

  // Utility spending by type
  const utilitySpending = useMemo(() => {
    const typeMap = new Map<string, { paid: number; unpaid: number }>();
    
    utilityBills.forEach(b => {
      const name = b.utility_types?.name || "Other";
      const current = typeMap.get(name) || { paid: 0, unpaid: 0 };
      if (b.payment_status === "paid") {
        current.paid += Number(b.total_amount);
      } else {
        current.unpaid += Number(b.total_amount);
      }
      typeMap.set(name, current);
    });

    return Array.from(typeMap.entries()).map(([name, values]) => ({
      name,
      ...values,
    }));
  }, [utilityBills]);

  // Daily expenses and receipts for bar chart
  const dailyData = useMemo(() => {
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
    
    return days.map(day => {
      const dateStr = format(day, "yyyy-MM-dd");
      const dayLabel = format(day, "d");
      
      // Calculate expenses for the day (petty cash expenses + general expenses)
      const pettyCashExpense = pettyCashEntries
        .filter(e => e.entry_date === dateStr && e.entry_type === "expense")
        .reduce((sum, e) => sum + Number(e.amount), 0);
      
      const generalExpense = generalExpenses
        .filter(e => e.expense_date === dateStr)
        .reduce((sum, e) => sum + Number(e.total_amount), 0);
      
      // Calculate receipts for the day (petty cash receipts/replenishments)
      const receipts = pettyCashEntries
        .filter(e => e.entry_date === dateStr && (e.entry_type === "receipt" || e.entry_type === "replenishment"))
        .reduce((sum, e) => sum + Number(e.amount), 0);
      
      return {
        day: dayLabel,
        expenses: pettyCashExpense + generalExpense,
        receipts: receipts,
      };
    });
  }, [pettyCashEntries, generalExpenses, monthStart, monthEnd]);

  // Budget vs Actual
  const budgetVsActual = useMemo(() => {
    return budgets.slice(0, 6).map(b => {
      const categoryName = b.expense_categories?.name || b.utility_types?.name || "General";
      let actual = 0;
      
      if (b.category_id) {
        actual = [
          ...pettyCashEntries.filter(e => e.category_id === b.category_id && e.entry_type === "expense"),
          ...generalExpenses.filter(e => e.category_id === b.category_id),
        ].reduce((sum, e) => sum + Number((e as any).amount || (e as any).total_amount || 0), 0);
      }
      
      if (b.utility_type_id) {
        actual = utilityBills
          .filter(u => u.utility_type_id === b.utility_type_id)
          .reduce((sum, u) => sum + Number(u.total_amount), 0);
      }

      const percentage = Number(b.budget_amount) > 0 ? (actual / Number(b.budget_amount)) * 100 : 0;

      return {
        name: categoryName.length > 15 ? categoryName.substring(0, 15) + "..." : categoryName,
        budget: Number(b.budget_amount),
        actual,
        percentage: Math.round(percentage),
      };
    });
  }, [budgets, pettyCashEntries, generalExpenses, utilityBills]);

  const months = [
    { value: 1, label: "January" }, { value: 2, label: "February" }, { value: 3, label: "March" },
    { value: 4, label: "April" }, { value: 5, label: "May" }, { value: 6, label: "June" },
    { value: 7, label: "July" }, { value: 8, label: "August" }, { value: 9, label: "September" },
    { value: 10, label: "October" }, { value: 11, label: "November" }, { value: 12, label: "December" },
  ];

  const years = Array.from({ length: 5 }, (_, i) => currentDate.getFullYear() - 2 + i);

  return (
    <ERPLayout>
      <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <PageHeader title="Expense Dashboard" description="Overview of all expenses and budget utilization" />
        <div className="flex items-center gap-2">
          <Select value={selectedMonth.toString()} onValueChange={(v) => setSelectedMonth(parseInt(v))}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.map((m) => (
                <SelectItem key={m.value} value={m.value.toString()}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(parseInt(v))}>
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Alerts Section */}
      {budgetAlerts.length > 0 && (
        <Card className="border-warning bg-warning/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-warning">
              <AlertTriangle className="h-4 w-4" />
              Budget Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {budgetAlerts.slice(0, 3).map((alert) => (
                <div key={alert.id} className="flex items-center justify-between text-sm">
                  <span>
                    {alert.expense_budgets?.expense_categories?.name || alert.expense_budgets?.utility_types?.name || "Budget"} - 
                    {alert.alert_type === "warning_80" ? " 80% utilized" : " 100% exceeded"}
                  </span>
                  <Badge variant={alert.alert_type === "exceeded_100" ? "destructive" : "secondary"}>
                    {alert.percentage_used?.toFixed(0)}%
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total Expenses"
          value={`₹${metrics.totalExpenses.toLocaleString()}`}
          icon={DollarSign}
          description="This month"
        />
        <MetricCard
          title="Petty Cash"
          value={`₹${metrics.pettyCashTotal.toLocaleString()}`}
          icon={Wallet}
          description={`${pettyCashEntries.filter(e => e.entry_type === "expense").length} entries`}
        />
        <MetricCard
          title="General Expenses"
          value={`₹${metrics.generalExpenseTotal.toLocaleString()}`}
          icon={Receipt}
          description={`${generalExpenses.length} expenses`}
        />
        <MetricCard
          title="Utilities"
          value={`₹${metrics.utilityTotal.toLocaleString()}`}
          icon={Zap}
          description={`${utilityBills.length} bills`}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Budget Utilization"
          value={`${metrics.budgetUtilization.toFixed(1)}%`}
          icon={TrendingUp}
          description={`₹${metrics.totalBudget.toLocaleString()} budget`}
        />
        <MetricCard
          title="Pending Approvals"
          value={metrics.pendingApprovals.toString()}
          icon={Clock}
          description="Awaiting action"
        />
        <MetricCard
          title="Missing Receipts"
          value={metrics.missingReceipts.toString()}
          icon={FileWarning}
          description="Need attachments"
        />
        <MetricCard
          title="Overdue Bills"
          value={metrics.overdueBills.toString()}
          icon={AlertTriangle}
          description="Past due date"
        />
      </div>

      {/* Daily Expenses & Receipts Chart */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base">Daily Expenses & Receipts</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={selectedMonth.toString()} onValueChange={(v) => setSelectedMonth(parseInt(v))}>
              <SelectTrigger className="w-[120px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end" side="bottom" className="z-[100]">
                {months.map((m) => (
                  <SelectItem key={m.value} value={m.value.toString()}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(parseInt(v))}>
              <SelectTrigger className="w-[80px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end" side="bottom" className="z-[100]">
                {years.map((y) => (
                  <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis 
                  dataKey="day" 
                  tick={{ fontSize: 10 }} 
                  interval={0}
                  angle={0}
                />
                <YAxis 
                  tick={{ fontSize: 12 }} 
                  tickFormatter={(v) => v >= 1000 ? `₹${(v/1000).toFixed(0)}k` : `₹${v}`} 
                />
                <Tooltip 
                  formatter={(value: number) => `₹${value.toLocaleString()}`}
                  labelFormatter={(label) => `Day ${label}`}
                />
                <Legend />
                <Bar dataKey="expenses" fill="hsl(var(--destructive))" name="Expenses" radius={[2, 2, 0, 0]} />
                <Bar dataKey="receipts" fill="hsl(var(--primary))" name="Receipts" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Category Spending Pie Chart */}
        <Card>
          <CardHeader className="flex flex-col gap-3">
            <CardTitle className="text-base">Category-wise Spending</CardTitle>
            <div className="flex flex-wrap gap-2 items-center">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className={cn("h-8 text-xs justify-start", !categoryFromDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-1 h-3 w-3" />
                    {categoryFromDate ? format(categoryFromDate, "dd MMM yyyy") : "From"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={categoryFromDate} onSelect={setCategoryFromDate} initialFocus className={cn("p-3 pointer-events-auto")} />
                </PopoverContent>
              </Popover>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className={cn("h-8 text-xs justify-start", !categoryToDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-1 h-3 w-3" />
                    {categoryToDate ? format(categoryToDate, "dd MMM yyyy") : "To"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={categoryToDate} onSelect={setCategoryToDate} initialFocus className={cn("p-3 pointer-events-auto")} />
                </PopoverContent>
              </Popover>
              {(categoryFromDate || categoryToDate) && (
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setCategoryFromDate(undefined); setCategoryToDate(undefined); }}>
                  Clear
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <RePieChart>
                  <Pie
                    data={categorySpending}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {categorySpending.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => `₹${value.toLocaleString()}`} />
                </RePieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Utility Bills Bar Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Utility Bills Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={utilitySpending}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `₹${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value: number) => `₹${value.toLocaleString()}`} />
                  <Legend />
                  <Bar dataKey="paid" stackId="a" fill="hsl(var(--primary))" name="Paid" />
                  <Bar dataKey="unpaid" stackId="a" fill="hsl(var(--destructive))" name="Unpaid" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Budget vs Actual */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Budget vs Actual</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {budgetVsActual.map((item, index) => (
              <div key={index} className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{item.name}</span>
                  <span className="text-muted-foreground">
                    ₹{item.actual.toLocaleString()} / ₹{item.budget.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Progress 
                    value={Math.min(item.percentage, 100)} 
                    className={`h-2 flex-1 ${item.percentage > 100 ? '[&>div]:bg-destructive' : item.percentage > 80 ? '[&>div]:bg-warning' : ''}`}
                  />
                  <Badge variant={item.percentage > 100 ? "destructive" : item.percentage > 80 ? "secondary" : "outline"}>
                    {item.percentage}%
                  </Badge>
                </div>
              </div>
            ))}
            {budgetVsActual.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No budgets configured for this period</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Category-wise Expenses List */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base">Category-wise Expenses</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={catListMonth.toString()} onValueChange={(v) => setCatListMonth(parseInt(v))}>
              <SelectTrigger className="w-[120px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end" side="bottom" className="z-[100]">
                {months.map((m) => (
                  <SelectItem key={m.value} value={m.value.toString()}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={catListYear.toString()} onValueChange={(v) => setCatListYear(parseInt(v))}>
              <SelectTrigger className="w-[80px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end" side="bottom" className="z-[100]">
                {years.map((y) => (
                  <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-center">Entries</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">% Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categoryExpensesList.list.map((item, index) => (
                <React.Fragment key={item.name}>
                  <TableRow 
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setExpandedCategory(expandedCategory === item.name ? null : item.name)}
                  >
                    <TableCell className="text-muted-foreground">
                      <span className="flex items-center gap-1">
                        {expandedCategory === item.name ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        {index + 1}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{item.source}</Badge>
                    </TableCell>
                    <TableCell className="text-center">{item.count}</TableCell>
                    <TableCell className="text-right">₹{item.amount.toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      {categoryExpensesList.total > 0 ? ((item.amount / categoryExpensesList.total) * 100).toFixed(1) : 0}%
                    </TableCell>
                  </TableRow>
                  {expandedCategory === item.name && (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={6} className="p-0">
                        <div className="px-6 py-3">
                          <Table>
                            <TableHeader>
                              <TableRow className="text-xs">
                                <TableHead className="h-8 text-xs">#</TableHead>
                                <TableHead className="h-8 text-xs">Date</TableHead>
                                <TableHead className="h-8 text-xs">Ref No.</TableHead>
                                <TableHead className="h-8 text-xs">Description</TableHead>
                                <TableHead className="h-8 text-xs">Source</TableHead>
                                <TableHead className="h-8 text-xs text-right">Amount</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {item.entries
                                .sort((a, b) => a.date.localeCompare(b.date))
                                .map((entry, ei) => (
                                <TableRow key={ei} className="text-xs">
                                  <TableCell className="py-1.5">{ei + 1}</TableCell>
                                  <TableCell className="py-1.5">{format(parseISO(entry.date), "dd MMM yyyy")}</TableCell>
                                  <TableCell className="py-1.5 font-mono">{entry.refNumber}</TableCell>
                                  <TableCell className="py-1.5 max-w-[250px] truncate">{entry.description}</TableCell>
                                  <TableCell className="py-1.5">
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">{entry.source}</Badge>
                                  </TableCell>
                                  <TableCell className="py-1.5 text-right">₹{entry.amount.toLocaleString()}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))}
              {categoryExpensesList.list.length > 0 && (
                <TableRow className="bg-muted/50 font-semibold">
                  <TableCell></TableCell>
                  <TableCell>Total</TableCell>
                  <TableCell></TableCell>
                  <TableCell className="text-center">{categoryExpensesList.list.reduce((s, i) => s + i.count, 0)}</TableCell>
                  <TableCell className="text-right">₹{categoryExpensesList.total.toLocaleString()}</TableCell>
                  <TableCell className="text-right">100%</TableCell>
                </TableRow>
              )}
              {categoryExpensesList.list.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">No expenses found for this month</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pending Approvals Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pending Approvals</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Number</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                ...pettyCashEntries
                  .filter(e => e.approval_status === "pending")
                  .map(e => ({ type: "Petty Cash", number: e.entry_number, desc: e.description, amount: e.amount, date: e.entry_date })),
                ...generalExpenses
                  .filter(e => e.approval_status === "pending")
                  .map(e => ({ type: "General", number: e.expense_number, desc: e.description, amount: e.total_amount, date: e.expense_date })),
              ].slice(0, 5).map((item, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <Badge variant="outline">{item.type}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{item.number}</TableCell>
                  <TableCell className="max-w-[200px] truncate">{item.desc}</TableCell>
                  <TableCell className="text-right">₹{Number(item.amount).toLocaleString()}</TableCell>
                  <TableCell>{format(parseISO(item.date), "dd MMM")}</TableCell>
                </TableRow>
              ))}
              {pettyCashEntries.filter(e => e.approval_status === "pending").length + generalExpenses.filter(e => e.approval_status === "pending").length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">No pending approvals</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      </div>
    </ERPLayout>
  );
}
