import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;

// In-memory cache so a single flow (e.g. "save dispatch → post AR → post COGS")
// doesn't hit the DB three times. TTL is short; the cache is invalidated
// explicitly by the settings page when a value changes.
const CACHE: Map<string, { value: any; ts: number }> = new Map();
const TTL_MS = 60_000;

export async function getAppSetting<T = unknown>(key: string, fallback: T): Promise<T> {
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.value as T;
  try {
    const { data, error } = await sb
      .from("app_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error || !data) return fallback;
    CACHE.set(key, { value: data.value, ts: Date.now() });
    return data.value as T;
  } catch {
    return fallback;
  }
}

export function invalidateAppSettingsCache(key?: string) {
  if (key) CACHE.delete(key);
  else CACHE.clear();
}

// Convenience accessors used by the accounting posting functions.
// Both default to `true` if the row is missing (preserves current behavior).
export const isAccAutopostEnabled = (): Promise<boolean> =>
  getAppSetting<boolean>("accounting_autopost_enabled", true);

export const isPerpetualCogsEnabled = (): Promise<boolean> =>
  getAppSetting<boolean>("perpetual_cogs_enabled", true);
