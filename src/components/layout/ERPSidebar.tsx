import { useState, useEffect, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Factory,
  AlertOctagon,
  Clock,
  ClipboardCheck,
  Users,
  TrendingUp,
  Wrench,
  ShoppingCart,
  Package,
  Warehouse,
  LayoutDashboard,
  Settings,
  Database,
  ChevronDown,
  LogOut,
  X,
  UserCheck,
  Plus,
  Calendar,
  Building,
  Receipt,
  Beaker,
  Shield,
  BookOpen,
  Target,
  ShoppingBag,
  FolderKanban,
  FlaskConical,
  Monitor,
  Headphones,
  Workflow,
} from "lucide-react";
import { AddRawMaterialDialog } from "@/components/floor-inventory/AddRawMaterialDialog";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useAuth } from "@/contexts/AuthContext";
import type { Database as SupabaseDatabase } from "@/integrations/supabase/types";
import cansportLogo from "@/assets/cansport-logo.png";

type AppRole = SupabaseDatabase["public"]["Enums"]["app_role"];

interface NavChild {
  title: string;
  href: string;
  superAdminOnly?: boolean;
  requiresApprove?: string; // module name; only show if user has approve permission for this module
  excludeRoles?: AppRole[];
  state?: Record<string, any>;
  // When true, this entry renders as a non-clickable section header inside the
  // module's children. Used to group long modules (e.g. Accounting) into
  // standard-practice sections — Masters / Entries / Books / Ledgers / Reports etc.
  isHeader?: boolean;
}

interface NavItem {
  title: string;
  icon: React.ElementType;
  href?: string;
  color?: string;
  module?: string; // Module identifier for permission checking
  superAdminOnly?: boolean; // Only show for super_admin
  hasQuickAction?: boolean; // Show quick action button
  // When true, the module renders as a prominent, brand-gradient "hero" button
  // so it stands out in the sidebar for quick access (e.g. Accounting).
  prominent?: boolean;
  // For prominent items: clicking the main button navigates here directly
  // (quick access), while the chevron still expands the submenu.
  quickHref?: string;
  children?: NavChild[];
}

