// Freight voucher at gate out — shared definitions.
// Rules live in supabase/migrations/20261012130000_gate_pass_freight.sql: the
// office records the freight on a sales gate pass, the voucher (FV-…) is made
// by the database when the vehicle goes Out, and the cashier marks it paid.
// Every write goes through the gate_pass_freight_* functions.

import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { esc, printDocument } from "@/lib/printDocument";
import { gpDb } from "@/lib/gatePass";

export type FreightPayer = "company" | "customer" | "customer_vehicle";
export type FreightMode = "contractor_van" | "online_rickshaw" | "bike";
export type TransporterKind = "contractor" | "app";
export type FreightVoucherStatus = "unpaid" | "paid" | "cancelled";

export const PAYERS: { value: FreightPayer; label: string; description: string }[] = [
  { value: "company", label: "Company pays", description: "Hired vehicle — a voucher is made at gate out for the driver / contractor to collect cash" },
  { value: "customer", label: "Customer paid", description: "The customer paid the transport — no voucher" },
  { value: "customer_vehicle", label: "Customer's own vehicle", description: "The customer collected the stock — no voucher" },
];

export const MODES: { value: FreightMode; label: string }[] = [
  { value: "contractor_van", label: "Contractor van" },
  { value: "online_rickshaw", label: "Online rickshaw" },
  { value: "bike", label: "Bike" },
];

export const KINDS: { value: TransporterKind; label: string; description: string }[] = [
  { value: "contractor", label: "Contractor", description: "A known firm or person, paid per trip, trips settled together" },
  { value: "app", label: "App", description: "Bykea, InDrive, Careem… a different driver every ride; the ride number goes on the pass" },
];

export const payerLabel = (p: string | null | undefined) => PAYERS.find((x) => x.value === p)?.label ?? "Not recorded";
export const modeLabel = (m: string | null | undefined) => MODES.find((x) => x.value === m)?.label ?? (m ?? "");
export const kindLabel = (k: string | null | undefined) => KINDS.find((x) => x.value === k)?.label ?? (k ?? "");

