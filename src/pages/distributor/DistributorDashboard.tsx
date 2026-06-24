import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent } from "@/components/ui/card";
import { Building, Users, UserCog, ShoppingCart, ClipboardCheck, ChevronRight } from "lucide-react";

export default function DistributorDashboard() {
  const { roles, getDistributorScope } = useAuth();
  const { isCompany, distributorId } = getDistributorScope();

  const isAdmin = roles.some((r) => r.role === "distributor_admin");
  const isManager = roles.some((r) => r.role === "distributor_manager");

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

  const quickLinks: { title: string; description: string; href: string; icon: typeof Users }[] = [];
  if (isCompany) {
    quickLinks.push({ title: "Distributors", description: "Manage distributor companies", href: "/distributor/distributors", icon: Building });
  }
  quickLinks.push({ title: "Customers", description: "Your distributor's customers", href: "/distributor/customers", icon: Users });
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
          {/* Orders & approvals land in Phase 2 — shown as placeholders so the layout is stable. */}
          <MetricCard title="Open Orders" value="—" icon={ShoppingCart} description="Coming in Phase 2" />
          {(isManager || isAdmin) && (
            <MetricCard title="Pending Approvals" value="—" icon={ClipboardCheck} description="Coming in Phase 2" />
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
            Order creation, manager approvals, the distributor product catalog, pricing, and the
            dispatch sheet arrive in the next phases. This Phase 1 release sets up distributors,
            their teams, and their customers.
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
