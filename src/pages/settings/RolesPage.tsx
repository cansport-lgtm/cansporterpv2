import { useState, useEffect } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Shield, Users, Package, ClipboardList } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

const roleDescriptions: Record<AppRole, string> = {
  super_admin: "Full system access with all permissions",
  admin: "Administrative access to most features",
  manager: "Department-level management access",
  supervisor: "Team supervision and approval capabilities",
  operator: "Data entry and operational tasks",
  viewer: "Read-only access to permitted modules",
  operational_manager: "Full access to Production and QA modules",
  qa_manager: "Full access to Quality Assurance module only",
  maintenance_manager: "Full access to Maintenance module only",
  sales_executive: "Access to Sales module for order management",
  order_management: "View access to Sales and Production dashboards only",
  floor_incharge: "Labour Productivity Entry, plus Hourly Production & Machine Monitor when authorized",
  private_label_distributor: "View-only access to Private Label Sales module",
  pettycash_handler: "Access to Petty Cash page only with entry creation",
  store_operator: "Access to Stock Closing page in Material Consumption module only",
  project_manager: "Access to Project Management module – can only see assigned projects",
  online_sales_packing: "Online Sales orders page only – can only scan parcels and update weight/items",
  online_sales_admin: "Online Sales – full module access including financials, masters and settings (all actions)",
  online_sales_manager: "Online Sales – full module visibility incl. financials; can approve but not delete",
  online_sales_agent: "Online Sales – order/customer/return fulfilment only (orders, customers, returns, live status, inventory); no money/financial pages",
  accounting_poster: "Accounting – post vouchers/receipts/payments and review books & ledgers; no financial reports",
  accounting_officer: "Accounting (no P&L / Balance Sheet) + Production view-only (incl. WIP Ledger) + Sales & Purchase invoicing/returns + Master Data (products/items)",
  accounting_manager: "Accounting – full access to all entries and reports, including approve",
  billing_officer: "Sales & Purchase invoicing – access to Sales and Purchase modules (permission-driven)",
  purchase_officer: "Creates purchase orders – cannot approve (approval reserved for Purchase Manager)",
  purchase_manager: "Approves purchase orders raised by Purchase Officers",
  purchase_qc_inspector: "Quality Inspection page only – inspects incoming raw material against POs and approves QC; no prices, no other purchase pages",
  dispatch_operator: "Domestic Dispatch page only – can create dispatches without seeing any prices",
  sales_order_manager: "Domestic sales orders + dispatch coordination & dashboards – no customer/product creation, no invoices, no prices",
  production_operator: "Production & Production Planning – can post and edit entries within 48 hours of creation (no delete/approve)",
  closing_data_poster: "Posts Daily Stock Closing (Production Planning) and Stock Closing (Material Consumption) – limited to those two pages only",
  distributor_sales: "Distributor Orders – create customers and make/submit orders for their distributor only",
  distributor_manager: "Distributor Orders – approve/reject/edit orders and run the dispatch sheet for their distributor",
  distributor_admin: "Distributor Orders – manage their distributor's sales & manager users, plus full module access",
  labour_productivity_approver: "Labour Productivity – review and approve labour productivity entries and edit requests",
  labour_productivity_poster: "Labour Productivity – create and post labour productivity entries",
  labour_productivity_viewer: "Labour Productivity – read-only access to labour productivity data",
  export_manager: "Export Sales – full access including approve (delete reserved for super admin)",
  export_officer: "Export Sales – create and edit entries (no approve, no delete)",
  export_viewer: "Export Sales – read-only access",
  master_data_manager: "Master Data – full access including approve (delete reserved for super admin)",
  master_data_officer: "Master Data – create and edit entries (no approve, no delete)",
  master_data_viewer: "Master Data – read-only access",
  hr_manager: "Human Resources – full access including approve (delete reserved for super admin)",
  hr_officer: "Human Resources – create and edit entries (no approve, no delete)",
  hr_viewer: "Human Resources – read-only access",
  wip_manager: "WIP Management – full access including approve (delete reserved for super admin)",
  wip_officer: "WIP Management – create and edit entries (no approve, no delete)",
  wip_viewer: "WIP Management – read-only access",
  rejections_manager: "Rejections & Wastages – full access including approve (delete reserved for super admin)",
  rejections_officer: "Rejections & Wastages – create and edit entries (no approve, no delete)",
  rejections_viewer: "Rejections & Wastages – read-only access",
  performance_manager: "Performance – full access including approve (delete reserved for super admin)",
  performance_officer: "Performance – create and edit entries (no approve, no delete)",
  performance_viewer: "Performance – read-only access",
  floor_inventory_manager: "Floor Inventory – full access including approve (delete reserved for super admin)",
  floor_inventory_officer: "Floor Inventory – create and edit entries (no approve, no delete)",
  floor_inventory_viewer: "Floor Inventory – read-only access",
  fixed_assets_manager: "Fixed Assets – full access including approve (delete reserved for super admin)",
  fixed_assets_officer: "Fixed Assets – create and edit entries (no approve, no delete)",
  fixed_assets_viewer: "Fixed Assets – read-only access",
  five_s_manager: "5S Audit – full access including approve (delete reserved for super admin)",
  five_s_officer: "5S Audit – create and edit entries (no approve, no delete)",
  five_s_viewer: "5S Audit – read-only access",
  hourly_production_manager: "Hourly Production – full access including approve (delete reserved for super admin)",
  hourly_production_officer: "Hourly Production – create and edit entries (no approve, no delete)",
  hourly_production_viewer: "Hourly Production – read-only access",
  rd_manager: "Product Dev & R&D – full access including approve (delete reserved for super admin)",
  rd_officer: "Product Dev & R&D – create and edit entries (no approve, no delete)",
  rd_viewer: "Product Dev & R&D – read-only access",
  crm_manager: "CRM – full access including approve (delete reserved for super admin)",
  crm_officer: "CRM – create and edit entries (no approve, no delete)",
  crm_viewer: "CRM – read-only access",
  marketing_manager: "Marketing – full access including approve (delete reserved for super admin)",
  marketing_officer: "Marketing – create and edit entries (no approve, no delete)",
  marketing_viewer: "Marketing – read-only access",
};

