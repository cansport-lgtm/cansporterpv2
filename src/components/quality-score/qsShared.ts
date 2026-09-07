import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Shared types + queries for the Quality Score module. The qs_* tables are newer than
// the generated types.ts, so queries go through (supabase as any) like the newer rw_* pages.

export interface QsParameter {
  id: string;
  scope: "ball" | "process";
  name: string;
  description: string | null;
  weight: number;
  sort_order: number;
  is_active: boolean;
}

export interface QsSettings {
  id: number;
  ball_weight: number;
  process_weight: number;
  process_mode: "holistic" | "parameters";
  ball_inspector_count: number;
  process_inspector_count: number;
  disagreement_threshold: number;
}

export interface QsScoreParam {
  id: string;
  parameter_id: string;
  parameter_name: string;
  weight: number;
  score: number;
}

export interface QsBallScore {
  id: string;
  entry_id: string;
  inspector_id: string;
  weighted_score: number;
  created_at: string;
  inspector?: { full_name: string } | null;
  params?: QsScoreParam[];
}

export interface QsProcessScore {
  id: string;
  entry_id: string;
  inspector_id: string;
  mode: "holistic" | "parameters";
  score: number;
  process_id: string | null;
  process_name: string | null;
  created_at: string;
  inspector?: { full_name: string } | null;
  params?: QsScoreParam[];
}

export interface QsProcess {
  id: string;
  name: string;
  description: string | null;
  department_id: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface QsEntry {
  id: string;
  entry_date: string;
  department_id: string;
  shift: "morning" | "afternoon" | "night";
  product_id: string | null;
  grade_id: string | null;
  status: "open" | "complete";
  remarks: string | null;
  department?: { name: string } | null;
  product?: { name: string } | null;
  grade?: { name: string } | null;
  ball_scores?: QsBallScore[];
  process_scores?: QsProcessScore[];
}

export const QS_ENTRY_SELECT = `*,
  department:production_departments(name),
  product:products(name),
  grade:grades(name),
  ball_scores:qs_ball_scores(*, inspector:app_users(full_name), params:qs_ball_score_params(*)),
  process_scores:qs_process_scores(*, inspector:app_users(full_name), params:qs_process_score_params(*))`;

export const SHIFT_OPTIONS = [
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
  { value: "night", label: "Night" },
] as const;

export function useQsSettings() {
  return useQuery({
    queryKey: ["qs-settings"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("qs_settings").select("*").eq("id", 1).single();
      if (error) throw error;
      return data as QsSettings;
    },
  });
}

export function useQsProcesses() {
  return useQuery({
    queryKey: ["qs-processes"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("qs_processes").select("*").order("sort_order").order("name");
      if (error) throw error;
      return data as QsProcess[];
    },
  });
}

export function useQsParameters(scope?: "ball" | "process") {
  return useQuery({
    queryKey: ["qs-parameters", scope ?? "all"],
    queryFn: async () => {
      let q = (supabase as any)
        .from("qs_parameters").select("*").order("scope").order("sort_order");
      if (scope) q = q.eq("scope", scope);
      const { data, error } = await q;
      if (error) throw error;
      return data as QsParameter[];
    },
  });
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export const avg = (nums: number[]): number | null =>
  nums.length ? round2(nums.reduce((a, b) => a + b, 0) / nums.length) : null;

// Sub-module averages + the overall roll-up for one entry. Overall only exists once
// both sub-modules have at least one submission.
export function entryAverages(entry: QsEntry, settings?: QsSettings) {
  const ball = avg((entry.ball_scores ?? []).map((s) => Number(s.weighted_score)));
  const process = avg((entry.process_scores ?? []).map((s) => Number(s.score)));
  const bw = settings ? Number(settings.ball_weight) : 50;
  const pw = settings ? Number(settings.process_weight) : 50;
  const overall =
    ball !== null && process !== null ? round2((ball * bw + process * pw) / 100) : null;
  return { ball, process, overall };
}

// Largest gap between inspectors on any single parameter (ball) or on the process score —
// used for the disagreement flag.
export function entryMaxDelta(entry: QsEntry): { delta: number; label: string } | null {
  let worst: { delta: number; label: string } | null = null;
  const consider = (delta: number, label: string) => {
    if (!worst || delta > worst.delta) worst = { delta: round2(delta), label };
  };
  const byParam: Record<string, number[]> = {};
  for (const s of entry.ball_scores ?? []) {
    for (const p of s.params ?? []) {
      (byParam[p.parameter_name] ??= []).push(Number(p.score));
    }
  }
  for (const [name, scores] of Object.entries(byParam)) {
    if (scores.length > 1) consider(Math.max(...scores) - Math.min(...scores), name);
  }
  const proc = (entry.process_scores ?? []).map((s) => Number(s.score));
  if (proc.length > 1) consider(Math.max(...proc) - Math.min(...proc), "Process");
  return worst;
}

export const fmtScore = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : Number(n).toFixed(2);
