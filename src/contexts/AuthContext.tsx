import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface AppUser {
  id: string;
  user_id: string;
  full_name: string;
  department_id: string | null;
  designation: string | null;
  is_active: boolean;
  last_login: string | null;
  // Distributor Order Management: which distributor this user belongs to.
  // NULL for company staff (super_admin/admin/etc.); set for distributor users.
  distributor_id: string | null;
}

interface UserRole {
  role: 'super_admin' | 'admin' | 'manager' | 'supervisor' | 'operator' | 'viewer' | 'operational_manager' | 'qa_manager' | 'maintenance_manager' | 'sales_executive' | 'order_management' | 'floor_incharge' | 'private_label_distributor' | 'pettycash_handler' | 'store_operator' | 'project_manager' | 'online_sales_packing' | 'accounting_poster' | 'accounting_officer' | 'accounting_manager' | 'billing_officer' | 'purchase_officer' | 'purchase_manager' | 'dispatch_operator' | 'sales_order_manager' | 'production_operator' | 'closing_data_poster' | 'distributor_sales' | 'distributor_manager' | 'distributor_admin';
}

// Define which modules each special role can access
const ROLE_MODULE_ACCESS: Record<string, string[]> = {
  operational_manager: ['production', 'qa', 'dashboard'],
  qa_manager: ['qa', 'dashboard'],
  maintenance_manager: ['maintenance', 'dashboard'],
  operator: ['qa', 'dashboard'], // Operators need QA access for inspections
  sales_executive: ['sales'], // Sales executives access sales module only
  order_management: ['production'], // Order management: production orders only
  floor_incharge: ['labour'], // Floor incharge: labour productivity entry only
  private_label_distributor: ['sales'], // Private label distributors: sales module (view-only) only
  pettycash_handler: ['expenses'], // Petty cash handler: petty cash page only
  store_operator: ['material_consumption'], // Store operator: stock closing page only
  project_manager: ['projects', 'dashboard'], // Project manager: project management module only
  online_sales_packing: ['online_sales'], // Online sales packing: online orders page only (scan & weigh)
  // Dispatch operator: domestic dispatch page only. 'sales' keeps the Sales sidebar group
  // visible; 'domestic' satisfies the /domestic/* module check in ProtectedRoute. No pricing
  // page (Orders/Invoices) is reachable, so prices are never exposed.
  dispatch_operator: ['sales', 'domestic'],
  // Sales order manager: domestic sales order making + dispatch coordination + dashboards.
  // 'sales' keeps the Sales sidebar group visible; 'domestic' satisfies the /domestic/* module
  // check; 'dashboard' for the landing shell. Prices are hidden in-page (see canViewPrices).
  sales_order_manager: ['sales', 'domestic', 'dashboard'],
  // Production operator: full Production + Production Planning access. Can post and edit
  // within a 48h window (enforced in the entry/planning pages). No delete/approve.
  production_operator: ['production', 'planning', 'dashboard'],
  // Closing Data Poster: posts Daily Stock Closing (Production Planning) and Stock Closing
  // (Material Consumption). Module access opens both sidebar groups; route restrictions below
  // confine it to just the two stock-closing pages.
  closing_data_poster: ['planning', 'material_consumption', 'dashboard'],
  // Accounting access tiers — limited to the accounting module (+ dashboard landing)
  accounting_poster: ['accounting', 'dashboard'],
  // Accounting Officer: accounting (no P&L / Balance Sheet) + cross-module operational
  // access — Production (view-only, incl. WIP Ledger), full Sales/Purchase (make invoices,
  // returns, orders, dispatches, goods receipts) and Master Data (create products/items/etc).
  // Action limits in hasModulePermission.
  accounting_officer: ['accounting', 'dashboard', 'production', 'sales', 'domestic', 'export', 'purchase', 'master_data'],
  accounting_manager: ['accounting', 'dashboard'],
  // Distributor Order Management — a self-contained external module. All three
  // distributor roles are confined to the 'distributor' module (+ dashboard shell).
  // Per-distributor data isolation is enforced in-page by filtering on distributor_id.
  distributor_sales: ['distributor', 'dashboard'],
  distributor_manager: ['distributor', 'dashboard'],
  distributor_admin: ['distributor', 'dashboard'],
};

