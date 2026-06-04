import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PackingType {
  id: string;
  label: string;
  dozens: number;
  is_active: boolean;
  sort_order: number;
}

/** Active packing types from the master, ordered for display. */
export function usePackingTypes() {
  return useQuery({
    queryKey: ["packing-types"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("packing_types")
        .select("id, label, dozens, is_active, sort_order")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("label", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PackingType[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Dozens-per-package for a stored packing label. Falls back to 0 (or a provided default). */
export function dozensForLabel(
  label: string | null | undefined,
  list: Pick<PackingType, "label" | "dozens">[] | undefined,
  fallback = 0
): number {
  if (!label) return fallback;
  const match = (list ?? []).find((p) => p.label === label);
  return match ? Number(match.dozens) || 0 : fallback;
}
