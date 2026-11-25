import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCrmProducts } from "@/hooks/useCrmProducts";

export default function CRMProductListPage() {
  const queryClient = useQueryClient();
  const { hasModulePermission } = useAuth();
  const canEdit = hasModulePermission("crm", "edit");
  const { allProducts, listIds, isCurated, isLoading } = useCrmProducts();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<string[] | null>(null);

  const selected = draft ?? listIds;
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const dirty = draft !== null;

  const filtered = allProducts.filter((p) =>
    `${p.code} ${p.name}`.toLowerCase().includes(search.trim().toLowerCase()),
  );

  const toggle = (id: string) =>
    setDraft(selectedSet.has(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  const saveMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const current = new Set(listIds);
      const next = new Set(ids);
      const toRemove = listIds.filter((id) => !next.has(id));
      const toAdd = ids.filter((id) => !current.has(id));
      if (toRemove.length) {
        const { error } = await supabase.from("crm_product_list").delete().in("product_id", toRemove);
        if (error) throw error;
      }
      if (toAdd.length) {
        const { error } = await supabase
          .from("crm_product_list")
          .insert(toAdd.map((product_id) => ({ product_id })));
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-product-list"] });
      toast.success("CRM product list saved");
      setDraft(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ERPLayout>
      <PageHeader
        title="CRM Product List"
        description="Choose which products are available in CRM (deal form and pipeline filter)"
      >
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={!dirty} onClick={() => setDraft(null)}>
              Reset
            </Button>
            <Button size="sm" disabled={!dirty || saveMutation.isPending} onClick={() => saveMutation.mutate(selected)}>
              {saveMutation.isPending ? "Saving..." : "Save list"}
            </Button>
          </div>
        )}
      </PageHeader>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search products..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Badge variant="secondary">{selected.length} selected</Badge>
            {canEdit && (
              <>
                <Button variant="ghost" size="sm" onClick={() => setDraft(Array.from(new Set([...selected, ...filtered.map((p) => p.id)])))}>
                  Select shown
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDraft(selected.filter((id) => !filtered.some((p) => p.id === id)))}>
                  Clear shown
                </Button>
              </>
            )}
          </div>

          {!isCurated && !dirty && (
            <p className="text-sm text-muted-foreground">
              No list chosen yet, so CRM currently shows all active products. Tick the products you want and save.
            </p>
          )}

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {filtered.map((p) => (
                <label
                  key={p.id}
                  className="flex items-center gap-2 rounded-md border p-2 text-sm cursor-pointer hover:bg-muted/50"
                >
                  <Checkbox checked={selectedSet.has(p.id)} disabled={!canEdit} onCheckedChange={() => toggle(p.id)} />
                  <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
                  <span className="truncate">{p.name.trim()}</span>
                </label>
              ))}
              {filtered.length === 0 && <p className="text-sm text-muted-foreground">No products match.</p>}
            </div>
          )}
        </CardContent>
      </Card>
    </ERPLayout>
  );
}
