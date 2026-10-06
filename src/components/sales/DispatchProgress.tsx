/**
 * "120 / 300 Dz" under an order's status badge: how much of the order has
 * left against dispatches. Shown only while an order is partly dispatched;
 * a fully dispatched or untouched order says it with its status alone.
 *
 * `lines` are the order's sales_order_items (or the subset of their columns
 * a list query embeds). quantity_dispatched is kept by a database trigger
 * from the dispatch lines, and the order status follows it (see migration
 * 20261012120000_sales_order_dispatch_status.sql).
 */

export interface DispatchProgressLine {
  quantity_dozens: number | string | null;
  quantity_dispatched: number | string | null;
}

function dispatchTotals(lines: readonly DispatchProgressLine[] | null | undefined) {
  let ordered = 0;
  let dispatched = 0;
  for (const line of lines || []) {
    ordered += Number(line.quantity_dozens) || 0;
    dispatched += Number(line.quantity_dispatched) || 0;
  }
  return { ordered, dispatched, pending: Math.max(ordered - dispatched, 0) };
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

interface DispatchProgressProps {
  lines: readonly DispatchProgressLine[] | null | undefined;
  status: string;
  className?: string;
}

export function DispatchProgress({ lines, status, className }: DispatchProgressProps) {
  if (status !== 'partially_dispatched') return null;
  const { ordered, dispatched, pending } = dispatchTotals(lines);
  if (ordered <= 0) return null;
  return (
    <div
      className={`text-xs text-muted-foreground whitespace-nowrap ${className || ''}`}
      title={`${fmt(dispatched)} of ${fmt(ordered)} dozen dispatched, ${fmt(pending)} pending`}
    >
      {fmt(dispatched)} / {fmt(ordered)} Dz · {fmt(pending)} pending
    </div>
  );
}
