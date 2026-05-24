export const PIPELINE_STAGES = [
  "identified",
  "contacted",
  "demo_scheduled",
  "demo_completed",
  "trial_supply",
  "house_ball",
  "lost",
] as const;
export type PipelineStage = typeof PIPELINE_STAGES[number];

export const STAGE_LABEL: Record<PipelineStage, string> = {
  identified: "Identified",
  contacted: "Contacted",
  demo_scheduled: "Demo Scheduled",
  demo_completed: "Demo Completed",
  trial_supply: "Trial Supply",
  house_ball: "House Ball",
  lost: "Lost",
};

export const STAGE_COLOR: Record<PipelineStage, string> = {
  identified: "border-t-slate-400",
  contacted: "border-t-blue-500",
  demo_scheduled: "border-t-amber-500",
  demo_completed: "border-t-purple-500",
  trial_supply: "border-t-cyan-500",
  house_ball: "border-t-emerald-500",
  lost: "border-t-red-500",
};

export const INTERACTION_TYPES = ["call", "whatsapp", "visit", "demo", "tournament"] as const;
export type InteractionType = typeof INTERACTION_TYPES[number];

export const AGREEMENT_TYPES = ["trial", "house_ball", "exclusive"] as const;
export type AgreementType = typeof AGREEMENT_TYPES[number];

export interface PadelCourt {
  id: string;
  venue_name: string;
  city: string | null;
  area: string | null;
  google_maps_url: string | null;
  latitude: number | null;
  longitude: number | null;
  number_of_courts: number | null;
  weekly_play_hours: number | null;
  manager_name: string | null;
  manager_phone: string | null;
  manager_email: string | null;
  current_ball_brand: string | null;
  monthly_consumption_estimate: number | null;
  pipeline_stage: PipelineStage;
  lost_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PadelInteraction {
  id: string;
  court_id: string;
  type: InteractionType;
  outcome: string | null;
  stage_before: string | null;
  stage_after: string | null;
  follow_up_date: string | null;
  notes: string | null;
  performed_by: string | null;
  performed_at: string;
}

export interface PadelDemo {
  id: string;
  court_id: string;
  scheduled_at: string | null;
  completed_at: string | null;
  attendees_count: number | null;
  balls_provided: number | null;
  performance_rating: number | null;
  pressure_retention_rating: number | null;
  durability_rating: number | null;
  manager_feedback: string | null;
  player_feedback: string | null;
  photos_url: string[] | null;
  converted_to_trial: boolean;
  created_at: string;
}

export interface PadelAgreement {
  id: string;
  agreement_number: string | null;
  court_id: string;
  customer_id: string | null;
  type: AgreementType;
  monthly_volume: number | null;
  unit_price: number | null;
  payment_terms: string | null;
  start_date: string | null;
  end_date: string | null;
  auto_renew: boolean;
  status: string;
  delivered_volume_mtd: number;
  created_at: string;
}

export const phoneDigits = (p: string | null | undefined): string =>
  (p ?? "").replace(/\D+/g, "");

export const fmtPKR = (n: number | null | undefined): string =>
  `Rs. ${Math.round(n ?? 0).toLocaleString()}`;
