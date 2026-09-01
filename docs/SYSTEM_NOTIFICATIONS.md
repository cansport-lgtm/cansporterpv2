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
        ▼                                                 │
  /notifications page  ◄──── useNotifications() hook ◄────┘
  header NotificationBell        (toast + desktop notification)
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

## Notification fields

| Field | Purpose |
| --- | --- |
| `title` / `message` | What the user sees. |
| `type` | `info` \| `success` \| `warning` \| `error` — drives the color. |
| `module` | Originating module key, shown as a badge and usable for filtering. |
| `link` | In-app route opened when the notification is clicked. |
| `reference_type` / `reference_id` | Pointer back to the source record. |
| `is_read` / `read_at` | Per-recipient read state. |
