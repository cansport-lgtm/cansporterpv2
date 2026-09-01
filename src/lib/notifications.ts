import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

export type NotificationType = "info" | "success" | "warning" | "error";

interface NotificationPayload {
  title: string;
  message?: string;
  type?: NotificationType;
  /** Originating module key, e.g. 'purchase', 'qa', 'maintenance'. */
  module?: string;
  /** In-app route to open when the notification is clicked, e.g. '/purchase/orders'. */
  link?: string;
  referenceType?: string;
  referenceId?: string;
}

const SESSION_KEY = "erp_session";

// The logged-in user's uuid, read the same way audit.ts does, so a
// notification's created_by stays attributed without threading it through
// every call site.
function currentUserUuid(): string | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const session = JSON.parse(raw);
      if (typeof session?.userUuid === "string") return session.userUuid;
    }
  } catch {
    // no session — send unattributed
  }
  return null;
}

/** Send a notification to a single user. */
export async function notifyUser(recipientId: string, n: NotificationPayload): Promise<void> {
  const { error } = await supabase.rpc("notify_user", {
    p_recipient_id: recipientId,
    p_title: n.title,
    p_message: n.message,
    p_type: n.type ?? "info",
    p_module: n.module,
    p_link: n.link,
    p_reference_type: n.referenceType,
    p_reference_id: n.referenceId,
    p_created_by: currentUserUuid() ?? undefined,
  });
  if (error) console.error("Failed to send notification:", error);
}

/**
 * Send a notification to every active user holding any of the given roles.
 * The current user is excluded by default (they performed the action).
 */
export async function notifyRoles(
  roles: AppRole[],
  n: NotificationPayload & { includeSelf?: boolean }
): Promise<void> {
  const self = currentUserUuid();
  const { error } = await supabase.rpc("notify_role", {
    p_roles: roles,
    p_title: n.title,
    p_message: n.message,
    p_type: n.type ?? "info",
    p_module: n.module,
    p_link: n.link,
    p_reference_type: n.referenceType,
    p_reference_id: n.referenceId,
    p_created_by: self ?? undefined,
    p_exclude_user: n.includeSelf ? undefined : self ?? undefined,
  });
  if (error) console.error("Failed to send role notification:", error);
}
