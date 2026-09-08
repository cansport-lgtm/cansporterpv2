import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ListChecks, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  QsSelectionOption, useQsSelectionOptions,
} from "@/components/quality-score/qsShared";

interface Lookup { id: string; name: string; }
type ListType = QsSelectionOption["list_type"];

const LISTS: { type: ListType; title: string; source: string; table: string }[] = [
  { type: "department", title: "Departments", source: "Production Departments master", table: "production_departments" },
  { type: "product", title: "Products", source: "Products master", table: "products" },
  { type: "grade", title: "Grades", source: "Grades master", table: "grades" },
];

// Curates what the Ball/Process entry dropdowns offer. Ticked items are the only
// ones shown; a list with nothing ticked falls back to showing every active item,
// so the entry forms can never end up with an empty required dropdown.
export default function QSSelectionMasterPage() {
  const qc = useQueryClient();
  const { hasRole, hasModulePermission } = useAuth();
  const canManage = hasRole("super_admin") || hasModulePermission("quality_score", "approve");

  const { data: selections = [] } = useQsSelectionOptions();

  const lookups: Record<ListType, Lookup[]> = {
    department: useQuery({
      queryKey: ["qs-lookup-departments"],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("production_departments").select("id, name").eq("is_active", true).order("name");
        if (error) throw error;
        return data as Lookup[];
      },
    }).data ?? [],
    product: useQuery({
      queryKey: ["qs-lookup-products"],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("products").select("id, name").eq("is_active", true).order("name");
        if (error) throw error;
        return data as Lookup[];
      },
    }).data ?? [],
    grade: useQuery({
      queryKey: ["qs-lookup-grades"],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("grades").select("id, name").eq("is_active", true).order("name");
        if (error) throw error;
        return data as Lookup[];
      },
    }).data ?? [],
  };

  const toggle = useMutation({
    mutationFn: async ({ type, refId, include }: { type: ListType; refId: string; include: boolean }) => {
      if (include) {
        const { error } = await (supabase as any)
          .from("qs_selection_options").insert({ list_type: type, ref_id: refId });
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("qs_selection_options").delete().eq("list_type", type).eq("ref_id", refId);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["qs-selection-options"] }),
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <ERPLayout>
      <div className="w-full max-w-4xl space-y-4">
        <PageHeader
          title="Quality Score — Selection Master"
          description="Choose which departments, products and grades appear in the entry-form dropdowns"
          icon={ListChecks}
        />

        {!canManage && (
          <Card>
            <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <ShieldAlert className="h-4 w-4" /> View only — a Quality Score manager or super admin maintains this master.
            </CardContent>
          </Card>
        )}

        {LISTS.map((list) => {
          const items = lookups[list.type];
          const picked = new Set(
            selections.filter((s) => s.list_type === list.type).map((s) => s.ref_id),
          );
          return (
            <Card key={list.type}>
              <CardContent className="space-y-3 p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-display text-base font-bold">{list.title}</h3>
                    <Badge variant={picked.size > 0 ? "success" : "secondary"}>
                      {picked.size > 0
                        ? `${picked.size} of ${items.length} shown in dropdown`
                        : "None selected — all shown"}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">from the {list.source}</span>
                </div>
                {items.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    No active items in the {list.source}
                  </div>
                ) : (
                  <div className="grid gap-1 sm:grid-cols-2">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-transparent px-3 py-2 hover:border-border"
                      >
                        <span className="min-w-0 truncate text-sm">{item.name}</span>
                        <Switch
                          checked={picked.has(item.id)}
                          disabled={!canManage || toggle.isPending}
                          onCheckedChange={(v) =>
                            toggle.mutate({ type: list.type, refId: item.id, include: v })
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        <p className="text-xs text-muted-foreground">
          Ticked items are the only ones offered on the Ball / Process entry forms. Leaving a list
          with nothing ticked shows every active item from its master. Existing score entries are
          never affected by changes here.
        </p>
      </div>
    </ERPLayout>
  );
}
