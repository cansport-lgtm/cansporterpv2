import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, Factory } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredModule?: string;
  requiredPermission?: 'view' | 'create' | 'edit' | 'delete' | 'approve';
  requiredRole?: string;
}

export function ProtectedRoute({ 
  children, 
  requiredModule,
  requiredPermission = 'view',
  requiredRole
}: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, hasModulePermission, roles, canAccessModule, canAccessRoute } = useAuth();
  const location = useLocation();

  const moduleFromPath = (() => {
    if (location.pathname === '/') return 'dashboard';

    const firstSegment = location.pathname.split('/').filter(Boolean)[0];
    switch (firstSegment) {
      case 'production':
        return 'production';
      case 'qa':
        return 'qa';
      case 'hr':
        return 'hr';
      case 'performance':
        return 'performance';
      case 'maintenance':
        return 'maintenance';
      case 'sales':
        return 'sales';
      case 'purchase':
        return 'purchase';
      case 'master':
        return 'master_data';
      case 'settings':
        return 'settings';
      case 'labour':
        return 'labour';
      case 'domestic':
        return 'domestic';
      case 'export':
        return 'export';
      case 'expenses':
        return 'expenses';
      case 'floor-inventory':
        return 'floor_inventory';
      case 'fixed-assets':
        return 'fixed_assets';
      case 'planning':
        return 'planning';
      case 'inventory':
        return 'inventory';
       case 'consumption':
         return 'material_consumption';
      case 'five-s':
        return 'five_s';
      case 'hourly-production':
        return 'hourly_production';
      case 'online-sales':
        return 'online_sales';
      case 'finance':
        return 'finance';
      case 'accounting':
        return 'accounting';
      case 'projects':
        return 'projects';
      case 'rd':
        return 'rd';
      case 'six-sigma':
        return 'six_sigma';
      case 'machine-monitor':
        return 'machine_monitor';
      case 'crm':
        return 'crm';
      case 'marketing':
        return 'marketing';
      default:
        return undefined;
    }
  })();

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
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check route-level restrictions first (for roles like order_management and floor_incharge)
  if (!canAccessRoute(location.pathname)) {
    // For order management, hard-redirect back to Production Orders (no other pages allowed)
    if (
      roles.some((r) => r.role === 'order_management') &&
      location.pathname !== '/production/orders'
    ) {
      return <Navigate to="/production/orders" replace />;
    }

    // For floor incharge, hard-redirect back to Labour Productivity Entry if not on an allowed page
    if (
      roles.some((r) => r.role === 'floor_incharge') &&
      location.pathname !== '/labour/entry' &&
      location.pathname !== '/labour/todays-target'
    ) {
      return <Navigate to="/labour/entry" replace />;
    }

    // For private label distributor, redirect back to sales dashboard if accessing unauthorized page
    if (roles.some((r) => r.role === 'private_label_distributor')) {
      const allowedPaths = ['/sales/dashboard', '/sales/orders', '/sales/dispatch', '/sales/customers', '/sales/customer-logos', '/sales/visit-dashboard'];
      const isAllowed = allowedPaths.some(p => location.pathname === p || location.pathname.startsWith(p + '/'));
      if (!isAllowed) {
        return <Navigate to="/sales/dashboard" replace />;
      }
    }

    // For pettycash handler, redirect back to petty cash page if accessing unauthorized page
    if (roles.some((r) => r.role === 'pettycash_handler')) {
      if (location.pathname !== '/expenses/petty-cash') {
        return <Navigate to="/expenses/petty-cash" replace />;
      }
    }

    // For store operator, redirect back to stock closing page if accessing unauthorized page
    if (roles.some((r) => (r.role as string) === 'store_operator')) {
      if (location.pathname !== '/consumption/stock-closing') {
        return <Navigate to="/consumption/stock-closing" replace />;
      }
    }

    // For dispatch operator, redirect back to the domestic dispatch page if accessing
    // any unauthorized page (keeps them away from pricing pages entirely)
    if (roles.some((r) => (r.role as string) === 'dispatch_operator')) {
      if (location.pathname !== '/domestic/dispatch') {
        return <Navigate to="/domestic/dispatch" replace />;
      }
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-foreground">Access Denied</h1>
          <p className="text-muted-foreground">
            You don't have permission to access this page.
          </p>
        </div>
      </div>
    );
  }

  // Enforce module access for restricted roles (e.g., qa_manager / operational_manager)
  if (moduleFromPath && !canAccessModule(moduleFromPath)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-foreground">Access Denied</h1>
          <p className="text-muted-foreground">
            You don't have permission to access this module.
          </p>
        </div>
      </div>
    );
  }

  // Check required role if specified
  if (requiredRole && !roles.some(r => r.role === requiredRole)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-foreground">Access Denied</h1>
          <p className="text-muted-foreground">
            You don't have permission to access this page.
          </p>
        </div>
      </div>
    );
  }

  // Check module permission if required
  if (requiredModule && !hasModulePermission(requiredModule, requiredPermission)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-foreground">Access Denied</h1>
          <p className="text-muted-foreground">
            You don't have permission to access this module.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
