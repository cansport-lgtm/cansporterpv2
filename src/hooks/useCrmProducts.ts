import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CrmProduct {
  id: string;
  code: string;
  name: string;
}

/**
 * Products to use across CRM. Returns the curated CRM list (crm_product_list);
 * while that list is empty it falls back to every active product so nothing breaks
 * before a list has been chosen.
 */
export function useCrmProducts() {
  const all = useQuery({
    queryKey: ["crm-all-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, code, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as CrmProduct[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const list = useQuery({
    queryKey: ["crm-product-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_product_list")
        .select("product_id, sort_order")
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as { product_id: string; sort_order: number }[];
    },
    staleTime: 60 * 1000,
  });

  const allProducts = all.data ?? [];
  const listIds = (list.data ?? []).map((r) => r.product_id);
  const idSet = new Set(listIds);
  const products = listIds.length
    ? allProducts.filter((p) => idSet.has(p.id))
    : allProducts;

  return {
    products,
    allProducts,
    listIds,
    isCurated: listIds.length > 0,
    isLoading: all.isLoading || list.isLoading,
  };
}
