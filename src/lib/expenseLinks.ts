// Expense Account Links: operational expense sources (petty cash categories,
// staff trip fuel) linked to the ledger accounts their cash payments are posted
// to, and the reconciliation of the two. Rules live in the database:
// supabase/migrations/20261013120000_expense_account_links.sql. Every write goes
// through expense_account_link_save / _delete; the reconciliation is read-only.

import { format, startOfMonth, endOfMonth, startOfYear, endOfYear, subYears, subDays } from "date-fns";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// The link table and the reconciliation function are not in the generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const elDb = supabase as any;

export type LinkSourceType = "petty_cash_category" | "trip_fuel";

/** Reference of the Staff Trip Fuel source in a reconciliation row's source_refs. */
export const TRIP_FUEL_REF = "trip_fuel:staff_trip_fuel";
export const TRIP_FUEL_KEY = "staff_trip_fuel";

export const LINK_EDIT_ROLES = ["super_admin", "accounting_manager"];

export const KEYS = {
  links: "expense-account-links",
  recon: "expense-link-reconciliation",
  accounts: "expense-link-accounts",
  categories: "expense-link-petty-categories",
};

export const invalidateExpenseLinkQueries = (qc: QueryClient) =>
  Object.values(KEYS).forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

export type AccountRef = { code: string; name: string } | null;

export type ExpenseLink = {
  id: string;
  source_type: LinkSourceType;
  source_key: string;
  source_label: string;
  expense_account_id: string;
  funding_account_id: string | null;
  tolerance: number;
  compare_from: string | null;
  is_active: boolean;
  notes: string | null;
  updated_at: string;
  expense_account: AccountRef;
  funding_account: AccountRef;
};

export const useExpenseLinks = () =>
  useQuery<ExpenseLink[]>({
    queryKey: [KEYS.links],
    queryFn: async () => {
      const { data, error } = await elDb
        .from("expense_account_links")
        .select(
          "id, source_type, source_key, source_label, expense_account_id, funding_account_id, tolerance, compare_from, is_active, notes, updated_at," +
          "expense_account:accounting_chart_of_accounts!expense_account_links_expense_account_id_fkey(code, name)," +
          "funding_account:accounting_chart_of_accounts!expense_account_links_funding_account_id_fkey(code, name)",
        )
        .order("source_label");
      if (error) throw error;
      return (data ?? []).map((l: ExpenseLink) => ({ ...l, tolerance: Number(l.tolerance) }));
    },
  });

export type CoaAccount = { id: string; code: string; name: string; account_type: string; sub_category: string | null };

/** Active expense accounts and active asset (cash / bank) accounts of the chart of accounts. */
export const useLinkAccounts = () =>
  useQuery<{ expense: CoaAccount[]; funding: CoaAccount[] }>({
    queryKey: [KEYS.accounts],
    queryFn: async () => {
      const { data, error } = await elDb
        .from("accounting_chart_of_accounts")
        .select("id, code, name, account_type, sub_category")
        .eq("is_active", true)
        .in("account_type", ["expense", "asset"])
        .order("code");
      if (error) throw error;
      const rows = (data ?? []) as CoaAccount[];
      return {
        expense: rows.filter((a) => a.account_type === "expense"),
        funding: rows.filter((a) => a.account_type === "asset" && ["Cash", "Bank"].includes(a.sub_category ?? "")),
      };
    },
  });

export type PettyCategory = { id: string; code: string; name: string };

