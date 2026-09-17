# System Notifications

In-app notifications delivered from the system to users in real time. Users see
them in the header bell (live badge + dropdown) and on the **/notifications**
inbox page. New notifications also raise a toast, and — when the user grants
browser permission — a desktop notification while the tab is in the background.

## How it works

```
Producer (DB trigger or app code)
        │  notify_user(...) / notify_role(...)
        ▼
public.notifications  ──(one row per recipient)──►  supabase_realtime
        │                                                 ▼
        │                                     /notifications page  ◄─┐
        │                                     header NotificationBell│ useNotifications() hook
        │                                     (toast + desktop notif)┘
        ▼  trg_send_web_push (pg_net)
send-web-push Edge Function ──► Web Push ──► OS notification (app fully closed)
        ▲
public.push_subscriptions  (one row per device that granted permission)
```

- **`public.notifications`** — one row per recipient. Role sends are fanned out
  into per-user rows so read state stays per-user.
- **`notify_user(...)`** / **`notify_role(...)`** — SQL helpers (SECURITY
  DEFINER) callable from triggers or via RPC from the frontend. `notify_role`
  targets every **active** user holding any of the given roles and can exclude
  the acting user.
- **Realtime** — the table is in the `supabase_realtime` publication; the
  `useNotifications` hook subscribes filtered on `recipient_id`.

## Establishing the feature

1. Apply the migration `supabase/migrations/20260901150000_system_notifications.sql`
   (via `supabase db push`, or by running it in the SQL editor of the project).
   Rollback: `supabase/rollbacks/20260901150000_system_notifications_down.sql`.
2. Deploy the frontend. The header bell and `/notifications` page are already
   wired — no configuration needed.
3. Desktop notifications: each user is prompted for browser permission the
   first time they open the bell. This is per-browser and optional; in-app
   delivery works without it.

## Emitting notifications

### From a database trigger (preferred for system events)

Events that originate from data changes should notify from a trigger, so the
notification fires no matter which screen or API path made the change. The
migration ships one producer as the template — purchase orders entering
`pending_approval` notify all purchase managers/admins:

```sql
PERFORM public.notify_role(
    ARRAY['purchase_manager', 'admin']::app_role[],
    'Purchase Approval Pending',              -- title
    NEW.po_number || ' requires your approval', -- message
    'warning',                                 -- info | success | warning | error
    'purchase',                                -- module key
    '/purchase/orders',                        -- in-app link opened on click
    'purchase_order', NEW.id,                  -- reference back to the record
    NEW.created_by,                            -- created_by
    NEW.created_by                             -- exclude the submitter
);
```

A second producer covers dispatches: every new row in `sales_dispatches`
notifies `super_admin` / `admin` / `sales_order_manager` (except the
dispatcher) with the dispatch number, order, customer, and vehicle
(`20260901160000_dispatch_notifications.sql`). To change who is notified,
edit the role array in `notify_new_dispatch()`.

Copy this pattern for other events (QA holds, PM due, low stock, …): write a
trigger function that calls `notify_role` / `notify_user` and attach it to the
relevant table.

### From application code

```ts
import { notifyUser, notifyRoles } from "@/lib/notifications";

// One user
await notifyUser(userUuid, {
  title: "Order approved",
  message: `${order.order_number} was approved`,
  type: "success",
  module: "sales",
  link: "/domestic/orders",
});

// Everyone holding a role (the current user is excluded automatically)
await notifyRoles(["qa_manager", "admin"], {
  title: "QA Hold Alert",
  message: `Batch ${batchNo} on hold — NCR pending`,
  type: "error",
  module: "qa",
  link: "/qa/ncr",
});
```

## Reading notifications (frontend)

`useNotifications()` (src/hooks/useNotifications.ts) returns
`{ notifications, unreadCount, isLoading, markRead, markAllRead }` for the
logged-in user and keeps everything live via realtime. The bell
(`src/components/layout/NotificationBell.tsx`) and the inbox page
(`src/pages/NotificationsPage.tsx`) are both built on it.

Clicking a notification marks it read and navigates to its `link` (when set).
"Mark all read" uses the `mark_all_notifications_read` RPC.

## Notifications on mobile

There are three delivery levels; all three work once the setup below is done:

1. **In-app (always)** — bell badge, dropdown, toast, and the /notifications
   page update in real time whenever the app is open, on any device.
2. **Device notification (app open, possibly in background)** — after the user
   taps the bell once and grants the browser's notification permission, new
   notifications appear as OS notifications whenever the tab/PWA is open but
   not in the foreground. On Android this requires the app to be installed as
   a PWA ("Add to Home Screen"); delivery goes through the service worker.
   iOS Safari only supports this for an installed PWA on iOS 16.4+.
3. **Push with the app fully closed** — Web Push. The same permission prompt
   in (2) also subscribes the device (`src/lib/webPush.ts`,
   `public/push-sw.js`) and saves the subscription in
   `public.push_subscriptions`. Every insert into `notifications` fires the
   `send-web-push` Edge Function via the `trg_send_web_push` trigger
   (`supabase/migrations/20260917120000_push_subscriptions.sql`), which sends
   a real push through the browser's push service — no tab or PWA needs to be
   open at all. Same platform support as (2): Android needs the PWA
   installed; iOS Safari needs iOS 16.4+ and an installed PWA.

### Enabling push delivery (one-time, per environment)

1. Apply `20260917120000_push_subscriptions.sql` (adds `push_subscriptions`
   and the trigger). Rollback:
   `20260917120000_push_subscriptions_down.sql`.
2. Deploy the `send-web-push` Edge Function (`supabase functions deploy
   send-web-push`) and set `verify_jwt = false` for it (dashboard or
   `config.toml`) — the trigger calls it with only the anon `apikey`, the
   same as `postex`.
3. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:`
   contact address) as function secrets, or as rows in
   `integration_secrets` (same fallback `postex` uses for its API token —
   the function checks a real secret first). A key pair is already
   generated and wired into `src/lib/webPush.ts` (`VAPID_PUBLIC_KEY`) — set
   the matching private key as `VAPID_PRIVATE_KEY`. To rotate, generate a
   fresh EC P-256 pair, update both the secret and `VAPID_PUBLIC_KEY` in the
   frontend, and redeploy; existing subscriptions become invalid and are
   re-created next time each device grants/renews permission.
4. Deploy the frontend. Nothing else to configure — granting permission via
   the bell now also enables level 3.

## Notification fields

| Field | Purpose |
| --- | --- |
| `title` / `message` | What the user sees. |
| `type` | `info` \| `success` \| `warning` \| `error` — drives the color. |
| `module` | Originating module key, shown as a badge and usable for filtering. |
| `link` | In-app route opened when the notification is clicked. |
| `reference_type` / `reference_id` | Pointer back to the source record. |
| `is_read` / `read_at` | Per-recipient read state. |