export const VOUCHER_STATUS: Record<string, { label: string; variant: "warning" | "success" | "secondary" | "destructive" }> = {
  unpaid: { label: "Unpaid", variant: "warning" },
  paid: { label: "Paid", variant: "success" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};
export const voucherStatusMeta = (s: string | null | undefined) =>
  (s && VOUCHER_STATUS[s]) || { label: s ?? "—", variant: "secondary" as const };

export const fmtRs = (n: number | string | null | undefined) =>
  `Rs ${Number(n || 0).toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;

export type Transporter = {
  id: string;
  name: string;
  phone: string | null;
  kind: TransporterKind;
  default_mode: FreightMode;
  default_rate: number | null;
  is_active: boolean;
  remarks: string | null;
  created_at: string;
};

/** The freight the office entered on a pass (one row per sales pass). */
export type GatePassFreight = {
  gate_pass_id: string;
  payer: FreightPayer;
  mode: FreightMode | null;
  transporter_id: string | null;
  transporter_name: string | null;
  amount: number | null;
  booking_ref: string | null;
  note: string | null;
  updated_at: string;
};

export type FreightVoucher = {
  id: string;
  voucher_number: string;
  gate_pass_id: string;
  voucher_date: string;
  status: FreightVoucherStatus;
  mode: FreightMode;
  transporter_id: string | null;
  transporter_name: string;
  driver_name: string | null;
  driver_contact: string | null;
  vehicle_number: string | null;
  booking_ref: string | null;
  dispatch_numbers: string | null;
  customer_names: string | null;
  amount: number;
  note: string | null;
  paid_date: string | null;
  paid_at: string | null;
  paid_by: string | null;
  paid_amount: number | null;
  paid_photo_path: string | null;
  paid_remark: string | null;
  statement_id: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  replaces_voucher_id: string | null;
  created_at: string;
  gate_passes?: { pass_number: string } | null;
  payer_user?: { full_name: string | null } | null;
  gate_pass_freight_statements?: { statement_number: string } | null;
};

export const VOUCHER_SELECT =
  "*, gate_passes(pass_number), payer_user:app_users!gate_pass_freight_vouchers_paid_by_fkey(full_name)," +
  "gate_pass_freight_statements(statement_number)";

export type FreightStatement = {
  id: string;
  statement_number: string;
  transporter_id: string | null;
  transporter_name: string;
  paid_date: string;
  paid_by: string | null;
  total_amount: number;
  voucher_count: number;
  photo_path: string | null;
  remark: string | null;
  created_at: string;
  payer_user?: { full_name: string | null } | null;
};

export const STATEMENT_SELECT = "*, payer_user:app_users!gate_pass_freight_statements_paid_by_fkey(full_name)";

/** A row of v_gate_pass_freight_log: a sales pass with freight, and its live voucher. */
export type FreightLogRow = {
  gate_pass_id: string;
  pass_number: string;
  pass_date: string;
  pass_status: string;
  gate_out_at: string | null;
  out_date: string | null;
  party_name: string;
  vehicle_number: string | null;
  driver_name: string | null;
  driver_contact: string | null;
  dispatch_numbers: string | null;
  payer: FreightPayer;
  mode: FreightMode | null;
  transporter_id: string | null;
  transporter_name: string | null;
  amount: number | null;
  booking_ref: string | null;
  note: string | null;
  voucher_id: string | null;
  voucher_number: string | null;
  voucher_status: FreightVoucherStatus | null;
  voucher_date: string | null;
  paid_date: string | null;
  paid_amount: number | null;
  paid_by: string | null;
  statement_id: string | null;
  statement_number: string | null;
};

export const FREIGHT_EVENT_LABEL: Record<string, string> = {
  created: "Made at gate out",
  reissued: "Re-issued",
  corrected: "Corrected",
  paid: "Paid",
  cancelled: "Cancelled",
};

const CHUNK = 150;

/** Freight log rows keyed by gate pass id (for the dispatch pages' Freight column). */
export function useGatePassFreight(gatePassIds: string[]) {
  const ids = [...new Set(gatePassIds.filter(Boolean))].sort();
  const { data } = useQuery<Map<string, FreightLogRow>>({
    queryKey: ["gate-pass-freight-by-pass", ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const map = new Map<string, FreightLogRow>();
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { data: rows, error } = await gpDb
          .from("v_gate_pass_freight_log")
          .select("*")
          .in("gate_pass_id", ids.slice(i, i + CHUNK));
        // Missing until the migration is applied, or hidden from this role — show blanks.
        if (error) return map;
        (rows as FreightLogRow[]).forEach((r) => map.set(r.gate_pass_id, r));
      }
      return map;
    },
  });
  return data ?? new Map<string, FreightLogRow>();
}

// ---------------------------------------------------------------------------
// Amount in words (Pakistani grouping: thousand, lakh, crore)
// ---------------------------------------------------------------------------

const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

const below1000 = (n: number): string => {
  const parts: string[] = [];
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} hundred`); n %= 100; }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "")); }
  else if (n > 0) parts.push(ONES[n]);
  return parts.join(" ");
};