const navigationItems: NavItem[] = [
  {
    title: "Dashboard",
    icon: LayoutDashboard,
    href: "/",
    module: "dashboard",
    superAdminOnly: true, // Main dashboard only for super_admin
  },
  {
    title: "Production Planning",
    icon: Calendar,
    color: "text-violet-400",
    module: "planning",
    children: [
      { title: "Dashboard", href: "/planning/dashboard" },
      { title: "Weekly Planning", href: "/planning/weekly" },
      { title: "Job Orders", href: "/planning/job-orders" },
      { title: "Job Order Departments", href: "/planning/job-order-departments", superAdminOnly: true },
      { title: "Store Department", href: "/planning/store-management" },
      { title: "Daily Stock Closing", href: "/planning/stock-closing" },
      { title: "Daily Closing Dashboard", href: "/planning/closing-dashboard" },
      { title: "Item Master", href: "/planning/items" },
      { title: "Capacity Master", href: "/planning/capacity" },
      { title: "Skilled Labour", href: "/planning/skilled-labour" },
    ],
  },
  // Accounting promoted to 3rd position with a prominent brand-gradient button
  // for quick access. Clicking the main button jumps to the dashboard; the
  // chevron expands the full submenu.
  {
    title: "Accounting",
    icon: Receipt,
    color: "text-teal-500",
    module: "accounting",
    prominent: true,
    quickHref: "/accounting/dashboard",
    children: [
      { title: "Dashboard", href: "/accounting/dashboard" },

      { title: "Masters", href: "", isHeader: true },
      { title: "Chart of Accounts", href: "/accounting/chart-of-accounts" },
      { title: "Parties", href: "/accounting/parties" },
      { title: "Default Accounts", href: "/accounting/default-accounts" },

      { title: "Entries", href: "", isHeader: true },
      { title: "New Voucher", href: "/accounting/vouchers/new" },
      { title: "Customer Receipts", href: "/accounting/customer-receipts" },
      { title: "Supplier Payments", href: "/accounting/supplier-payments" },
      // Sales / Purchase Returns moved to the Sales and Purchase modules respectively (as proper return invoices).

      { title: "Books", href: "", isHeader: true },
      { title: "Day Book", href: "/accounting/day-book" },
      { title: "Voucher Register", href: "/accounting/vouchers" },
      { title: "Cash Book", href: "/accounting/cash-book" },
      { title: "Bank Book", href: "/accounting/bank-book" },

      { title: "Ledgers", href: "", isHeader: true },
      { title: "General Ledger", href: "/accounting/general-ledger" },
      { title: "Customer Ledger", href: "/accounting/party-ledger?type=customer" },
      { title: "Vendor Ledger", href: "/accounting/party-ledger?type=supplier" },

      { title: "Reports", href: "", isHeader: true },
      { title: "Trial Balance", href: "/accounting/trial-balance" },
      { title: "Profit & Loss", href: "/accounting/profit-loss" },
      { title: "Balance Sheet", href: "/accounting/balance-sheet" },
      { title: "Receivables & Payables", href: "/accounting/ar-ap-report" },
      { title: "Sales Report", href: "/accounting/sales-report" },
      { title: "Sales Analysis", href: "/accounting/sales-analysis" },
      { title: "Purchase Analysis", href: "/accounting/purchase-analysis" },
      { title: "Expenses Analysis", href: "/accounting/expenses-analysis" },

      { title: "Reconciliation", href: "", isHeader: true },
      { title: "Sales Reconciliation", href: "/accounting/sales-reconciliation" },
      { title: "Purchase Reconciliation", href: "/accounting/purchase-reconciliation" },
      { title: "Production Reconciliation", href: "/accounting/production-reconciliation" },
      { title: "Production Cost Recognition", href: "/accounting/production-cost-recognition" },
      { title: "Production Output Recognition", href: "/accounting/production-output-recognition" },
      { title: "Periodic COGS", href: "/accounting/periodic-cogs" },
      { title: "COGS (Invoice-wise)", href: "/accounting/cogs" },

      { title: "Period & Audit", href: "", isHeader: true },
      { title: "Period Close", href: "/accounting/period-close" },
      { title: "Audit Log", href: "/accounting/audit-log" },
      { title: "Settings", href: "/accounting/settings", superAdminOnly: true },
    ],
  },
  {
    title: "Production",
    icon: Factory,
    color: "text-blue-400",
    module: "production",
    children: [
      { title: "Production Orders", href: "/production/orders" },
      { title: "Order Dashboard", href: "/production/order-dashboard" },
      { title: "Daily Entry", href: "/production/daily-entry" },
      { title: "Entry List", href: "/production/entry-list" },
      { title: "WIP Tracking", href: "/production/wip" },
      { title: "WIP Ledger", href: "/production/wip-ledger" },
      { title: "WIP Reconciliation", href: "/production/wip-reconciliation" },
      { title: "WIP Sequence", href: "/production/wip-sequence", superAdminOnly: true },
      { title: "Dashboard", href: "/production/dashboard" },
      { title: "Target Dashboard", href: "/production/target-dashboard" },
      { title: "MPH Master", href: "/production/mph-master", superAdminOnly: true },
      { title: "Production Coordinator", href: "/production/coordinator", highlight: true },
    ],
  },
  {
    title: "Rejections & Wastages",
    icon: AlertOctagon,
    color: "text-amber-400",
    module: "rejections_wastages",
    children: [
      { title: "Dashboard", href: "/rejections/dashboard" },
      { title: "New Entry", href: "/rejections/entry", highlight: true },
      { title: "Rework Tracking", href: "/rejections/rework" },
      { title: "Analytics", href: "/rejections/analytics" },
      { title: "Reasons Master", href: "/rejections/reasons", superAdminOnly: true },
      { title: "Units Master", href: "/rejections/units", superAdminOnly: true },
      { title: "Dispositions Master", href: "/rejections/dispositions", superAdminOnly: true },
      { title: "Materials Master", href: "/rejections/materials", superAdminOnly: true },
    ],
  },
  {
    title: "WIP Management",
    icon: Workflow,
    color: "text-amber-400",
    module: "wip_management",
    children: [
      { title: "WIP Monitor", href: "/wip/dashboard", highlight: true },
      { title: "Stock Hold Entry", href: "/wip/entries" },
      { title: "Stages Master", href: "/wip/stages" },
      { title: "Stage Thresholds", href: "/wip/thresholds" },
      { title: "Flow Analysis", href: "/wip/flow" },
    ],
  },
  {
    title: "Quality Assurance",
    icon: ClipboardCheck,
    color: "text-green-400",
    module: "qa",
    children: [
      { title: "Quality Coordinator", href: "/qa/quality-coordinator", highlight: true },
      { title: "New Inspection", href: "/qa/inspections", state: { openNewInspection: true } },
      { title: "Process Master", href: "/qa/processes", superAdminOnly: true },
      { title: "Process Instructions", href: "/qa/process-instructions" },
      { title: "Process Standards", href: "/qa/process-standards", superAdminOnly: true },
      { title: "Daily Acknowledgement", href: "/qa/instruction-acknowledgement" },
      { title: "Inspections", href: "/qa/inspections" },
      { title: "Process Inspections", href: "/qa/process-inspections" },
      { title: "Daily Quality Plan", href: "/qa/daily-plan" },
      { title: "Inspection Targets", href: "/qa/inspection-targets" },
      { title: "NCR / CAPA", href: "/qa/ncr-capa" },
      { title: "CAPA Dashboard", href: "/qa/capa-dashboard" },
      { title: "QA Release", href: "/qa/release", excludeRoles: ["operator"] },
      { title: "Dashboard", href: "/qa/dashboard" },
    ],
  },
  {
    title: "HR",
    icon: Users,
    color: "text-purple-400",
    module: "hr",
    children: [
      { title: "Dashboard", href: "/hr/dashboard" },
      { title: "Employees", href: "/hr/employees" },
      { title: "Attendance", href: "/hr/attendance" },
      { title: "Attendance Sheet", href: "/hr/attendance-sheet" },
      { title: "Leave Requests", href: "/hr/leaves" },
      { title: "Recruitment", href: "/hr/recruitment" },
      { title: "Loans", href: "/hr/loans" },
      { title: "Salary Sheet", href: "/hr/salary-report" },
      { title: "Public Holidays", href: "/hr/public-holidays", superAdminOnly: true },
      { title: "Punctuality Analytics", href: "/hr/punctuality-analytics" },
      { title: "Time Sheet", href: "/hr/time-sheet" },
    ],
  },
  {
    title: "Performance",
    icon: TrendingUp,
    color: "text-pink-400",
    module: "performance",
    children: [
      { title: "KPI Library", href: "/performance/kpi" },
      { title: "Assignments", href: "/performance/assignments" },
      { title: "Score Cards", href: "/performance/score-cards" },
      { title: "Monthly KPIs", href: "/performance/monthly-kpis" },
      { title: "Goal Assignment", href: "/performance/monthly-goals" },
      { title: "Monthly Scores", href: "/performance/monthly-scores" },
      { title: "Daily Tracking", href: "/performance/daily-tracking" },
      { title: "Daily Progress", href: "/performance/daily-progress" },
      { title: "Reports", href: "/performance/reports" },
      { title: "Reviews", href: "/performance/reviews" },
      { title: "Monthly Dashboard", href: "/performance/monthly-dashboard" },
      { title: "Dashboard", href: "/performance/dashboard" },
    ],
  },
  {
    title: "Maintenance",
    icon: Wrench,
    color: "text-amber-400",
    module: "maintenance",
    children: [
      { title: "Dashboard", href: "/maintenance/dashboard" },
      { title: "Machines/Assets", href: "/maintenance/assets" },
      { title: "Work Orders", href: "/maintenance/tickets" },
      { title: "Breakdown Logs", href: "/maintenance/breakdowns" },
      { title: "PM Dashboard", href: "/maintenance/pm-dashboard" },
      { title: "PM Schedule", href: "/maintenance/pm-schedule" },
      { title: "Spare Parts", href: "/maintenance/spare-parts" },
      { title: "Spare Part Issues", href: "/maintenance/spare-part-issues" },
      { title: "Spare Parts Dashboard", href: "/maintenance/spare-dashboard" },
      { title: "Machine Consumption", href: "/maintenance/spare-consumption" },
      { title: "Dev Tasks", href: "/maintenance/dev-tasks" },
    ],
  },
  {
    title: "Private Label Sales",
    icon: ShoppingCart,
    color: "text-cyan-400",
    module: "sales",
    children: [
      { title: "Customers", href: "/sales/customers" },
      { title: "Customer Logos", href: "/sales/customer-logos" },
      { title: "Customer Pricing", href: "/sales/customer-pricing" },
      { title: "Sales Orders", href: "/sales/orders" },
      { title: "Dispatch", href: "/sales/dispatch" },
      { title: "Visit Reports", href: "/sales/visit-dashboard" },
      { title: "Dashboard", href: "/sales/dashboard" },
      { title: "Fuel Trips", href: "/sales/fuel/trips" },
      { title: "Fuel Weekly Payouts", href: "/sales/fuel/payouts" },
      { title: "Sales Vehicles", href: "/sales/fuel/vehicles", superAdminOnly: true },
      { title: "Fuel Prices", href: "/sales/fuel/prices", superAdminOnly: true },
      { title: "City Master", href: "/sales/cities", superAdminOnly: true },
      { title: "Area Master", href: "/sales/areas", superAdminOnly: true },
      { title: "Customer Categories", href: "/sales/categories", superAdminOnly: true },
    ],
  },
  {
    title: "Sales",
    icon: ShoppingCart,
    color: "text-orange-400",
    module: "sales",
    children: [
      { title: "Customers", href: "/domestic/customers" },
      { title: "Sales Orders", href: "/domestic/orders" },
      { title: "Packing Master", href: "/domestic/packing-types" },
      { title: "Order Status Board", href: "/domestic/order-status" },
      { title: "New Item", href: "/domestic/new-item" },
      { title: "Pending Dispatch", href: "/domestic/pending-dispatch" },
      { title: "Dispatch", href: "/domestic/dispatch" },
      { title: "Invoices", href: "/domestic/invoices" },
      { title: "Sales Returns", href: "/sales/returns" },
      { title: "Dispatch Acknowledgement", href: "/domestic/dispatch-acknowledgement" },
      { title: "Dispatch Dashboard", href: "/domestic/dispatch-dashboard" },
      { title: "Deadline Requests", href: "/domestic/deadline-requests", superAdminOnly: true },
      { title: "Dashboard", href: "/domestic/dashboard" },
    ],
  },
  {
    title: "Export Sales",
    icon: ShoppingCart,
    color: "text-teal-400",
    module: "sales",
    children: [
      { title: "Customers", href: "/export/customers" },
      { title: "Sales Orders", href: "/export/orders" },
      { title: "Dispatch", href: "/export/dispatch" },
      { title: "Dashboard", href: "/export/dashboard" },
    ],
  },
  {
    title: "Purchase",
    icon: Package,
    color: "text-indigo-400",
    module: "purchase",
    children: [
      { title: "Suppliers", href: "/purchase/suppliers" },
      { title: "Purchase Requests", href: "/purchase/requests" },
      { title: "Purchase Orders", href: "/purchase/orders" },
      { title: "Goods Receipt", href: "/purchase/grn" },
      { title: "Purchase Invoices", href: "/purchase/invoices" },
      { title: "Purchase Returns", href: "/purchase/returns" },
      { title: "Dashboard", href: "/purchase/dashboard" },
    ],
  },
  // "Store & Inventory" and "Floor Inventory" modules removed from the sidebar —
  // not in use per user request (2026-05-24). Routes remain in App.tsx so old
  // bookmarks still resolve. Restore the entries below if the modules come back.
  /*
  {
    title: "Store & Inventory",
    icon: Warehouse,
    color: "text-rose-400",
    module: "inventory",
    children: [
      { title: "Dashboard", href: "/inventory/dashboard" },
      { title: "Stock Levels", href: "/inventory/stock" },
      { title: "Stock Movements", href: "/inventory/movements" },
      { title: "Inventory Ledger", href: "/inventory/ledger" },
      { title: "WIP Inventory", href: "/inventory/wip" },
      { title: "Locations", href: "/inventory/locations" },
    ],
  },
  {
    title: "Floor Inventory",
    icon: Package,
    color: "text-lime-400",
    module: "floor_inventory",
    hasQuickAction: true, // Flag for quick action button
    children: [
      { title: "Dashboard", href: "/floor-inventory/dashboard" },
      { title: "Items", href: "/floor-inventory/items" },
      { title: "Stock Levels", href: "/floor-inventory/stock" },
      { title: "Movements", href: "/floor-inventory/movements" },
      { title: "Production", href: "/floor-inventory/production" },
      { title: "Ledger", href: "/floor-inventory/ledger" },
      { title: "Locations", href: "/floor-inventory/locations" },
    ],
  },
  */
  {
    title: "Fixed Assets",
    icon: Building,
    color: "text-slate-400",
    module: "fixed_assets",
    children: [
      { title: "Dashboard", href: "/fixed-assets/dashboard" },
      { title: "Asset Register", href: "/fixed-assets/list" },
      { title: "Categories", href: "/fixed-assets/categories" },
      { title: "Valuations", href: "/fixed-assets/valuations" },
      { title: "Disposal", href: "/fixed-assets/disposal" },
      { title: "Reconciliation", href: "/fixed-assets/reconciliation" },
    ],
  },
  {
    title: "Expenses",
    icon: Receipt,
    color: "text-yellow-400",
    module: "expenses",
    children: [
      { title: "Dashboard", href: "/expenses/dashboard" },
      { title: "Operating Expenses Analysis", href: "/expenses/operating-analysis" },
      { title: "Petty Cash", href: "/expenses/petty-cash" },
      { title: "General Expenses", href: "/expenses/general" },
      { title: "Utility Bills", href: "/expenses/utilities" },
      { title: "Budgets", href: "/expenses/budgets" },
      { title: "Expense Master", href: "/expenses/master" },
    ],
  },
  {
    title: "Material Consumption",
    icon: Beaker,
    color: "text-red-400",
    module: "material_consumption",
    children: [
      { title: "Dashboard", href: "/consumption/dashboard" },
      { title: "Production Dashboard", href: "/consumption/production-dashboard" },
      { title: "Efficiency Dashboard", href: "/consumption/efficiency-dashboard" },
      { title: "Products Master", href: "/consumption/products" },
      { title: "Raw Materials", href: "/consumption/raw-materials" },
      { title: "Category Master", href: "/consumption/categories" },
      { title: "Consumption BOM", href: "/consumption/bom" },
      { title: "Stock Closing", href: "/consumption/stock-closing" },
      { title: "Stock Closing Dashboard", href: "/consumption/stock-closing-dashboard" },
      { title: "Stock Closing View", href: "/consumption/stock-closing-view" },
      { title: "Monthly Receipt View", href: "/consumption/monthly-receipts" },
      { title: "Production Entry", href: "/consumption/production-entry" },
      { title: "Analysis", href: "/consumption/analysis" },
      { title: "Usage Report", href: "/consumption/usage-report" },
    ],
  },
  {
    title: "Labour Productivity",
    icon: UserCheck,
    color: "text-emerald-400",
    module: "labour",
    children: [
      { title: "Daily Entry", href: "/labour/entry" },
      { title: "Missing Entries", href: "/labour/missing-entries" },
      { title: "Time Sheet", href: "/labour/time-sheet" },
      { title: "Process Targets", href: "/labour/process-targets" },
      { title: "Todays Labour Deployment & Targets", href: "/labour/todays-target" },
      { title: "Deployment & Target Analysis", href: "/labour/deployment-analysis", requiresApprove: "labour" },
      { title: "Employee Center", href: "/labour/employees" },
      { title: "Category Master", href: "/labour/categories" },
      { title: "Attendance Sheet", href: "/labour/attendance" },
      { title: "Labour Salary", href: "/labour/salary" },
      { title: "Process Dashboard", href: "/labour/process-dashboard" },
      { title: "Category Dashboard", href: "/labour/category-dashboard" },
      { title: "Individual Performance", href: "/labour/individual-performance" },
      { title: "Public Holidays", href: "/labour/public-holidays" },
      { title: "MPH Management", href: "/labour/mph-management" },
      { title: "Edit Requests", href: "/labour/edit-requests", superAdminOnly: true },
      { title: "Dashboard", href: "/labour/dashboard" },
    ],
  },
  {
    title: "5S Audit",
    icon: Shield,
    color: "text-sky-400",
    module: "five_s",
    children: [
      { title: "Dashboard", href: "/five-s/dashboard" },
      { title: "Audits", href: "/five-s/audits" },
      { title: "Action Items", href: "/five-s/action-items" },
      { title: "Departments", href: "/five-s/departments" },
      { title: "Checkpoints", href: "/five-s/checkpoints" },
    ],
  },
  {
    title: "Six Sigma",
    icon: Target,
    color: "text-fuchsia-400",
    module: "six_sigma",
    children: [
      { title: "Dashboard", href: "/six-sigma/dashboard" },
      { title: "Projects", href: "/six-sigma/projects" },
      { title: "Tools & Templates", href: "/six-sigma/tools" },
      { title: "Metrics", href: "/six-sigma/metrics" },
    ],
  },
  {
    title: "Online Sales",
    icon: ShoppingBag,
    color: "text-emerald-400",
    module: "online_sales",
    children: [
      { title: "Dashboard", href: "/online-sales/dashboard" },
      { title: "Sales Analysis", href: "/online-sales/analysis" },
      { title: "Profit & Loss", href: "/online-sales/pnl" },
      { title: "Money / COD Settlement", href: "/online-sales/money" },
      { title: "Payment Receipts", href: "/online-sales/payment-receipts" },
      { title: "Marketing / Ad Spend", href: "/online-sales/marketing" },
      { title: "Expenses", href: "/online-sales/expenses" },
      { title: "Platform Master", href: "/online-sales/platforms" },
      { title: "Item Master", href: "/online-sales/items" },
      { title: "Orders", href: "/online-sales/orders" },
      { title: "Live Status", href: "/online-sales/live-status" },

      { title: "Returns", href: "/online-sales/returns" },
      { title: "Return Reconciliation", href: "/online-sales/return-reconciliation" },
      { title: "Returns Analytics", href: "/online-sales/returns-analytics" },
      
    ],
  },
  // Legacy "Finance Reports" section removed — those pages query the empty
  // finance_* tables. All accounting data now flows through the new
  // accounting_* schema and is surfaced under the Accounting module (now
  // promoted near the top of the sidebar for quick access).
  // Routes are retained (in App.tsx) so any old bookmarks still resolve.
  {
    title: "Project Management",
    icon: FolderKanban,
    color: "text-cyan-500",
    module: "projects",
    children: [
      { title: "Dashboard", href: "/projects" },
      { title: "Projects List", href: "/projects/list" },
      { title: "Kanban Board", href: "/projects/kanban" },
    ],
  },
  {
    title: "Product Dev & R&D",
    icon: FlaskConical,
    color: "text-rose-400",
    module: "rd",
    children: [
      { title: "Dashboard", href: "/rd/dashboard" },
      { title: "Projects", href: "/rd/projects" },
      { title: "Experiments", href: "/rd/experiments" },
    ],
  },
  {
    title: "CRM",
    icon: Headphones,
    color: "text-fuchsia-400",
    module: "crm",
    children: [
      { title: "Dashboard", href: "/crm/dashboard" },
      { title: "Leads", href: "/crm/leads" },
      { title: "Contacts", href: "/crm/contacts" },
      { title: "Deals Pipeline", href: "/crm/deals" },
      { title: "Activities", href: "/crm/activities" },
      { title: "Content & Creatives", href: "/crm/content" },
      { title: "Product & Brand", href: "/crm/product-brand" },
      { title: "Daily Closing", href: "/crm/daily-closing" },
      { title: "Marketing KPIs", href: "/crm/marketing-kpis" },
      { title: "Reactivation", href: "/crm/reactivation" },
      { title: "Aero Padel Courts", href: "/crm/aero-courts" },
      { title: "Aero Courts Insights", href: "/crm/aero-courts/insights" },
      { title: "Sample Items", href: "/crm/sample-items" },
      { title: "Sample Inventory", href: "/crm/sample-inventory" },
      { title: "Sample Requests", href: "/crm/sample-requests" },
    ],
  },
  {
    // Distributor Order Management — external module for distributors' sales teams.
    // Child visibility is driven by canAccessRoute(), so distributor_sales sees ONLY
    // Orders (they can do nothing but make sales orders), distributor_manager also sees
    // Approvals/Dispatch, distributor_admin additionally sees Manage Users, and
    // super_admin additionally sees the company-level Distributors master.
    title: "Distributor Orders",
    icon: Building,
    color: "text-amber-400",
    module: "distributor",
    children: [
      { title: "Dashboard", href: "/distributor/dashboard" },
      { title: "Distributors", href: "/distributor/distributors", superAdminOnly: true },
      { title: "Customers", href: "/distributor/customers" },
      { title: "Products & Pricing", href: "/distributor/products" },
      { title: "Orders", href: "/distributor/orders" },
      { title: "Order Analysis", href: "/distributor/analysis" },
      // Approvals only renders for manager/admin (route whitelist hides it from sales).
      { title: "Approvals", href: "/distributor/approvals" },
      // Dispatch is whitelisted for manager/admin only (hidden from sales).
      { title: "Dispatch", href: "/distributor/dispatch" },
      { title: "Manage Users", href: "/distributor/admin/users" },
    ],
  },
  {
    title: "Marketing",
    icon: Target,
    color: "text-pink-400",
    module: "marketing",
    children: [
      { title: "Dashboard", href: "/marketing" },
      { title: "Campaigns", href: "/marketing/campaigns" },
      { title: "Deliverables Kanban", href: "/marketing/deliverables" },
      { title: "Gantt Timeline", href: "/marketing/gantt" },
      { title: "Content Calendar", href: "/marketing/calendar" },
      { title: "Events & Activations", href: "/marketing/events" },
      { title: "Meetings & Actions", href: "/marketing/meetings" },
      { title: "Masters", href: "/marketing/masters", superAdminOnly: true },
    ],
  },
  {
    title: "Hourly Production",
    icon: Clock,
    color: "text-violet-400",
    module: "hourly_production",
    children: [
      { title: "Dashboard", href: "/hourly-production/dashboard" },
      { title: "Hourly Entry", href: "/hourly-production/entry" },
      { title: "Reports", href: "/hourly-production/reports" },
      { title: "Analysis", href: "/hourly-production/analysis" },
      { title: "Live Overview", href: "/hourly-production/live-overview" },
      { title: "Loss Entry", href: "/hourly-production/loss-entry" },
      { title: "Loss Logs", href: "/hourly-production/loss-logs" },
      { title: "Material Issuance", href: "/hourly-production/material-issuance" },
      { title: "Material Consumption", href: "/hourly-production/material-consumption" },
      { title: "Material Analysis", href: "/hourly-production/material-analysis" },
      { title: "Material Master", href: "/hourly-production/materials", superAdminOnly: true },
      { title: "Process Master", href: "/hourly-production/process-master", superAdminOnly: true },
    ],
  },
  {
    title: "Machine Monitor",
    icon: Monitor,
    color: "text-cyan-400",
    module: "machine_monitor",
    children: [
      { title: "Control Room", href: "/machine-monitor/display" },
      { title: "Status Entry", href: "/machine-monitor/entry" },
      { title: "QR Scan", href: "/machine-monitor/scan" },
      { title: "Machines", href: "/machine-monitor/machines" },
      { title: "Breakdown Logs", href: "/machine-monitor/breakdown-logs" },
      { title: "Performance Issue Logs", href: "/machine-monitor/performance-logs" },
    ],
  },
  {
    title: "Master Data",
    icon: Database,
    module: "master_data",
    children: [
      { title: "Departments", href: "/master/departments" },
      { title: "Grades", href: "/master/grades" },
      { title: "Products/SKUs", href: "/master/products" },
      { title: "Machines", href: "/master/machines" },
      { title: "Items", href: "/master/items" },
      { title: "Units", href: "/master/units" },
      { title: "Reason Masters", href: "/master/reasons" },
      { title: "Hourly Loss Reasons", href: "/master/hourly-loss-reasons" },
    ],
  },
  {
    title: "Settings",
    icon: Settings,
    module: "settings",
    children: [
      { title: "Users", href: "/settings/users", superAdminOnly: true },
      { title: "Roles & Permissions", href: "/settings/roles" },
      { title: "System Alerts", href: "/settings/alerts" },
      { title: "Audit Log", href: "/settings/audit-log" },
    ],
  },
];

