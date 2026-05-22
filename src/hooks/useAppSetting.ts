import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;

/**
 * Read a single app_settings row reactively.
 * `fallback` is returned while the row is loading or if the row doesn't exist.
 */
export function useAppSetting<T>(key: string, fallback: T): { value: T; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ["app-setting", key],
    queryFn: async () => {
      const { data, error } = await sb.from("app_settings").select("value").eq("key", key).maybeSingle();
      if (error || !data) return fallback;
      return data.value as T;
    },
    staleTime: 30_000,
  });
  return { value: (data ?? fallback) as T, isLoading };
}