// Define specific route restrictions for roles (only these exact routes are allowed)
const ROLE_ROUTE_RESTRICTIONS: Record<string, string[]> = {
  order_management: ['/production/orders'], // Can ONLY access production orders page
  floor_incharge: ['/labour/entry', '/labour/todays-target'], // Can access labour productivity entry and today's target pages
  private_label_distributor: ['/sales/dashboard', '/sales/orders', '/sales/dispatch', '/sales/customers', '/sales/customer-logos', '/sales/visit-dashboard'], // Private Label Sales view-only (all pages)
  pettycash_handler: ['/expenses/petty-cash'], // Petty cash handler: petty cash page only
  store_operator: ['/consumption/stock-closing'], // Store operator: stock closing page only
  project_manager: ['/projects', '/projects/list', '/projects/kanban'], // Project manager: project management pages only
  online_sales_packing: ['/online-sales/orders'], // Online sales packing: orders page only (scan & weigh)
  dispatch_operator: ['/domestic/dispatch'], // Dispatch operator: domestic dispatch page only (no pricing pages)
  // Sales order manager: order making + dispatch coordination + dashboards (NO products, invoices, or pricing pages)
  sales_order_manager: [
    '/domestic/orders',
    '/domestic/order-status',
    '/domestic/customers',
    '/domestic/pending-dispatch',
    '/domestic/dispatch',
    '/domestic/dispatch-dashboard',
    '/domestic/dispatch-acknowledgement',
    '/domestic/dashboard',
  ],
  // Production operator: full Production + Planning modules (prefix match covers all their pages).
  production_operator: ['/production', '/planning', '/dashboard'],
  // Closing Data Poster: ONLY the two stock-closing pages — Daily Stock Closing (Planning)
  // and Stock Closing (Material Consumption). Nothing else in those modules is reachable.
  closing_data_poster: ['/planning/stock-closing', '/consumption/stock-closing'],
  // Accounting Poster: post entries + review books/ledgers + read masters needed to post.
  // NO reports and NO accounting dashboard (it surfaces cash/bank/inventory balances).
  accounting_poster: [
    '/accounting/vouchers/new',
    '/accounting/vouchers',
    '/accounting/customer-receipts',
    '/accounting/supplier-payments',
    '/accounting/sales-return',
    '/accounting/purchase-return',
    '/accounting/day-book',
    '/accounting/cash-book',
    '/accounting/bank-book',
    '/accounting/general-ledger',
    '/accounting/party-ledger',
    '/accounting/parties',
  ],
  // Distributor Sales: ONLY make/submit sales orders. The orders page is fully
  // self-contained — customers and products load inside the order dialog — so no
  // customers, products, analysis, approvals, dispatch, dashboard or user pages.
  distributor_sales: [
    '/distributor/orders',
  ],
  // Distributor Manager: everything sales can do, plus approve/reject/edit orders
  // and run the dispatch sheet. No user management.
  distributor_manager: [
    '/distributor/dashboard',
    '/distributor/customers',
    '/distributor/products',
    '/distributor/orders',
    '/distributor/analysis',
    '/distributor/approvals',
    '/distributor/dispatch',
  ],
  // Distributor Admin: full distributor module + manage their own sales/manager users.
  distributor_admin: [
    '/distributor/dashboard',
    '/distributor/customers',
    '/distributor/products',
    '/distributor/orders',
    '/distributor/analysis',
    '/distributor/approvals',
    '/distributor/dispatch',
    '/distributor/admin',
  ],
};

// Routes a role is explicitly DENIED even though it otherwise has broad access to the module.
// (Used for "see everything except these statements" tiers.)
const ROLE_ROUTE_DENY: Record<string, string[]> = {
  // Accounting Officer: no financial statements, and no access to the super-admin-only
  // production master/config tools (which have no in-page permission gating). Everything
  // else in Production stays view-only via hasModulePermission.
  accounting_officer: [
    '/accounting/profit-loss',
    '/accounting/balance-sheet',
    '/production/mph-master',
    '/production/wip-sequence',
  ],
};

const HARD_RESTRICTED_MODULE_ROLES = new Set([
  'qa_manager',
  'maintenance_manager',
  'operator',
  'sales_executive',
  'order_management',
  'floor_incharge',
  'private_label_distributor',
  'pettycash_handler',
  'store_operator',
  'project_manager',
  'online_sales_packing',
  'accounting_poster',
  'accounting_officer',
  'accounting_manager',
  'dispatch_operator',
  'sales_order_manager',
  'production_operator',
  'closing_data_poster',
  'distributor_sales',
  'distributor_manager',
  'distributor_admin',
]);

