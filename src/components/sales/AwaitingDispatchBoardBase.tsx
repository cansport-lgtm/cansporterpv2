import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { Search, Truck, PackageCheck } from "lucide-react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

/**
 * Awaiting Dispatch board: one tile per approved sales order that has not
 * fully left the factory, most urgent first.
 *
 * "Approved" is the set of statuses the dispatch pages accept a dispatch
 * against: confirmed, in_production, ready, partially_dispatched. The order
 * status itself is kept by the database from the dispatch lines (see
 * migration 20261012120000_sales_order_dispatch_status.sql), so a tile
 * disappears on its own once the last dozen is dispatched.
 *
 * Urgency on the tile edge:
 *   red    expected_dispatch_date is in the past
 *   amber  due within DUE_SOON_DAYS, or AGE_WARN_DAYS+ old (the nightly job
 *          auto-cancels orders with no dispatch at AUTO_CANCEL_DAYS, see
 *          migration 20261015120000_auto_cancel_stale_orders.sql)
 *   green  on track
 */

type SalesSegment = Database["public"]["Enums"]["sales_segment"];

const PENDING_STATUSES = ["confirmed", "in_production", "ready", "partially_dispatched"] as const;

const DUE_SOON_DAYS = 3;
const AGE_WARN_DAYS = 21;
const AUTO_CANCEL_DAYS = 30;

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  in_production: "In Production",
  ready: "Ready",
  partially_dispatched: "Partial",
};

const STATUS_COLORS: Record<string, string> = {
  confirmed: "bg-blue-500",
  in_production: "bg-amber-500",
  ready: "bg-cyan-500",
  partially_dispatched: "bg-purple-500",
};

type Urgency = "crit" | "warn" | "ok";

const EDGE_COLORS: Record<Urgency, string> = {
  crit: "border-l-red-500",
  warn: "border-l-amber-500",
  ok: "border-l-green-500",
};

interface OrderRow {
  id: string;
  order_number: string;
  order_date: string;
  expected_dispatch_date: string | null;
  status: string;
  net_amount: number | null;
  customers: { name: string; code: string; city: string | null } | null;
  sales_order_items: { quantity_dozens: number | string | null; quantity_dispatched: number | string | null }[];
}

interface Tile {
  order: OrderRow;
  ordered: number;
  dispatched: number;
  pending: number;
  ageDays: number;
  /** Days until expected dispatch; negative = overdue; null = no date set. */
  dueInDays: number | null;
  urgency: Urgency;
  lines: number;
}

