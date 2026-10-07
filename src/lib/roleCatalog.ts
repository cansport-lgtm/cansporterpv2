import { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];

/**
 * Role tier inside a module. Tiers are NOT mutually exclusive — a user may hold
 * several tiers of the same module and receives the union of their scopes.
 */
export type RoleTier = "manager" | "officer" | "viewer" | "special";

export const ROLE_MODULES = [
  { key: "administration", label: "Administration" },
  { key: "general", label: "General (cross-module)" },
  { key: "production", label: "Production & Planning" },
  { key: "hourly_production", label: "Hourly Production" },
  { key: "machine_monitor", label: "Machine Monitor" },
  { key: "wip", label: "WIP Management" },
  { key: "material_consumption", label: "Material Consumption" },
  { key: "floor_inventory", label: "Floor Inventory" },
  { key: "labour", label: "Labour Productivity" },
  { key: "qa", label: "Quality Assurance" },
  { key: "quality_score", label: "Quality Score" },
  { key: "rejections", label: "Rejections & Wastages" },
  { key: "maintenance", label: "Maintenance" },
  { key: "five_s", label: "5S Audit" },
  { key: "hr", label: "Human Resources" },
  { key: "performance", label: "Performance" },
  { key: "domestic_sales", label: "Sales (Domestic)" },
  { key: "dispatch_planner", label: "Dispatch Planner" },
  { key: "private_label", label: "Private Label Sales" },
  { key: "export", label: "Export Sales" },
  { key: "online_sales", label: "Online Sales" },
  { key: "purchase", label: "Purchase" },
  { key: "purchase_requests", label: "Purchase Requests" },
  { key: "gate_pass", label: "Gate Pass" },
  { key: "store_pass", label: "Store Pass" },
  { key: "accounting", label: "Accounting" },
  { key: "expenses", label: "Expenses" },
  { key: "fixed_assets", label: "Fixed Assets" },
  { key: "master_data", label: "Master Data" },
  { key: "projects", label: "Project Management" },
  { key: "rd", label: "Product Dev & R&D" },
  { key: "crm", label: "CRM" },
  { key: "marketing", label: "Marketing" },
  { key: "helpdesk", label: "Help Desk" },
  { key: "distributor", label: "Distributor Orders" },
] as const;

export type RoleModuleKey = (typeof ROLE_MODULES)[number]["key"];

export interface RoleMeta {
  module: RoleModuleKey;
  /** Short label shown inside its module group (the module name is not repeated). */
  label: string;
  tier: RoleTier;
  description: string;
  /** Badge classes. */
  color: string;
}

/**
 * Single source of truth for every app_role: which module it belongs to, its
 * label, tier, description and badge colour. Typed as Record<AppRole, …> so a
 * new enum value fails the type check until it is catalogued here.
 */