// Strict single-purpose roles whose lockdown must ALWAYS be enforced, even when the user
// also holds a "flexible" role (admin/manager/viewer/etc.). This prevents a stray flexible
// role from silently bypassing the module/route restrictions (and price hiding) of these
// security-sensitive roles. Super admin still overrides everything.
const STRICT_LOCKED_ROLES = new Set([
  'dispatch_operator',
  'sales_order_manager',
  'production_operator',
  'closing_data_poster',
  'distributor_sales',
  'distributor_manager',
  'distributor_admin',
]);

interface ModulePermission {
  module_name: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_approve: boolean;
}

interface PurchaseCategoryPermission {
  category: 'raw_material' | 'office_supplies' | 'general_supplies' | 'spare_maintenance';
  can_view: boolean;
  can_create: boolean;
  can_approve: boolean;
}

interface AuthContextType {
  user: AppUser | null;
  roles: UserRole[];
  modulePermissions: ModulePermission[];
  purchaseCategoryPermissions: PurchaseCategoryPermission[];
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (userId: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  hasRole: (role: UserRole['role']) => boolean;
  hasModulePermission: (module: string, permission: 'view' | 'create' | 'edit' | 'delete' | 'approve') => boolean;
  hasPurchaseCategoryPermission: (category: PurchaseCategoryPermission['category'], permission: 'view' | 'create' | 'approve') => boolean;
  canAccessModule: (module: string) => boolean;
  canAccessRoute: (route: string) => boolean;
  canViewPrices: () => boolean;
  // Distributor scope: company staff (super_admin) see all distributors; a distributor
  // user is confined to their own distributor_id. Pages use this to filter every query.
  getDistributorScope: () => { isCompany: boolean; distributorId: string | null };
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SESSION_KEY = 'erp_session';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isValidUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_REGEX.test(value);

const sanitizeStoredSession = () => {
  if (typeof window === 'undefined') return;

  try {
    const rawSession = window.localStorage.getItem(SESSION_KEY);
    if (!rawSession) return;

    const parsed = JSON.parse(rawSession);
    const userUuid = parsed?.userUuid;
    const expiry = parsed?.expiry;

    if (!isValidUuid(userUuid) || typeof expiry !== 'number' || Date.now() >= expiry) {
      window.localStorage.removeItem(SESSION_KEY);
    }
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
  }
};

sanitizeStoredSession();

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [modulePermissions, setModulePermissions] = useState<ModulePermission[]>([]);
  const [purchaseCategoryPermissions, setPurchaseCategoryPermissions] = useState<PurchaseCategoryPermission[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadUserData = useCallback(async (userUuid: string) => {
    if (!isValidUuid(userUuid)) {
      localStorage.removeItem(SESSION_KEY);
      setUser(null);
      setRoles([]);
      setModulePermissions([]);
      setPurchaseCategoryPermissions([]);
      return false;
    }

    try {
      const { data: userData, error: userError } = await supabase
        .from('app_users')
        .select('*')
        .eq('id', userUuid)
        .single();

      if (userError || !userData) {
        console.error('Error loading user data:', userError);
        return false;
      }

      setUser(userData);

      const { data: rolesData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userUuid);

      setRoles((rolesData || []) as UserRole[]);

      const { data: modulePermsData } = await supabase
        .from('module_permissions')
        .select('module_name, can_view, can_create, can_edit, can_delete, can_approve')
        .eq('user_id', userUuid);

      setModulePermissions((modulePermsData || []) as ModulePermission[]);

      const { data: purchasePermsData } = await supabase
        .from('purchase_category_permissions')
        .select('category, can_view, can_create, can_approve')
        .eq('user_id', userUuid);

      setPurchaseCategoryPermissions((purchasePermsData || []) as PurchaseCategoryPermission[]);

      return true;
    } catch (error) {
      console.error('Error loading user data:', error);
      return false;
    }
  }, []);

  useEffect(() => {
    // Demo-only bypass: skip Supabase auth, inject a stub super_admin user
    if (import.meta.env.VITE_DEMO_BYPASS === 'true') {
      setUser({
        id: '00000000-0000-0000-0000-000000000000',
        user_id: 'demo',
        full_name: 'Demo User',
        department_id: null,
        designation: 'Demo',
        is_active: true,
        last_login: new Date().toISOString(),
        distributor_id: null,
      });
      setRoles([{ role: 'super_admin' }]);
      setModulePermissions([]);
      setPurchaseCategoryPermissions([]);
      setIsLoading(false);
      return;
    }

    const checkSession = async () => {
      sanitizeStoredSession();
      const sessionData = localStorage.getItem(SESSION_KEY);

      if (sessionData) {
        try {
          const { userUuid, expiry } = JSON.parse(sessionData);

          if (!isValidUuid(userUuid) || typeof expiry !== 'number' || Date.now() >= expiry) {
            localStorage.removeItem(SESSION_KEY);
          } else {
            const success = await loadUserData(userUuid);
            if (!success) {
              localStorage.removeItem(SESSION_KEY);
            }
          }
        } catch {
          localStorage.removeItem(SESSION_KEY);
        }
      }

      setIsLoading(false);
    };

    checkSession();
  }, [loadUserData]);

  const login = async (userId: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const { data, error } = await supabase.rpc('verify_user_password', {
        p_user_id: userId,
        p_password: password
      });

      if (error) {
        console.error('Login error:', error);
        return { success: false, error: 'Authentication failed. Please try again.' };
      }

      if (!data || data.length === 0 || !data[0].is_valid) {
        return { success: false, error: 'Invalid user ID or password.' };
      }

      const userUuid = data[0].user_uuid;
      if (!isValidUuid(userUuid)) {
        localStorage.removeItem(SESSION_KEY);
        return { success: false, error: 'Invalid session data returned. Please try again.' };
      }

      const success = await loadUserData(userUuid);

      if (!success) {
        return { success: false, error: 'Failed to load user data.' };
      }

      const sessionData = {
        userUuid,
        expiry: Date.now() + (24 * 60 * 60 * 1000)
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));

      return { success: true };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: 'An unexpected error occurred.' };
    }
  };

  const logout = () => {
    localStorage.removeItem(SESSION_KEY);
    setUser(null);
    setRoles([]);
    setModulePermissions([]);
    setPurchaseCategoryPermissions([]);
  };

  const hasRole = (role: UserRole['role']): boolean => {
    return roles.some(r => r.role === role) || roles.some(r => r.role === 'super_admin');
  };

  // Whether the current user may see monetary values (prices, rates, amounts, totals).
  // Roles that manage logistics/orders without commercial visibility are hidden from money.
  const canViewPrices = (): boolean => {
    if (roles.some(r => r.role === 'super_admin')) return true;
    return !roles.some(r => r.role === 'sales_order_manager');
  };

  // Distributor data-isolation scope. super_admin is the company actor that can see
  // every distributor's data; any distributor user is locked to their own distributor_id.
  const getDistributorScope = (): { isCompany: boolean; distributorId: string | null } => {
    const isCompany = roles.some(r => r.role === 'super_admin');
    return { isCompany, distributorId: user?.distributor_id ?? null };
  };

  // Check if user can access a specific module (module permissions are the source of truth)
  const canAccessModule = (module: string): boolean => {
    const normalizeModule = (m: string) => {
      const key = m.toLowerCase();
      // Support legacy keys / inconsistent callers
      if (key === 'master') return 'master_data';
      return key;
    };

    const mod = normalizeModule(module);

    // Super admin has all access
    if (roles.some((r) => r.role === 'super_admin')) return true;

    // Always allow the main dashboard shell so users have somewhere to land
    if (mod === 'dashboard') return true;

    // Strict-locked roles enforce their own module scope regardless of any other (flexible)
    // role the user may also hold. This closes the "stray Viewer/Manager bypasses the lockdown" gap.
    const strictRoles = roles.filter((r) => STRICT_LOCKED_ROLES.has(r.role));
    if (strictRoles.length > 0) {
      return strictRoles.some((r) => ROLE_MODULE_ACCESS[r.role]?.includes(mod));
    }

    // Accounting Officer: its module grants are role-driven and additive — they apply even
    // when the account also holds a flexible role (which would otherwise route to per-user
    // module permissions below and silently hide these modules).
    if (
      roles.some((r) => r.role === 'accounting_officer') &&
      ROLE_MODULE_ACCESS['accounting_officer']?.includes(mod)
    ) {
      return true;
    }

    const hardRestrictedRoles = roles.filter((r) => HARD_RESTRICTED_MODULE_ROLES.has(r.role));
    const hasFlexibleRole = roles.some((r) => !HARD_RESTRICTED_MODULE_ROLES.has(r.role));

    // If the user only has hard-restricted roles, allow the union of those role modules.
    // If they also have a flexible role, fall back to assigned module permissions instead.
    if (hardRestrictedRoles.length > 0 && !hasFlexibleRole) {
      return hardRestrictedRoles.some((r) => ROLE_MODULE_ACCESS[r.role]?.includes(mod));
    }

    // operational_manager: driven by module permissions
    if (roles.some((r) => r.role === 'operational_manager')) {
      const perm = modulePermissions.find((p) => p.module_name === mod);
      return !!perm?.can_view;
    }

    // All other roles: require module permission to view the module
    const perm = modulePermissions.find((p) => p.module_name === mod);
    return !!perm?.can_view;
  };

  const hasModulePermission = (module: string, permission: 'view' | 'create' | 'edit' | 'delete' | 'approve'): boolean => {
    // Super admin has all permissions
    if (roles.some(r => r.role === 'super_admin')) return true;

    // Accounting access tiers (accounting module only; action perms implied by the role)
    if (module === 'accounting') {
      if (roles.some(r => r.role === 'accounting_manager')) return true; // full incl. delete + approve
      if (roles.some(r => r.role === 'accounting_poster' || r.role === 'accounting_officer')) {
        return permission === 'view' || permission === 'create' || permission === 'edit';
      }
    }

    // Accounting Officer — cross-module operational access (additive to the accounting tier):
    //  • Production: view only (full read access including the WIP Ledger)
    //  • Sales / Domestic & Purchase: view + create + edit (make sales invoices & returns,
    //    purchase invoices via Goods Receipt & purchase returns, plus orders/dispatches).
    //  • Master Data: view + create + edit (create new products/items/grades/units, etc).
    //  Delete and approve stay with managers (separation of duties).
    if (roles.some(r => r.role === 'accounting_officer')) {
      if (module === 'production') return permission === 'view';
      if (
        module === 'sales' || module === 'domestic' || module === 'export' ||
        module === 'purchase' || module === 'master_data'
      ) {
        return permission === 'view' || permission === 'create' || permission === 'edit';
      }
    }

    // Floor incharge cannot approve any data (hard restriction)
    if (roles.some(r => r.role === 'floor_incharge') && permission === 'approve') {
      return false;
    }

    // Purchase officer cannot approve purchase orders — approval is reserved for
    // purchase_manager (separation of duties), unless the user also holds that role.
    if (
      permission === 'approve' &&
      module === 'purchase' &&
      roles.some(r => r.role === 'purchase_officer') &&
      !roles.some(r => r.role === 'purchase_manager')
    ) {
      return false;
    }

    // Private label distributor: view-only access (no create, edit, delete, approve)
    if (roles.some(r => r.role === 'private_label_distributor')) {
      if (permission !== 'view') return false;
      // Allow view only for sales module
      return module === 'sales';
    }

    // Pettycash handler: view and create only for expenses module (no edit, delete, approve)
    if (roles.some(r => r.role === 'pettycash_handler')) {
      if (permission !== 'view' && permission !== 'create') return false;
      return module === 'expenses';
    }

    // Strict operational roles grant view/create/edit within their own module scope
    // (never delete/approve). These checks are GRANT-ONLY (additive): when the role is
    // out of scope they DO NOT return — they fall through so another strict role the same
    // user also holds can still grant its own modules. A hard `return module === X` here
    // used to let an earlier role veto a later one (e.g. a user holding both
    // sales_order_manager + production_operator had production create blocked because the
    // sales_order_manager branch returned false for the production module first).
    //   • dispatch_operator     → sales / domestic (dispatch; no pricing pages)
    //   • sales_order_manager   → sales / domestic (orders + dispatch)
    //   • production_operator   → production / planning
    //   • closing_data_poster   → planning / material_consumption (stock closing)
    // Out-of-scope, delete and approve all fall through to the per-user module_permissions
    // check below, which denies them (strict roles carry no module_permissions rows).
    const grantsWithinScope = (modules: string[]): boolean =>
      modules.includes(module) && permission !== 'delete' && permission !== 'approve';

    if (roles.some(r => r.role === 'dispatch_operator') && grantsWithinScope(['sales', 'domestic'])) return true;
    if (roles.some(r => r.role === 'sales_order_manager') && grantsWithinScope(['sales', 'domestic'])) return true;
    if (roles.some(r => r.role === 'production_operator') && grantsWithinScope(['production', 'planning'])) return true;
    if (roles.some(r => r.role === 'closing_data_poster') && grantsWithinScope(['planning', 'material_consumption'])) return true;

    // Distributor Order Management roles — grants within the 'distributor' module only.
    //   • distributor_sales   → view / create / edit (orders, customers, own catalog). No approve/delete.
    //   • distributor_manager → view / create / edit / approve (approve/reject orders). No delete.
    //   • distributor_admin   → full control (incl. delete) of the distributor module.
    if (module === 'distributor') {
      if (roles.some(r => r.role === 'distributor_admin')) return true;
      if (roles.some(r => r.role === 'distributor_manager')) return permission !== 'delete';
      if (roles.some(r => r.role === 'distributor_sales')) {
        return permission === 'view' || permission === 'create' || permission === 'edit';
      }
    }

    const perm = modulePermissions.find(p => p.module_name === module);
    if (!perm) return false;
    
    switch (permission) {
      case 'view': return perm.can_view;
      case 'create': return perm.can_create;
      case 'edit': return perm.can_edit;
      case 'delete': return perm.can_delete;
      case 'approve': return perm.can_approve;
      default: return false;
    }
  };

  const hasPurchaseCategoryPermission = (
    category: PurchaseCategoryPermission['category'], 
    permission: 'view' | 'create' | 'approve'
  ): boolean => {
    // Super admin has all permissions
    if (roles.some(r => r.role === 'super_admin')) return true;

    // Accounting Officer: operates the full Purchase module — allow viewing & creating across
    // all purchase categories (so the Purchase Invoices list and Goods Receipt category flows
    // work). Approval stays reserved for purchase managers.
    if (roles.some(r => r.role === 'accounting_officer')) {
      return permission === 'view' || permission === 'create';
    }

    const perm = purchaseCategoryPermissions.find(p => p.category === category);
    if (!perm) return false;
    
    switch (permission) {
      case 'view': return perm.can_view;
      case 'create': return perm.can_create;
      case 'approve': return perm.can_approve;
      default: return false;
    }
  };

  // Check if user can access a specific route (for roles with route-level restrictions)
  const canAccessRoute = (route: string): boolean => {
    // Super admin has all access
    if (roles.some((r) => r.role === 'super_admin')) return true;

    // Explicit per-role route denials take precedence (e.g. hide P&L / Balance Sheet from a tier)
    if (
      roles.some((r) =>
        ROLE_ROUTE_DENY[r.role]?.some(
          (denied) => route === denied || route.startsWith(denied + '/')
        )
      )
    ) {
      return false;
    }

    // Strict-locked roles confine the user to their explicit route whitelist even if the user
    // also holds a flexible role. Enforced before the flexible-role bypass below.
    const strictRoles = roles.filter((r) => STRICT_LOCKED_ROLES.has(r.role));
    if (strictRoles.length > 0) {
      return strictRoles.some((r) => {
        const allowedRoutes = ROLE_ROUTE_RESTRICTIONS[r.role] || [];
        return allowedRoutes.some((allowed) => route === allowed || route.startsWith(allowed + '/'));
      });
    }

    const restrictedRoles = roles.filter((r) => ROLE_ROUTE_RESTRICTIONS[r.role]);

    if (restrictedRoles.length === 0) {
      return true;
    }

    const hasFlexibleRole = roles.some((r) => !ROLE_ROUTE_RESTRICTIONS[r.role]);

    // If the user has any unrestricted role, don't let a secondary restricted role hide valid pages.
    if (hasFlexibleRole) {
      return true;
    }

    // Users with only restricted roles can access the union of their explicitly allowed routes.
    return restrictedRoles.some((r) => {
      const allowedRoutes = ROLE_ROUTE_RESTRICTIONS[r.role];
      return allowedRoutes.some((allowed) => route === allowed || route.startsWith(allowed + '/'));
    });

    // No route restrictions for this role - fall back to module access
  };

  return (
    <AuthContext.Provider value={{
      user,
      roles,
      modulePermissions,
      purchaseCategoryPermissions,
      isLoading,
      isAuthenticated: !!user,
      login,
      logout,
      hasRole,
      hasModulePermission,
      hasPurchaseCategoryPermission,
      canAccessModule,
      canAccessRoute,
      canViewPrices,
      getDistributorScope
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