const roleColors: Record<AppRole, string> = {
  super_admin: "bg-red-500/10 text-red-500 border-red-500/20",
  admin: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  manager: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  supervisor: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  operator: "bg-green-500/10 text-green-500 border-green-500/20",
  viewer: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  operational_manager: "bg-teal-500/10 text-teal-500 border-teal-500/20",
  qa_manager: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  maintenance_manager: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  sales_executive: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
  order_management: "bg-pink-500/10 text-pink-500 border-pink-500/20",
  floor_incharge: "bg-lime-500/10 text-lime-500 border-lime-500/20",
  private_label_distributor: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  pettycash_handler: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  store_operator: "bg-sky-500/10 text-sky-500 border-sky-500/20",
  project_manager: "bg-violet-500/10 text-violet-500 border-violet-500/20",
  online_sales_packing: "bg-rose-500/10 text-rose-500 border-rose-500/20",
  online_sales_admin: "bg-rose-700/10 text-rose-700 border-rose-700/20",
  online_sales_manager: "bg-rose-600/10 text-rose-600 border-rose-600/20",
  online_sales_agent: "bg-pink-600/10 text-pink-600 border-pink-600/20",
  accounting_poster: "bg-teal-500/10 text-teal-500 border-teal-500/20",
  accounting_officer: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  accounting_manager: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  billing_officer: "bg-fuchsia-500/10 text-fuchsia-500 border-fuchsia-500/20",
  purchase_officer: "bg-teal-600/10 text-teal-600 border-teal-600/20",
  purchase_manager: "bg-blue-700/10 text-blue-700 border-blue-700/20",
  purchase_qc_inspector: "bg-emerald-600/10 text-emerald-600 border-emerald-600/20",
  dispatch_operator: "bg-orange-600/10 text-orange-600 border-orange-600/20",
  sales_order_manager: "bg-indigo-600/10 text-indigo-600 border-indigo-600/20",
  production_operator: "bg-blue-600/10 text-blue-600 border-blue-600/20",
  closing_data_poster: "bg-purple-600/10 text-purple-600 border-purple-600/20",
  distributor_sales: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  distributor_manager: "bg-amber-600/10 text-amber-600 border-amber-600/20",
  distributor_admin: "bg-amber-700/10 text-amber-700 border-amber-700/20",
  labour_productivity_approver: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  labour_productivity_poster: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
  labour_productivity_viewer: "bg-slate-500/10 text-slate-500 border-slate-500/20",
  export_manager: "bg-blue-600/10 text-blue-600 border-blue-600/20",
  export_officer: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  export_viewer: "bg-blue-400/10 text-blue-400 border-blue-400/20",
  master_data_manager: "bg-emerald-600/10 text-emerald-600 border-emerald-600/20",
  master_data_officer: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  master_data_viewer: "bg-emerald-400/10 text-emerald-400 border-emerald-400/20",
  hr_manager: "bg-amber-600/10 text-amber-600 border-amber-600/20",
  hr_officer: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  hr_viewer: "bg-amber-400/10 text-amber-400 border-amber-400/20",
  wip_manager: "bg-violet-600/10 text-violet-600 border-violet-600/20",
  wip_officer: "bg-violet-500/10 text-violet-500 border-violet-500/20",
  wip_viewer: "bg-violet-400/10 text-violet-400 border-violet-400/20",
  rejections_manager: "bg-cyan-600/10 text-cyan-600 border-cyan-600/20",
  rejections_officer: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  rejections_viewer: "bg-cyan-400/10 text-cyan-400 border-cyan-400/20",
  performance_manager: "bg-rose-600/10 text-rose-600 border-rose-600/20",
  performance_officer: "bg-rose-500/10 text-rose-500 border-rose-500/20",
  performance_viewer: "bg-rose-400/10 text-rose-400 border-rose-400/20",
  floor_inventory_manager: "bg-lime-600/10 text-lime-600 border-lime-600/20",
  floor_inventory_officer: "bg-lime-500/10 text-lime-500 border-lime-500/20",
  floor_inventory_viewer: "bg-lime-400/10 text-lime-400 border-lime-400/20",
  fixed_assets_manager: "bg-orange-600/10 text-orange-600 border-orange-600/20",
  fixed_assets_officer: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  fixed_assets_viewer: "bg-orange-400/10 text-orange-400 border-orange-400/20",
  five_s_manager: "bg-teal-600/10 text-teal-600 border-teal-600/20",
  five_s_officer: "bg-teal-500/10 text-teal-500 border-teal-500/20",
  five_s_viewer: "bg-teal-400/10 text-teal-400 border-teal-400/20",
  hourly_production_manager: "bg-indigo-600/10 text-indigo-600 border-indigo-600/20",
  hourly_production_officer: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
  hourly_production_viewer: "bg-indigo-400/10 text-indigo-400 border-indigo-400/20",
  rd_manager: "bg-fuchsia-600/10 text-fuchsia-600 border-fuchsia-600/20",
  rd_officer: "bg-fuchsia-500/10 text-fuchsia-500 border-fuchsia-500/20",
  rd_viewer: "bg-fuchsia-400/10 text-fuchsia-400 border-fuchsia-400/20",
  crm_manager: "bg-sky-600/10 text-sky-600 border-sky-600/20",
  crm_officer: "bg-sky-500/10 text-sky-500 border-sky-500/20",
  crm_viewer: "bg-sky-400/10 text-sky-400 border-sky-400/20",
  marketing_manager: "bg-purple-600/10 text-purple-600 border-purple-600/20",
  marketing_officer: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  marketing_viewer: "bg-purple-400/10 text-purple-400 border-purple-400/20",
};