/** 125000 → "one lakh twenty-five thousand". Whole rupees only. */
export function rupeesInWords(amount: number): string {
  let n = Math.floor(Math.abs(Number(amount) || 0));
  if (n === 0) return "zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000); n %= 10_000_000;
  const lakh = Math.floor(n / 100_000); n %= 100_000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${below1000(crore)} crore`);
  if (lakh) parts.push(`${below1000(lakh)} lakh`);
  if (thousand) parts.push(`${below1000(thousand)} thousand`);
  if (n) parts.push(below1000(n));
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Printouts
// ---------------------------------------------------------------------------

const fmtDate = (s: string | null | undefined) => (s ? format(new Date(s), "dd MMM yyyy") : "");
const fmtDateTime = (s: string | null | undefined) => (s ? format(new Date(s), "dd MMM yyyy, HH:mm") : "");

const PRINT_CSS = `
  <style>
    .fv .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; font-size: 12px; margin-top: 12px; }
    .fv .amount { margin: 16px 0; padding: 12px 14px; border: 2px solid #111; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; }
    .fv .amount b { font-size: 22px; }
    .fv .words { font-size: 12px; font-style: italic; }
    .fv .sign { display: flex; gap: 16px; margin-top: 48px; }
    .fv .sign div { flex: 1; border-top: 1px solid #111; padding-top: 4px; font-size: 11px; text-align: center; }
    .fv table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    .fv th, .fv td { border: 1px solid #bbb; padding: 5px 8px; font-size: 11px; text-align: left; }
    .fv th { background: #f1f3f7; }
    .fv .right { text-align: right; }
    .fv .stamp { display: inline-block; padding: 2px 8px; border: 2px solid; border-radius: 4px; font-weight: 700; font-size: 12px; letter-spacing: .06em; }
  </style>`;

/** Print the freight voucher (A5-style) — the paper the driver / contractor collects cash against. */
export function printFreightVoucher(v: FreightVoucher, qrSvg: string) {
  const status = v.status === "paid" ? `<span class="stamp" style="color:#067647;border-color:#067647">PAID ${esc(fmtDate(v.paid_date))}</span>`
    : v.status === "cancelled" ? `<span class="stamp" style="color:#b42318;border-color:#b42318">CANCELLED</span>`
    : `<span class="stamp" style="color:#b54708;border-color:#b54708">UNPAID</span>`;
  const body = `${PRINT_CSS}
  <div class="wrap fv">
    <div class="head">
      <div>
        <h1>Cansport Global Industries</h1>
        <div class="bold" style="margin-top:8px; letter-spacing:.08em; font-size:15px">FREIGHT VOUCHER</div>
        <div style="margin-top:6px">${status}</div>
      </div>
      <div style="text-align:center">${qrSvg}<div class="xs muted">${esc(v.voucher_number)}</div></div>
    </div>
    <div class="facts">
      <div><span class="muted">Voucher no.</span> <b style="font-size:15px">${esc(v.voucher_number)}</b></div>
      <div><span class="muted">Date</span> <b>${esc(fmtDate(v.voucher_date))}</b></div>
      <div><span class="muted">Gate pass</span> <b>${esc(v.gate_passes?.pass_number ?? "")}</b></div>
      <div><span class="muted">Vehicle</span> <b>${esc(v.vehicle_number || "—")}</b></div>
      <div style="grid-column: span 2"><span class="muted">Dispatches</span> <b>${esc(v.dispatch_numbers || "—")}</b></div>
      <div style="grid-column: span 2"><span class="muted">Customer(s)</span> <b>${esc(v.customer_names || "—")}</b></div>
      <div><span class="muted">Mode</span> <b>${esc(modeLabel(v.mode))}</b></div>
      <div><span class="muted">Transporter</span> <b>${esc(v.transporter_name)}</b></div>
      <div><span class="muted">Driver</span> <b>${esc([v.driver_name, v.driver_contact].filter(Boolean).join(" · ") || "—")}</b></div>
      <div><span class="muted">Ride / booking ref</span> <b>${esc(v.booking_ref || "—")}</b></div>
      ${v.note ? `<div style="grid-column: span 2"><span class="muted">Note</span> ${esc(v.note)}</div>` : ""}
    </div>
    <div class="amount">
      <div>
        <div class="muted xs">PAY TO ${esc(v.transporter_name.toUpperCase())}</div>
        <div class="words">Rupees ${esc(rupeesInWords(v.amount))} only</div>
      </div>
      <b>${esc(fmtRs(v.amount))}</b>
    </div>
    ${v.status === "paid" ? `<div style="font-size:12px">Paid ${esc(fmtRs(v.paid_amount ?? v.amount))} on ${esc(fmtDate(v.paid_date))} by ${esc(v.payer_user?.full_name ?? "")}${v.gate_pass_freight_statements?.statement_number ? ` · statement ${esc(v.gate_pass_freight_statements.statement_number)}` : ""}${v.paid_remark ? ` · ${esc(v.paid_remark)}` : ""}</div>` : ""}
    ${v.status === "cancelled" ? `<div style="font-size:12px; color:#b42318">Cancelled ${esc(fmtDateTime(v.cancelled_at))}: ${esc(v.cancel_reason ?? "")}</div>` : ""}
    <div class="sign">
      <div>Received by (driver / transporter)<br>Name · CNIC / phone<br>&nbsp;</div>
      <div>Paid by (cashier)<br>&nbsp;<br>&nbsp;</div>
      <div>Checked by<br>&nbsp;<br>&nbsp;</div>
    </div>
    <p class="xs muted" style="text-align:center; margin-top:12px">Cash is paid against this voucher only. Made automatically when the vehicle left the gate.</p>
  </div>`;
  printDocument(v.voucher_number, body);
}

/** Print a contractor's payment statement: the trips paid together. */
export function printFreightStatement(s: FreightStatement, vouchers: FreightVoucher[]) {
  const rows = [...vouchers]
    .sort((a, b) => a.voucher_date.localeCompare(b.voucher_date) || a.voucher_number.localeCompare(b.voucher_number))
    .map((v, n) => `<tr>
      <td>${n + 1}</td>
      <td>${esc(fmtDate(v.voucher_date))}</td>
      <td>${esc(v.voucher_number)}</td>
      <td>${esc(v.gate_passes?.pass_number ?? "")}</td>
      <td>${esc(v.dispatch_numbers || "")}</td>
      <td>${esc(v.vehicle_number || "")}</td>
      <td>${esc(v.driver_name || "")}</td>
      <td class="right">${esc(fmtRs(v.amount))}</td>
    </tr>`).join("");
  const body = `${PRINT_CSS}
  <div class="wrap fv">
    <div class="head">
      <div>
        <h1>Cansport Global Industries</h1>
        <div class="bold" style="margin-top:8px; letter-spacing:.08em; font-size:15px">FREIGHT PAYMENT STATEMENT</div>
      </div>
      <div style="text-align:right">
        <div><b style="font-size:15px">${esc(s.statement_number)}</b></div>
        <div class="xs muted">Paid ${esc(fmtDate(s.paid_date))}</div>
      </div>
    </div>
    <div class="facts">
      <div><span class="muted">Transporter</span> <b>${esc(s.transporter_name)}</b></div>
      <div><span class="muted">Trips</span> <b>${s.voucher_count}</b></div>
      <div><span class="muted">Paid by</span> <b>${esc(s.payer_user?.full_name ?? "")}</b></div>
      ${s.remark ? `<div><span class="muted">Remark</span> ${esc(s.remark)}</div>` : ""}
    </div>
    <table>
      <thead><tr><th>#</th><th>Date</th><th>Voucher</th><th>Gate pass</th><th>Dispatches</th><th>Vehicle</th><th>Driver</th><th class="right">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="7" class="right"><b>Total</b></td><td class="right"><b>${esc(fmtRs(s.total_amount))}</b></td></tr></tfoot>
    </table>
    <div class="amount">
      <div><div class="muted xs">PAID TO ${esc(s.transporter_name.toUpperCase())}</div><div class="words">Rupees ${esc(rupeesInWords(s.total_amount))} only</div></div>
      <b>${esc(fmtRs(s.total_amount))}</b>
    </div>
    <div class="sign">
      <div>Received by (transporter)<br>Name · CNIC / phone<br>&nbsp;</div>
      <div>Paid by (cashier)<br>&nbsp;<br>&nbsp;</div>
      <div>Checked by<br>&nbsp;<br>&nbsp;</div>
    </div>
  </div>`;
  printDocument(s.statement_number, body);
}
