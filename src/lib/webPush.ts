import { supabase } from "@/integrations/supabase/client";

// Public VAPID key — safe to ship in the bundle (it's how the browser proves
// which server may push to it; only the matching private key, held by the
// send-web-push Edge Function, can actually send). Generated once; rotating
// it invalidates every existing subscription (users re-subscribe next visit).
const VAPID_PUBLIC_KEY = "BGAQ-glBm-xBHy7VklbAJQ5Ewl_6FMDs5i-ahmO1xAUyVl3yTHH8MZkUbps4uzCMr1rMGHx_puxdUsi82ME6XOM";

function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Subscribe this browser/device to Web Push and store the subscription for
 * `userId`, so system notifications reach it even when the app is fully
 * closed. No-ops when the platform doesn't support Push, or when permission
 * hasn't been granted. Safe to call repeatedly — it upserts on the
 * subscription's endpoint.
 */
export async function subscribeToPush(userId: string): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const json = subscription.toJSON();
    const p256dh = json.keys?.p256dh;
    const auth = json.keys?.auth;
    if (!p256dh || !auth) return;

    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: userId,
        endpoint: subscription.endpoint,
        p256dh,
        auth,
        user_agent: navigator.userAgent,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    );
    if (error) console.error("Failed to save push subscription:", error);
  } catch (err) {
    // Permission dismissed mid-flow, unsupported browser quirk, etc. — the
    // in-app and background-tab delivery levels still work without this.
    console.error("Push subscription failed:", err);
  }
}
