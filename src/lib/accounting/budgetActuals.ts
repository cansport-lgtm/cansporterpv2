// Shared helpers for the accounting budget feature: the list of months a
// budget covers, and ledger actuals per account per month derived from
// accounting_voucher_lines (same source the Trial Balance aggregates).
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "./fetchAllRows";

const sb = supabase as any;

export interface BudgetPeriod {
  year: number;
  month: number; // 1-12
}

export interface BudgetHeader {
  id: string;
  name: string;
  fiscal_year_label: string;
  start_year: number;
  start_month: number;
  num_months: number;
  status: "draft" | "active" | "closed";
  notes: string | null;
  approved_by: string | null;
  approved_at: string | null;
}

/** Ordered list of {year, month} periods covered by a budget header. */
export function budgetMonths(b: Pick<BudgetHeader, "start_year" | "start_month" | "num_months">): BudgetPeriod[] {
  return Array.from({ length: b.num_months }, (_, i) => {
    const idx = b.start_month - 1 + i;
    return { year: b.start_year + Math.floor(idx / 12), month: (idx % 12) + 1 };
  });
}

export const periodKey = (p: BudgetPeriod) => `${p.year}-${String(p.month).padStart(2, "0")}`;

export const monthLabel = (p: BudgetPeriod) => format(new Date(p.year, p.month - 1, 1), "MMM yy");

export const monthLabelLong = (p: BudgetPeriod) => format(new Date(p.year, p.month - 1, 1), "MMMM yyyy");

export const periodStartDate = (p: BudgetPeriod) => `${periodKey(p)}-01`;

export const periodEndDate = (p: BudgetPeriod) =>
  format(new Date(p.year, p.month, 0), "yyyy-MM-dd");

/**
 * Sum voucher lines per account per month between two dates (inclusive).
 * Returns a Map keyed `${account_id}|${yyyy-MM}` -> { dr, cr }. Matches the
 * Trial Balance: all vouchers in accounting_vouchers count, no status filter.
 */
export async function fetchMonthlyLedgerTotals(
  fromDate: string,
  toDate: string,
): Promise<Map<string, { dr: number; cr: number }>> {
  const lines = await fetchAllRows((from, to) =>
    sb
      .from("accounting_voucher_lines")
      .select("account_id, debit_amount, credit_amount, voucher:accounting_vouchers!inner(voucher_date)")
      .gte("voucher.voucher_date", fromDate)
      .lte("voucher.voucher_date", toDate)
      .order("id", { ascending: true })
      .range(from, to));
  const map = new Map<string, { dr: number; cr: number }>();
  lines.forEach((l: any) => {
    const d: string = l.voucher?.voucher_date || "";
    if (!d) return;
    const key = `${l.account_id}|${d.slice(0, 7)}`;
    const cur = map.get(key) || { dr: 0, cr: 0 };
    cur.dr += Number(l.debit_amount || 0);
    cur.cr += Number(l.credit_amount || 0);
    map.set(key, cur);
  });
  return map;
}

export const actualKey = (accountId: string, p: BudgetPeriod) => `${accountId}|${periodKey(p)}`;

/**
 * Ledger activity as a positive "actual" for budget comparison:
 * expenses grow with debits, revenue grows with credits.
 */
export function signedActual(accountType: string, dr: number, cr: number): number {
  return accountType === "revenue" ? cr - dr : dr - cr;
}
