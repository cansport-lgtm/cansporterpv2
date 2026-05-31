import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Factory, ClipboardCheck, Package, Wrench, AlertTriangle,
  Users, ShoppingCart, Download, Database, FileJson, Loader2,
  IndianRupee, Zap, Truck, CalendarIcon, Beaker, ChevronsUpDown, X,
  FolderKanban, FlaskConical, Rocket, TestTube, Lightbulb, ArrowRight,
  Code, Hammer, ChevronDown, ChevronRight, ShoppingBag, RotateCcw,
  TrendingUp, Wallet, Landmark, Receipt,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command, CommandInput, CommandList, CommandItem, CommandEmpty, CommandGroup,
} from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { DailyEmployeeProgress } from "@/components/dashboard/DailyEmployeeProgress";
import { EmployeeComparisonChart } from "@/components/dashboard/EmployeeComparisonChart";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, subDays, startOfMonth, endOfMonth, startOfWeek, endOfWeek, subMonths, eachDayOfInterval } from "date-fns";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

const CHART_COLORS = [
  "hsl(var(--primary))",
  "hsl(220 70% 55%)",
  "hsl(160 60% 45%)",
  "hsl(30 80% 55%)",
  "hsl(280 60% 55%)",
  "hsl(0 70% 55%)",
  "hsl(45 80% 50%)",
  "hsl(190 70% 45%)",
];

type Period = "yesterday" | "today" | "week" | "month" | "custom";

