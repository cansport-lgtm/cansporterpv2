# Auto-cancel of stale sales and purchase orders

Every night at 00:05 Pakistan time a database job (`auto-cancel-stale-orders`,
pg_cron) runs `public.auto_cancel_stale_orders(30)` and cancels orders that are
30 or more days old (by order date) and have had nothing done against them.

| Order | Cancelled when status is | …and none of these exist |
|---|---|---|
| Sales order | draft, confirmed, in production, ready | a dispatch (single or multi-order), dispatched dozens on any line |
| Purchase order | draft, pending approval, approved, ordered | a GRN, a QC inspection, a gate inward entry that is not cancelled/rejected, received quantity on any line, a close-short |

Partly dispatched / partly received orders are never auto-cancelled; close
them by hand (Delivered on a sales order, Close Short on a PO).

What changes on a cancelled order:

- `status` becomes `cancelled` and `auto_cancelled_at` is set.
- The order lists show "Auto-cancelled (30 days)" under the status; the PO
  view dialog shows an "auto-cancelled <date>" badge.
- One notification per run goes to super admin / admin / sales order manager
  (sales orders) and super admin / admin / purchase manager / purchase officer
  (purchase orders), listing the order numbers.

Migration: `supabase/migrations/20261015120000_auto_cancel_stale_orders.sql`
Rollback: `supabase/rollbacks/20261015120000_auto_cancel_stale_orders_down.sql`
(stops the job; already cancelled orders stay cancelled).

To change the age, reschedule the job with a different argument, e.g.
`SELECT cron.schedule('auto-cancel-stale-orders', '5 19 * * *', 'SELECT public.auto_cancel_stale_orders(45)');`
