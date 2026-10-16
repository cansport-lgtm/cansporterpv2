import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/**
 * Server-side windowed list for the Sales Order pages.
 *
 * The old pages downloaded every order ever created plus every order line in
 * two dependent requests, then filtered and rendered the lot in the browser.
 * This hook pushes the work to PostgREST instead:
 *
 *  - one request returns the orders WITH their lines embedded
 *    (`sales_order_items(...)`), so there is no second round trip and no
 *    26 KB `in(...)` URL built from every order id;
 *  - search, status and period are query filters, not `Array.filter`;
 *  - only `limit` rows come down; "Load more" grows the window.
 *
 * Browsing is windowed to a period (default 90 days). A search term spans
 * all time so an old order can always be found by number or customer.
 */

export type SalesOrderSegment = "private_label" | "domestic";
export type SalesOrderPeriod = "30" | "90" | "365" | "all";

export const SALES_ORDER_PERIOD_OPTIONS: { value: SalesOrderPeriod; label: string }[] = [
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last 12 months" },
  { value: "all", label: "All time" },
];

export const SALES_ORDERS_PAGE_SIZE = 50;

type Tables = Database["public"]["Tables"];

/** One order line as embedded on a list row. */
export type SalesOrderLine = Tables["sales_order_items"]["Row"] & {
  products: Pick<Tables["products"]["Row"], "code" | "name"> | null;
};

/** One row of the windowed order list. */
export type SalesOrderListRow = Tables["sales_orders"]["Row"] & {
  customers: Pick<Tables["customers"]["Row"], "name" | "code" | "logo_url" | "billing_customer"> | null;
  created_by_user: Pick<Tables["app_users"]["Row"], "full_name"> | null;
  sales_order_items: SalesOrderLine[];
};

/** Limit how many customer ids go into the `customer_id.in.(...)` filter. */
const MAX_CUSTOMER_MATCHES = 200;

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

/**
 * PostgREST `or=(...)` filters are comma separated and use `*` as the LIKE
 * wildcard, so strip the characters that would break out of the value.
 */
function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,()"'\\*%]/g, " ").replace(/\s+/g, " ").trim();
}

const ORDER_LIST_SELECT = `
  *,
  customers(name, code, logo_url, billing_customer),
  created_by_user:app_users!sales_orders_created_by_fkey(full_name),
  sales_order_items(*, products(code, name))
`;

export interface UseSalesOrdersListArgs {
  segment: SalesOrderSegment;
  search: string;
  status: string;
  period: SalesOrderPeriod;
}

export function useSalesOrdersList({ segment, search, status, period }: UseSalesOrdersListArgs) {
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const [limit, setLimit] = useState(SALES_ORDERS_PAGE_SIZE);

  // A new filter starts a fresh window.
  useEffect(() => {
    setLimit(SALES_ORDERS_PAGE_SIZE);
  }, [segment, debouncedSearch, status, period]);

  const query = useQuery({
    // Keep the `['sales-orders', segment]` prefix: every mutation on the order
    // pages invalidates that prefix to refresh the list.
    queryKey: ["sales-orders", segment, { search: debouncedSearch, status, period, limit }],
    queryFn: async () => {
      const term = sanitizeSearchTerm(debouncedSearch);

      let q = supabase
        .from("sales_orders")
        .select(ORDER_LIST_SELECT, { count: "exact" })
        .eq("sales_segment", segment);

      if (status !== "all") {
        q = q.eq("status", status);
      }

      if (term) {
        // Customer name/code lives on another table, so resolve the matching
        // customers first (tiny table) and OR their ids in with the order number.
        const { data: matches, error: customerError } = await supabase
          .from("customers")
          .select("id")
          .eq("sales_segment", segment)
          .or(`name.ilike.*${term}*,code.ilike.*${term}*`)
          .limit(MAX_CUSTOMER_MATCHES);
        if (customerError) throw customerError;

        const clauses = [`order_number.ilike.*${term}*`];
        if (matches && matches.length > 0) {
          clauses.push(`customer_id.in.(${matches.map((c) => c.id).join(",")})`);
        }
        q = q.or(clauses.join(","));
      } else if (period !== "all") {
        const from = format(subDays(new Date(), Number(period)), "yyyy-MM-dd");
        q = q.gte("order_date", from);
      }

      const { data, error, count } = await q
        .order("created_at", { ascending: false })
        .order("id", { referencedTable: "sales_order_items", ascending: true })
        .range(0, limit - 1);

      if (error) throw error;
      const orders = (data ?? []) as unknown as SalesOrderListRow[];
      return { orders, total: count ?? orders.length };
    },
    // Growing the window or typing a search keeps the current rows on screen
    // instead of flashing "Loading...".
    placeholderData: keepPreviousData,
  });

  const orders: SalesOrderListRow[] = query.data?.orders ?? [];
  const total = query.data?.total ?? 0;

  return {
    orders,
    total,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    hasMore: orders.length < total,
    loadMore: () => setLimit((current) => current + SALES_ORDERS_PAGE_SIZE),
    /** True while a search term is active (the period filter is then ignored). */
    isSearching: debouncedSearch.length > 0,
  };
}
