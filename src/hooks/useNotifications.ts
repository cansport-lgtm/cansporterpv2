import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import type { Database } from "@/integrations/supabase/types";

export type SystemNotification = Database["public"]["Tables"]["notifications"]["Row"];

const LIST_LIMIT = 30;

/**
 * The current user's system notifications: latest items + unread count,
 * kept live via a realtime subscription on the notifications table.
 * A newly arriving notification also raises a toast and (when the user
 * has granted permission) a browser notification.
 */
export function useNotifications() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id;

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ["notifications", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("recipient_id", userId!)
        .order("created_at", { ascending: false })
        .limit(LIST_LIMIT);
      if (error) throw error;
      return data as SystemNotification[];
    },
    enabled: !!userId,
  });

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ["notifications-unread", userId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("recipient_id", userId!)
        .eq("is_read", false);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!userId,
  });

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${userId}`,
        },
        (payload) => {
          queryClient.invalidateQueries({ queryKey: ["notifications", userId] });
          queryClient.invalidateQueries({ queryKey: ["notifications-unread", userId] });

          const n = payload.new as SystemNotification;
          toast({
            title: n.title,
            description: n.message ?? undefined,
            variant: n.type === "error" ? "destructive" : "default",
          });

          // Desktop notification when the tab is in the background and the
          // user granted permission (see requestDesktopNotifications below).
          if (
            typeof Notification !== "undefined" &&
            Notification.permission === "granted" &&
            document.visibilityState !== "visible"
          ) {
            try {
              new Notification(n.title, {
                body: n.message ?? undefined,
                icon: "/favicon.ico",
                tag: n.id,
              });
            } catch {
              // Some mobile browsers throw on direct construction — ignore.
            }
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["notifications", userId] });
          queryClient.invalidateQueries({ queryKey: ["notifications-unread", userId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);

  const markRead = async (id: string) => {
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("id", id);
    if (error) console.error("Failed to mark notification read:", error);
    queryClient.invalidateQueries({ queryKey: ["notifications", userId] });
    queryClient.invalidateQueries({ queryKey: ["notifications-unread", userId] });
  };

  const markAllRead = async () => {
    if (!userId) return;
    const { error } = await supabase.rpc("mark_all_notifications_read", {
      p_recipient_id: userId,
    });
    if (error) console.error("Failed to mark notifications read:", error);
    queryClient.invalidateQueries({ queryKey: ["notifications", userId] });
    queryClient.invalidateQueries({ queryKey: ["notifications-unread", userId] });
  };

  return { notifications, unreadCount, isLoading, markRead, markAllRead };
}

/** Ask the browser for desktop-notification permission (no-op if already decided). */
export function requestDesktopNotifications(): void {
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    void Notification.requestPermission();
  }
}