export const ROLE_META: Record<AppRole, RoleMeta> = {

  // administration
  super_admin: {
    module: "administration",
    label: "Super Admin",
    tier: "special",
    description: "Full system access with all permissions",
    color: "bg-red-500/10 text-red-500 border-red-500/20",
  },
  admin: {
    module: "administration",
    label: "Admin",
    tier: "special",
    description: "Administrative access to most features",
    color: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  },

  // general
  operational_manager: {
    module: "general",
    label: "Operational Manager (Production + QA)",
    tier: "manager",
    description: "Full access to Production and QA modules",
    color: "bg-teal-500/10 text-teal-500 border-teal-500/20",
  },
  manager: {
    module: "general",
    label: "Manager",
    tier: "manager",
    description: "Department-level management access",
    color: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  },
  supervisor: {
    module: "general",
    label: "Supervisor",
    tier: "special",
    description: "Team supervision and approval capabilities",
    color: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  },
  operator: {
    module: "general",
    label: "Operator",
    tier: "officer",
    description: "Data entry and operational tasks",
    color: "bg-green-500/10 text-green-500 border-green-500/20",
  },
  viewer: {
    module: "general",
    label: "Viewer",
    tier: "viewer",
    description: "Read-only access to permitted modules",
    color: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  },

  // production
  production_manager: {
    module: "production",
    label: "Manager",
    tier: "manager",
    description: "Production – full access including approve/post (delete reserved for super admin)",
    color: "bg-orange-600/10 text-orange-600 border-orange-600/20",
  },
  production_officer: {
    module: "production",
    label: "Officer",
    tier: "officer",
    description: "Production – create and edit entries (no approve, no delete)",
    color: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  },
  production_viewer: {
    module: "production",
    label: "Viewer",
    tier: "viewer",
    description: "Production – read-only access",
    color: "bg-orange-400/10 text-orange-400 border-orange-400/20",
  },
  production_operator: {
    module: "production",
    label: "Production Operator (post + planning, edit ≤48h)",
    tier: "special",
    description: "Production & Production Planning – can post/unpost the day's production entries and edit within 48 hours of creation (no delete)",
    color: "bg-blue-600/10 text-blue-600 border-blue-600/20",
  },
  closing_data_poster: {
    module: "production",
    label: "Closing Data Poster (daily stock closing)",
    tier: "special",
    description: "Posts Daily Stock Closing (Production Planning) and Stock Closing (Material Consumption) – limited to those two pages only",
    color: "bg-purple-600/10 text-purple-600 border-purple-600/20",
  },

  // hourly_production
  hourly_production_manager: {
    module: "hourly_production",
    label: "Manager",
    tier: "manager",
    description: "Hourly Production – full access including approve (delete reserved for super admin)",
    color: "bg-indigo-600/10 text-indigo-600 border-indigo-600/20",
  },
  hourly_production_officer: {
    module: "hourly_production",
    label: "Officer",
    tier: "officer",
    description: "Hourly Production – create and edit entries (no approve, no delete)",
    color: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
  },
  hourly_production_viewer: {
    module: "hourly_production",
    label: "Viewer",
    tier: "viewer",
    description: "Hourly Production – read-only access",
    color: "bg-indigo-400/10 text-indigo-400 border-indigo-400/20",
  },

  // machine_monitor
  machine_monitor_manager: {
    module: "machine_monitor",
    label: "Manager",
    tier: "manager",
    description: "Machine Monitor – full access including approve (delete reserved for super admin)",
    color: "bg-cyan-600/10 text-cyan-600 border-cyan-600/20",
  },
  machine_monitor_officer: {
    module: "machine_monitor",
    label: "Officer",
    tier: "officer",
    description: "Machine Monitor – create and edit entries (no approve, no delete)",
    color: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  },
  machine_monitor_viewer: {
    module: "machine_monitor",
    label: "Viewer",
    tier: "viewer",
    description: "Machine Monitor – read-only access",
    color: "bg-cyan-400/10 text-cyan-400 border-cyan-400/20",
  },

  // wip
  wip_manager: {
    module: "wip",
    label: "Manager",
    tier: "manager",
    description: "WIP Management – full access including approve (delete reserved for super admin)",
    color: "bg-violet-600/10 text-violet-600 border-violet-600/20",
  },
  wip_officer: {
    module: "wip",
    label: "Officer",
    tier: "officer",
    description: "WIP Management – create and edit entries (no approve, no delete)",
    color: "bg-violet-500/10 text-violet-500 border-violet-500/20",
  },
  wip_viewer: {
    module: "wip",
    label: "Viewer",
    tier: "viewer",
    description: "WIP Management – read-only access",
    color: "bg-violet-400/10 text-violet-400 border-violet-400/20",
  },

  // material_consumption
  material_consumption_manager: {
    module: "material_consumption",
    label: "Manager",
    tier: "manager",
    description: "Material Consumption – full access including approve (delete reserved for super admin)",
    color: "bg-sky-600/10 text-sky-600 border-sky-600/20",
  },
  material_consumption_officer: {
    module: "material_consumption",
    label: "Officer",
    tier: "officer",
    description: "Material Consumption – create and edit entries (no approve, no delete)",
    color: "bg-sky-500/10 text-sky-500 border-sky-500/20",
  },
  material_consumption_viewer: {
    module: "material_consumption",
    label: "Viewer",
    tier: "viewer",
    description: "Material Consumption – read-only access",
    color: "bg-sky-400/10 text-sky-400 border-sky-400/20",
  },
  store_operator: {
    module: "material_consumption",
    label: "Store Operator (stock closing only)",
    tier: "special",
    description: "Access to Stock Closing page in Material Consumption module only",
    color: "bg-sky-500/10 text-sky-500 border-sky-500/20",
  },

  // floor_inventory
  floor_inventory_manager: {
    module: "floor_inventory",
    label: "Manager",
    tier: "manager",
    description: "Floor Inventory – full access including approve (delete reserved for super admin)",
    color: "bg-lime-600/10 text-lime-600 border-lime-600/20",
  },
  floor_inventory_officer: {
    module: "floor_inventory",
    label: "Officer",
    tier: "officer",
    description: "Floor Inventory – create and edit entries (no approve, no delete)",
    color: "bg-lime-500/10 text-lime-500 border-lime-500/20",
  },
  floor_inventory_viewer: {
    module: "floor_inventory",
    label: "Viewer",
    tier: "viewer",
    description: "Floor Inventory – read-only access",
    color: "bg-lime-400/10 text-lime-400 border-lime-400/20",
  },

  // labour
  labour_productivity_approver: {
    module: "labour",
    label: "Approver",
    tier: "manager",
    description: "Labour Productivity – review and approve labour productivity entries and edit requests",
    color: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  },
  labour_productivity_poster: {
    module: "labour",
    label: "Poster",
    tier: "officer",
    description: "Labour Productivity – create and post labour productivity entries",
    color: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
  },
  labour_productivity_viewer: {
    module: "labour",
    label: "Viewer",
    tier: "viewer",
    description: "Labour Productivity – read-only access to labour productivity data",
    color: "bg-slate-500/10 text-slate-500 border-slate-500/20",
  },
  floor_incharge: {
    module: "labour",
    label: "Floor Incharge",
    tier: "special",
    description: "Labour Productivity Entry, plus Hourly Production & Machine Monitor when authorized",
    color: "bg-lime-500/10 text-lime-500 border-lime-500/20",
  },
  labour_gate_pass_approver: {
    module: "labour",
    label: "Gate Pass Approver (worker passes)",
    tier: "special",
    description: "Labour Productivity – approve / reject worker gate passes (half day, short leave), cancel a pass before it is out, convert an overdue short leave to a half day",
    color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  },
  labour_attendance_delete_approver: {
    module: "labour",
    label: "Attendance Delete Approver",
    tier: "special",
    description: "Labour Productivity – approve / reject supervisors' requests to delete a worker's attendance entry marked by mistake (approval deletes the entry); sees the attendance delete log sheet",
    color: "bg-rose-500/10 text-rose-600 border-rose-500/20",
  },

  // qa
  qa_super_manager: {
    module: "qa",
    label: "Super Manager (manager + daily targets)",
    tier: "manager",
    description: "Quality Assurance – everything the QA Manager can do, plus setting daily inspection targets (Daily Quality Plan); no delete",
    color: "bg-cyan-700/10 text-cyan-700 border-cyan-700/20",
  },
  qa_manager: {
    module: "qa",
    label: "Manager",
    tier: "manager",
    description: "Quality Assurance – full access including approve (delete reserved for super admin)",
    color: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  },
  qa_officer: {
    module: "qa",
    label: "Officer",
    tier: "officer",
    description: "Quality Assurance – create and edit inspections (no approve, no delete)",
    color: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  },
  qa_viewer: {
    module: "qa",
    label: "Viewer",
    tier: "viewer",
    description: "Quality Assurance – read-only access",
    color: "bg-cyan-400/10 text-cyan-400 border-cyan-400/20",
  },
  qa_inspector: {
    module: "qa",
    label: "Inspector (inspection form only)",
    tier: "special",
    description: "Quality Assurance – inspection entry form only; can only create inspections (no dashboard or any other page)",
    color: "bg-cyan-600/10 text-cyan-600 border-cyan-600/20",
  },

  // quality_score
  quality_score_manager: {
    module: "quality_score",
    label: "Manager",
    tier: "manager",
    description: "Quality Score – full access including approve (delete reserved for super admin)",
    color: "bg-indigo-600/10 text-indigo-600 border-indigo-600/20",
  },
  quality_score_officer: {
    module: "quality_score",
    label: "Officer",
    tier: "officer",
    description: "Quality Score – create and edit entries (no approve, no delete)",
    color: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
  },
  quality_score_viewer: {
    module: "quality_score",
    label: "Viewer",
    tier: "viewer",
    description: "Quality Score – read-only access",
    color: "bg-indigo-400/10 text-indigo-400 border-indigo-400/20",
  },

  // rejections
  rejections_manager: {
    module: "rejections",
    label: "Manager",
    tier: "manager",
    description: "Rejections & Wastages – full access including approve (delete reserved for super admin)",
    color: "bg-cyan-600/10 text-cyan-600 border-cyan-600/20",
  },
  rejections_officer: {
    module: "rejections",
    label: "Officer",
    tier: "officer",
    description: "Rejections & Wastages – create and edit entries (no approve, no delete)",
    color: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  },
  rejections_viewer: {
    module: "rejections",
    label: "Viewer",
    tier: "viewer",
    description: "Rejections & Wastages – read-only access",
    color: "bg-cyan-400/10 text-cyan-400 border-cyan-400/20",
  },

  // maintenance
  maintenance_manager: {
    module: "maintenance",
    label: "Manager",
    tier: "manager",
    description: "Maintenance – full access including approve (delete reserved for super admin)",
    color: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  },
  maintenance_officer: {
    module: "maintenance",
    label: "Officer",
    tier: "officer",
    description: "Maintenance – create and edit work orders (no approve, no delete)",
    color: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  },
  maintenance_viewer: {
    module: "maintenance",
    label: "Viewer",
    tier: "viewer",
    description: "Maintenance – read-only access",
    color: "bg-amber-400/10 text-amber-400 border-amber-400/20",
  },

  // five_s
  five_s_manager: {
    module: "five_s",
    label: "Manager",
    tier: "manager",
    description: "5S Audit – full access including approve (delete reserved for super admin)",
    color: "bg-teal-600/10 text-teal-600 border-teal-600/20",
  },
  five_s_officer: {
    module: "five_s",
    label: "Officer",
    tier: "officer",
    description: "5S Audit – create and edit entries (no approve, no delete)",
    color: "bg-teal-500/10 text-teal-500 border-teal-500/20",
  },
  five_s_viewer: {
    module: "five_s",
    label: "Viewer",
    tier: "viewer",
    description: "5S Audit – read-only access",
    color: "bg-teal-400/10 text-teal-400 border-teal-400/20",
  },

  // hr
  hr_manager: {
    module: "hr",
    label: "Manager",
    tier: "manager",
    description: "Human Resources – full access including approve (delete reserved for super admin)",
    color: "bg-amber-600/10 text-amber-600 border-amber-600/20",
  },
  hr_officer: {
    module: "hr",
    label: "Officer",
    tier: "officer",
    description: "Human Resources – create and edit entries (no approve, no delete)",
    color: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  },
  hr_viewer: {
    module: "hr",
    label: "Viewer",
    tier: "viewer",
    description: "Human Resources – read-only access",
    color: "bg-amber-400/10 text-amber-400 border-amber-400/20",
  },
  staff_gate_pass_approver: {
    module: "hr",
    label: "Staff Gate Pass Approver",
    tier: "special",
    description: "HR – approve / reject staff gate passes (half day, short leave), cancel a pass before it is out, convert an overdue short leave to a half day; HR manager / officer apply",
    color: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  },

  // performance
  performance_manager: {
    module: "performance",
    label: "Manager",
    tier: "manager",
    description: "Performance – full access including approve (delete reserved for super admin)",
    color: "bg-rose-600/10 text-rose-600 border-rose-600/20",
  },
  performance_officer: {
    module: "performance",
    label: "Officer",
    tier: "officer",
    description: "Performance – create and edit entries (no approve, no delete)",
    color: "bg-rose-500/10 text-rose-500 border-rose-500/20",
  },
  performance_viewer: {
    module: "performance",
    label: "Viewer",
    tier: "viewer",
    description: "Performance – read-only access",
    color: "bg-rose-400/10 text-rose-400 border-rose-400/20",
  },

  // domestic_sales
  sales_executive: {
    module: "domestic_sales",
    label: "Sales Executive",
    tier: "officer",
    description: "Access to Sales module for order management",
    color: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
  },
  sales_order_manager: {
    module: "domestic_sales",
    label: "Sales Order Management (no prices/invoices)",
    tier: "special",
    description: "Domestic sales orders + dispatch coordination & dashboards – no customer/product creation, no invoices, no prices",
    color: "bg-indigo-600/10 text-indigo-600 border-indigo-600/20",
  },
  order_management: {
    module: "domestic_sales",
    label: "Order Management (dashboards view)",
    tier: "viewer",
    description: "View access to Sales and Production dashboards only",
    color: "bg-pink-500/10 text-pink-500 border-pink-500/20",
  },
  dispatch_operator: {
    module: "domestic_sales",
    label: "Dispatch Operator (no prices)",
    tier: "special",
    description: "Domestic Dispatch page only – can create dispatches without seeing any prices; links store passes to their dispatch (DC)",
    color: "bg-orange-600/10 text-orange-600 border-orange-600/20",
  },
  billing_officer: {
    module: "domestic_sales",
    label: "Billing Officer (Sales + Purchase invoicing)",
    tier: "special",
    description: "Sales & Purchase invoicing – access to Sales and Purchase modules (permission-driven)",
    color: "bg-fuchsia-500/10 text-fuchsia-500 border-fuchsia-500/20",
  },

  // dispatch_planner
  dispatch_planner_manager: {
    module: "dispatch_planner",
    label: "Manager",
    tier: "manager",
    description: "Dispatch Planner – everything the officer can, plus the vehicle master and deleting saved plan versions",
    color: "bg-cyan-700/10 text-cyan-700 border-cyan-700/20",
  },
  dispatch_planner_officer: {
    module: "dispatch_planner",
    label: "Officer",
    tier: "officer",
    description: "Dispatch Planner – run suggestions, pin / flag lines, save plan versions, print and export (reads only; nothing is dispatched or booked)",
    color: "bg-cyan-600/10 text-cyan-600 border-cyan-600/20",
  },
  dispatch_planner_viewer: {
    module: "dispatch_planner",
    label: "Viewer",
    tier: "viewer",
    description: "Dispatch Planner – read-only access to the suggested plan, pending lines and saved versions",
    color: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  },

  // private_label
  private_label_manager: {
    module: "private_label",
    label: "Manager",
    tier: "manager",
    description: "Private Label Sales – full access including approve (delete reserved for super admin)",
    color: "bg-cyan-600/10 text-cyan-600 border-cyan-600/20",
  },
  private_label_officer: {
    module: "private_label",
    label: "Officer",
    tier: "officer",
    description: "Private Label Sales – create and edit entries (no approve, no delete)",
    color: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  },
  private_label_viewer: {
    module: "private_label",
    label: "Viewer",
    tier: "viewer",
    description: "Private Label Sales – read-only access",
    color: "bg-cyan-400/10 text-cyan-400 border-cyan-400/20",
  },
  private_label_distributor: {
    module: "private_label",
    label: "Private Label Distributor",
    tier: "special",
    description: "View-only access to Private Label Sales module",
    color: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  },

  // export
  export_manager: {
    module: "export",
    label: "Manager",
    tier: "manager",
    description: "Export Sales – full access including approve (delete reserved for super admin)",
    color: "bg-blue-600/10 text-blue-600 border-blue-600/20",
  },
  export_officer: {
    module: "export",
    label: "Officer",
    tier: "officer",
    description: "Export Sales – create and edit entries (no approve, no delete)",
    color: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  },
  export_viewer: {
    module: "export",
    label: "Viewer",
    tier: "viewer",
    description: "Export Sales – read-only access",
    color: "bg-blue-400/10 text-blue-400 border-blue-400/20",
  },

  // online_sales
  online_sales_admin: {
    module: "online_sales",
    label: "Admin (full module)",
    tier: "manager",
    description: "Online Sales – full module access including financials, masters and settings (all actions)",
    color: "bg-rose-700/10 text-rose-700 border-rose-700/20",
  },
  online_sales_manager: {
    module: "online_sales",
    label: "Manager (no delete)",
    tier: "manager",
    description: "Online Sales – full module visibility incl. financials; can approve but not delete",
    color: "bg-rose-600/10 text-rose-600 border-rose-600/20",
  },
  online_sales_agent: {
    module: "online_sales",
    label: "Agent (fulfilment, no prices)",
    tier: "officer",
    description: "Online Sales – order/customer/return fulfilment only (orders, customers, returns, live status, inventory); no money/financial pages",
    color: "bg-pink-600/10 text-pink-600 border-pink-600/20",
  },
  online_sales_packing: {
    module: "online_sales",
    label: "Packing",
    tier: "special",
    description: "Online Sales orders page only – can only scan parcels and update weight/items",
    color: "bg-rose-500/10 text-rose-500 border-rose-500/20",
  },

  // purchase
  purchase_manager: {
    module: "purchase",
    label: "Manager (approve POs)",
    tier: "manager",
    description: "Approves purchase orders raised by Purchase Officers",
    color: "bg-blue-700/10 text-blue-700 border-blue-700/20",
  },
  purchase_officer: {
    module: "purchase",
    label: "Officer (create POs)",
    tier: "officer",
    description: "Creates purchase orders – cannot approve (approval reserved for Purchase Manager)",
    color: "bg-teal-600/10 text-teal-600 border-teal-600/20",
  },
  purchase_qc_inspector: {
    module: "purchase",
    label: "QC Inspector (no prices)",
    tier: "special",
    description: "Quality Inspection page only – inspects incoming raw material against POs and approves QC; no prices, no other purchase pages",
    color: "bg-emerald-600/10 text-emerald-600 border-emerald-600/20",
  },

  // purchase_requests
  pr_office_approver: {
    module: "purchase_requests",
    label: "Office Supplies — Approver",
    tier: "manager",
    description: "Purchase Requests – Office Supplies: the officer's rights plus the Purchase approval for Office Supplies (lower quantities, set estimated rates, approve / reject; never on own request)",
    color: "bg-violet-700/10 text-violet-700 border-violet-700/20",
  },
  pr_office_officer: {
    module: "purchase_requests",
    label: "Office Supplies — Officer",
    tier: "officer",
    description: "Purchase Requests – Office Supplies: sees the Office Supplies requests on Purchase → Purchase Requests (no other Purchase page); told when one is approved and ready to order",
    color: "bg-violet-500/10 text-violet-500 border-violet-500/20",
  },
  pr_raw_material_approver: {
    module: "purchase_requests",
    label: "Raw Material — Approver",
    tier: "manager",
    description: "Purchase Requests – Raw Material: the officer's rights plus the Purchase approval for Raw Material (lower quantities, set estimated rates, approve / reject; never on own request)",
    color: "bg-violet-700/10 text-violet-700 border-violet-700/20",
  },
  pr_raw_material_officer: {
    module: "purchase_requests",
    label: "Raw Material — Officer",
    tier: "officer",
    description: "Purchase Requests – Raw Material: sees the Raw Material requests on Purchase → Purchase Requests (no other Purchase page); told when one is approved and ready to order",
    color: "bg-violet-500/10 text-violet-500 border-violet-500/20",
  },
  pr_production_approver: {
    module: "purchase_requests",
    label: "Production Supplies — Approver",
    tier: "manager",
    description: "Purchase Requests – Production Supplies: the officer's rights plus the Purchase approval for Production Supplies (lower quantities, set estimated rates, approve / reject; never on own request)",
    color: "bg-violet-700/10 text-violet-700 border-violet-700/20",
  },
  pr_production_officer: {
    module: "purchase_requests",
    label: "Production Supplies — Officer",
    tier: "officer",
    description: "Purchase Requests – Production Supplies: sees the Production Supplies requests on Purchase → Purchase Requests (no other Purchase page); told when one is approved and ready to order",
    color: "bg-violet-500/10 text-violet-500 border-violet-500/20",
  },
  pr_spares_approver: {
    module: "purchase_requests",
    label: "Spares & Parts — Approver",
    tier: "manager",
    description: "Purchase Requests – Spares & Parts: the officer's rights plus the Purchase approval for Spares & Parts (lower quantities, set estimated rates, approve / reject; never on own request)",
    color: "bg-violet-700/10 text-violet-700 border-violet-700/20",
  },
  pr_spares_officer: {
    module: "purchase_requests",
    label: "Spares & Parts — Officer",
    tier: "officer",
    description: "Purchase Requests – Spares & Parts: sees the Spares & Parts requests on Purchase → Purchase Requests (no other Purchase page); told when one is approved and ready to order",
    color: "bg-violet-500/10 text-violet-500 border-violet-500/20",
  },

  // gate_pass
  gate_pass_manager: {
    module: "gate_pass",
    label: "Manager",
    tier: "manager",
    description: "Gate Pass – make and cancel passes; release a held pass with the counted quantity; close returnable / job work; manual backfill and paper books (sample, returnable, job work and scrap passes are approved by their own managers)",
    color: "bg-stone-700/10 text-stone-700 border-stone-700/20",
  },
  gate_pass_officer: {
    module: "gate_pass",
    label: "Officer",
    tier: "officer",
    description: "Gate Pass – make and submit passes (no approve)",
    color: "bg-stone-600/10 text-stone-600 border-stone-600/20",
  },
  gate_pass_viewer: {
    module: "gate_pass",
    label: "Viewer",
    tier: "viewer",
    description: "Gate Pass – read-only access to passes and the register",
    color: "bg-stone-500/10 text-stone-500 border-stone-500/20",
  },
  gate_pass_sample_manager: {
    module: "gate_pass",
    label: "Sample Pass Approver",
    tier: "special",
    description: "Gate Pass – approve or reject sample passes only",
    color: "bg-stone-700/10 text-stone-700 border-stone-700/20",
  },
  gate_pass_returnable_manager: {
    module: "gate_pass",
    label: "Returnable Pass Approver",
    tier: "special",
    description: "Gate Pass – approve or reject returnable passes only",
    color: "bg-stone-700/10 text-stone-700 border-stone-700/20",
  },
  gate_pass_jobwork_manager: {
    module: "gate_pass",
    label: "Job Work Pass Approver",
    tier: "special",
    description: "Gate Pass – approve or reject job work passes only",
    color: "bg-stone-700/10 text-stone-700 border-stone-700/20",
  },
  gate_pass_scrap_manager: {
    module: "gate_pass",
    label: "Scrap Pass Approver",
    tier: "special",
    description: "Gate Pass – approve or reject scrap passes only (sees scrap rates)",
    color: "bg-stone-700/10 text-stone-700 border-stone-700/20",
  },
  gate_security: {
    module: "gate_pass",
    label: "Gate Security (gate check only)",
    tier: "special",
    description: "Gate Pass – gate guard: Gate Check page only; counts each line, marks the vehicle Out or holds it (never sees prices)",
    color: "bg-slate-800/10 text-slate-800 border-slate-800/20",
  },

  // store_pass
  store_pass_manager: {
    module: "store_pass",
    label: "Manager",
    tier: "manager",
    description: "Store Pass – make and issue store passes, cancel an issued pass (with a reason), explain store ↔ gate discrepancies",
    color: "bg-indigo-700/10 text-indigo-700 border-indigo-700/20",
  },
  store_pass_officer: {
    module: "store_pass",
    label: "Officer / Store Keeper",
    tier: "officer",
    description: "Store Pass – store keeper: make, issue and print store passes; edit / cancel own drafts (the dispatch operator links passes to dispatches)",
    color: "bg-indigo-600/10 text-indigo-600 border-indigo-600/20",
  },
  store_pass_viewer: {
    module: "store_pass",
    label: "Viewer",
    tier: "viewer",
    description: "Store Pass – read-only access to passes, dispatch tracking and reconciliation",
    color: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
  },

  // accounting
  accounting_manager: {
    module: "accounting",
    label: "Manager (full + approve)",
    tier: "manager",
    description: "Accounting – full access to all entries and reports, including approve",
    color: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  },
  accounting_officer: {
    module: "accounting",
    label: "Officer (no P&L / Balance Sheet)",
    tier: "officer",
    description: "Accounting (no P&L / Balance Sheet) + Production view-only (incl. WIP Ledger) + Sales & Purchase invoicing/returns + Master Data (products/items)",
    color: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  },
  accounting_poster: {
    module: "accounting",
    label: "Poster (entries only)",
    tier: "special",
    description: "Accounting – post vouchers/receipts/payments and review books & ledgers; no financial reports",
    color: "bg-teal-500/10 text-teal-500 border-teal-500/20",
  },

  // expenses
  expenses_manager: {
    module: "expenses",
    label: "Manager",
    tier: "manager",
    description: "Expenses – full access including approve (delete reserved for super admin)",
    color: "bg-yellow-600/10 text-yellow-600 border-yellow-600/20",
  },
  expenses_officer: {
    module: "expenses",
    label: "Officer",
    tier: "officer",
    description: "Expenses – create and edit entries (no approve, no delete)",
    color: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  },
  expenses_viewer: {
    module: "expenses",
    label: "Viewer",
    tier: "viewer",
    description: "Expenses – read-only access",
    color: "bg-yellow-400/10 text-yellow-400 border-yellow-400/20",
  },
  pettycash_handler: {
    module: "expenses",
    label: "Pettycash Handler",
    tier: "special",
    description: "Access to Petty Cash page only with entry creation; pays staff trip fuel vouchers (Expenses → Trip Fuel Vouchers)",
    color: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  },

  // fixed_assets
  fixed_assets_manager: {
    module: "fixed_assets",
    label: "Manager",
    tier: "manager",
    description: "Fixed Assets – full access including approve (delete reserved for super admin)",
    color: "bg-orange-600/10 text-orange-600 border-orange-600/20",
  },
  fixed_assets_officer: {
    module: "fixed_assets",
    label: "Officer",
    tier: "officer",
    description: "Fixed Assets – create and edit entries (no approve, no delete)",
    color: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  },
  fixed_assets_viewer: {
    module: "fixed_assets",
    label: "Viewer",
    tier: "viewer",
    description: "Fixed Assets – read-only access",
    color: "bg-orange-400/10 text-orange-400 border-orange-400/20",
  },

  // master_data
  master_data_manager: {
    module: "master_data",
    label: "Manager",
    tier: "manager",
    description: "Master Data – full access including approve (delete reserved for super admin)",
    color: "bg-emerald-600/10 text-emerald-600 border-emerald-600/20",
  },
  master_data_officer: {
    module: "master_data",
    label: "Officer",
    tier: "officer",
    description: "Master Data – create and edit entries (no approve, no delete)",
    color: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  },
  master_data_viewer: {
    module: "master_data",
    label: "Viewer",
    tier: "viewer",
    description: "Master Data – read-only access",
    color: "bg-emerald-400/10 text-emerald-400 border-emerald-400/20",
  },

  // projects
  project_manager: {
    module: "projects",
    label: "Manager (assigned projects)",
    tier: "manager",
    description: "Project Management – full access including approve (delete reserved for super admin); can only see assigned projects",
    color: "bg-violet-500/10 text-violet-500 border-violet-500/20",
  },
  projects_super_manager: {
    module: "projects",
    label: "Super Manager (all projects, no delete)",
    tier: "manager",
    description: "Project Management – sees all users' projects and progress; can create projects, tasks and documents but cannot delete anything",
    color: "bg-blue-700/10 text-blue-700 border-blue-700/20",
  },
  projects_officer: {
    module: "projects",
    label: "Officer",
    tier: "officer",
    description: "Project Management – create and edit projects (no approve, no delete)",
    color: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  },
  projects_viewer: {
    module: "projects",
    label: "Viewer",
    tier: "viewer",
    description: "Project Management – read-only access",
    color: "bg-blue-400/10 text-blue-400 border-blue-400/20",
  },

  // rd
  rd_manager: {
    module: "rd",
    label: "Manager",
    tier: "manager",
    description: "Product Dev & R&D – full access including approve (delete reserved for super admin)",
    color: "bg-fuchsia-600/10 text-fuchsia-600 border-fuchsia-600/20",
  },
  rd_officer: {
    module: "rd",
    label: "Officer",
    tier: "officer",
    description: "Product Dev & R&D – create and edit entries (no approve, no delete)",
    color: "bg-fuchsia-500/10 text-fuchsia-500 border-fuchsia-500/20",
  },
  rd_viewer: {
    module: "rd",
    label: "Viewer",
    tier: "viewer",
    description: "Product Dev & R&D – read-only access",
    color: "bg-fuchsia-400/10 text-fuchsia-400 border-fuchsia-400/20",
  },

  // crm
  crm_manager: {
    module: "crm",
    label: "Manager",
    tier: "manager",
    description: "CRM – full access including approve (delete reserved for super admin)",
    color: "bg-sky-600/10 text-sky-600 border-sky-600/20",
  },
  crm_officer: {
    module: "crm",
    label: "Officer",
    tier: "officer",
    description: "CRM – create and edit entries (no approve, no delete)",
    color: "bg-sky-500/10 text-sky-500 border-sky-500/20",
  },
  crm_viewer: {
    module: "crm",
    label: "Viewer",
    tier: "viewer",
    description: "CRM – read-only access",
    color: "bg-sky-400/10 text-sky-400 border-sky-400/20",
  },

  // marketing
  marketing_manager: {
    module: "marketing",
    label: "Manager",
    tier: "manager",
    description: "Marketing – full access including approve (delete reserved for super admin)",
    color: "bg-purple-600/10 text-purple-600 border-purple-600/20",
  },
  marketing_officer: {
    module: "marketing",
    label: "Officer",
    tier: "officer",
    description: "Marketing – create and edit entries (no approve, no delete)",
    color: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  },
  marketing_viewer: {
    module: "marketing",
    label: "Viewer",
    tier: "viewer",
    description: "Marketing – read-only access",
    color: "bg-purple-400/10 text-purple-400 border-purple-400/20",
  },

  // helpdesk
  helpdesk_manager: {
    module: "helpdesk",
    label: "Manager (all tickets)",
    tier: "manager",
    description: "Help Desk – manages all support tickets (assign, comment, change status/priority, resolve) on the ticket admin board",
    color: "bg-rose-600/10 text-rose-600 border-rose-600/20",
  },

  // distributor
  distributor_admin: {
    module: "distributor",
    label: "Admin",
    tier: "manager",
    description: "Distributor Orders – manage their distributor's sales & manager users, plus full module access",
    color: "bg-amber-700/10 text-amber-700 border-amber-700/20",
  },
  distributor_manager: {
    module: "distributor",
    label: "Manager",
    tier: "manager",
    description: "Distributor Orders – approve/reject/edit orders and run the dispatch sheet for their distributor",
    color: "bg-amber-600/10 text-amber-600 border-amber-600/20",
  },
  distributor_sales: {
    module: "distributor",
    label: "Sales",
    tier: "officer",
    description: "Distributor Orders – create customers and make/submit orders for their distributor only",
    color: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  },
};