const fmtDz = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmtRs = (n: number) =>
  n >= 1_000_000
    ? `Rs ${(n / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })} M`
    : `Rs ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function buildTile(order: OrderRow, today: Date): Tile {
  let ordered = 0;
  let dispatched = 0;
  for (const line of order.sales_order_items || []) {
    ordered += Number(line.quantity_dozens) || 0;
    dispatched += Number(line.quantity_dispatched) || 0;
  }
  const pending = Math.max(ordered - dispatched, 0);
  const ageDays = differenceInCalendarDays(today, parseISO(order.order_date));
  const dueInDays = order.expected_dispatch_date
    ? differenceInCalendarDays(parseISO(order.expected_dispatch_date), today)
    : null;

  let urgency: Urgency = "ok";
  if (dueInDays !== null && dueInDays < 0) urgency = "crit";
  else if ((dueInDays !== null && dueInDays <= DUE_SOON_DAYS) || ageDays >= AGE_WARN_DAYS) urgency = "warn";

  return {
    order,
    ordered,
    dispatched,
    pending,
    ageDays,
    dueInDays,
    urgency,
    lines: order.sales_order_items?.length || 0,
  };
}

const URGENCY_RANK: Record<Urgency, number> = { crit: 0, warn: 1, ok: 2 };

/** Overdue first (most overdue on top), then by expected dispatch date, undated last, then oldest. */
function compareTiles(a: Tile, b: Tile): number {
  if (URGENCY_RANK[a.urgency] !== URGENCY_RANK[b.urgency]) return URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
  if (a.dueInDays !== null && b.dueInDays !== null && a.dueInDays !== b.dueInDays) return a.dueInDays - b.dueInDays;
  if (a.dueInDays === null && b.dueInDays !== null) return 1;
  if (a.dueInDays !== null && b.dueInDays === null) return -1;
  return b.ageDays - a.ageDays;
}

function dueLabel(t: Tile): string {
  if (t.dueInDays === null) return "Not set";
  const d = format(parseISO(t.order.expected_dispatch_date!), "dd MMM");
  if (t.dueInDays < 0) return `${d} · ${-t.dueInDays} day${t.dueInDays === -1 ? "" : "s"} overdue`;
  if (t.dueInDays === 0) return `${d} · today`;
  if (t.dueInDays === 1) return `${d} · tomorrow`;
  return `${d} · in ${t.dueInDays} days`;
}

interface AwaitingDispatchBoardBaseProps {
  segment: SalesSegment;
  title: string;
  /** Route of this segment's sales orders page, for the Open button. */
  ordersPath: string;
  /** Route of this segment's dispatch page, for the Create dispatch button. */
  dispatchPath: string;
}

export default function AwaitingDispatchBoardBase({ segment, title, ordersPath, dispatchPath }: AwaitingDispatchBoardBaseProps) {
  const { canViewPrices, hasModulePermission } = useAuth();
  const showPrices = canViewPrices();
  const canDispatch = hasModulePermission("sales", "create");
  const [search, setSearch] = useState("");

  const { data: orders, isLoading, error } = useQuery({
    queryKey: ["sales-orders", segment, "awaiting-dispatch"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_orders")
        .select(
          `id, order_number, order_date, expected_dispatch_date, status, net_amount,
           customers(name, code, city),
           sales_order_items(quantity_dozens, quantity_dispatched)`,
        )
        .eq("sales_segment", segment)
        .in("status", [...PENDING_STATUSES])
        .order("order_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as OrderRow[];
    },
    refetchInterval: 60_000,
  });

  const tiles = useMemo(() => {
    const today = new Date();
    return (orders ?? [])
      .map((o) => buildTile(o, today))
      .filter((t) => t.pending > 0)
      .sort(compareTiles);
  }, [orders]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return tiles;
    return tiles.filter(
      (t) =>
        t.order.order_number.toLowerCase().includes(term) ||
        t.order.customers?.name.toLowerCase().includes(term) ||
        t.order.customers?.code.toLowerCase().includes(term),
    );
  }, [tiles, search]);

  const totals = useMemo(
    () => ({
      orders: tiles.length,
      pendingDz: tiles.reduce((s, t) => s + t.pending, 0),
      value: tiles.reduce((s, t) => s + Number(t.order.net_amount || 0), 0),
    }),
    [tiles],
  );

  const summary = [
    `${totals.orders} order${totals.orders === 1 ? "" : "s"}`,
    `${fmtDz(totals.pendingDz)} Dz pending`,
    showPrices ? fmtRs(totals.value) : null,
    "most urgent first",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title={title} description={summary} icon={Truck}>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="awaiting-dispatch-search"
              placeholder="Order no. or customer"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </PageHeader>

        {error ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-destructive">
              Could not load orders: {(error as Error).message}
            </CardContent>
          </Card>
        ) : isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-56 animate-pulse rounded-2xl border border-border/60 bg-card" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
              <PackageCheck className="h-10 w-10 text-green-500" />
              <p className="font-medium">
                {tiles.length === 0 ? "Nothing is waiting for dispatch." : "No order matches that search."}
              </p>
              <p className="text-sm text-muted-foreground">
                {tiles.length === 0
                  ? "Every approved order has fully dispatched."
                  : "Try the order number or the customer name or code."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {visible.map((t) => (
              <OrderTile
                key={t.order.id}
                tile={t}
                showPrices={showPrices}
                canDispatch={canDispatch}
                ordersPath={ordersPath}
                dispatchPath={dispatchPath}
              />
            ))}
          </div>
        )}
      </div>
    </ERPLayout>
  );
}

interface OrderTileProps {
  tile: Tile;
  showPrices: boolean;
  canDispatch: boolean;
  ordersPath: string;
  dispatchPath: string;
}

function OrderTile({ tile: t, showPrices, canDispatch, ordersPath, dispatchPath }: OrderTileProps) {
  const o = t.order;
  const isPartial = o.status === "partially_dispatched";
  const dispatchReady = o.status === "ready" || isPartial;
  const daysToAutoCancel = AUTO_CANCEL_DAYS - t.ageDays;
  const showAutoCancel = !isPartial && t.ageDays >= AGE_WARN_DAYS;
  const dueTone = t.dueInDays === null ? "" : t.dueInDays < 0 ? "text-red-600 dark:text-red-400" : t.dueInDays <= DUE_SOON_DAYS ? "text-amber-600 dark:text-amber-400" : "";
  const ageTone = t.ageDays >= AGE_WARN_DAYS ? "text-amber-600 dark:text-amber-400" : "";

  return (
    <Card className={cn("flex flex-col border-l-4 shadow-card", EDGE_COLORS[t.urgency])}>
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-display text-base font-bold tracking-tight">{o.order_number}</div>
            <div className="truncate text-sm font-medium">{o.customers?.name ?? "Unknown customer"}</div>
            <div className="truncate text-xs text-muted-foreground">
              {o.customers?.city || o.customers?.code || ""}
            </div>
          </div>
          <Badge className={cn("shrink-0 text-white", STATUS_COLORS[o.status] || "bg-muted")}>
            {STATUS_LABELS[o.status] || o.status.replace(/_/g, " ")}
          </Badge>
        </div>

        <div className="flex items-baseline gap-1.5 tabular-nums">
          <span className="font-display text-3xl font-bold leading-none tracking-tight">{fmtDz(t.pending)}</span>
          <span className="text-sm text-muted-foreground">Dz pending of {fmtDz(t.ordered)}</span>
        </div>
        {isPartial && t.ordered > 0 && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-purple-500"
              style={{ width: `${Math.min(100, (t.dispatched / t.ordered) * 100)}%` }}
            />
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-border/60 pt-3 text-xs tabular-nums">
          <div>
            <dt className="text-muted-foreground">Expected dispatch</dt>
            <dd className={cn("font-semibold", dueTone)}>{dueLabel(t)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Ordered</dt>
            <dd className={cn("font-semibold", ageTone)}>
              {format(parseISO(o.order_date), "dd MMM")} · {t.ageDays} day{t.ageDays === 1 ? "" : "s"} ago
            </dd>
          </div>
          {showPrices && (
            <div>
              <dt className="text-muted-foreground">Value</dt>
              <dd className="font-semibold">{fmtRs(Number(o.net_amount || 0))}</dd>
            </div>
          )}
          {isPartial ? (
            <div>
              <dt className="text-muted-foreground">Dispatched so far</dt>
              <dd className="font-semibold">{fmtDz(t.dispatched)} Dz</dd>
            </div>
          ) : showAutoCancel ? (
            <div>
              <dt className="text-muted-foreground">Auto-cancel</dt>
              <dd className="font-semibold text-amber-600 dark:text-amber-400">
                {daysToAutoCancel > 0 ? `in ${daysToAutoCancel} day${daysToAutoCancel === 1 ? "" : "s"} if no dispatch` : "tonight if no dispatch"}
              </dd>
            </div>
          ) : (
            <div>
              <dt className="text-muted-foreground">Lines</dt>
              <dd className="font-semibold">{t.lines} item{t.lines === 1 ? "" : "s"}</dd>
            </div>
          )}
        </dl>

        <div className="mt-auto flex justify-end gap-2 pt-1">
          <Button asChild variant="outline" size="sm">
            <Link to={ordersPath}>Open</Link>
          </Button>
          {canDispatch && dispatchReady && (
            <Button asChild size="sm">
              <Link to={dispatchPath}>{isPartial ? "Dispatch balance" : "Create dispatch"}</Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
