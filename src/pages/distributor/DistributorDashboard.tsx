import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent } from "@/components/ui/card";
import { Building, Users, UserCog, ShoppingCart, ClipboardCheck, Package, ChevronRight, BarChart3 } from "lucide-react";

const OPEN_STATUSES = ["draft", "submitted", "approved", "dispatched"];

export default function DistributorDashboard() {
  const { roles, getDistributorScope } = useAuth();
  const { isCompany, distributorId } = getDistributorScope();

  const isAdmin = roles.some((r) => r.role === "distributor_admin");
  const isManager = roles.some((r) => r.role === "distributor_manager");
  const canApprove = isManager || isAdmin || isCompany;

  // Company view: count distributors. Distributor view: count own customers.
  const { data: distributorCount = 0 } = useQuery({
    queryKey: ["distributor-count"],
    enabled: isCompany,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("distributors")
        .select("*", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: customerCount = 0 } = useQuery({
    queryKey: ["distributor-customer-count", distributorId],
    enabled: !isCompany && !!distributorId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("distributor_customers")
        .select("*", { count: "exact", head: true })
        .eq("distributor_id", distributorId as string);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: userCount = 0 } = useQuery({
    queryKey: ["distributor-user-count", distributorId],
    enabled: !isCompany && !!distributorId && isAdmin,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("app_users")
        .select("*", { count: "exact", head: true })
        .eq("distributor_id", distributorId as string);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: openOrders = 0 } = useQuery({
    queryKey: ["distributor-open-orders", isCompany, distributorId],
    enabled: isCompany || !!distributorId,
    queryFn: async () => {
      let q = supabase
        .from("distributor_orders")
        .select("*", { count: "exact", head: true })
        .in("status", OPEN_STATUSES);
      if (!isCompany && distributorId) q = q.eq("distributor_id", distributorId);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: pendingApprovals = 0 } = useQuery({
    queryKey: ["distributor-pending-approvals", isCompany, distributorId],
    enabled: canApprove && (isCompany || !!distributorId),
    queryFn: async () => {
      let q = supabase
        .from("distributor_orders")
        .select("*", { count: "exact", head: true })
        .eq("status", "submitted");
      if (!isCompany && distributorId) q = q.eq("distributor_id", distributorId);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
  });

  const quickLinks: { title: string; description: string; href: string; icon: typeof Users }[] = [];
  if (isCompany) {
    quickLinks.push({ title: "Distributors", description: "Manage distributor companies", href: "/distributor/distributors", icon: Building });
  }
  quickLinks.push({ title: "Customers", description: "Your distributor's customers", href: "/distributor/customers", icon: Users });
  quickLinks.push({ title: "Products & Pricing", description: "Catalog & selling prices", href: "/distributor/products", icon: Package });
  quickLinks.push({ title: "Orders", description: "Create & track orders", href: "/distributor/orders", icon: ShoppingCart });
  quickLinks.push({ title: "Order Analysis", description: "Trends, value & top performers", href: "/distributor/analysis", icon: BarChart3 });
  if (canApprove) {
    quickLinks.push({ title: "Approvals", description: "Review submitted orders", href: "/distributor/approvals", icon: ClipboardCheck });
  }
  if (isAdmin) {
    quickLinks.push({ title: "Manage Users", description: "Sales & manager accounts", href: "/distributor/admin/users", icon: UserCog });
  }

  return (
    <ERPLayout>
      <PageHeader
        title="Distributor Orders"
        description="Order management for distributor sales teams."
        icon={Building}
        iconColor="bg-amber-500 text-white"
      />

      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {isCompany ? (
            <MetricCard title="Distributors" value={distributorCount} icon={Building} />
          ) : (
            <MetricCard title="My Customers" value={customerCount} icon={Users} />
          )}
          {isAdmin && !isCompany && (
            <MetricCard title="Team Members" value={userCount} icon={UserCog} />
          )}
          <MetricCard title="Open Orders" value={openOrders} icon={ShoppingCart} />
          {canApprove && (
            <MetricCard title="Pending Approvals" value={pendingApprovals} icon={ClipboardCheck} />
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {quickLinks.map((q) => (
            <Link key={q.href} to={q.href}>
              <Card className="hover:border-primary/50 transition-colors">
                <CardContent className="flex items-center gap-4 p-5">
                  <div className="h-10 w-10 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center">
                    <q.icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{q.title}</p>
                    <p className="text-sm text-muted-foreground">{q.description}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <Card>
          <CardContent className="p-5 text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-1">What's next</p>
            The dispatch sheet (with company-SKU totals + Excel export) and company oversight
            views arrive in Phase 3.
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