/**
 * Distributor roles need a distributor_id, which is assigned in the Distributor
 * module's "Manage Users" page (Distributor Orders → Manage Users). Assigning them
 * from User Management would leave distributor_id NULL and break isolation.
 */
export const NON_ASSIGNABLE_MODULES: ReadonlySet<RoleModuleKey> = new Set(["distributor"]);

export const TIER_LABELS: Record<RoleTier, string> = {
  manager: "Manager",
  officer: "Officer",
  viewer: "Viewer",
  special: "Special",
};

export interface RoleModuleGroup {
  key: RoleModuleKey;
  label: string;
  roles: AppRole[];
}

/** Every module with its roles, in catalogue order. */
export const ROLE_GROUPS: RoleModuleGroup[] = ROLE_MODULES.map((m) => ({
  key: m.key,
  label: m.label,
  roles: (Object.keys(ROLE_META) as AppRole[]).filter((r) => ROLE_META[r].module === m.key),
}));

/** Modules whose roles can be assigned from Settings → User Management. */
export const ASSIGNABLE_ROLE_GROUPS = ROLE_GROUPS.filter((g) => !NON_ASSIGNABLE_MODULES.has(g.key));

export const getModuleLabel = (module: RoleModuleKey) =>
  ROLE_MODULES.find((m) => m.key === module)?.label ?? module;

/** "Gate Pass — Manager" style label, for places where the module is not shown separately. */
export const getRoleFullLabel = (role: AppRole) => {
  const meta = ROLE_META[role];
  if (!meta) return role.replace(/_/g, " ");
  if (meta.module === "administration" || meta.module === "general") return meta.label;
  return `${getModuleLabel(meta.module)} — ${meta.label}`;
};

export const getRoleColor = (role: AppRole) => ROLE_META[role]?.color ?? "";
