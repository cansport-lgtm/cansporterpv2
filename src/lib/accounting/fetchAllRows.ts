const PAGE_SIZE = 1000;

/**
 * Fetch *every* row of a PostgREST query, paging past the API row cap.
 *
 * Supabase/PostgREST limits a single response to ~1000 rows (`max-rows`). Any
 * report that loads all voucher lines for a period and sums them client-side
 * therefore silently UNDER-reports once the period exceeds that cap — the
 * extra rows are dropped with no error. This helper pages through the full
 * result set with `.range()` and concatenates the batches.
 *
 * `build(from, to)` must return a Supabase query builder already scoped with
 * its filters AND a stable `.order(...)` (so pages neither overlap nor skip
 * rows). Example:
 *
 *   const rows = await fetchAllRows((from, to) =>
 *     sb.from("accounting_voucher_lines")
 *       .select("account_id, debit_amount, credit_amount, voucher:accounting_vouchers!inner(voucher_date)")
 *       .gte("voucher.voucher_date", fromDate)
 *       .lte("voucher.voucher_date", toDate)
 *       .order("id", { ascending: true })
 *       .range(from, to));
 */
export async function fetchAllRows<T = any>(
  build: (from: number, to: number) => any,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  // Page until a short batch signals the end.
  for (;;) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data || []) as T[];
    out.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}