export const usePettyCashCategories = () =>
  useQuery<PettyCategory[]>({
    queryKey: [KEYS.categories],
    queryFn: async () => {
      const { data, error } = await elDb
        .from("expense_categories")
        .select("id, code, name")
        .eq("category_type", "petty_cash")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

export type ReconStatus = "matched" | "warning" | "no_link";

export type ReconRow = {
  row_kind: "linked" | "unlinked";
  expense_account_id: string | null;
  expense_account_code: string | null;
  expense_account_name: string | null;
  funding_account_id: string | null;
  funding_account_code: string | null;
  month: string;
  source_refs: string[];
  source_labels: string[];
  link_ids: string[] | null;
  source_amount: number;
  source_count: number;
  gl_amount: number | null;
  gl_count: number;
  difference: number | null;
  tolerance: number | null;
  status: ReconStatus;
};

export const useReconciliation = (from: string, to: string, enabled = true) =>
  useQuery<ReconRow[]>({
    queryKey: [KEYS.recon, from, to],
    enabled,
    queryFn: async () => {
      const { data, error } = await elDb.rpc("expense_link_reconciliation", { p_from: from, p_to: to });
      if (error) throw error;
      return (data ?? []).map((r: ReconRow) => ({
        ...r,
        source_amount: Number(r.source_amount ?? 0),
        source_count: Number(r.source_count ?? 0),
        gl_amount: r.gl_amount == null ? null : Number(r.gl_amount),
        gl_count: Number(r.gl_count ?? 0),
        difference: r.difference == null ? null : Number(r.difference),
        tolerance: r.tolerance == null ? null : Number(r.tolerance),
      }));
    },
  });

export const STATUS_LABEL: Record<ReconStatus, string> = {
  matched: "Matched",
  warning: "Difference",
  no_link: "Not linked",
};

export type ReconGroup = {
  key: string;
  kind: "linked" | "unlinked";
  accountCode: string | null;
  accountName: string | null;
  fundingCode: string | null;
  labels: string[];
  refs: string[];
  sourceAmount: number;
  glAmount: number;
  difference: number;
  tolerance: number;
  warningMonths: number;
  months: ReconRow[];
  status: ReconStatus;
};

/** Group reconciliation rows by account (or by unlinked source) with period totals. */
export function groupReconciliation(rows: ReconRow[]): ReconGroup[] {
  const map = new Map<string, ReconGroup>();
  rows.forEach((r) => {
    const key = r.row_kind === "linked" ? `L:${r.expense_account_id}:${r.funding_account_id ?? ""}` : `U:${r.source_refs.join(",")}`;
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        kind: r.row_kind,
        accountCode: r.expense_account_code,
        accountName: r.expense_account_name,
        fundingCode: r.funding_account_code,
        labels: r.source_labels,
        refs: r.source_refs,
        sourceAmount: 0,
        glAmount: 0,
        difference: 0,
        tolerance: r.tolerance ?? 0,
        warningMonths: 0,
        months: [],
        status: r.row_kind === "linked" ? "matched" : "no_link",
      };
      map.set(key, g);
    }
    g.months.push(r);
    g.sourceAmount += r.source_amount;
    g.glAmount += r.gl_amount ?? 0;
    g.difference += r.difference ?? 0;
    if (r.status === "warning") g.warningMonths += 1;
  });
  map.forEach((g) => {
    if (g.kind === "linked") g.status = g.warningMonths > 0 ? "warning" : "matched";
  });
  return [...map.values()].sort((a, b) => (a.accountCode ?? "￿").localeCompare(b.accountCode ?? "￿") || a.labels.join().localeCompare(b.labels.join()));
}

export const reconSummary = (rows: ReconRow[]) => ({
  warnings: rows.filter((r) => r.status === "warning").length,
  unlinked: new Set(rows.filter((r) => r.status === "no_link").map((r) => r.source_refs.join(","))).size,
  matched: rows.filter((r) => r.status === "matched").length,
});

/** Plain-language reading of a difference (source minus ledger). */
export const differenceText = (diff: number | null, tolerance: number | null) => {
  if (diff == null || Math.abs(diff) <= (tolerance ?? 0)) return "";
  return diff > 0
    ? `Recorded Rs ${Math.round(diff).toLocaleString()} more than the ledger shows. Not posted yet, or posted to another account.`
    : `Ledger shows Rs ${Math.round(-diff).toLocaleString()} more than was recorded. Posted twice, or from another source.`;
};

// ---- Date presets (same set as the Expenses Analysis report) -----------------------

export const PRESETS = [
  { key: "this_month", label: "This Month" },
  { key: "last_90", label: "Last 90 Days" },
  { key: "ytd", label: "Year to Date" },
  { key: "this_year", label: "This Year" },
  { key: "last_year", label: "Last Year" },
  { key: "custom", label: "Custom" },
];

export function applyPreset(key: string): { from: string; to: string } {
  const now = new Date();
  const iso = (d: Date) => format(d, "yyyy-MM-dd");
  switch (key) {
    case "this_month": return { from: iso(startOfMonth(now)), to: iso(endOfMonth(now)) };
    case "last_90": return { from: iso(subDays(now, 89)), to: iso(now) };
    case "ytd": return { from: iso(startOfYear(now)), to: iso(now) };
    case "this_year": return { from: iso(startOfYear(now)), to: iso(endOfYear(now)) };
    case "last_year": { const ly = subYears(now, 1); return { from: iso(startOfYear(ly)), to: iso(endOfYear(ly)) }; }
    default: return { from: iso(startOfYear(now)), to: iso(endOfYear(now)) };
  }
}

// ---- Suggest an account by name ---------------------------------------------------------

const STOP = new Set(["exp", "expense", "expenses", "payment", "charges", "charge"]);
const normalise = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w && !STOP.has(w)).join(" ");

/** The expense account whose name equals the label once "Exp" / "Expense" are dropped, or null. */
export function suggestExpenseAccount(label: string, accounts: CoaAccount[]): CoaAccount | null {
  const target = normalise(label);
  if (!target) return null;
  const hits = accounts.filter((a) => normalise(a.name) === target);
  return hits.length === 1 ? hits[0] : null;
}

/** Calendar date (yyyy-MM-dd) of a timestamp in Pakistan time, the way the reconciliation dates an approved voucher. */
export const pkDate = (ts: string | null | undefined) =>
  ts ? new Date(ts).toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" }) : "";
