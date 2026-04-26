import { supabase } from "@/integrations/supabase/client";
import { format, endOfDay } from "date-fns";

const FAILURE_THRESHOLD = 3;

export async function checkAndCreateFailureAlert(
  processId: string,
  processName: string,
  inspectionDate: string
) {
  try {
    // Count today's failures for this process
    const { count, error: countError } = await supabase
      .from("qa_inspections")
      .select("*", { count: "exact", head: true })
      .eq("process_id", processId)
      .eq("inspection_date", inspectionDate)
      .eq("result", "fail");

    if (countError || count === null || count < FAILURE_THRESHOLD) return;

    // Check if alert already exists today for this process
    const todayStart = `${inspectionDate}T00:00:00`;
    const { data: existing } = await supabase
      .from("system_alerts")
      .select("id")
      .eq("module", "QA")
      .eq("type", "error")
      .gte("created_at", todayStart)
      .ilike("message", `%${processName}%`)
      .limit(1);

    if (existing && existing.length > 0) return;

    // Create auto-alert
    const expiresAt = endOfDay(new Date(inspectionDate)).toISOString();
    await supabase.from("system_alerts").insert({
      type: "error",
      message: `${count} failed inspections at ${processName} today — immediate attention required`,
      module: "QA",
      priority: 10,
      is_active: true,
      expires_at: expiresAt,
    } as any);
  } catch (err) {
    console.error("Auto-alert check failed:", err);
  }
}
