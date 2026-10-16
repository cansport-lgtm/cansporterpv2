import { useState, useEffect } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Shield, Users, Package, ClipboardList, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_GROUPS, ROLE_META, NON_ASSIGNABLE_MODULES, TIER_LABELS, type AppRole } from "@/lib/roleCatalog";

export default function RolesPage() {
  const [roleCounts, setRoleCounts] = useState<Partial<Record<AppRole, number>>>({});
  const [search, setSearch] = useState("");

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

  const term = search.trim().toLowerCase();
  const groups = ROLE_GROUPS.map((g) => ({
    ...g,
    roles: g.roles.filter((r) => {
      if (!term || g.label.toLowerCase().includes(term)) return true;
      const m = ROLE_META[r];
      return m.label.toLowerCase().includes(term) || m.description.toLowerCase().includes(term) || r.replace(/_/g, " ").includes(term);
    }),
  })).filter((g) => g.roles.length > 0);

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

        <TabsContent value="roles" className="space-y-6">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search roles or modules..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {groups.map((g) => (
            <div key={g.key} className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground">
                {g.label}
                {NON_ASSIGNABLE_MODULES.has(g.key) && (
                  <span className="ml-2 font-normal">(assigned in Distributor Orders → Manage Users)</span>
                )}
              </h3>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {g.roles.map((role) => (
                  <Card key={role}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-lg">
                          {ROLE_META[role].label}
                          <span className="ml-2 align-middle text-xs font-normal text-muted-foreground">
                            {TIER_LABELS[ROLE_META[role].tier]}
                          </span>
                        </CardTitle>
                        <Badge variant="outline" className={ROLE_META[role].color}>
                          {roleCounts[role] ?? 0} users
                        </Badge>
                      </div>
                      <CardDescription>{ROLE_META[role].description}</CardDescription>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            </div>
          ))}
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
                {["Raw Material", "Office Supplies", "Production Supplies", "Spares & Parts"].map(
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