interface ERPSidebarProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

export function ERPSidebar({ isOpen, setIsOpen }: ERPSidebarProps) {
  const location = useLocation();
  const { canAccessModule, canAccessRoute, roles, hasModulePermission } = useAuth();
  const [isAddRawMaterialOpen, setIsAddRawMaterialOpen] = useState(false);

  // Check if user is super_admin
  const isSuperAdmin = roles.some(r => r.role === 'super_admin');

  // Memoize filtered navigation items to prevent unnecessary recalculations
  const filteredNavigationItems = useMemo(() => {
    const getVisibleChildren = (item: NavItem) => {
      if (!item.children) return undefined;

      const userRoleNames = roles.map((r) => r.role as string);

      return item.children.filter((child) => {
        if (child.superAdminOnly && !isSuperAdmin) return false;

        // Section headers are always visible alongside their group (we drop
        // dangling headers later, after route-level filtering).
        if (child.isHeader) return true;

        if (child.requiresApprove && !hasModulePermission(child.requiresApprove, "approve")) {
          return false;
        }

        if (
          child.excludeRoles &&
          child.excludeRoles.some((excludedRole) => userRoleNames.includes(excludedRole))
        ) {
          return false;
        }

        // child.href may carry a default query string (e.g. ?type=customer);
        // the role-restriction list only knows pathnames, so strip the query.
        return canAccessRoute(child.href.split("?")[0]);
      });
    };

    // Drop section headers that have no following link entries (e.g. when every
    // route in that section was hidden by permissions). Headers are dangling
    // when no non-header child sits between them and the next header / end.
    const dropDanglingHeaders = (kids: NavChild[] | undefined): NavChild[] | undefined => {
      if (!kids) return kids;
      const out: NavChild[] = [];
      for (let i = 0; i < kids.length; i++) {
        const c = kids[i];
        if (c.isHeader) {
          // Look ahead until next header or end; keep header only if any link follows.
          let hasLink = false;
          for (let j = i + 1; j < kids.length; j++) {
            if (kids[j].isHeader) break;
            hasLink = true;
            break;
          }
          if (!hasLink) continue;
        }
        out.push(c);
      }
      return out;
    };

    return navigationItems
      .map((item) => {
        if (item.superAdminOnly && !isSuperAdmin) return null;

        const visibleChildren = getVisibleChildren(item);

        if (item.children) {
          const hasModuleAccess = item.module ? canAccessModule(item.module) : true;

          if (!hasModuleAccess) {
            return null;
          }

          return {
            ...item,
            children: dropDanglingHeaders(visibleChildren),
          };
        }

        if (item.module && !canAccessModule(item.module)) return null;

        return item;
      })
      // Remove parent items with no children after filtering
      .filter((item): item is NavItem => Boolean(item))
      .filter((item) => !item.children || item.children.length > 0);
  }, [isSuperAdmin, roles, canAccessModule, canAccessRoute, hasModulePermission]);

  // Some sidebar entries carry a default query string (e.g. ?type=customer on the
  // ledger views) so we compare only the path portion when locating the active module.
  const hrefPath = (href: string) => href.split("?")[0];

  // Find which module contains the current route
  const getActiveModuleTitle = () => {
    for (const item of filteredNavigationItems) {
      if (item.children?.some(child => !child.isHeader && location.pathname.startsWith(hrefPath(child.href)))) {
        return item.title;
      }
    }
    return null;
  };

  // Initialize expanded items with the active module
  const [expandedItems, setExpandedItems] = useState<string[]>(() => {
    const activeModule = getActiveModuleTitle();
    return activeModule ? [activeModule] : [];
  });

  // Update expanded items when route changes to include active module
  useEffect(() => {
    const activeModule = getActiveModuleTitle();
    if (activeModule && !expandedItems.includes(activeModule)) {
      setExpandedItems(prev => [...prev, activeModule]);
    }
  }, [location.pathname]);

  const toggleExpanded = (title: string) => {
    setExpandedItems((prev) =>
      prev.includes(title)
        ? prev.filter((item) => item !== title)
        : [...prev, title]
    );
  };

  const isActiveRoute = (href: string) => {
    const [path, query] = href.split("?");
    if (location.pathname !== path) return false;
    if (!query) return true;
    const want = new URLSearchParams(query);
    const have = new URLSearchParams(location.search);
    for (const [k, v] of want) {
      if (have.get(k) !== v) return false;
    }
    return true;
  };
  const isParentActive = (children?: { href: string; isHeader?: boolean }[]) =>
    children?.some((child) => !child.isHeader && location.pathname.startsWith(hrefPath(child.href)));

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-50 h-screen w-64 bg-sidebar border-r border-sidebar-border shadow-xs transition-transform duration-300 lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex h-16 items-center justify-between px-4 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <img
              src={cansportLogo}
              alt="Cansport Global Industries"
              className="h-10 w-auto object-contain"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden text-sidebar-foreground"
            onClick={() => setIsOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 h-[calc(100vh-8rem)] scrollbar-thin">
          <div className="space-y-0.5">
            {filteredNavigationItems.map((item) => {
              const itemActive = item.href ? isActiveRoute(item.href) : isParentActive(item.children);
              return (
                <div key={item.title}>
                  {item.href ? (
                    <Link
                      to={item.href}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                        itemActive
                          ? "bg-brand-gradient text-primary-foreground shadow-soft"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      )}
                    >
                      {itemActive && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-full bg-primary-foreground/80" />
                      )}
                      <item.icon
                        className={cn(
                          "h-5 w-5 transition-transform group-hover:scale-110",
                          itemActive ? "text-primary-foreground" : item.color,
                        )}
                      />
                      {item.title}
                    </Link>
                  ) : (
                    <Collapsible
                      open={expandedItems.includes(item.title)}
                      onOpenChange={() => toggleExpanded(item.title)}
                    >
                      {item.prominent ? (
                        // Prominent "hero" split button: main area navigates
                        // straight to the quick-access page; the chevron only
                        // toggles the submenu.
                        <div className="group relative flex items-center gap-1 rounded-xl bg-brand-gradient text-primary-foreground shadow-soft transition-all duration-200 hover:shadow-md">
                          <Link
                            to={item.quickHref || item.children?.[0]?.href || "#"}
                            className="flex flex-1 items-center gap-3 rounded-l-xl px-3 py-2.5 text-sm font-semibold"
                          >
                            <item.icon className="h-5 w-5 transition-transform group-hover:scale-110 text-primary-foreground" />
                            {item.title}
                          </Link>
                          <CollapsibleTrigger
                            aria-label={`Toggle ${item.title} menu`}
                            className="flex items-center self-stretch rounded-r-xl px-2 hover:bg-primary-foreground/10"
                          >
                            <ChevronDown
                              className={cn(
                                "h-4 w-4 transition-transform duration-300 text-primary-foreground/80",
                                expandedItems.includes(item.title) && "rotate-180 text-primary-foreground"
                              )}
                            />
                          </CollapsibleTrigger>
                        </div>
                      ) : (
                        <CollapsibleTrigger className="w-full">
                          <div
                            className={cn(
                              "group relative flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                              itemActive
                                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                            )}
                          >
                            {itemActive && (
                              <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-full bg-primary" />
                            )}
                            <div className="flex items-center gap-3">
                              <item.icon
                                className={cn(
                                  "h-5 w-5 transition-transform group-hover:scale-110",
                                  item.color,
                                )}
                              />
                              {item.title}
                            </div>
                            <ChevronDown
                              className={cn(
                                "h-4 w-4 transition-transform duration-300 text-sidebar-foreground/50",
                                expandedItems.includes(item.title) && "rotate-180 text-sidebar-foreground"
                              )}
                            />
                          </div>
                        </CollapsibleTrigger>
                      )}
                      <CollapsibleContent className="relative pl-7 ml-3.5 mt-1 mb-1 border-l border-sidebar-border/80 space-y-0.5">
                        {/* Quick Action Button for Floor Inventory */}
                        {item.hasQuickAction && item.title === "Floor Inventory" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsAddRawMaterialOpen(true);
                            }}
                            className="flex items-center gap-2 w-full rounded-lg px-3 py-1.5 text-sm transition-colors text-primary hover:bg-sidebar-accent font-medium"
                          >
                            <Plus className="h-4 w-4" />
                            Add Raw Material
                          </button>
                        )}
                        {item.children?.map((child, idx) =>
                          child.isHeader ? (
                            <div
                              key={`hdr-${child.title}-${idx}`}
                              className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40 select-none"
                            >
                              {child.title}
                            </div>
                          ) : (
                            <Link
                              key={child.title}
                              to={child.href}
                              state={child.state}
                              className={cn(
                                "relative block rounded-lg px-3 py-1.5 text-sm transition-all duration-200",
                                isActiveRoute(child.href) && !child.state
                                  ? "bg-primary/10 text-primary font-semibold ring-1 ring-inset ring-primary/15"
                                  : "text-sidebar-foreground/65 hover:text-sidebar-foreground hover:bg-sidebar-accent/70"
                              )}
                            >
                              {child.title}
                            </Link>
                          )
                        )}
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </div>
              );
            })}
          </div>
        </nav>

        {/* Footer */}
        <div className="border-t border-sidebar-border p-3 bg-sidebar/80">
          <Button
            variant="ghost"
            className="w-full justify-start text-sidebar-foreground/70 hover:text-destructive hover:bg-destructive/10"
          >
            <LogOut className="h-4 w-4 mr-3" />
            Logout
          </Button>
        </div>
      </aside>

      {/* Add Raw Material Dialog */}
      <AddRawMaterialDialog 
        open={isAddRawMaterialOpen} 
        onOpenChange={setIsAddRawMaterialOpen} 
      />
    </>
  );
}
