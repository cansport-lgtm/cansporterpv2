import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export const KEY_RAW_MATERIALS_QUERY_KEY = ["consumption-key-raw-materials"];

// Stable fallback so consumers can safely depend on keyIds in effects/memos.
const NO_IDS: string[] = [];

/**
 * The shared Key Raw Materials list (consumption_key_raw_materials), as raw
 * material ids in display order. Only a super admin may change it; the
 * database enforces that inside consumption_set_key_raw_materials().
 */
export function useKeyRawMaterials() {
  const queryClient = useQueryClient();
  const { roles } = useAuth();
  const canEdit = roles.some((r) => r.role === "super_admin");

  const { data: keyIds = NO_IDS, isLoading } = useQuery({
    queryKey: KEY_RAW_MATERIALS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_key_raw_materials")
        .select("raw_material_id, sort_order")
        .order("sort_order");
      if (error) throw error;
      return (data || []).map((r) => r.raw_material_id);
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.rpc("consumption_set_key_raw_materials", { p_raw_material_ids: ids });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY_RAW_MATERIALS_QUERY_KEY }),
  });

  return {
    keyIds,
    isLoading,
    canEdit,
    saveKeyIds: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
  };
}
