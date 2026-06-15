import { supabase } from "@/integrations/supabase/client";

export interface WIPStage {
  id: string;
  name: string;
  sequence_order: number;
  unit: string;
  is_active: boolean;
}

export interface Threshold {
  id: string;
  stage_id: string;
  max_threshold: number;
  unit: string;
  notes: string | null;
}

export interface StockEntry {
  id: string;
  stage_id: string;
  entry_date: string;
  entry_time: string;
  quantity: number;
  unit: string;
  remarks: string | null;
  entered_by: string | null;
  created_at: string;
}

export async function fetchStages(activeOnly = false): Promise<WIPStage[]> {
  let q = supabase.from("wip_stages" as any).select("*").order("sequence_order");
  if (activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as unknown as WIPStage[];
}

export async function fetchThresholds(): Promise<Threshold[]> {
  const { data, error } = await supabase.from("wip_stage_thresholds" as any).select("*");
  if (error) throw error;
  return (data || []) as unknown as Threshold[];
}

export async function fetchEntriesInRange(from: string, to: string): Promise<StockEntry[]> {
  const { data, error } = await supabase
    .from("wip_stock_entries" as any)
    .select("*")
    .gte("entry_date", from)
    .lte("entry_date", to)
    .order("entry_date", { ascending: false })
    .order("entry_time", { ascending: false });
  if (error) throw error;
  return (data || []) as unknown as StockEntry[];
}

export async function fetchEntriesAsOf(asOf: string): Promise<StockEntry[]> {
  // All entries up to and including asOf — caller picks latest per stage / per day
  const { data, error } = await supabase
    .from("wip_stock_entries" as any)
    .select("*")
    .lte("entry_date", asOf)
    .order("entry_date", { ascending: false })
    .order("entry_time", { ascending: false });
  if (error) throw error;
  return (data || []) as unknown as StockEntry[];
}

export const fmtNum = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 2 });

export function statusFromUtil(pct: number): { label: string; color: string; bg: string; border: string } {
  if (pct > 100) return { label: "Bottleneck", color: "text-red-600", bg: "bg-red-500/10", border: "border-red-500/40" };
  if (pct >= 75) return { label: "Warning", color: "text-amber-600", bg: "bg-amber-500/10", border: "border-amber-500/40" };
  return { label: "Healthy", color: "text-green-600", bg: "bg-green-500/10", border: "border-green-500/40" };
}

// Pick latest entry per stage (date desc, time desc already sorted)
export function latestPerStage(entries: StockEntry[]): Map<string, StockEntry> {
  const m = new Map<string, StockEntry>();
  for (const e of entries) {
    if (!m.has(e.stage_id)) m.set(e.stage_id, e);
  }
  return m;
}
