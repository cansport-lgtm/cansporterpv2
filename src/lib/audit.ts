import { supabase } from "@/integrations/supabase/client";

const SESSION_KEY = "erp_session";

interface ActivityEntry {
  module: string;
  action: string;
  recordType?: string;
  recordId?: string;
  details?: Record<string, unknown>;
}

// Records an app-level event (logout, approvals, exports, …) into the central
// audit_log. Data changes (create/edit/delete) are captured automatically by
// database triggers — do NOT log those here too.
//
// The session is read synchronously at call time so the event stays attributed
// even when the caller clears the session right after (logout).
export function logActivity(entry: ActivityEntry): void {
  let userUuid: string | null = null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const session = JSON.parse(raw);
      if (typeof session?.userUuid === "string") userUuid = session.userUuid;
    }
  } catch {
    // no session — log the event unattributed
  }

  void supabase
    .from("audit_log")
    .insert({
      user_id: userUuid,
      module: entry.module,
      action: entry.action,
      record_type: entry.recordType ?? null,
      record_id: entry.recordId ?? null,
      new_values: (entry.details ?? null) as never,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    })
    .then(({ error }) => {
      if (error) console.error("Failed to record activity:", error);
    });
}