export default function RolesPage() {
  const [roleCounts, setRoleCounts] = useState<Record<AppRole, number>>({
    super_admin: 0,
    admin: 0,
    manager: 0,
    supervisor: 0,
    operator: 0,
    viewer: 0,
    operational_manager: 0,
    qa_manager: 0,
    maintenance_manager: 0,
    sales_executive: 0,
    order_management: 0,
    floor_incharge: 0,
    private_label_distributor: 0,
    pettycash_handler: 0,
    store_operator: 0,
    project_manager: 0,
    online_sales_packing: 0,
    online_sales_admin: 0,
    online_sales_manager: 0,
    online_sales_agent: 0,
    accounting_poster: 0,
    accounting_officer: 0,
    accounting_manager: 0,
    billing_officer: 0,
    purchase_officer: 0,
    purchase_manager: 0,
    purchase_qc_inspector: 0,
    dispatch_operator: 0,
    sales_order_manager: 0,
    production_operator: 0,
    closing_data_poster: 0,
    distributor_sales: 0,
    distributor_manager: 0,
    distributor_admin: 0,
    labour_productivity_approver: 0,
    labour_productivity_poster: 0,
    labour_productivity_viewer: 0,
    export_manager: 0,
    export_officer: 0,
    export_viewer: 0,
    master_data_manager: 0,
    master_data_officer: 0,
    master_data_viewer: 0,
    hr_manager: 0,
    hr_officer: 0,
    hr_viewer: 0,
    wip_manager: 0,
    wip_officer: 0,
    wip_viewer: 0,
    rejections_manager: 0,
    rejections_officer: 0,
    rejections_viewer: 0,
    performance_manager: 0,
    performance_officer: 0,
    performance_viewer: 0,
    floor_inventory_manager: 0,
    floor_inventory_officer: 0,
    floor_inventory_viewer: 0,
    fixed_assets_manager: 0,
    fixed_assets_officer: 0,
    fixed_assets_viewer: 0,
    five_s_manager: 0,
    five_s_officer: 0,
    five_s_viewer: 0,
    hourly_production_manager: 0,
    hourly_production_officer: 0,
    hourly_production_viewer: 0,
    rd_manager: 0,
    rd_officer: 0,
    rd_viewer: 0,
    crm_manager: 0,
    crm_officer: 0,
    crm_viewer: 0,
    marketing_manager: 0,
    marketing_officer: 0,
    marketing_viewer: 0,
  });

  useEffect(() => {
    const fetchRoleCounts = async () => {
      const { data } = await supabase.from("user_roles").select("role");
      if (data) {
        const counts = data.reduce((acc, { role }) => {
          acc[role as AppRole] = (acc[role as AppRole] || 0) + 1;
          return acc;
        }, {} as Record<AppRole, number>);
        setRoleCounts((prev) => ({ ...prev, ...counts }));
      }
    };
    fetchRoleCounts();
  }, []);

  const roles: AppRole[] = ["super_admin", "admin", "operational_manager", "qa_manager", "maintenance_manager", "sales_executive", "order_management", "floor_incharge", "private_label_distributor", "pettycash_handler", "store_operator", "online_sales_packing", "online_sales_admin", "online_sales_manager", "online_sales_agent", "dispatch_operator", "sales_order_manager", "production_operator", "closing_data_poster", "accounting_poster", "accounting_officer", "accounting_manager", "billing_officer", "purchase_officer", "purchase_manager", "purchase_qc_inspector", "labour_productivity_approver", "labour_productivity_poster", "labour_productivity_viewer", "export_manager", "export_officer", "export_viewer", "master_data_manager", "master_data_officer", "master_data_viewer", "hr_manager", "hr_officer", "hr_viewer", "wip_manager", "wip_officer", "wip_viewer", "rejections_manager", "rejections_officer", "rejections_viewer", "performance_manager", "performance_officer", "performance_viewer", "floor_inventory_manager", "floor_inventory_officer", "floor_inventory_viewer", "fixed_assets_manager", "fixed_assets_officer", "fixed_assets_viewer", "five_s_manager", "five_s_officer", "five_s_viewer", "hourly_production_manager", "hourly_production_officer", "hourly_production_viewer", "rd_manager", "rd_officer", "rd_viewer", "crm_manager", "crm_officer", "crm_viewer", "marketing_manager", "marketing_officer", "marketing_viewer", "manager", "supervisor", "operator", "viewer"];

  return (
    <ERPLayout>
      <PageHeader
        title="Roles & Permissions"
        description="Manage user roles and access permissions"
        icon={Shield}
      />

      <Tabs defaultValue="roles" className="space-y-4">
        <TabsList>
          <TabsTrigger value="roles">
            <Users className="h-4 w-4 mr-2" />
            Roles
          </TabsTrigger>
          <TabsTrigger value="modules">
            <ClipboardList className="h-4 w-4 mr-2" />
            Module Permissions
          </TabsTrigger>
          <TabsTrigger value="categories">
            <Package className="h-4 w-4 mr-2" />
            Purchase Categories
          </TabsTrigger>
        </TabsList>

        <TabsContent value="roles" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {roles.map((role) => (
              <Card key={role}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg capitalize">
                      {role.replace(/_/g, " ")}
                    </CardTitle>
                    <Badge variant="outline" className={roleColors[role]}>
                      {roleCounts[role]} users
                    </Badge>
                  </div>
                  <CardDescription>{roleDescriptions[role]}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="modules" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Module Permissions</CardTitle>
              <CardDescription>
                Configure access permissions for each module
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-muted-foreground text-sm">
                Module permissions can be configured per user in the User Management section.
                Each user can have view, create, edit, delete, and approve permissions for each module.
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="categories" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Purchase Category Permissions</CardTitle>
              <CardDescription>
                Control access to different purchase categories
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                {["Raw Material", "Office Supplies", "General Supplies", "Spare & Maintenance"].map(
                  (category) => (
                    <Card key={category} className="border-dashed">
                      <CardHeader className="py-3">
                        <CardTitle className="text-base">{category}</CardTitle>
                        <CardDescription className="text-xs">
                          View, Create, Approve permissions
                        </CardDescription>
                      </CardHeader>
                    </Card>
                  )
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </ERPLayout>
  );
}