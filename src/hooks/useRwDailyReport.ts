import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// The daily report tables/functions are not in the generated Supabase types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type ReportStatus = "missing" | "draft" | "submitted" | "approved" | "rejected";
export type DueKind = "reminder" | "overdue" | "approval";

type Kind = { qty: number; cost: number; entries: number };

/** The day's figures, as returned by rw_daily_report_figures (also frozen on submit). */
export type RwFigures = {
  date: string;
  rejection: Kind;
  wastage: Kind;
  leakage: Kind;
  total_cost: number;
  prev_day_total: number | null;
  avg_prev_days: number | null;
  trend: { date: string; total: number }[];
  departments: {
    department: string;
    rejected_qty: number; rejection_cost: number;
    wastage_qty: number; wastage_cost: number;
    leakage_qty: number; leakage_cost: number;
    total_cost: number;
  }[];
  reasons: { reason: string; kind: "rejection" | "wastage" | "leakage"; qty: number; cost: number; entries: number }[];
  materials: { material: string; kind: string; qty: number; cost: number }[];
};

export type RwReport = {
  report_date: string;
  summary: string;
  biggest_loss_remark: string;
  action_plan: string;
  status: Exclude<ReportStatus, "missing">;
  snapshot: RwFigures | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  submitter: { full_name: string | null } | null;
  reviewer: { full_name: string | null } | null;
};

export type RwHistory = {
  id: string;
  action: string;
  status: string;
  remarks: { summary?: string; biggest_loss_remark?: string; action_plan?: string } | null;
  note: string | null;
  created_at: string;
  actor: { full_name: string | null } | null;
};

export type RwDay = {
  report_date: string;
  is_active: boolean;
  status: ReportStatus;
  total_cost: number;
  submitted_at: string | null;
  reviewed_at: string | null;
  due_kind: DueKind | null;
  due_at: string | null;
};

export type RwSettings = {
  enabled: boolean;
  start_date: string;
  reminder_time: string;
  submit_by_time: string;
  approve_hours: number;
  resubmit_hours: number;
  alert_time: string;
};

export type RemarksInput = { summary: string; biggest_loss_remark: string; action_plan: string };

const WRITER_ROLES = ["rejections_manager", "super_admin"];
const KEY = ["rw-daily-report"];

/** The 30-day status list and the alert settings (also used by the dashboard card). */
export function useRwReportOverview() {
  const settings = useQuery<RwSettings | null>({
    queryKey: [...KEY, "settings"],
    queryFn: async () => {
      const { data } = await db.from("rw_daily_report_settings").select("*").maybeSingle();
      return data ?? null;
    },
  });

  const days = useQuery<RwDay[]>({
    queryKey: [...KEY, "days"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const today = new Date();
      const { data, error } = await db.rpc("rw_daily_report_days", {
        p_from: format(subDays(today, 29), "yyyy-MM-dd"),
        p_to: format(today, "yyyy-MM-dd"),
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  return { settings, days };
}

/** One day's report + history, the 30-day status list and the alert settings. */
export function useRwDailyReport(dateStr: string) {
  const queryClient = useQueryClient();
  const { roles } = useAuth();
  const isSuperAdmin = roles.some((r) => r.role === "super_admin");
  const canWrite = roles.some((r) => WRITER_ROLES.includes(r.role));

  const report = useQuery<RwReport | null>({
    queryKey: [...KEY, "one", dateStr],
    queryFn: async () => {
      const { data, error } = await db
        .from("rw_daily_reports")
        .select("report_date, summary, biggest_loss_remark, action_plan, status, snapshot, submitted_at, reviewed_at, review_note, submitter:app_users!rw_daily_reports_submitted_by_fkey(full_name), reviewer:app_users!rw_daily_reports_reviewed_by_fkey(full_name)")
        .eq("report_date", dateStr)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });

  const locked = report.data?.status === "submitted" || report.data?.status === "approved";

  // Live figures while the report is open; the frozen snapshot once it is submitted.
  const live = useQuery<RwFigures>({
    queryKey: [...KEY, "figures", dateStr],
    enabled: !report.isLoading && !(locked && report.data?.snapshot),
    queryFn: async () => {
      const { data, error } = await db.rpc("rw_daily_report_figures", { p_date: dateStr });
      if (error) throw error;
      return data;
    },
  });
  const figures: RwFigures | null = locked && report.data?.snapshot ? report.data.snapshot : live.data ?? null;

  const history = useQuery<RwHistory[]>({
    queryKey: [...KEY, "history", dateStr],
    queryFn: async () => {
      const { data, error } = await db
        .from("rw_daily_report_history")
        .select("id, action, status, remarks, note, created_at, actor:app_users!rw_daily_report_history_actor_id_fkey(full_name)")
        .eq("report_date", dateStr)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { settings, days } = useRwReportOverview();

  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });
  const call = async (fn: string, args: Record<string, unknown>) => {
    const { error } = await db.rpc(fn, args);
    if (error) throw error;
  };

  const save = useMutation({
    mutationFn: (v: RemarksInput & { submit: boolean }) =>
      call("rw_daily_report_save", {
        p_date: dateStr, p_summary: v.summary, p_biggest_loss_remark: v.biggest_loss_remark,
        p_action_plan: v.action_plan, p_submit: v.submit,
      }),
    onSuccess: refresh,
  });
  const review = useMutation({
    mutationFn: (v: { approve: boolean; note?: string }) =>
      call("rw_daily_report_review", { p_date: dateStr, p_approve: v.approve, p_note: v.note ?? null }),
    onSuccess: refresh,
  });
  const reopen = useMutation({
    mutationFn: (note: string) => call("rw_daily_report_reopen", { p_date: dateStr, p_note: note }),
    onSuccess: refresh,
  });
  const saveSettings = useMutation({
    mutationFn: (s: RwSettings) =>
      call("rw_daily_report_settings_save", {
        p_enabled: s.enabled, p_start_date: s.start_date,
        p_reminder_time: s.reminder_time, p_submit_by_time: s.submit_by_time,
        p_approve_hours: s.approve_hours, p_resubmit_hours: s.resubmit_hours, p_alert_time: s.alert_time,
      }),
    onSuccess: refresh,
  });

  return {
    canWrite, isSuperAdmin,
    report: report.data ?? null, reportLoading: report.isLoading,
    figures, figuresLoading: live.isLoading && !figures,
    history: history.data ?? [],
    settings: settings.data ?? null,
    days: days.data ?? [],
    save, review, reopen, saveSettings,
  };
}
