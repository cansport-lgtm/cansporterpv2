// Shared definitions for the grade-wise stage ledger (Coly → Jorr → Ball).
// The ledger itself is derived in the database: see
// supabase/migrations/20260926120000_grade_stage_ledger.sql.

export type LedgerBucket = "COLY" | "JORR" | "BALL";

export const LEDGER_BUCKETS: { value: LedgerBucket; label: string; from: string }[] = [
  { value: "COLY", label: "Coly", from: "Press" },
  { value: "JORR", label: "Jorr", from: "Jorr" },
  { value: "BALL", label: "Ball", from: "Final + Fancy Final" },
];

export const bucketLabel = (b: string) => LEDGER_BUCKETS.find((x) => x.value === b)?.label ?? b;

// The bucket a production department's entries consume from (1 bag in → 1 bag
// out, OK + rejected). Departments not listed consume nothing from the ledger.
export const CONSUMES_FROM: Record<string, LedgerBucket> = {
  JORR: "COLY",
  LOCAL_FINAL: "JORR",
  FANCY_FINAL: "JORR",
};

export const CUTOVER_OPTIONS = ["2026-09-01", "2026-10-01"];

export const LEDGER_SOURCE: Record<
  string,
  { label: string; variant: "soft" | "info" | "warning" | "success" | "destructive" | "secondary" }
> = {
  opening: { label: "Opening", variant: "secondary" },
  production: { label: "Production", variant: "success" },
  consumption: { label: "Consumed", variant: "info" },
  adjustment: { label: "Adjustment", variant: "destructive" },
  regrade_in: { label: "Regrade in", variant: "warning" },
  regrade_out: { label: "Regrade out", variant: "warning" },
  packing_transfer: { label: "To packing", variant: "soft" },
};

export const DEPARTMENT_LABEL: Record<string, string> = {
  PRESS: "Press",
  JORR: "Jorr",
  LOCAL_FINAL: "Local Final",
  FANCY_FINAL: "Fancy Final",
};

export const fmtQty = (n: number | null | undefined) =>
  Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export type LedgerAvailability =
  | { enabled: false }
  | {
      enabled: true;
      posted_balance: number;
      pending_drafts: number;
      available: number;
      block: boolean;
      block_negative_from: string;
    };

export type LedgerSettings = {
  cutover_date: string;
  block_negative_from: string;
  opening_locked: boolean;
  updated_at: string;
};
