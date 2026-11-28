import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// The remark tables/functions are not in the generated Supabase types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type RemarkStatus = "missing" | "draft" | "submitted" | "approved" | "rejected";
export type DueKind = "reminder" | "overdue" | "approval";

export type KeyRmRemark = {
  report_date: string;
  remarks: string;
  status: Exclude<RemarkStatus, "missing">;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  submitter: { full_name: string | null } | null;
  reviewer: { full_name: string | null } | null;
};

export type KeyRmHistory = {
  id: string;
  action: string;
  status: string;
  remarks: string | null;
  note: string | null;
  created_at: string;
  actor: { full_name: string | null } | null;
};

export type KeyRmDay = {
  report_date: string;
  is_active: boolean;
  status: RemarkStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  due_kind: DueKind | null;
};

export type KeyRmSettings = {
  enabled: boolean;
  start_date: string;
  reminder_hours: number;
  submit_hours: number;
  approve_hours: number;
  alert_time: string;
};

const WRITER_ROLES = ["material_consumption_manager", "super_admin"];
const KEY = ["key-rm-remarks"];

/** One day's remark + history, the 30-day status list and the alert settings. */
export function useKeyRmRemarks(date: Date) {
  const queryClient = useQueryClient();
  const { roles } = useAuth();
  const isSuperAdmin = roles.some((r) => r.role === "super_admin");
  const canWrite = roles.some((r) => WRITER_ROLES.includes(r.role));
  const dateStr = format(date, "yyyy-MM-dd");

  const remark = useQuery<KeyRmRemark | null>({
    queryKey: [...KEY, "one", dateStr],
    queryFn: async () => {
      const { data, error } = await db
        .from("consumption_key_rm_remarks")
        .select("report_date, remarks, status, submitted_at, reviewed_at, review_note, submitter:app_users!consumption_key_rm_remarks_submitted_by_fkey(full_name), reviewer:app_users!consumption_key_rm_remarks_reviewed_by_fkey(full_name)")
        .eq("report_date", dateStr)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });

  const history = useQuery<KeyRmHistory[]>({
    queryKey: [...KEY, "history", dateStr],
    queryFn: async () => {
      const { data, error } = await db
        .from("consumption_key_rm_remark_history")
        .select("id, action, status, remarks, note, created_at, actor:app_users!consumption_key_rm_remark_history_actor_id_fkey(full_name)")
        .eq("report_date", dateStr)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const settings = useQuery<KeyRmSettings | null>({
    queryKey: [...KEY, "settings"],
    queryFn: async () => {
      const { data } = await db.from("consumption_key_rm_remark_settings").select("*").maybeSingle();
      return data ?? null;
    },
  });

  const days = useQuery<KeyRmDay[]>({
    queryKey: [...KEY, "days"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const today = new Date();
      const { data, error } = await db.rpc("key_rm_remark_days", {
        p_from: format(subDays(today, 29), "yyyy-MM-dd"),
        p_to: format(today, "yyyy-MM-dd"),
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });
  const rpc = (fn: string, args: Record<string, unknown>) => async () => {
    const { error } = await db.rpc(fn, args);
    if (error) throw error;
  };

  const save = useMutation({
    mutationFn: (v: { remarks: string; submit: boolean }) =>
      rpc("key_rm_remark_save", { p_date: dateStr, p_remarks: v.remarks, p_submit: v.submit })(),
    onSuccess: refresh,
  });
  const review = useMutation({
    mutationFn: (v: { approve: boolean; note?: string }) =>
      rpc("key_rm_remark_review", { p_date: dateStr, p_approve: v.approve, p_note: v.note ?? null })(),
    onSuccess: refresh,
  });
  const reopen = useMutation({
    mutationFn: (note: string) => rpc("key_rm_remark_reopen", { p_date: dateStr, p_note: note })(),
    onSuccess: refresh,
  });
  const saveSettings = useMutation({
    mutationFn: (s: KeyRmSettings) =>
      rpc("key_rm_remark_settings_save", {
        p_enabled: s.enabled,
        p_start_date: s.start_date,
        p_reminder_hours: s.reminder_hours,
        p_submit_hours: s.submit_hours,
        p_approve_hours: s.approve_hours,
        p_alert_time: s.alert_time,
      })(),
    onSuccess: refresh,
  });

  return {
    dateStr, canWrite, isSuperAdmin,
    remark: remark.data ?? null, remarkLoading: remark.isLoading,
    history: history.data ?? [],
    settings: settings.data ?? null,
    days: days.data ?? [],
    save, review, reopen, saveSettings,
  };
}
