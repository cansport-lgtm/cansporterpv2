// Sends a Web Push message for a system notification, so it reaches the
// user's device as a real OS notification even when the app/PWA is fully
// closed (delivery level 3 in docs/SYSTEM_NOTIFICATIONS.md).
//
// Invoked by the `trg_send_web_push` trigger (via pg_net) right after a row
// lands in public.notifications — see
// supabase/migrations/20260917120000_push_subscriptions.sql. Body:
//   { notificationId, recipientId, title, message, link }
//
// Requires these function secrets (Supabase dashboard -> Edge Functions ->
// send-web-push -> Secrets, or `supabase secrets set`):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (a "mailto:" address)
// The public key must match VAPID_PUBLIC_KEY in src/lib/webPush.ts — the
// browser signs up for push with it, the private key here signs the push.
//
// NOTE: verify_jwt is disabled (dashboard function setting) — the app has no
// Supabase Auth and the trigger calls this with only the anon apikey.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return json({ error: "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT not configured" }, 500);
  }

  let body: { notificationId?: string; recipientId?: string; title?: string; message?: string; link?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const { notificationId, recipientId, title, message, link } = body;
  if (!recipientId || !title) return json({ error: "recipientId and title are required" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: subs, error: subsErr } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", recipientId);
  if (subsErr) return json({ error: subsErr.message }, 500);
  if (!subs || subs.length === 0) return json({ sent: 0, reason: "no subscriptions" });

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const payload = JSON.stringify({ title, body: message, link, tag: notificationId });

  const stale: string[] = [];
  let sent = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        sent++;
      } catch (err) {
        // 404/410 means the browser dropped the subscription (uninstalled,
        // permission revoked, storage cleared) — clean it up. Anything else
        // is logged but left alone (e.g. a transient push-service outage).
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          stale.push(sub.id);
        } else {
          console.error(`Push failed for subscription ${sub.id}:`, err);
        }
      }
    }),
  );

  if (stale.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", stale);
  }

  return json({ sent, removed: stale.length });
});
