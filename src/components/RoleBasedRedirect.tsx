import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, Factory } from 'lucide-react';

/**
 * Redirects users to the appropriate dashboard based on their role.
 * - super_admin: Main Dashboard
 * - qa_manager: QA Dashboard
 * - maintenance_manager: Maintenance Dashboard
 * - operational_manager: Production Dashboard
 * - Others: First accessible module dashboard
 */
export function RoleBasedRedirect() {
  const { isAuthenticated, isLoading, roles, canAccessModule } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-3">
            <div className="p-3 bg-primary rounded-xl">
              <Factory className="h-8 w-8 text-primary-foreground" />
            </div>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Super admin goes to main dashboard
  if (roles.some(r => r.role === 'super_admin')) {
    return <Navigate to="/dashboard" replace />;
  }

  // QA Manager goes to QA Dashboard
  if (roles.some(r => r.role === 'qa_manager')) {
    return <Navigate to="/qa/dashboard" replace />;
  }

  // Maintenance Manager goes to Maintenance Dashboard
  if (roles.some(r => r.role === 'maintenance_manager')) {
    return <Navigate to="/maintenance/dashboard" replace />;
  }

  // Operational Manager goes to Production Dashboard
  if (roles.some(r => r.role === 'operational_manager')) {
    return <Navigate to="/production/dashboard" replace />;
  }

  // Operator role goes directly to dedicated inspection entry page (locked UI)
  if (roles.some(r => r.role === 'operator')) {
    return <Navigate to="/qa/operator-inspection" replace />;
  }

  // Sales Executive goes to Sales Orders page
  if (roles.some(r => r.role === 'sales_executive')) {
    return <Navigate to="/sales/orders" replace />;
  }

  // Order Management goes to Production Orders list
  if (roles.some(r => r.role === 'order_management')) {
    return <Navigate to="/production/orders" replace />;
  }

  // Floor Incharge goes to Labour Productivity Entry page
  if (roles.some(r => r.role === 'floor_incharge')) {
    return <Navigate to="/labour/entry" replace />;
  }

  // Pettycash Handler goes to Petty Cash page
  if (roles.some(r => r.role === 'pettycash_handler')) {
    return <Navigate to="/expenses/petty-cash" replace />;
  }

  // Private Label Distributor goes to Private Label Sales Dashboard (view-only)
  if (roles.some(r => r.role === 'private_label_distributor')) {
    return <Navigate to="/sales/dashboard" replace />;
  }

  // Store Operator goes to Stock Closing page in Material Consumption module
  if (roles.some(r => (r.role as string) === 'store_operator')) {
    return <Navigate to="/consumption/stock-closing" replace />;
  }

  // Dispatch Operator goes straight to the Domestic Dispatch page (no pricing pages)
  if (roles.some(r => (r.role as string) === 'dispatch_operator')) {
    return <Navigate to="/domestic/dispatch" replace />;
  }

  // Sales Order Manager lands on the Sales Orders page (order making is the primary job)
  if (roles.some(r => (r.role as string) === 'sales_order_manager')) {
    return <Navigate to="/domestic/orders" replace />;
  }

  // Production Operator lands on the Daily Production Entry page (posting is the primary job)
  if (roles.some(r => (r.role as string) === 'production_operator')) {
    return <Navigate to="/production/daily-entry" replace />;
  }

  // Project Manager goes to Projects Dashboard
  if (roles.some(r => r.role === 'project_manager')) {
    return <Navigate to="/projects" replace />;
  }

  // Distributor Sales can ONLY make sales orders — land them directly on the orders page.
  if (roles.some(r => (r.role as string) === 'distributor_sales')) {
    return <Navigate to="/distributor/orders" replace />;
  }

  // Distributor Manager / Admin land on the Distributor dashboard
  if (roles.some(r => ['distributor_manager', 'distributor_admin'].includes(r.role as string))) {
    return <Navigate to="/distributor/dashboard" replace />;
  }

  // Online Sales Packing goes to Online Orders page
  if (roles.some(r => (r.role as string) === 'online_sales_packing')) {
    return <Navigate to="/online-sales/orders" replace />;
  }

  // Accounting Poster lands on New Voucher (post-only; no financial dashboard/reports)
  if (roles.some(r => (r.role as string) === 'accounting_poster')) {
    return <Navigate to="/accounting/vouchers/new" replace />;
  }

  // Accounting Officer / Manager land on the Accounting Dashboard
  if (roles.some(r => (r.role as string) === 'accounting_officer' || (r.role as string) === 'accounting_manager')) {
    return <Navigate to="/accounting/dashboard" replace />;
  }

  // For other roles, find first accessible module
  const moduleDashboardRoutes: Record<string, string> = {
    accounting: '/accounting/dashboard',
    production: '/production/dashboard',
    qa: '/qa/dashboard',
    sales: '/sales/dashboard',
    planning: '/planning/dashboard',
    material_consumption: '/consumption/dashboard',
    hr: '/hr/dashboard',
    performance: '/performance/dashboard',
    maintenance: '/maintenance/dashboard',
    expenses: '/expenses/dashboard',
    inventory: '/inventory/dashboard',
    floor_inventory: '/floor-inventory/dashboard',
    purchase: '/purchase/dashboard',
    five_s: '/five-s/dashboard',
    fixed_assets: '/fixed-assets/dashboard',
    master_data: '/master/products',
    domestic: '/domestic/dashboard',
    export: '/export/dashboard',
    labour: '/labour/dashboard',
    six_sigma: '/six-sigma/dashboard',
    online_sales: '/online-sales/dashboard',
    projects: '/projects',
    rd: '/rd/dashboard',
    crm: '/crm/dashboard',
  };
  for (const [module, route] of Object.entries(moduleDashboardRoutes)) {
    if (canAccessModule(module)) {
      return <Navigate to={route} replace />;
    }
  }

  // Fallback - should not happen if permissions are set correctly
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-bold text-foreground">No Access</h1>
        <p className="text-muted-foreground">
          You don't have access to any modules. Please contact your administrator.
        </p>
      </div>
    </div>
  );
}