export default function Dashboard() {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  const [isExporting, setIsExporting] = useState(false);
  const [period, setPeriod] = useState<Period>("yesterday");
  const [customDate, setCustomDate] = useState<Date | undefined>(undefined);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("ceo_key_materials") || "[]"); } catch { return []; }
  });
  const [materialPopoverOpen, setMaterialPopoverOpen] = useState(false);
  const [expandedExpenseCategories, setExpandedExpenseCategories] = useState<Set<string>>(new Set());
  const [selectedQAProcessIds, setSelectedQAProcessIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("ceo_key_qa_processes") || "[]"); } catch { return []; }
  });
  const [qaProcessPopoverOpen, setQAProcessPopoverOpen] = useState(false);

  // Persist selections to localStorage
  const updateSelectedMaterials = (ids: string[] | ((prev: string[]) => string[])) => {
    setSelectedMaterialIds(prev => {
      const next = typeof ids === "function" ? ids(prev) : ids;
      localStorage.setItem("ceo_key_materials", JSON.stringify(next));
      return next;
    });
  };
  const updateSelectedQAProcesses = (ids: string[] | ((prev: string[]) => string[])) => {
    setSelectedQAProcessIds(prev => {
      const next = typeof ids === "function" ? ids(prev) : ids;
      localStorage.setItem("ceo_key_qa_processes", JSON.stringify(next));
      return next;
    });
  };

  const today = format(new Date(), "yyyy-MM-dd");
  // On Monday (day 1), default to Saturday (2 days ago) instead of Sunday
  const isMonday = new Date().getDay() === 1;
  const yesterday = format(subDays(new Date(), isMonday ? 2 : 1), "yyyy-MM-dd");
  const dateRange = useMemo(() => {
    const now = new Date();
    if (period === "yesterday") return { start: yesterday, end: yesterday };
    if (period === "today") return { start: today, end: today };
    if (period === "custom" && customDate) {
      const d = format(customDate, "yyyy-MM-dd");
      return { start: d, end: d };
    }
    if (period === "week") return { start: format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"), end: format(endOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd") };
    return { start: format(startOfMonth(now), "yyyy-MM-dd"), end: format(endOfMonth(now), "yyyy-MM-dd") };
  }, [period, today, yesterday, customDate]);

  // ============ LIVE DATA QUERIES ============

  // Production entries for the period
  const { data: productionData } = useQuery({
    queryKey: ["ceo-production", dateRange],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_entries")
        .select("entry_date, quantity_ok, quantity_rejected, department_id, production_departments(name)")
        .gte("entry_date", dateRange.start)
        .lte("entry_date", dateRange.end)
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
  });

  // Sales orders - domestic only
  const { data: salesOrders } = useQuery({
    queryKey: ["ceo-sales", dateRange],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_orders")
        .select("id, order_number, order_date, total_amount, status, customers(name)")
        .eq("sales_segment", "domestic")
        .in("status", ["dispatched", "partially_dispatched"])
        .gte("order_date", dateRange.start)
        .lte("order_date", dateRange.end)
        .order("order_date", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
  });

  // Today's & Yesterday's dispatch details
  const { data: recentDispatches } = useQuery({
    queryKey: ["ceo-recent-dispatches", today, yesterday],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_dispatches")
        .select("id, dispatch_number, dispatch_date, vehicle_number, delivery_status, sales_orders!inner(order_number, customers(name)), sales_dispatch_items(quantity_dozens)")
        .gte("dispatch_date", yesterday)
        .lte("dispatch_date", today)
        .order("dispatch_date", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
  });

  // Active employees
  const { data: employeesData } = useQuery({
    queryKey: ["ceo-employees"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, is_active")
        .eq("is_active", true);
      if (error) throw error;
      return data || [];
    },
  });

  // Attendance today
  const { data: attendanceToday } = useQuery({
    queryKey: ["ceo-attendance", today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance")
        .select("id, status")
        .eq("attendance_date", today);
      if (error) throw error;
      return data || [];
    },
  });

  // Pending purchase orders
  const { data: pendingPOs } = useQuery({
    queryKey: ["ceo-pending-pos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_orders")
        .select("id, status")
        .in("status", ["draft", "pending", "submitted"]);
      if (error) throw error;
      return data || [];
    },
  });

  // Active breakdowns
  const { data: activeBreakdowns } = useQuery({
    queryKey: ["ceo-breakdowns"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("breakdown_logs")
        .select("id, breakdown_number, description, breakdown_start, priority, status, machines(name)")
        .in("status", ["draft", "in_progress"])
        .order("breakdown_start", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
  });

  // Expenses: petty cash
  const { data: pettyCash } = useQuery({
    queryKey: ["ceo-petty-cash", dateRange],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("petty_cash_entries")
        .select("amount, entry_date, entry_number, description, paid_to, expense_categories(name)")
        .gte("entry_date", dateRange.start)
        .lte("entry_date", dateRange.end)
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
  });

  // General expenses
  const { data: generalExpenses } = useQuery({
    queryKey: ["ceo-general-expenses", dateRange],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("general_expenses")
        .select("amount, expense_date, expense_number, description, vendor_name, expense_categories(name)")
        .gte("expense_date", dateRange.start)
        .lte("expense_date", dateRange.end)
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
  });

  // Utility bills
  const { data: utilityBills } = useQuery({
    queryKey: ["ceo-utility-bills", dateRange],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("utility_bills")
        .select("total_amount, bill_date, bill_number, remarks, utility_types(name)")
        .gte("bill_date", dateRange.start)
        .lte("bill_date", dateRange.end)
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
  });

  // Accounting: the fiscal month at the end of the selected date range
  const rangeEndYM = useMemo(() => {
    const d = new Date(dateRange.end + "T00:00:00");
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }, [dateRange]);

  // Accounting: fiscal periods on or before the selected range end, newest first.
  // GL data is sparse/monthly, so the KPIs show the latest period that has data
  // rather than tying strictly to the day/week selector (which would read zero).
  const { data: financePeriods } = useQuery({
    queryKey: ["ceo-finance-periods", rangeEndYM],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("finance_periods")
        .select("id, year, month, period_name")
        .order("year", { ascending: false })
        .order("month", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data || []).filter(p =>
        p.year < rangeEndYM.year || (p.year === rangeEndYM.year && p.month <= rangeEndYM.month)
      );
    },
  });

  // Accounting: trial balance entries for those periods
  const { data: financeTrialEntries } = useQuery({
    queryKey: ["ceo-finance-tb", financePeriods?.map(p => p.id)],
    queryFn: async () => {
      const ids = (financePeriods || []).map(p => p.id);
      if (!ids.length) return [];
      const { data, error } = await supabase
        .from("finance_trial_balance_entries")
        .select("debit_amount, credit_amount, period_id, account:finance_chart_of_accounts(account_type, sub_category)")
        .in("period_id", ids);
      if (error) throw error;
      return data || [];
    },
    enabled: !!financePeriods,
  });

  // Labour productivity
  const { data: labourData } = useQuery({
    queryKey: ["ceo-labour", dateRange],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("labour_productivity_targets")
        .select("department_id, target_quantity, actual_quantity")
        .gte("target_date", dateRange.start)
        .lte("target_date", dateRange.end)
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
  });

  // QA Inspections for the period
  const { data: qaInspections } = useQuery({
    queryKey: ["ceo-qa-inspections", dateRange],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_inspections")
        .select("id, inspection_date, result, process_id, qa_processes(name, code)")
        .gte("inspection_date", dateRange.start)
        .lte("inspection_date", dateRange.end)
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
  });

  // All QA processes for selector
  const { data: allQAProcesses } = useQuery({
    queryKey: ["ceo-all-qa-processes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_processes")
        .select("id, code, name")
        .eq("is_active", true)
        .order("code");
      if (error) throw error;
      return data || [];
    },
  });

  // MPH data for CEO dashboard - auto-calculated from production
  const { data: mphProductionEntries } = useQuery({
    queryKey: ["ceo-mph-production-entries", dateRange],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_entries")
        .select("department_id, sub_department_id, quantity_produced, production_departments(name)")
        .gte("entry_date", dateRange.start)
        .lte("entry_date", dateRange.end)
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: mphCalculatingNumbers } = useQuery({
    queryKey: ["ceo-mph-calculating-numbers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mph_calculating_numbers")
        .select("department_id, sub_department_id, mph_number")
        .eq("is_active", true);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: mphUsed } = useQuery({
    queryKey: ["ceo-mph-used", dateRange],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("labour_productivity_targets")
        .select("department_id, mph, production_departments(name)")
        .gte("target_date", dateRange.start)
        .lte("target_date", dateRange.end)
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
  });

  // Material Consumption Analysis
  const { data: consumptionProduction } = useQuery({
    queryKey: ["ceo-consumption-production", dateRange],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_production_entry")
        .select("product_id, quantity_produced")
        .gte("entry_date", dateRange.start)
        .lte("entry_date", dateRange.end);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: allRawMaterials } = useQuery({
    queryKey: ["ceo-raw-materials-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_raw_materials")
        .select("id, code, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: consumptionBom } = useQuery({
    queryKey: ["ceo-consumption-bom"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_bom")
        .select("product_id, raw_material_id, standard_quantity, raw_material:consumption_raw_materials(code, name, unit, priority)")
        .eq("is_active", true);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: consumptionClosing } = useQuery({
    queryKey: ["ceo-consumption-closing", dateRange],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_stock_closing")
        .select("raw_material_id, actual_consumption, raw_material:consumption_raw_materials(code, name, unit, priority)")
        .gte("closing_date", dateRange.start)
        .lte("closing_date", dateRange.end);
      if (error) throw error;
      return data || [];
    },
  });

  // Monthly totals for material consumption (full current month)
  const monthRange = useMemo(() => {
    const now = new Date();
    return {
      start: format(startOfMonth(now), "yyyy-MM-dd"),
      end: format(endOfMonth(now), "yyyy-MM-dd"),
    };
  }, []);

  const { data: monthlyProduction } = useQuery({
    queryKey: ["ceo-consumption-monthly-prod", monthRange],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_production_entry")
        .select("product_id, quantity_produced")
        .gte("entry_date", monthRange.start)
        .lte("entry_date", monthRange.end);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: monthlyClosing } = useQuery({
    queryKey: ["ceo-consumption-monthly-closing", monthRange],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_stock_closing")
        .select("raw_material_id, actual_consumption")
        .gte("closing_date", monthRange.start)
        .lte("closing_date", monthRange.end);
      if (error) throw error;
      return data || [];
    },
  });

  // Stock Closing — Production Planning (yesterday)
  const { data: planningClosingYesterday } = useQuery({
    queryKey: ["ceo-planning-closing-yesterday", yesterday],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_stock_closing")
        .select(`
          id, closing_quantity, planning_item_id, department_id,
          planning_items(id, code, name, unit, costing_value),
          production_departments(id, name)
        `)
        .eq("closing_date", yesterday);
      if (error) throw error;
      return data || [];
    },
  });

  // Stock Closing — Material Consumption (yesterday)
  const { data: consumptionClosingYesterday } = useQuery({
    queryKey: ["ceo-consumption-closing-yesterday", yesterday],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_stock_closing")
        .select(`
          id, closing_quantity, actual_consumption, raw_material_id,
          consumption_raw_materials(id, code, name, unit, category, cost_value, threshold)
        `)
        .eq("closing_date", yesterday);
      if (error) throw error;
      return data || [];
    },
  });

  // CRM — Leads
  const { data: crmLeads } = useQuery({
    queryKey: ["ceo-crm-leads"],
    queryFn: async () => {
      const { data, error } = await supabase.from("crm_leads").select("status");
      if (error) throw error;
      return data || [];
    },
  });

  // CRM — Deals
  const { data: crmDeals } = useQuery({
    queryKey: ["ceo-crm-deals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_deals")
        .select("stage, value, probability, expected_close_date, won_at, lost_reason");
      if (error) throw error;
      return data || [];
    },
  });

  // CRM — Activities
  const { data: crmActivities } = useQuery({
    queryKey: ["ceo-crm-activities"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_activities")
        .select("completed, due_date");
      if (error) throw error;
      return data || [];
    },
  });

  // System alerts
  const { data: alerts } = useQuery({
    queryKey: ["ceo-alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_alerts")
        .select("*")
        .eq("is_active", true)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .order("priority", { ascending: true })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
  });

  // Projects data
  const { data: projectsData } = useQuery({
    queryKey: ["ceo-projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, project_number, title, status, priority, target_end_date, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // R&D Projects data
  const { data: rdProjectsData } = useQuery({
    queryKey: ["ceo-rd-projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rd_projects")
        .select("id, project_number, title, status, current_stage, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Development Tasks data
  const { data: devTasksData } = useQuery({
    queryKey: ["ceo-dev-tasks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("development_tasks")
        .select("id, task_number, title, module, priority, status, target_date, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Maintenance Module Analysis
  const { data: allWorkOrders } = useQuery({
    queryKey: ["ceo-maintenance-wo", dateRange],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance_work_orders")
        .select("id, work_order_number, title, priority, status, requested_date, completed_at, estimated_hours, actual_hours, machines(name)")
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: allBreakdowns } = useQuery({
    queryKey: ["ceo-maintenance-bd-all", dateRange],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("breakdown_logs")
        .select("id, breakdown_number, description, breakdown_start, breakdown_end, downtime_minutes, priority, status, machines(name)")
        .order("breakdown_start", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: sparePartsData } = useQuery({
    queryKey: ["ceo-maintenance-spares"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("spare_parts")
        .select("id, code, name, current_stock, minimum_stock, unit_cost, is_active")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: sparePartIssuesData } = useQuery({
    queryKey: ["ceo-maintenance-spare-issues", dateRange],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("spare_part_issues")
        .select("id, issue_date, quantity_issued, spare_parts(name, unit_cost)")
        .gte("issue_date", dateRange.start)
        .lte("issue_date", dateRange.end)
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: pmSchedules } = useQuery({
    queryKey: ["ceo-maintenance-pm"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance_schedules")
        .select("id, is_active, next_due_date")
        .eq("is_active", true);
      if (error) throw error;
      return data || [];
    },
  });

  // Online Sales data
  const { data: onlineOrders } = useQuery({
    queryKey: ["ceo-online-orders", dateRange],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("online_orders")
        .select("id, order_date, order_value, status, platform, payment_mode, quantity, shipping_charges, net_amount")
        .gte("order_date", dateRange.start)
        .lte("order_date", dateRange.end)
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: onlineReturns } = useQuery({
    queryKey: ["ceo-online-returns", dateRange],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("online_returns")
        .select("id, return_date, return_reason, refund_amount, refund_status, order_id")
        .gte("return_date", dateRange.start)
        .lte("return_date", dateRange.end)
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
  });

  // Production trend (last 30 days)
  const { data: productionTrend } = useQuery({
    queryKey: ["ceo-production-trend"],
    queryFn: async () => {
      const thirtyDaysAgo = format(subDays(new Date(), 30), "yyyy-MM-dd");
      const { data, error } = await supabase
        .from("production_entries")
        .select("entry_date, quantity_ok")
        .gte("entry_date", thirtyDaysAgo)
        .lte("entry_date", today)
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
  });

  // Sales dispatches for last 6 months (for Sales vs Dispatch chart)
  const { data: dispatchData } = useQuery({
    queryKey: ["ceo-dispatch-6m"],
    queryFn: async () => {
      const sixMonthsAgo = format(subMonths(new Date(), 6), "yyyy-MM-dd");
      const { data, error } = await supabase
        .from("sales_dispatches")
        .select("dispatch_date, sales_dispatch_items(quantity_dozens)")
        .gte("dispatch_date", sixMonthsAgo)
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: salesForChart } = useQuery({
    queryKey: ["ceo-sales-6m"],
    queryFn: async () => {
      const sixMonthsAgo = format(subMonths(new Date(), 6), "yyyy-MM-dd");
      const { data, error } = await supabase
        .from("sales_orders")
        .select("order_date, total_amount")
        .eq("sales_segment", "domestic")
        .gte("order_date", sixMonthsAgo)
        .not("status", "eq", "cancelled")
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
  });

  // ============ COMPUTED KPIs ============

  const totalProduction = useMemo(() => {
    return (productionData || []).reduce((s, e) => s + (e.quantity_ok || 0), 0);
  }, [productionData]);

  const localFinalOutput = useMemo(() => {
    return (productionData || [])
      .filter(e => (e.production_departments as any)?.name === "Local Final")
      .reduce((s, e) => s + (e.quantity_ok || 0), 0);
  }, [productionData]);

  const fancyFinalOutput = useMemo(() => {
    return (productionData || [])
      .filter(e => (e.production_departments as any)?.name === "Fancy Final")
      .reduce((s, e) => s + (e.quantity_ok || 0), 0);
  }, [productionData]);

  const totalRejected = useMemo(() => {
    return (productionData || []).reduce((s, e) => s + (e.quantity_rejected || 0), 0);
  }, [productionData]);

  const qaPassRate = useMemo(() => {
    const total = totalProduction + totalRejected;
    return total > 0 ? ((totalProduction / total) * 100).toFixed(1) : "0.0";
  }, [totalProduction, totalRejected]);

  // QA Inspection KPIs
  const qaStats = useMemo(() => {
    let inspections = qaInspections || [];
    
    // Filter by selected QA processes
    if (selectedQAProcessIds.length > 0) {
      inspections = inspections.filter(i => i.process_id && selectedQAProcessIds.includes(i.process_id));
    }

    const total = inspections.length;
    const passed = inspections.filter(i => i.result === "pass").length;
    const failed = inspections.filter(i => i.result === "fail").length;
    const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : "0.0";

    // Process-wise breakdown
    const processMap = new Map<string, { name: string; code: string; total: number; passed: number; failed: number }>();
    inspections.forEach(i => {
      const proc = i.qa_processes as any;
      const key = i.process_id || "unknown";
      if (!processMap.has(key)) {
        processMap.set(key, { name: proc?.name || "Unknown", code: proc?.code || "-", total: 0, passed: 0, failed: 0 });
      }
      const entry = processMap.get(key)!;
      entry.total++;
      if (i.result === "pass") entry.passed++;
      if (i.result === "fail") entry.failed++;
    });

    const byProcess = Array.from(processMap.values()).sort((a, b) => b.total - a.total);

    return { total, passed, failed, passRate, byProcess };
  }, [qaInspections, selectedQAProcessIds]);

  const monthlySales = useMemo(() => {
    return (salesOrders || []).reduce((s, o) => s + (o.total_amount || 0), 0);
  }, [salesOrders]);

  const totalExpenses = useMemo(() => {
    const pc = (pettyCash || []).reduce((s, e) => s + (e.amount || 0), 0);
    const ge = (generalExpenses || []).reduce((s, e) => s + (e.amount || 0), 0);
    const ub = (utilityBills || []).reduce((s, e) => s + (e.total_amount || 0), 0);
    return pc + ge + ub;
  }, [pettyCash, generalExpenses, utilityBills]);

  // Accounting KPIs derived from trial balance (GL) entries.
  // financePeriods is sorted newest-first; use the latest period that has data.
  const financeKPIs = useMemo(() => {
    const periods = financePeriods || [];
    const allEntries = (financeTrialEntries || []) as any[];
    const activePeriod = periods.find(p => allEntries.some(e => e.period_id === p.id));
    const entries = activePeriod ? allEntries.filter(e => e.period_id === activePeriod.id) : [];
    const revenue = entries
      .filter(e => e.account?.account_type === "revenue")
      .reduce((s, e) => s + Number(e.credit_amount || 0) - Number(e.debit_amount || 0), 0);
    const expenses = entries
      .filter(e => e.account?.account_type === "expense")
      .reduce((s, e) => s + Number(e.debit_amount || 0) - Number(e.credit_amount || 0), 0);
    const cogs = entries
      .filter(e => e.account?.account_type === "expense" && e.account?.sub_category?.toLowerCase()?.includes("cost of"))
      .reduce((s, e) => s + Number(e.debit_amount || 0) - Number(e.credit_amount || 0), 0);
    const assets = entries
      .filter(e => e.account?.account_type === "asset")
      .reduce((s, e) => s + Number(e.debit_amount || 0) - Number(e.credit_amount || 0), 0);
    return {
      revenue, expenses, grossProfit: revenue - cogs, netProfit: revenue - expenses, assets,
      periodName: activePeriod?.period_name ?? null,
    };
  }, [financePeriods, financeTrialEntries]);

  const labourEfficiency = useMemo(() => {
    const entries = labourData || [];
    if (entries.length === 0) return "0";
    const totalTarget = entries.reduce((s, e) => s + (e.target_quantity || 0), 0);
    const totalActual = entries.reduce((s, e) => s + (e.actual_quantity || 0), 0);
    return totalTarget > 0 ? ((totalActual / totalTarget) * 100).toFixed(0) : "0";
  }, [labourData]);

  // MPH department-wise stats - computed from production × mph_calculating_numbers
  const mphStats = useMemo(() => {
    const deptMap = new Map<string, { name: string; authorized: number; used: number; targetQty: number; actualQty: number }>();
    
    // Compute authorized MPH from production entries × mph calculating numbers
    (mphProductionEntries || []).forEach((entry: any) => {
      const mphRow = (mphCalculatingNumbers || []).find((m: any) =>
        m.department_id === entry.department_id &&
        (m.sub_department_id || null) === (entry.sub_department_id || null)
      );
      if (mphRow) {
        const deptId = entry.department_id || "unknown";
        const deptName = entry.production_departments?.name || "Unknown";
        if (!deptMap.has(deptId)) deptMap.set(deptId, { name: deptName, authorized: 0, used: 0, targetQty: 0, actualQty: 0 });
        deptMap.get(deptId)!.authorized += Number(entry.quantity_produced || 0) * Number(mphRow.mph_number || 0);
      }
    });
    
    // Add used MPH from productivity targets
    (mphUsed || []).forEach(e => {
      const deptId = e.department_id || "unknown";
      const deptName = (e.production_departments as any)?.name || "Unknown";
      if (!deptMap.has(deptId)) deptMap.set(deptId, { name: deptName, authorized: 0, used: 0, targetQty: 0, actualQty: 0 });
      deptMap.get(deptId)!.used += (e.mph || 0);
    });

    // Add department efficiency from labour productivity targets
    (labourData || []).forEach((e: any) => {
      const deptId = e.department_id || "unknown";
      if (deptMap.has(deptId)) {
        deptMap.get(deptId)!.targetQty += (e.target_quantity || 0);
        deptMap.get(deptId)!.actualQty += (e.actual_quantity || 0);
      }
    });
    
    const rows = Array.from(deptMap.values()).map(d => ({
      ...d,
      net: d.authorized - d.used,
      status: d.authorized - d.used >= 0 ? "Saved" : "Loss",
      efficiency: d.targetQty > 0 ? ((d.actualQty / d.targetQty) * 100) : 0,
    }));
    const totalAuth = rows.reduce((s, r) => s + r.authorized, 0);
    const totalUsed = rows.reduce((s, r) => s + r.used, 0);
    return { rows: rows.sort((a, b) => a.name.localeCompare(b.name)), totalAuth, totalUsed, totalNet: totalAuth - totalUsed };
  }, [mphProductionEntries, mphCalculatingNumbers, mphUsed, labourData]);

  // Material Consumption Analysis stats
  const consumptionStats = useMemo(() => {
    if (!consumptionProduction || !consumptionBom || !consumptionClosing) return { rows: [], totalStandard: 0, totalActual: 0, totalLoss: 0 };

    const standardByMaterial: Record<string, { code: string; name: string; unit: string; priority: string; standard: number }> = {};
    consumptionProduction.forEach((prod: any) => {
      const bomItems = consumptionBom.filter((b: any) => b.product_id === prod.product_id);
      bomItems.forEach((b: any) => {
        const id = b.raw_material_id;
        if (!standardByMaterial[id]) {
          standardByMaterial[id] = { code: b.raw_material?.code || "", name: b.raw_material?.name || "Unknown", unit: b.raw_material?.unit || "kg", priority: b.raw_material?.priority || "medium", standard: 0 };
        }
        standardByMaterial[id].standard += Number(b.standard_quantity) * Number(prod.quantity_produced);
      });
    });

    const actualByMaterial: Record<string, number> = {};
    consumptionClosing.forEach((c: any) => {
      actualByMaterial[c.raw_material_id] = (actualByMaterial[c.raw_material_id] || 0) + Number(c.actual_consumption);
    });

    const allIds = new Set([...Object.keys(standardByMaterial), ...Object.keys(actualByMaterial)]);
    const rows: any[] = [];
    allIds.forEach((id) => {
      const sd = standardByMaterial[id];
      const actual = actualByMaterial[id] || 0;
      const standard = sd?.standard || 0;
      let info = sd || { code: "", name: "", unit: "kg", priority: "medium" };
      if (!sd) {
        const ci = consumptionClosing.find((c: any) => c.raw_material_id === id);
        if (ci?.raw_material) info = { code: (ci.raw_material as any).code, name: (ci.raw_material as any).name, unit: (ci.raw_material as any).unit, priority: (ci.raw_material as any).priority || "medium", standard: 0 };
      }
      const variance = actual - standard;
      const variancePct = standard > 0 ? (variance / standard) * 100 : actual > 0 ? 100 : 0;
      rows.push({ id, code: info.code, name: info.name, unit: info.unit, priority: info.priority, standard, actual, variance, variancePct, loss: variance > 0 ? variance : 0 });
    });

    rows.sort((a, b) => Math.abs(b.variancePct) - Math.abs(a.variancePct));

    // Filter by selected materials
    const filteredRows = selectedMaterialIds.length > 0
      ? rows.filter(r => selectedMaterialIds.includes(r.id))
      : rows;

    const totalStandard = filteredRows.reduce((s, r) => s + r.standard, 0);
    const totalActual = filteredRows.reduce((s, r) => s + r.actual, 0);
    const totalLoss = filteredRows.reduce((s, r) => s + r.loss, 0);
    return { rows: filteredRows, totalStandard, totalActual, totalLoss };
  }, [consumptionProduction, consumptionBom, consumptionClosing, selectedMaterialIds]);

  // Monthly variance per material
  const monthlyVarianceMap = useMemo(() => {
    const map: Record<string, number> = {};
    if (!monthlyProduction || !consumptionBom || !monthlyClosing) return map;

    const stdByMat: Record<string, number> = {};
    monthlyProduction.forEach((prod: any) => {
      const bomItems = consumptionBom.filter((b: any) => b.product_id === prod.product_id);
      bomItems.forEach((b: any) => {
        stdByMat[b.raw_material_id] = (stdByMat[b.raw_material_id] || 0) + Number(b.standard_quantity) * Number(prod.quantity_produced);
      });
    });

    const actByMat: Record<string, number> = {};
    monthlyClosing.forEach((c: any) => {
      actByMat[c.raw_material_id] = (actByMat[c.raw_material_id] || 0) + Number(c.actual_consumption);
    });

    const allIds = new Set([...Object.keys(stdByMat), ...Object.keys(actByMat)]);
    allIds.forEach((id) => {
      map[id] = (actByMat[id] || 0) - (stdByMat[id] || 0);
    });
    return map;
  }, [monthlyProduction, consumptionBom, monthlyClosing]);

  const activeEmployeeCount = employeesData?.length || 0;
  const absentToday = useMemo(() => {
    return (attendanceToday || []).filter(a => a.status === "absent").length;
  }, [attendanceToday]);

  // Project Management metrics
  const projectMetrics = useMemo(() => {
    const all = projectsData || [];
    const now = new Date();
    const todayStr = format(now, "yyyy-MM-dd");
    return {
      total: all.length,
      active: all.filter(p => p.status === "in_progress").length,
      completed: all.filter(p => p.status === "completed").length,
      overdue: all.filter(p => p.status !== "completed" && p.status !== "cancelled" && p.target_end_date && p.target_end_date < todayStr).length,
    };
  }, [projectsData]);

  // R&D metrics
  const rdMetrics = useMemo(() => {
    const all = rdProjectsData || [];
    const active = all.filter(p => p.status === "active");
    return {
      total: all.length,
      active: active.length,
      testing: all.filter(p => p.current_stage === "testing").length,
      launched: all.filter(p => p.current_stage === "launch").length,
    };
  }, [rdProjectsData]);

  const RD_STAGES = ["idea", "feasibility", "development", "testing", "validation", "launch"];
  const RD_STAGE_LABELS: Record<string, string> = { idea: "Idea", feasibility: "Feasibility", development: "Development", testing: "Testing", validation: "Validation", launch: "Launch" };
  const RD_STAGE_COLORS: Record<string, string> = { idea: "bg-blue-500", feasibility: "bg-yellow-500", development: "bg-orange-500", testing: "bg-purple-500", validation: "bg-cyan-500", launch: "bg-green-500" };

  const rdStageCounts = useMemo(() => {
    const active = (rdProjectsData || []).filter(p => p.status === "active");
    return RD_STAGES.map(s => ({ stage: s, count: active.filter(p => p.current_stage === s).length }));
  }, [rdProjectsData]);

  // Dev tasks metrics
  const devTaskMetrics = useMemo(() => {
    const all = devTasksData || [];
    return {
      total: all.length,
      draft: all.filter(t => t.status === "draft").length,
      inProgress: all.filter(t => t.status === "in_progress").length,
      pendingApproval: all.filter(t => t.status === "pending_approval").length,
      approved: all.filter(t => t.status === "approved").length,
      closed: all.filter(t => t.status === "closed").length,
    };
  }, [devTasksData]);

  // Maintenance Module Analysis metrics
  const maintenanceMetrics = useMemo(() => {
    const wo = allWorkOrders || [];
    const bd = allBreakdowns || [];
    const spares = sparePartsData || [];
    const issues = sparePartIssuesData || [];
    const pm = pmSchedules || [];
    const todayStr = format(new Date(), "yyyy-MM-dd");

    const totalWO = wo.length;
    const draftWO = wo.filter(w => w.status === "draft").length;
    const closedWO = wo.filter(w => w.status === "closed").length;
    const rejectedWO = wo.filter(w => w.status === "rejected").length;

    const totalBD = bd.length;
    const activeBD = bd.filter(b => b.status === "draft" || b.status === "in_progress").length;
    const totalDowntime = bd.reduce((s, b) => s + (b.downtime_minutes || 0), 0);
    const avgDowntime = totalBD > 0 ? totalDowntime / totalBD : 0;

    // Period breakdowns
    const periodBD = bd.filter(b => b.breakdown_start >= dateRange.start && b.breakdown_start <= dateRange.end + "T23:59:59");
    const periodDowntime = periodBD.reduce((s, b) => s + (b.downtime_minutes || 0), 0);

    // Spare parts
    const totalSpares = spares.length;
    const lowStockSpares = spares.filter(s => s.current_stock <= s.minimum_stock).length;
    const inventoryValue = spares.reduce((s, p) => s + (p.current_stock || 0) * (p.unit_cost || 0), 0);
    const criticalSpares = spares.filter(s => s.current_stock === 0);

    // Spare issues cost in period
    const issuesCost = issues.reduce((s, i) => {
      const cost = (i.spare_parts as any)?.unit_cost || 0;
      return s + (i.quantity_issued || 0) * cost;
    }, 0);

    // PM schedules
    const overduePM = pm.filter(p => p.next_due_date && p.next_due_date < todayStr && p.is_active).length;
    const totalPM = pm.length;

    // Breakdown by priority
    const bdByPriority = {
      critical: bd.filter(b => b.priority === "critical").length,
      high: bd.filter(b => b.priority === "high").length,
      medium: bd.filter(b => b.priority === "medium").length,
      low: bd.filter(b => b.priority === "low").length,
    };

    // Top 5 low-stock spares
    const topLowStock = [...spares]
      .filter(s => s.current_stock <= s.minimum_stock)
      .sort((a, b) => (a.current_stock / Math.max(a.minimum_stock, 1)) - (b.current_stock / Math.max(b.minimum_stock, 1)))
      .slice(0, 5);

    return {
      totalWO, draftWO, closedWO, rejectedWO,
      totalBD, activeBD, totalDowntime, avgDowntime, periodDowntime, periodBDCount: periodBD.length,
      totalSpares, lowStockSpares, inventoryValue, criticalSpares, issuesCost,
      overduePM, totalPM, bdByPriority, topLowStock,
    };
  }, [allWorkOrders, allBreakdowns, sparePartsData, sparePartIssuesData, pmSchedules, dateRange]);

  // Online Sales Analysis metrics
  const onlineSalesMetrics = useMemo(() => {
    const orders = onlineOrders || [];
    const returns = onlineReturns || [];

    const totalOrders = orders.length;
    const totalValue = orders.reduce((s, o) => s + (o.order_value || 0), 0);
    const totalQty = orders.reduce((s, o) => s + (o.quantity || 0), 0);
    const confirmedOrders = orders.filter(o => ["confirmed", "dispatched", "delivered", "sent_to_courier"].includes(o.status || "")).length;
    const deliveredOrders = orders.filter(o => o.status === "delivered").length;
    const totalReturns = returns.length;
    const returnRate = totalOrders > 0 ? ((totalReturns / totalOrders) * 100).toFixed(1) : "0.0";
    const codOrders = orders.filter(o => o.payment_mode === "cod").length;
    const prepaidOrders = orders.filter(o => o.payment_mode === "prepaid").length;
    const totalShipping = orders.reduce((s, o) => s + (o.shipping_charges || 0), 0);
    const totalNetAmount = orders.reduce((s, o) => s + (o.net_amount || 0), 0);

    // Platform distribution
    const platformMap = new Map<string, { count: number; value: number }>();
    orders.forEach(o => {
      const p = o.platform || "Unknown";
      const existing = platformMap.get(p) || { count: 0, value: 0 };
      existing.count++;
      existing.value += (o.order_value || 0);
      platformMap.set(p, existing);
    });
    const platformData = Array.from(platformMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.count - a.count);

    // Status distribution
    const statusMap = new Map<string, number>();
    orders.forEach(o => {
      const s = o.status || "unknown";
      statusMap.set(s, (statusMap.get(s) || 0) + 1);
    });
    const statusData = Array.from(statusMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // Return reasons
    const reasonMap = new Map<string, number>();
    returns.forEach(r => {
      const reason = r.return_reason || "Unknown";
      reasonMap.set(reason, (reasonMap.get(reason) || 0) + 1);
    });
    const returnReasons = Array.from(reasonMap.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    return {
      totalOrders, totalValue, totalQty, confirmedOrders, deliveredOrders,
      totalReturns, returnRate, codOrders, prepaidOrders,
      totalShipping, totalNetAmount, platformData, statusData, returnReasons,
    };
  }, [onlineOrders, onlineReturns]);

  // ============ CHART DATA ============

  const productionTrendChart = useMemo(() => {
    const days = eachDayOfInterval({ start: subDays(new Date(), 30), end: new Date() });
    const map = new Map<string, number>();
    (productionTrend || []).forEach(e => {
      const d = e.entry_date;
      map.set(d, (map.get(d) || 0) + (e.quantity_ok || 0));
    });
    return days.map(d => {
      const key = format(d, "yyyy-MM-dd");
      return { date: format(d, "dd MMM"), qty: map.get(key) || 0 };
    });
  }, [productionTrend]);

  const salesVsDispatchChart = useMemo(() => {
    const months: { label: string; sales: number; dispatch: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const m = subMonths(new Date(), i);
      const label = format(m, "MMM yy");
      const mStart = format(startOfMonth(m), "yyyy-MM-dd");
      const mEnd = format(endOfMonth(m), "yyyy-MM-dd");

      const sales = (salesForChart || [])
        .filter(o => o.order_date >= mStart && o.order_date <= mEnd)
        .reduce((s, o) => s + (o.total_amount || 0), 0);

      const dispatch = (dispatchData || [])
        .filter(d => d.dispatch_date >= mStart && d.dispatch_date <= mEnd)
        .reduce((s, d) => {
          const items = (d.sales_dispatch_items as any[]) || [];
          return s + items.reduce((ss: number, i: any) => ss + (i.quantity_dozens || 0), 0);
        }, 0);

      months.push({ label, sales: Math.round(sales), dispatch: Math.round(dispatch) });
    }
    return months;
  }, [salesForChart, dispatchData]);

  const deptProductionChart = useMemo(() => {
    const map = new Map<string, number>();
    (productionData || []).forEach(e => {
      const dept = (e.production_departments as any)?.name || "Unknown";
      map.set(dept, (map.get(dept) || 0) + (e.quantity_ok || 0));
    });
    return Array.from(map.entries())
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 8);
  }, [productionData]);

  const expenseBreakdownChart = useMemo(() => {
    const map = new Map<string, { value: number; details: { date: string; ref: string; description: string; amount: number }[] }>();
    const getOrCreate = (cat: string) => {
      if (!map.has(cat)) map.set(cat, { value: 0, details: [] });
      return map.get(cat)!;
    };
    (pettyCash || []).forEach((e: any) => {
      const cat = e.expense_categories?.name || "Petty Cash";
      const entry = getOrCreate(cat);
      entry.value += (e.amount || 0);
      entry.details.push({ date: e.entry_date, ref: e.entry_number || "", description: e.description || e.paid_to || "", amount: e.amount || 0 });
    });
    (generalExpenses || []).forEach((e: any) => {
      const cat = e.expense_categories?.name || "General";
      const entry = getOrCreate(cat);
      entry.value += (e.amount || 0);
      entry.details.push({ date: e.expense_date, ref: e.expense_number || "", description: e.description || e.vendor_name || "", amount: e.amount || 0 });
    });
    (utilityBills || []).forEach((e: any) => {
      const cat = e.utility_types?.name || "Utility";
      const entry = getOrCreate(cat);
      entry.value += (e.total_amount || 0);
      entry.details.push({ date: e.bill_date, ref: e.bill_number || "", description: e.remarks || "", amount: e.total_amount || 0 });
    });
    return Array.from(map.entries()).map(([name, data]) => ({ name, value: Math.round(data.value), details: data.details.sort((a, b) => b.amount - a.amount) }));
  }, [pettyCash, generalExpenses, utilityBills]);

  const recentOrders = useMemo(() => {
    return (salesOrders || []).slice(0, 5);
  }, [salesOrders]);

  // ============ EXPORT FUNCTIONS (kept from original) ============

  const fetchAllData = async () => {
    const tables = [
      "production_departments", "designations", "grades", "units_of_measure",
      "app_users", "employees", "products", "items", "customers", "suppliers",
      "sales_orders", "sales_order_items", "sales_dispatches", "sales_dispatch_items",
      "purchase_orders", "purchase_order_items", "goods_receipt_notes", "grn_items",
      "production_entries", "machines", "breakdown_logs", "maintenance_work_orders",
      "attendance", "leave_requests", "employee_leave_balances",
    ];
    const result: Record<string, any[]> = {};
    for (const table of tables) {
      const { data } = await supabase.from(table as any).select("*").limit(5000);
      result[table] = data || [];
    }
    return result;
  };

  const handleExportData = async () => {
    setIsExporting(true);
    toast.info("Exporting data...");
    try {
      const data = await fetchAllData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cansport_erp_data_${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Data exported successfully!");
    } catch (error) {
      toast.error("Failed to export data");
    } finally {
      setIsExporting(false);
    }
  };

  const formatCurrency = (val: number) => {
    if (val >= 10000000) return `Rs. ${(val / 10000000).toFixed(1)}Cr`;
    if (val >= 100000) return `Rs. ${(val / 100000).toFixed(1)}L`;
    if (val >= 1000) return `Rs. ${(val / 1000).toFixed(1)}K`;
    return `Rs. ${val.toLocaleString()}`;
  };

  const STATUS_COLORS: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    confirmed: "bg-blue-500 text-white",
    in_production: "bg-purple-500 text-white",
    ready: "bg-green-500 text-white",
    dispatched: "bg-emerald-500 text-white",
    partially_dispatched: "bg-amber-500 text-white",
    cancelled: "bg-red-500 text-white",
  };

  return (
    <ERPLayout>
      <div className="space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="page-title">CEO Dashboard</h1>
            <p className="page-description">
              Real-time overview of Cansport Global Industries.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yesterday">Yesterday</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="week">This Week</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
                <SelectItem value="custom">Custom Date</SelectItem>
              </SelectContent>
            </Select>
            {period === "custom" && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-[160px] justify-start text-left font-normal", !customDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {customDate ? format(customDate, "dd MMM yyyy") : "Pick date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={customDate}
                    onSelect={setCustomDate}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            )}
            {isSuperAdmin && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="gap-2" disabled={isExporting}>
                    {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64 bg-popover">
                  <DropdownMenuItem asChild>
                    <a href="/cansport_erp_schema.sql" download className="flex items-center gap-2 cursor-pointer">
                      <Database className="h-4 w-4" />
                      PostgreSQL Schema (SQL)
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleExportData} className="flex items-center gap-2 cursor-pointer">
                    <FileJson className="h-4 w-4" />
                    All Data (JSON)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {/* KPI Cards Row 1 */}
        <div className="dashboard-grid">
          <MetricCard
            title="Production Output"
            value={totalProduction.toLocaleString()}
            icon={Factory}
            description={`Local Final: ${localFinalOutput.toLocaleString()} | Fancy Final: ${fancyFinalOutput.toLocaleString()} | Rejected: ${totalRejected.toLocaleString()}`}
            iconColor="bg-blue-100 text-blue-600"
          />
          <MetricCard
            title="QA Pass Rate"
            value={`${qaPassRate}%`}
            icon={ClipboardCheck}
            iconColor="bg-green-100 text-green-600"
          />
          <MetricCard
            title="Sales Value"
            value={formatCurrency(monthlySales)}
            icon={ShoppingCart}
            description={`${salesOrders?.length || 0} orders`}
            iconColor="bg-cyan-100 text-cyan-600"
          />
          <MetricCard
            title="Expenses"
            value={formatCurrency(totalExpenses)}
            icon={IndianRupee}
            iconColor="bg-red-100 text-red-600"
          />
        </div>

        {/* KPI Cards Row 2 */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Active Employees"
            value={activeEmployeeCount.toString()}
            icon={Users}
            description={`${absentToday} absent today`}
            iconColor="bg-purple-100 text-purple-600"
          />
          <MetricCard
            title="Pending POs"
            value={(pendingPOs?.length || 0).toString()}
            icon={Package}
            iconColor="bg-indigo-100 text-indigo-600"
          />
          <MetricCard
            title="Active Breakdowns"
            value={(activeBreakdowns?.length || 0).toString()}
            icon={Wrench}
            description={activeBreakdowns?.filter(b => b.priority === "critical").length ? `${activeBreakdowns.filter(b => b.priority === "critical").length} critical` : undefined}
            iconColor="bg-amber-100 text-amber-600"
          />
          <MetricCard
            title="Labour Efficiency"
            value={`${labourEfficiency}%`}
            icon={Zap}
            iconColor="bg-pink-100 text-pink-600"
          />
        </div>

        {/* Accounting KPI Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Revenue"
            value={formatCurrency(financeKPIs.revenue)}
            icon={Landmark}
            description={financeKPIs.periodName ? `As of ${financeKPIs.periodName}` : "No ledger data"}
            iconColor="bg-emerald-100 text-emerald-600"
          />
          <MetricCard
            title="Gross Profit"
            value={formatCurrency(financeKPIs.grossProfit)}
            icon={TrendingUp}
            description={financeKPIs.revenue > 0 ? `${((financeKPIs.grossProfit / financeKPIs.revenue) * 100).toFixed(0)}% margin` : undefined}
            iconColor="bg-teal-100 text-teal-600"
          />
          <MetricCard
            title="Net Profit"
            value={formatCurrency(financeKPIs.netProfit)}
            icon={Receipt}
            description={financeKPIs.revenue > 0 ? `${((financeKPIs.netProfit / financeKPIs.revenue) * 100).toFixed(0)}% margin` : undefined}
            iconColor={financeKPIs.netProfit >= 0 ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600"}
          />
          <MetricCard
            title="Total Assets"
            value={formatCurrency(financeKPIs.assets)}
            icon={Wallet}
            description={financeKPIs.periodName ? `As of ${financeKPIs.periodName}` : "No ledger data"}
            iconColor="bg-slate-100 text-slate-600"
          />
        </div>

        {/* Charts Row 1 */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Production Trend */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-display">Production Trend (30 Days)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={productionTrendChart}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="qty" name="Production" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Sales vs Dispatch */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-display">Sales vs Dispatch (6 Months)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={salesVsDispatchChart}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="sales" name="Sales (Rs.)" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="dispatch" name="Dispatch (Dzn)" fill="hsl(160 60% 45%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts Row 2 */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Department-wise Production */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-display">Department-wise Production</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[280px]">
                {deptProductionChart.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={deptProductionChart} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={100} />
                      <Tooltip />
                      <Bar dataKey="qty" name="Quantity" fill="hsl(220 70% 55%)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-muted-foreground text-center pt-20">No production data for this period</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Expense Breakdown */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-display">Expense Breakdown</CardTitle>
                <Badge variant="outline" className="text-xs">{formatCurrency(totalExpenses)}</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {expenseBreakdownChart.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expenseBreakdownChart
                      .sort((a, b) => b.value - a.value)
                      .map((item, i) => {
                        const pct = totalExpenses > 0 ? ((item.value / totalExpenses) * 100) : 0;
                        const isExpanded = expandedExpenseCategories.has(item.name);
                        return (
                          <>
                            <TableRow key={item.name} className="cursor-pointer hover:bg-muted/50" onClick={() => {
                              setExpandedExpenseCategories(prev => {
                                const next = new Set(prev);
                                if (next.has(item.name)) next.delete(item.name); else next.add(item.name);
                                return next;
                              });
                            }}>
                              <TableCell className="text-sm font-medium">
                                <div className="flex items-center gap-2">
                                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                                  <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                                  {item.name}
                                  <Badge variant="secondary" className="text-[10px] ml-1">{item.details.length}</Badge>
                                </div>
                              </TableCell>
                              <TableCell className="text-right text-sm font-semibold">{formatCurrency(item.value)}</TableCell>
                              <TableCell className="text-right text-sm">
                                <div className="flex items-center justify-end gap-2">
                                  <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                                    <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                                  </div>
                                  <span className="text-muted-foreground w-12 text-right">{pct.toFixed(1)}%</span>
                                </div>
                              </TableCell>
                            </TableRow>
                            {isExpanded && item.details.map((d, di) => (
                              <TableRow key={`${item.name}-${di}`} className="bg-muted/30">
                                <TableCell className="text-xs pl-10" colSpan={1}>
                                  <div className="flex flex-col">
                                    <span className="text-foreground">{d.description || "—"}</span>
                                    <span className="text-muted-foreground">{d.ref}</span>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right text-xs">{formatCurrency(d.amount)}</TableCell>
                                <TableCell className="text-right text-xs text-muted-foreground">{d.date ? format(new Date(d.date), "dd MMM") : "—"}</TableCell>
                              </TableRow>
                            ))}
                          </>
                        );
                      })}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No expense data for this period</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Tables Row */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Recent Domestic Sales Orders */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-display">Recent Domestic Orders</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {recentOrders.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order #</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentOrders.map(order => (
                      <TableRow key={order.id}>
                        <TableCell className="font-medium text-sm">{order.order_number}</TableCell>
                        <TableCell className="text-sm">{(order.customers as any)?.name || "-"}</TableCell>
                        <TableCell className="text-sm">{formatCurrency(order.total_amount || 0)}</TableCell>
                        <TableCell>
                          <Badge className={`${STATUS_COLORS[order.status] || "bg-muted"} text-xs`}>
                            {order.status?.replace(/_/g, " ")}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No orders in this period</p>
              )}
            </CardContent>
          </Card>

          {/* Active Breakdowns */}
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-lg font-display">Active Breakdowns</CardTitle>
              {(activeBreakdowns?.length || 0) > 0 && (
                <Badge variant="destructive">{activeBreakdowns?.length}</Badge>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {(activeBreakdowns?.length || 0) > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>BD #</TableHead>
                      <TableHead>Machine</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeBreakdowns?.map(bd => (
                      <TableRow key={bd.id}>
                        <TableCell className="font-medium text-sm">{bd.breakdown_number}</TableCell>
                        <TableCell className="text-sm">{(bd.machines as any)?.name || "-"}</TableCell>
                        <TableCell>
                          <Badge variant={bd.priority === "critical" ? "destructive" : "secondary"} className="text-xs">
                            {bd.priority}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{bd.status?.replace(/_/g, " ")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No active breakdowns 🎉</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Today & Yesterday Dispatch Details */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-display flex items-center gap-2">
              <Truck className="h-5 w-5 text-emerald-600" />
              Dispatch Details (Today & Yesterday)
              <Badge variant="outline" className="ml-2">{(recentDispatches || []).length} dispatches</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {(recentDispatches || []).length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>DC #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-center">Qty (Dzn)</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(recentDispatches || []).map(d => {
                    const totalQty = ((d.sales_dispatch_items as any[]) || []).reduce((s: number, i: any) => s + (i.quantity_dozens || 0), 0);
                    const isToday = d.dispatch_date === today;
                    return (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium text-sm">{d.dispatch_number}</TableCell>
                        <TableCell className="text-sm">
                          <Badge variant={isToday ? "default" : "secondary"} className="text-xs">
                            {isToday ? "Today" : "Yesterday"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{(d.sales_orders as any)?.customers?.name || "-"}</TableCell>
                        <TableCell className="text-center text-sm font-medium">{totalQty}</TableCell>
                        <TableCell className="text-sm">{d.vehicle_number || "-"}</TableCell>
                        <TableCell>
                          <Badge className={`${STATUS_COLORS[d.delivery_status] || "bg-muted"} text-xs`}>
                            {d.delivery_status?.replace(/_/g, " ") || "-"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No dispatches for today or yesterday</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-display flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-green-600" />
              QA Inspection Results
              <Badge variant="outline" className="ml-2">
                {selectedQAProcessIds.length > 0 ? `${selectedQAProcessIds.length} selected` : `${qaStats.total} inspections`}
              </Badge>
            </CardTitle>
            <div className="flex items-center gap-2 mt-2">
              <Popover open={qaProcessPopoverOpen} onOpenChange={setQAProcessPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="justify-between min-w-[200px]">
                    <span className="truncate">
                      {selectedQAProcessIds.length > 0
                        ? `${selectedQAProcessIds.length} process${selectedQAProcessIds.length > 1 ? "es" : ""} selected`
                        : "Select Key Processes"}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search processes..." />
                    <CommandList>
                      <CommandEmpty>No processes found.</CommandEmpty>
                      <CommandGroup>
                        {selectedQAProcessIds.length > 0 && (
                          <CommandItem
                            onSelect={() => updateSelectedQAProcesses([])}
                            className="text-red-600 font-medium"
                          >
                            <X className="mr-2 h-4 w-4" />
                            Clear All
                          </CommandItem>
                        )}
                        {(allQAProcesses || []).map((proc) => {
                          const isSelected = selectedQAProcessIds.includes(proc.id);
                          return (
                            <CommandItem
                              key={proc.id}
                              value={`${proc.code} ${proc.name}`}
                              onSelect={() => {
                                updateSelectedQAProcesses(prev =>
                                  isSelected
                                    ? prev.filter(id => id !== proc.id)
                                    : [...prev, proc.id]
                                );
                              }}
                            >
                              <Checkbox checked={isSelected} className="mr-2" />
                              <span className="font-mono text-xs mr-2">{proc.code}</span>
                              <span className="truncate">{proc.name}</span>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex gap-4 text-sm mt-1">
              <span className="text-green-600 font-semibold">Pass: {qaStats.passed} ({qaStats.passRate}%)</span>
              <span className="text-red-600 font-semibold">Fail: {qaStats.failed}</span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {qaStats.byProcess.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Process Code</TableHead>
                    <TableHead>Process Name</TableHead>
                    <TableHead className="text-center">Total</TableHead>
                    <TableHead className="text-center">Pass</TableHead>
                    <TableHead className="text-center">Fail</TableHead>
                    <TableHead className="text-center">Pass %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {qaStats.byProcess.map((proc) => {
                    const passPercent = proc.total > 0 ? ((proc.passed / proc.total) * 100).toFixed(1) : "0.0";
                    const isLow = parseFloat(passPercent) < 80;
                    return (
                      <TableRow key={proc.code}>
                        <TableCell className="font-mono text-sm font-medium">{proc.code}</TableCell>
                        <TableCell className="text-sm">{proc.name}</TableCell>
                        <TableCell className="text-center text-sm">{proc.total}</TableCell>
                        <TableCell className="text-center text-sm text-green-600 font-medium">{proc.passed}</TableCell>
                        <TableCell className="text-center text-sm text-red-600 font-medium">{proc.failed}</TableCell>
                        <TableCell className="text-center">
                          <Badge className={`text-xs ${isLow ? "bg-red-500 text-white" : "bg-green-500 text-white"}`}>
                            {passPercent}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No QA inspections in this period</p>
            )}
          </CardContent>
        </Card>

        {/* Department-wise MPH Status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-display flex items-center gap-2">
              <Zap className="h-5 w-5 text-pink-600" />
              Department-wise MPH Status
              <Badge variant="outline" className="ml-2">
                Net: {mphStats.totalNet >= 0 ? "+" : ""}{mphStats.totalNet.toFixed(1)} hrs
              </Badge>
            </CardTitle>
            <div className="flex gap-4 text-sm mt-1">
              <span className="font-semibold">Authorized: {mphStats.totalAuth.toFixed(1)} hrs</span>
              <span className="font-semibold">Used: {mphStats.totalUsed.toFixed(1)} hrs</span>
              <span className={`font-semibold ${mphStats.totalNet >= 0 ? "text-green-600" : "text-red-600"}`}>
                {mphStats.totalNet >= 0 ? "Saved" : "Loss"}: {Math.abs(mphStats.totalNet).toFixed(1)} hrs
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {mphStats.rows.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Department</TableHead>
                    <TableHead className="text-center">Authorized (hrs)</TableHead>
                    <TableHead className="text-center">Used (hrs)</TableHead>
                    <TableHead className="text-center">Net (hrs)</TableHead>
                    <TableHead className="text-center">Efficiency</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mphStats.rows.map((row) => (
                    <TableRow key={row.name}>
                      <TableCell className="text-sm font-medium">{row.name}</TableCell>
                      <TableCell className="text-center text-sm">{row.authorized.toFixed(1)}</TableCell>
                      <TableCell className="text-center text-sm">{row.used.toFixed(1)}</TableCell>
                      <TableCell className="text-center text-sm font-medium">
                        {row.net >= 0 ? "+" : ""}{row.net.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={`text-sm font-semibold ${row.efficiency < 80 ? "text-red-600" : "text-green-600"}`}>
                          {row.efficiency > 0 ? `${row.efficiency.toFixed(0)}%` : "-"}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge className={`text-xs ${row.status === "Saved" ? "bg-green-500 text-white" : "bg-red-500 text-white"}`}>
                          {row.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No MPH data for this period</p>
            )}
          </CardContent>
        </Card>

        {/* Material Consumption Analysis */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-display flex items-center gap-2">
              <Beaker className="h-5 w-5 text-orange-600" />
              Material Consumption Analysis
              <Badge variant="outline" className="ml-2">
                {selectedMaterialIds.length > 0 ? `${selectedMaterialIds.length} selected` : `${consumptionStats.rows.length} materials`}
              </Badge>
            </CardTitle>
            <div className="flex items-center gap-2 mt-2">
              <Popover open={materialPopoverOpen} onOpenChange={setMaterialPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="justify-between min-w-[200px]">
                    <span className="truncate">
                      {selectedMaterialIds.length > 0
                        ? `${selectedMaterialIds.length} material${selectedMaterialIds.length > 1 ? "s" : ""} selected`
                        : "Select Key Materials"}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search materials..." />
                    <CommandList>
                      <CommandEmpty>No materials found.</CommandEmpty>
                      <CommandGroup>
                        {selectedMaterialIds.length > 0 && (
                          <CommandItem
                            onSelect={() => updateSelectedMaterials([])}
                            className="text-red-600 font-medium"
                          >
                            <X className="mr-2 h-4 w-4" />
                            Clear All
                          </CommandItem>
                        )}
                        {(allRawMaterials || []).map((mat) => {
                          const isSelected = selectedMaterialIds.includes(mat.id);
                          return (
                            <CommandItem
                              key={mat.id}
                              value={`${mat.code} ${mat.name}`}
                              onSelect={() => {
                                updateSelectedMaterials(prev =>
                                  isSelected
                                    ? prev.filter(id => id !== mat.id)
                                    : [...prev, mat.id]
                                );
                              }}
                            >
                              <Checkbox checked={isSelected} className="mr-2" />
                              <span className="font-mono text-xs mr-2">{mat.code}</span>
                              <span className="truncate">{mat.name}</span>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex gap-4 text-sm mt-1 flex-wrap">
              <span className="font-semibold">Standard: {consumptionStats.totalStandard.toFixed(2)} kg</span>
              <span className="font-semibold">Actual: {consumptionStats.totalActual.toFixed(2)} kg</span>
              <span className={`font-semibold ${consumptionStats.totalLoss > 0 ? "text-red-600" : "text-green-600"}`}>
                Loss: {consumptionStats.totalLoss.toFixed(2)} kg
                {consumptionStats.totalStandard > 0 && ` (${((consumptionStats.totalLoss / consumptionStats.totalStandard) * 100).toFixed(1)}%)`}
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {consumptionStats.rows.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead className="text-right">Standard</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                     <TableHead className="text-right">Variance</TableHead>
                     <TableHead className="text-right">Var %</TableHead>
                     <TableHead className="text-right">MTD Variance</TableHead>
                     <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consumptionStats.rows.slice(0, 15).map((item: any) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-sm">{item.code}</TableCell>
                      <TableCell className="text-sm font-medium">{item.name}</TableCell>
                      <TableCell className="text-right text-sm">{item.standard.toFixed(2)} {item.unit}</TableCell>
                      <TableCell className="text-right text-sm">{item.actual.toFixed(2)} {item.unit}</TableCell>
                      <TableCell className="text-right text-sm">
                        <span className={item.variance > 0 ? "text-red-600" : item.variance < 0 ? "text-green-600" : ""}>
                          {item.variance > 0 ? "+" : ""}{item.variance.toFixed(2)} {item.unit}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        <span className={Math.abs(item.variancePct) > 10 ? "text-red-600 font-semibold" : ""}>
                          {item.variancePct > 0 ? "+" : ""}{item.variancePct.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {(() => {
                          const mv = monthlyVarianceMap[item.id] || 0;
                          return (
                            <span className={mv > 0 ? "text-red-600 font-semibold" : mv < 0 ? "text-green-600" : ""}>
                              {mv > 0 ? "+" : ""}{mv.toFixed(2)} {item.unit}
                            </span>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-center">
                        {Math.abs(item.variancePct) > 10 ? (
                          <Badge className="bg-red-500 text-white text-xs">High</Badge>
                        ) : Math.abs(item.variancePct) > 5 ? (
                          <Badge variant="secondary" className="text-xs">Moderate</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">Normal</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No consumption data for this period</p>
            )}
          </CardContent>
        </Card>

        {/* Stock Closing Snapshot (Yesterday) */}
        {(() => {
          // Planning aggregation
          const planRows = planningClosingYesterday || [];
          const planByDept: Record<string, { name: string; items: number; qty: number; value: number }> = {};
          let planTotalQty = 0;
          let planTotalValue = 0;
          planRows.forEach((r: any) => {
            const dept = r.production_departments?.name || "Unassigned";
            const qty = Number(r.closing_quantity) || 0;
            const cv = Number(r.planning_items?.costing_value) || 0;
            const val = qty * cv;
            planTotalQty += qty;
            planTotalValue += val;
            if (!planByDept[dept]) planByDept[dept] = { name: dept, items: 0, qty: 0, value: 0 };
            planByDept[dept].items += 1;
            planByDept[dept].qty += qty;
            planByDept[dept].value += val;
          });
          const planDepts = Object.values(planByDept).sort((a, b) =>
            isSuperAdmin ? b.value - a.value : b.qty - a.qty
          ).slice(0, 5);

          // Consumption aggregation
          const consRows = consumptionClosingYesterday || [];
          const consByCat: Record<string, { name: string; items: number; qty: number; value: number }> = {};
          let consTotalQty = 0;
          let consTotalValue = 0;
          let consConsumed = 0;
          let consLowZero = 0;
          consRows.forEach((r: any) => {
            const cat = r.consumption_raw_materials?.category || "Uncategorized";
            const qty = Number(r.closing_quantity) || 0;
            const cv = Number(r.consumption_raw_materials?.cost_value) || 0;
            const threshold = Number(r.consumption_raw_materials?.threshold) || 0;
            const val = qty * cv;
            consTotalQty += qty;
            consTotalValue += val;
            consConsumed += Number(r.actual_consumption) || 0;
            if (qty === 0 || (threshold > 0 && qty <= threshold)) consLowZero += 1;
            if (!consByCat[cat]) consByCat[cat] = { name: cat, items: 0, qty: 0, value: 0 };
            consByCat[cat].items += 1;
            consByCat[cat].qty += qty;
            consByCat[cat].value += val;
          });
          const consCats = Object.values(consByCat).sort((a, b) =>
            isSuperAdmin ? b.value - a.value : b.qty - a.qty
          ).slice(0, 5);

          const fmtNum = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

          return (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-display font-semibold">Stock Closing Snapshot (Yesterday)</h2>
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Planning Closing Card */}
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-display flex items-center gap-2">
                        <Package className="h-4 w-4" />
                        Production Planning
                        <Badge variant="outline" className="ml-2 text-xs">Planning</Badge>
                      </CardTitle>
                      <Button variant="ghost" size="sm" onClick={() => navigate("/planning/closing-dashboard")} className="text-xs">
                        View <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {planRows.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">No planning closing entries for yesterday</p>
                    ) : (
                      <>
                        <div className={`grid ${isSuperAdmin ? "grid-cols-3" : "grid-cols-2"} gap-3 mb-4`}>
                          <div className="p-3 rounded-lg bg-muted/50">
                            <p className="text-xs text-muted-foreground">Items Closed</p>
                            <p className="text-lg font-bold">{planRows.length}</p>
                          </div>
                          <div className="p-3 rounded-lg bg-muted/50">
                            <p className="text-xs text-muted-foreground">Total Qty</p>
                            <p className="text-lg font-bold">{fmtNum(planTotalQty)}</p>
                          </div>
                          {isSuperAdmin && (
                            <div className="p-3 rounded-lg bg-muted/50">
                              <p className="text-xs text-muted-foreground">Stock Value</p>
                              <p className="text-lg font-bold text-green-700">{formatCurrency(planTotalValue)}</p>
                            </div>
                          )}
                        </div>
                        <div className="max-h-64 overflow-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs">Department</TableHead>
                                <TableHead className="text-xs text-right">Items</TableHead>
                                <TableHead className="text-xs text-right">Qty</TableHead>
                                {isSuperAdmin && <TableHead className="text-xs text-right">Value</TableHead>}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {planDepts.map((d) => (
                                <TableRow key={d.name}>
                                  <TableCell className="text-sm font-medium">{d.name}</TableCell>
                                  <TableCell className="text-sm text-right">{d.items}</TableCell>
                                  <TableCell className="text-sm text-right">{fmtNum(d.qty)}</TableCell>
                                  {isSuperAdmin && (
                                    <TableCell className="text-sm text-right font-semibold">{formatCurrency(d.value)}</TableCell>
                                  )}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                {/* Consumption Closing Card */}
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-display flex items-center gap-2">
                        <Beaker className="h-4 w-4" />
                        Material Consumption
                        <Badge variant="outline" className="ml-2 text-xs">Consumption</Badge>
                      </CardTitle>
                      <Button variant="ghost" size="sm" onClick={() => navigate("/consumption/stock-closing-dashboard")} className="text-xs">
                        View <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {consRows.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">No consumption closing entries for yesterday</p>
                    ) : (
                      <>
                        <div className={`grid ${isSuperAdmin ? "grid-cols-3 lg:grid-cols-5" : "grid-cols-3"} gap-3 mb-4`}>
                          <div className="p-3 rounded-lg bg-muted/50">
                            <p className="text-xs text-muted-foreground">Items Closed</p>
                            <p className="text-lg font-bold">{consRows.length}</p>
                          </div>
                          <div className="p-3 rounded-lg bg-muted/50">
                            <p className="text-xs text-muted-foreground">Closing Qty</p>
                            <p className="text-lg font-bold">{fmtNum(consTotalQty)}</p>
                          </div>
                          <div className="p-3 rounded-lg bg-muted/50">
                            <p className="text-xs text-muted-foreground">Consumed Qty</p>
                            <p className="text-lg font-bold">{fmtNum(consConsumed)}</p>
                          </div>
                          {isSuperAdmin && (
                            <div className="p-3 rounded-lg bg-muted/50">
                              <p className="text-xs text-muted-foreground">Closing Value</p>
                              <p className="text-lg font-bold text-green-700">{formatCurrency(consTotalValue)}</p>
                            </div>
                          )}
                          <div className="p-3 rounded-lg bg-muted/50">
                            <p className="text-xs text-muted-foreground">Low / Zero Stock</p>
                            <p className={`text-lg font-bold ${consLowZero > 0 ? "text-red-600" : ""}`}>{consLowZero}</p>
                          </div>
                        </div>
                        <div className="max-h-64 overflow-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs">Category</TableHead>
                                <TableHead className="text-xs text-right">Items</TableHead>
                                <TableHead className="text-xs text-right">Closing Qty</TableHead>
                                {isSuperAdmin && <TableHead className="text-xs text-right">Value</TableHead>}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {consCats.map((c) => (
                                <TableRow key={c.name}>
                                  <TableCell className="text-sm font-medium">{c.name}</TableCell>
                                  <TableCell className="text-sm text-right">{c.items}</TableCell>
                                  <TableCell className="text-sm text-right">{fmtNum(c.qty)}</TableCell>
                                  {isSuperAdmin && (
                                    <TableCell className="text-sm text-right font-semibold">{formatCurrency(c.value)}</TableCell>
                                  )}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                        {isSuperAdmin && (
                          <div className="mt-3 pt-3 border-t flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Total Closing Value</span>
                            <span className="font-bold text-green-700">{formatCurrency(consTotalValue)}</span>
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          );
        })()}

        {/* CRM Pipeline Snapshot */}
        {(() => {
          const leads = crmLeads || [];
          const deals = crmDeals || [];
          const acts = crmActivities || [];

          const activeLeadStatuses = ["new", "contacted", "qualified"];
          const activeLeads = leads.filter((l: any) => activeLeadStatuses.includes(l.status)).length;
          const leadStatusCounts = leads.reduce((acc: Record<string, number>, l: any) => {
            acc[l.status] = (acc[l.status] || 0) + 1;
            return acc;
          }, {});

          const closedStages = ["won", "lost", "closed_won", "closed_lost"];
          const openDeals = deals.filter((d: any) => !closedStages.includes((d.stage || "").toLowerCase()));
          const totalPipelineValue = openDeals.reduce((s: number, d: any) => s + Number(d.value || 0), 0);
          const weightedPipeline = openDeals.reduce(
            (s: number, d: any) => s + Number(d.value || 0) * (Number(d.probability || 0) / 100),
            0
          );

          const stageMap = new Map<string, { stage: string; deals: number; value: number; weighted: number }>();
          deals.forEach((d: any) => {
            const stage = d.stage || "unknown";
            const cur = stageMap.get(stage) || { stage, deals: 0, value: 0, weighted: 0 };
            cur.deals += 1;
            cur.value += Number(d.value || 0);
            cur.weighted += Number(d.value || 0) * (Number(d.probability || 0) / 100);
            stageMap.set(stage, cur);
          });
          const stageBreakdown = Array.from(stageMap.values()).sort((a, b) => b.value - a.value);

          const todayStr = format(new Date(), "yyyy-MM-dd");
          const openActivities = acts.filter((a: any) => !a.completed).length;
          const overdueActivities = acts.filter(
            (a: any) => !a.completed && a.due_date && a.due_date < todayStr
          ).length;
          const dueTodayActivities = acts.filter(
            (a: any) => !a.completed && a.due_date && a.due_date.slice(0, 10) === todayStr
          ).length;

          const stageLabel = (s: string) =>
            s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

          const leadOrder = ["new", "contacted", "qualified", "converted", "lost"];
          const leadColors: Record<string, string> = {
            new: "bg-blue-100 text-blue-700",
            contacted: "bg-amber-100 text-amber-700",
            qualified: "bg-violet-100 text-violet-700",
            converted: "bg-green-100 text-green-700",
            lost: "bg-red-100 text-red-700",
          };

          const hasAnyData = leads.length > 0 || deals.length > 0 || acts.length > 0;

          return (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-display font-semibold">CRM Pipeline Snapshot</h2>
                <Button variant="ghost" size="sm" onClick={() => navigate("/crm")} className="gap-1 text-xs">
                  View CRM <ArrowRight className="h-3 w-3" />
                </Button>
              </div>

              {!hasAnyData ? (
                <Card>
                  <CardContent className="py-10">
                    <p className="text-sm text-muted-foreground text-center">No CRM activity yet</p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <MetricCard
                      title="Active Leads"
                      value={activeLeads}
                      icon={Users}
                      iconColor="bg-blue-100 text-blue-600"
                      description={`${leads.length} total`}
                    />
                    <MetricCard
                      title="Open Deals"
                      value={openDeals.length}
                      icon={ShoppingCart}
                      iconColor="bg-violet-100 text-violet-600"
                      description={`${deals.length} total`}
                    />
                    <MetricCard
                      title={isSuperAdmin ? "Pipeline Value" : "Weighted Pipeline"}
                      value={
                        isSuperAdmin
                          ? formatCurrency(totalPipelineValue)
                          : openDeals.length.toString()
                      }
                      icon={IndianRupee}
                      iconColor="bg-green-100 text-green-600"
                      description={
                        isSuperAdmin ? `Weighted ${formatCurrency(weightedPipeline)}` : "Open deals"
                      }
                    />
                    <MetricCard
                      title="Open Activities"
                      value={openActivities}
                      icon={ClipboardCheck}
                      iconColor="bg-amber-100 text-amber-600"
                      description={`${overdueActivities} overdue`}
                    />
                  </div>

                  <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center justify-between">
                          <span>Pipeline by Stage</span>
                          <Badge variant="outline" className="text-xs">{deals.length} deals</Badge>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {stageBreakdown.length === 0 ? (
                          <p className="text-sm text-muted-foreground text-center py-8">No deals yet</p>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs">Stage</TableHead>
                                <TableHead className="text-xs text-right">Deals</TableHead>
                                {isSuperAdmin && <TableHead className="text-xs text-right">Value</TableHead>}
                                {isSuperAdmin && <TableHead className="text-xs text-right">Weighted</TableHead>}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {stageBreakdown.map((s) => (
                                <TableRow key={s.stage}>
                                  <TableCell className="text-sm font-medium">{stageLabel(s.stage)}</TableCell>
                                  <TableCell className="text-sm text-right">{s.deals}</TableCell>
                                  {isSuperAdmin && (
                                    <TableCell className="text-sm text-right font-semibold">
                                      {formatCurrency(s.value)}
                                    </TableCell>
                                  )}
                                  {isSuperAdmin && (
                                    <TableCell className="text-sm text-right text-muted-foreground">
                                      {formatCurrency(s.weighted)}
                                    </TableCell>
                                  )}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">Lead Funnel & Activity Health</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                            Lead Funnel
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {leadOrder.map((status) => (
                              <span
                                key={status}
                                className={cn(
                                  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
                                  leadColors[status] || "bg-slate-100 text-slate-700"
                                )}
                              >
                                <span className="capitalize">{status}</span>
                                <span className="font-bold">{leadStatusCounts[status] || 0}</span>
                              </span>
                            ))}
                          </div>
                        </div>

                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                            Activity Health
                          </p>
                          <div className="grid grid-cols-3 gap-2">
                            <div className="rounded-md border bg-red-50 dark:bg-red-950/20 p-3 text-center">
                              <p className="text-xs text-red-700 dark:text-red-400">Overdue</p>
                              <p className="text-xl font-bold text-red-700 dark:text-red-400">
                                {overdueActivities}
                              </p>
                            </div>
                            <div className="rounded-md border bg-amber-50 dark:bg-amber-950/20 p-3 text-center">
                              <p className="text-xs text-amber-700 dark:text-amber-400">Due Today</p>
                              <p className="text-xl font-bold text-amber-700 dark:text-amber-400">
                                {dueTodayActivities}
                              </p>
                            </div>
                            <div className="rounded-md border bg-muted/40 p-3 text-center">
                              <p className="text-xs text-muted-foreground">Open</p>
                              <p className="text-xl font-bold">{openActivities}</p>
                            </div>
                          </div>
                        </div>

                        <div className="pt-2 border-t flex items-center justify-between text-xs text-muted-foreground">
                          <span>Pipeline snapshot · live</span>
                          <Button
                            variant="link"
                            size="sm"
                            onClick={() => navigate("/crm")}
                            className="h-auto p-0 text-xs"
                          >
                            Open CRM dashboard →
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </>
              )}
            </div>
          );
        })()}

        {/* Maintenance Module Analysis */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard title="Total Work Orders" value={maintenanceMetrics.totalWO} icon={Wrench} iconColor="bg-orange-100 text-orange-600" description={`${maintenanceMetrics.draftWO} draft`} />
          <MetricCard title="Total Breakdowns" value={maintenanceMetrics.totalBD} icon={AlertTriangle} iconColor="bg-red-100 text-red-600" description={`${maintenanceMetrics.activeBD} active`} />
          <MetricCard title="Spare Parts" value={maintenanceMetrics.totalSpares} icon={Package} iconColor="bg-blue-100 text-blue-600" description={`${maintenanceMetrics.lowStockSpares} low stock`} />
          <MetricCard title="Spare Inventory Value" value={formatCurrency(maintenanceMetrics.inventoryValue)} icon={IndianRupee} iconColor="bg-green-100 text-green-600" />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Maintenance Summary Card */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-display flex items-center gap-2">
                  <Wrench className="h-5 w-5 text-orange-600" />
                  Maintenance Summary
                  <Badge variant="outline" className="ml-2 text-xs">Maintenance</Badge>
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={() => navigate("/maintenance")} className="text-xs">
                  View All <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                <div className="text-center p-2 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold">{maintenanceMetrics.totalWO}</p>
                  <p className="text-xs text-muted-foreground">Work Orders</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-slate-100 dark:bg-slate-800">
                  <p className="text-lg font-bold">{maintenanceMetrics.draftWO}</p>
                  <p className="text-xs text-muted-foreground">Draft WO</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-green-50 dark:bg-green-950/30">
                  <p className="text-lg font-bold text-green-600">{maintenanceMetrics.closedWO}</p>
                  <p className="text-xs text-muted-foreground">Closed WO</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-red-50 dark:bg-red-950/30">
                  <p className="text-lg font-bold text-red-600">{maintenanceMetrics.activeBD}</p>
                  <p className="text-xs text-muted-foreground">Active Breakdowns</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30">
                  <p className="text-lg font-bold text-amber-600">{maintenanceMetrics.overduePM}</p>
                  <p className="text-xs text-muted-foreground">Overdue PM</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-purple-50 dark:bg-purple-950/30">
                  <p className="text-lg font-bold text-purple-600">{Math.round(maintenanceMetrics.totalDowntime / 60)}h</p>
                  <p className="text-xs text-muted-foreground">Total Downtime</p>
                </div>
              </div>

              {/* Breakdown Priority Distribution */}
              <div className="mt-3">
                <p className="text-sm font-medium mb-2">Breakdown by Priority</p>
                <div className="flex gap-2">
                  {[
                    { label: "Critical", count: maintenanceMetrics.bdByPriority.critical, color: "bg-red-500" },
                    { label: "High", count: maintenanceMetrics.bdByPriority.high, color: "bg-orange-500" },
                    { label: "Medium", count: maintenanceMetrics.bdByPriority.medium, color: "bg-yellow-500" },
                    { label: "Low", count: maintenanceMetrics.bdByPriority.low, color: "bg-green-500" },
                  ].map(p => (
                    <div key={p.label} className="flex-1 text-center">
                      <div className={`${p.color} text-white rounded-md py-1 text-sm font-bold`}>{p.count}</div>
                      <p className="text-xs text-muted-foreground mt-1">{p.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Spare Parts Status */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-display flex items-center gap-2">
                  <Package className="h-5 w-5 text-blue-600" />
                  Spare Parts Status
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={() => navigate("/maintenance/spare-parts")} className="text-xs">
                  View All <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="text-center p-2 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold">{maintenanceMetrics.totalSpares}</p>
                  <p className="text-xs text-muted-foreground">Total Parts</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-red-50 dark:bg-red-950/30">
                  <p className="text-lg font-bold text-red-600">{maintenanceMetrics.lowStockSpares}</p>
                  <p className="text-xs text-muted-foreground">Low Stock</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-green-50 dark:bg-green-950/30">
                  <p className="text-lg font-bold text-green-600">{formatCurrency(maintenanceMetrics.inventoryValue)}</p>
                  <p className="text-xs text-muted-foreground">Inventory Value</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30">
                  <p className="text-lg font-bold text-amber-600">{formatCurrency(maintenanceMetrics.issuesCost)}</p>
                  <p className="text-xs text-muted-foreground">Period Issues Cost</p>
                </div>
              </div>

              {/* Top Low Stock Spares */}
              {maintenanceMetrics.topLowStock.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-medium mb-2">Critical Low Stock Items</p>
                  <div className="space-y-2">
                    {maintenanceMetrics.topLowStock.map((spare: any) => (
                      <div key={spare.id} className="flex items-center justify-between text-sm">
                        <span className="truncate flex-1 font-medium">{spare.name}</span>
                        <div className="flex items-center gap-2">
                          <span className={`font-bold ${spare.current_stock === 0 ? "text-red-600" : "text-amber-600"}`}>
                            {spare.current_stock}
                          </span>
                          <span className="text-muted-foreground">/ {spare.minimum_stock}</span>
                          {spare.current_stock === 0 && (
                            <Badge variant="destructive" className="text-[10px] px-1">OUT</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Period Breakdown Analysis */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-display flex items-center gap-2">
              <Hammer className="h-5 w-5 text-orange-600" />
              Period Breakdown Analysis
              <Badge variant="outline" className="ml-2">{maintenanceMetrics.periodBDCount} breakdowns</Badge>
            </CardTitle>
            <div className="flex gap-4 text-sm mt-1">
              <span className="font-semibold">Downtime: {Math.round(maintenanceMetrics.periodDowntime / 60)}h {maintenanceMetrics.periodDowntime % 60}m</span>
              <span className="font-semibold text-muted-foreground">Avg per BD: {maintenanceMetrics.periodBDCount > 0 ? Math.round(maintenanceMetrics.periodDowntime / maintenanceMetrics.periodBDCount) : 0} min</span>
              <span className="font-semibold">PM Schedules: {maintenanceMetrics.totalPM}</span>
              {maintenanceMetrics.overduePM > 0 && (
                <span className="font-semibold text-red-600">Overdue PM: {maintenanceMetrics.overduePM}</span>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {(allBreakdowns || []).filter(b => b.breakdown_start >= dateRange.start && b.breakdown_start <= dateRange.end + "T23:59:59").length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>BD #</TableHead>
                    <TableHead>Machine</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-center">Downtime</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(allBreakdowns || [])
                    .filter(b => b.breakdown_start >= dateRange.start && b.breakdown_start <= dateRange.end + "T23:59:59")
                    .slice(0, 10)
                    .map((bd) => (
                      <TableRow key={bd.id}>
                        <TableCell className="font-mono text-sm">{bd.breakdown_number}</TableCell>
                        <TableCell className="text-sm">{(bd.machines as any)?.name || "-"}</TableCell>
                        <TableCell className="text-sm max-w-[200px] truncate">{bd.description}</TableCell>
                        <TableCell className="text-center text-sm font-medium">
                          {bd.downtime_minutes ? `${Math.floor(bd.downtime_minutes / 60)}h ${bd.downtime_minutes % 60}m` : "-"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={bd.priority === "critical" ? "destructive" : bd.priority === "high" ? "default" : "secondary"} className="text-xs">
                            {bd.priority}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{bd.status?.replace(/_/g, " ")}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No breakdowns in this period</p>
            )}
          </CardContent>
        </Card>

        {/* Project Management Overview */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard title="Total Projects" value={projectMetrics.total} icon={FolderKanban} iconColor="bg-blue-100 text-blue-600" />
          <MetricCard title="Active Projects" value={projectMetrics.active} icon={Lightbulb} iconColor="bg-green-100 text-green-600" />
          <MetricCard title="Completed" value={projectMetrics.completed} icon={ClipboardCheck} iconColor="bg-emerald-100 text-emerald-600" />
          <MetricCard title="Overdue" value={projectMetrics.overdue} icon={AlertTriangle} iconColor="bg-red-100 text-red-600" />
        </div>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg font-display flex items-center gap-2">
              <FolderKanban className="h-5 w-5 text-blue-600" />
              Recent Projects
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/projects/list")}>View All</Button>
          </CardHeader>
          <CardContent className="p-0">
            {(projectsData || []).length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project #</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Deadline</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(projectsData || []).slice(0, 5).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-sm">{p.project_number}</TableCell>
                      <TableCell className="text-sm font-medium">{p.title}</TableCell>
                      <TableCell>
                        <Badge variant={p.priority === "critical" ? "destructive" : p.priority === "high" ? "default" : "secondary"} className="text-xs">
                          {p.priority || "medium"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{p.target_end_date || "-"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{p.status?.replace(/_/g, " ")}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No projects yet</p>
            )}
          </CardContent>
        </Card>

        {/* R&D Pipeline Overview */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard title="Total R&D Projects" value={rdMetrics.total} icon={FlaskConical} iconColor="bg-purple-100 text-purple-600" />
          <MetricCard title="Active" value={rdMetrics.active} icon={Lightbulb} iconColor="bg-yellow-100 text-yellow-600" />
          <MetricCard title="In Testing" value={rdMetrics.testing} icon={TestTube} iconColor="bg-cyan-100 text-cyan-600" />
          <MetricCard title="Launched" value={rdMetrics.launched} icon={Rocket} iconColor="bg-green-100 text-green-600" />
        </div>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg font-display flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-purple-600" />
              R&D Stage-Gate Pipeline
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/rd/projects")}>View All</Button>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2 h-24 mb-4">
              {rdStageCounts.map((s, i) => {
                const maxCount = Math.max(...rdStageCounts.map(x => x.count), 1);
                return (
                  <div key={s.stage} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-sm font-bold">{s.count}</span>
                    <div className={`w-full rounded-t ${RD_STAGE_COLORS[s.stage]} transition-all`} style={{ height: `${(s.count / maxCount) * 60}px`, minHeight: s.count > 0 ? "12px" : "4px" }} />
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      {i > 0 && <ArrowRight className="h-3 w-3 text-muted-foreground/50" />}
                      <span className="font-medium">{RD_STAGE_LABELS[s.stage]}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {(rdProjectsData || []).length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project #</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(rdProjectsData || []).slice(0, 5).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-sm">{p.project_number}</TableCell>
                      <TableCell className="text-sm font-medium">{p.title}</TableCell>
                      <TableCell>
                        <Badge className={`text-xs text-white ${RD_STAGE_COLORS[p.current_stage] || "bg-muted"}`}>
                          {RD_STAGE_LABELS[p.current_stage] || p.current_stage}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={p.status === "active" ? "default" : "outline"} className="text-xs">{p.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No R&D projects yet</p>
            )}
          </CardContent>
        </Card>

        {/* Development Tasks Overview */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-display flex items-center gap-2">
                <Code className="h-5 w-5 text-primary" />
                Development Tasks
                <Badge variant="outline" className="ml-2 text-xs">Maintenance</Badge>
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate("/maintenance/dev-tasks")} className="text-xs">
                View All <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-4">
              <div className="text-center p-2 rounded-lg bg-muted/50">
                <p className="text-lg font-bold">{devTaskMetrics.total}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-slate-100 dark:bg-slate-800">
                <p className="text-lg font-bold">{devTaskMetrics.draft}</p>
                <p className="text-xs text-muted-foreground">Draft</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-blue-50 dark:bg-blue-950/30">
                <p className="text-lg font-bold text-blue-600">{devTaskMetrics.inProgress}</p>
                <p className="text-xs text-muted-foreground">In Progress</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30">
                <p className="text-lg font-bold text-amber-600">{devTaskMetrics.pendingApproval}</p>
                <p className="text-xs text-muted-foreground">Pending</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-green-50 dark:bg-green-950/30">
                <p className="text-lg font-bold text-green-600">{devTaskMetrics.approved}</p>
                <p className="text-xs text-muted-foreground">Approved</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/50">
                <p className="text-lg font-bold">{devTaskMetrics.closed}</p>
                <p className="text-xs text-muted-foreground">Closed</p>
              </div>
            </div>
            {(devTasksData || []).length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task #</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Module</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Target</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(devTasksData || []).filter(t => t.status !== "closed").slice(0, 8).map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-sm">{t.task_number}</TableCell>
                      <TableCell className="text-sm font-medium max-w-[200px] truncate">{t.title}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{t.module || "-"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${
                          t.priority === "critical" ? "border-red-500 text-red-600" :
                          t.priority === "high" ? "border-amber-500 text-amber-600" :
                          t.priority === "medium" ? "border-blue-500 text-blue-600" :
                          "border-muted text-muted-foreground"
                        }`}>
                          {t.priority}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={
                          t.status === "in_progress" ? "default" :
                          t.status === "approved" ? "default" :
                          "outline"
                        } className={`text-xs ${
                          t.status === "in_progress" ? "bg-blue-600" :
                          t.status === "approved" ? "bg-green-600" :
                          t.status === "pending_approval" ? "border-amber-500 text-amber-600" :
                          ""
                        }`}>
                          {t.status?.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t.target_date ? format(new Date(t.target_date), "dd-MMM") : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No development tasks yet</p>
            )}
          </CardContent>
        </Card>

        {/* Online Sales Module Analysis */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard title="Online Orders" value={onlineSalesMetrics.totalOrders} icon={ShoppingBag} iconColor="bg-emerald-100 text-emerald-600" />
          <MetricCard title="Order Value" value={`₹${onlineSalesMetrics.totalValue.toLocaleString()}`} icon={IndianRupee} iconColor="bg-green-100 text-green-600" />
          <MetricCard title="Returns" value={onlineSalesMetrics.totalReturns} icon={RotateCcw} iconColor="bg-red-100 text-red-600" />
          <MetricCard title="Return Rate" value={`${onlineSalesMetrics.returnRate}%`} icon={AlertTriangle} iconColor="bg-amber-100 text-amber-600" />
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Platform-wise Breakdown */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg font-display flex items-center gap-2">
                <ShoppingBag className="h-5 w-5 text-emerald-600" />
                Online Sales — Platform Breakdown
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate("/online-sales/dashboard")}>View All</Button>
            </CardHeader>
            <CardContent>
              {onlineSalesMetrics.platformData.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Platform</TableHead>
                      <TableHead className="text-center">Orders</TableHead>
                      <TableHead className="text-right">Value (₹)</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {onlineSalesMetrics.platformData.map((p) => (
                      <TableRow key={p.name}>
                        <TableCell className="font-medium text-sm">{p.name}</TableCell>
                        <TableCell className="text-center text-sm">{p.count}</TableCell>
                        <TableCell className="text-right text-sm">₹{p.value.toLocaleString()}</TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {onlineSalesMetrics.totalOrders > 0 ? ((p.count / onlineSalesMetrics.totalOrders) * 100).toFixed(1) : 0}%
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-semibold bg-muted/30">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-center">{onlineSalesMetrics.totalOrders}</TableCell>
                      <TableCell className="text-right">₹{onlineSalesMetrics.totalValue.toLocaleString()}</TableCell>
                      <TableCell className="text-right">100%</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No online orders in this period</p>
              )}
            </CardContent>
          </Card>

          {/* Order Status & Payment Split */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-display flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-blue-600" />
                Order Status & Payment
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Status breakdown */}
              {onlineSalesMetrics.statusData.length > 0 ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Status Breakdown</p>
                  <div className="space-y-2">
                    {onlineSalesMetrics.statusData.map((s) => {
                      const pct = onlineSalesMetrics.totalOrders > 0 ? (s.count / onlineSalesMetrics.totalOrders) * 100 : 0;
                      return (
                        <div key={s.name} className="flex items-center gap-2">
                          <span className="text-xs w-28 capitalize">{s.name.replace(/_/g, " ")}</span>
                          <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs font-medium w-8 text-right">{s.count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Payment mode split */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Payment Mode</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-3 rounded-lg bg-green-50 dark:bg-green-950/30">
                    <p className="text-xl font-bold text-green-600">{onlineSalesMetrics.prepaidOrders}</p>
                    <p className="text-xs text-muted-foreground">Prepaid</p>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30">
                    <p className="text-xl font-bold text-amber-600">{onlineSalesMetrics.codOrders}</p>
                    <p className="text-xs text-muted-foreground">COD</p>
                  </div>
                </div>
              </div>

              {/* Financial summary */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Financial Summary</p>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>Total Qty</span>
                    <span className="font-medium">{onlineSalesMetrics.totalQty.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Shipping Charges</span>
                    <span className="font-medium">₹{onlineSalesMetrics.totalShipping.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Net Amount</span>
                    <span className="font-medium text-green-600">₹{onlineSalesMetrics.totalNetAmount.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* Return reasons */}
              {onlineSalesMetrics.returnReasons.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Top Return Reasons</p>
                  <div className="space-y-1">
                    {onlineSalesMetrics.returnReasons.slice(0, 5).map((r) => (
                      <div key={r.reason} className="flex justify-between text-sm">
                        <span className="text-muted-foreground truncate max-w-[200px]">{r.reason}</span>
                        <Badge variant="outline" className="text-xs">{r.count}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Daily Employee Progress Report */}
        <DailyEmployeeProgress date={dateRange.start} />

        {/* Employee Comparison Chart */}
        <EmployeeComparisonChart date={dateRange.start} />

        {/* System Alerts */}
        {(alerts?.length || 0) > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-display flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                System Alerts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-2">
                {alerts?.map((alert) => (
                  <div
                    key={alert.id}
                    className={`flex items-start gap-3 p-3 rounded-lg border ${
                      alert.type === "error"
                        ? "border-red-200 bg-red-50 dark:bg-red-950/20"
                        : alert.type === "warning"
                        ? "border-amber-200 bg-amber-50 dark:bg-amber-950/20"
                        : "border-blue-200 bg-blue-50 dark:bg-blue-950/20"
                    }`}
                  >
                    <AlertTriangle
                      className={`h-5 w-5 mt-0.5 ${
                        alert.type === "error"
                          ? "text-red-500"
                          : alert.type === "warning"
                          ? "text-amber-500"
                          : "text-blue-500"
                      }`}
                    />
                    <div>
                      <p className="text-sm font-medium">{alert.message}</p>
                      <p className="text-xs text-muted-foreground">{alert.module}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ERPLayout>
  );
}
