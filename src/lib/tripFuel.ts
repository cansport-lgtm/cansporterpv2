// Staff Trip Fuel: the fuel claim and cash voucher raised on an official duty
// staff gate pass. Rules live in the database:
// supabase/migrations/20261006120000_staff_trip_fuel.sql. Every write goes
// through the staff_trip_fuel_* functions; the tables are read-only here.

import { format } from "date-fns";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { esc, printDocument } from "@/lib/printDocument";
import { fmtDT, ppDb, type PersonGatePass } from "@/lib/personGatePass";

export type TripFuelStatus = "pending_approval" | "approved" | "paid" | "rejected" | "cancelled";

export const FUEL_STATUS_META: Record<TripFuelStatus, { label: string; variant: "warning" | "success" | "destructive" | "secondary" | "info" | "soft" }> = {
  pending_approval: { label: "Awaiting approval", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
  // Vouchers marked paid before approval became final; they count as approved.
  paid: { label: "Approved", variant: "success" },
  rejected: { label: "Rejected", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

export const fuelStatusMeta = (s: string) => FUEL_STATUS_META[s as TripFuelStatus] ?? { label: s, variant: "secondary" as const };

/** Approval (by an HR manager or a staff gate pass approver) is final: there is no separate "mark paid" step. */
export const FUEL_APPROVE_ROLES = ["super_admin", "hr_manager", "staff_gate_pass_approver"];
/** Cancelling someone else's claim, or any approved voucher, stays with HR. */
export const FUEL_HR_ROLES = ["super_admin", "hr_manager"];

const APPROVER_ROLE_LABEL: Record<string, string> = {
  hr_manager: "HR Manager",
  staff_gate_pass_approver: "Staff Gate Pass Approver",
  super_admin: "Super Admin",
};
/** The capacity the voucher was approved / rejected in; vouchers reviewed before it was recorded were HR. */
export const approverRoleLabel = (v: Pick<TripFuelVoucher, "approved_as" | "approved_at">) =>
  v.approved_at ? (v.approved_as ? APPROVER_ROLE_LABEL[v.approved_as] ?? v.approved_as : "HR") : "";
/** "Ali Khan (Staff Gate Pass Approver)" */
export const approverName = (v: TripFuelVoucher) =>
  v.approver?.full_name ? `${v.approver.full_name}${approverRoleLabel(v) ? ` (${approverRoleLabel(v)})` : ""}` : "";
/** A claim the user raised or one for themselves: they cannot approve it (super admin excepted, as in the database). */
export const isOwnFuelClaim = (v: TripFuelVoucher, appUserId: string | undefined) =>
  Boolean(appUserId) && (v.created_by === appUserId || v.person?.app_user_id === appUserId);
/** Statuses that count as approved fuel (paid is an older status for the same thing). */
export const isApprovedFuel = (status: string) => status === "approved" || status === "paid";
/** Statuses offered in filters; "approved" covers the older paid ones too. */
export const FUEL_FILTER_STATUSES: TripFuelStatus[] = ["pending_approval", "approved", "rejected", "cancelled"];
export const FUEL_SETTINGS_ROLES = ["super_admin"];

export type TripFuelVoucher = {
  id: string;
  voucher_number: string;
  pass_id: string;
  employee_id: string;
  trip_date: string;
  destination: string | null;
  purpose: string | null;
  route: string | null;
  start_km: number | null;
  end_km: number | null;
  manual_km: number | null;
  km: number;
  rate_per_km: number;
  amount: number;
  odometer_photo_url: string | null;
  notes: string | null;
  status: TripFuelStatus;
  created_by: string | null;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  approved_as: string | null;
  approval_remarks: string | null;
  paid_by: string | null;
  paid_at: string | null;
  paid_remarks: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  person?: { employee_code: string; full_name: string; photo_url: string | null; app_user_id?: string | null; production_departments?: { name: string } | null } | null;
  pass?: { pass_number: string; gate_out_at: string | null; gate_in_at: string | null } | null;
  creator?: { full_name: string | null } | null;
  approver?: { full_name: string | null } | null;
  payer?: { full_name: string | null } | null;
};

export const FUEL_SELECT =
  "*," +
  "person:employees(employee_code, full_name, photo_url, app_user_id, production_departments(name))," +
  "pass:staff_gate_passes(pass_number, gate_out_at, gate_in_at)," +
  "creator:app_users!staff_trip_fuel_vouchers_created_by_fkey(full_name)," +
  "approver:app_users!staff_trip_fuel_vouchers_approved_by_fkey(full_name)," +
  "payer:app_users!staff_trip_fuel_vouchers_paid_by_fkey(full_name)";

export const FUEL_KEYS = {
  byPass: "staff-trip-fuel-by-pass",
  list: "staff-trip-fuel-list",
  pending: "staff-trip-fuel-pending",
  settings: "staff-trip-fuel-settings",
  lastEndKm: "staff-trip-fuel-last-end-km",
  events: "staff-trip-fuel-events",
  travelAllowed: "staff-trip-fuel-travel-allowed",
  mine: "staff-trip-fuel-mine",
};

export function invalidateTripFuelQueries(queryClient: QueryClient) {
  Object.values(FUEL_KEYS).forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
  queryClient.invalidateQueries({ queryKey: ["staff-gate-passes"] });
}

export type TripFuelSettings = { fuel_rate_per_km: number; fuel_max_km_per_trip: number };

/** Flat rate per km and the per-trip ceiling (staff_gate_pass_settings). */
export function useTripFuelSettings() {
  return useQuery<TripFuelSettings | null>({
    queryKey: [FUEL_KEYS.settings],
    queryFn: async () => {
      const { data, error } = await ppDb.from("staff_gate_pass_settings").select("fuel_rate_per_km, fuel_max_km_per_trip").maybeSingle();
      if (error) return null;
      return data ?? null;
    },
  });
}

/** The live voucher on a pass (pending, approved or paid), or null. */
export function useTripFuelVoucher(passId: string | undefined) {
  return useQuery<TripFuelVoucher | null>({
    queryKey: [FUEL_KEYS.byPass, passId],
    enabled: Boolean(passId),
    queryFn: async () => {
      const { data, error } = await ppDb
        .from("staff_trip_fuel_vouchers")
        .select(FUEL_SELECT)
        .eq("pass_id", passId)
        .in("status", ["pending_approval", "approved", "paid"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return data ?? null;
    },
  });
}

/** The last end-odometer reading claimed by this staff member (to warn on a lower start). */
export function useLastEndKm(employeeId: string | undefined) {
  return useQuery<number | null>({
    queryKey: [FUEL_KEYS.lastEndKm, employeeId],
    enabled: Boolean(employeeId),
    queryFn: async () => {
      const { data, error } = await ppDb
        .from("staff_trip_fuel_vouchers")
        .select("end_km")
        .eq("employee_id", employeeId)
        .in("status", ["pending_approval", "approved", "paid"])
        .not("end_km", "is", null)
        .order("trip_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !data) return null;
      return data.end_km == null ? null : Number(data.end_km);
    },
  });
}

/** Whether the staff member is paid travel allowance (employees.travel_allowance_allowed): only they can claim trip fuel. */
export function useTravelAllowanceAllowed(employeeId: string | undefined) {
  return useQuery<boolean | null>({
    queryKey: [FUEL_KEYS.travelAllowed, employeeId],
    enabled: Boolean(employeeId),
    queryFn: async () => {
      const { data, error } = await ppDb.from("employees").select("travel_allowance_allowed").eq("id", employeeId).maybeSingle();
      if (error || !data) return null;
      return Boolean(data.travel_allowance_allowed);
    },
  });
}

export const fmtKm = (n: number | null | undefined) => (n == null ? "—" : `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`);
export const fmtRs = (n: number | null | undefined) => (n == null ? "—" : `Rs ${Math.round(Number(n)).toLocaleString()}`);

type VoucherPass = Pick<PersonGatePass, "pass_number" | "gate_out_at" | "gate_in_at">;

// Two vouchers to an A4 sheet, each in a fixed half with a cut line between them.
const TFV_PRINT_CSS = `
  @page { size: A4; margin: 8mm; }
  body { padding: 0; }
  .tfv-sheet { height: 281mm; display: flex; flex-direction: column; page-break-after: always; break-after: page; }
  .tfv-sheet:last-child { page-break-after: auto; break-after: auto; }
  .tfv-slot { height: 50%; overflow: hidden; padding: 4mm 0; }
  .tfv-slot + .tfv-slot { border-top: 1px dashed #999; }
  .tfv { max-width: 560px; margin: 0 auto; border: 1px solid #999; padding: 12px 16px; }
  .tfv .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; font-size: 11px; margin-top: 8px; }
  .tfv .amount { margin-top: 10px; border: 2px solid #111; padding: 8px 12px; display: flex; justify-content: space-between; align-items: baseline; }
  .tfv .amount b { font-size: 20px; }
  .tfv .sign { display: flex; gap: 12px; margin-top: 30px; }
  .tfv .sign div { flex: 1; border-top: 1px solid #111; padding-top: 4px; font-size: 9px; text-align: center; }
`;

function tripFuelVoucherHtml(v: TripFuelVoucher, pass?: VoucherPass | null) {
  const p = pass ?? v.pass;
  const status = fuelStatusMeta(v.status).label;
  return `
  <div class="tfv">
    <div class="head" style="margin-bottom:6px; padding-bottom:6px">
      <div>
        <h1 style="font-size:15px">Cansport Global Industries</h1>
        <div class="bold" style="margin-top:4px; letter-spacing:.08em; font-size:12px">TRIP FUEL · CASH PAYMENT VOUCHER</div>
        ${v.status === "pending_approval" ? `<div class="bold" style="color:#b45309">NOT APPROVED YET — NOT PAYABLE</div>` : ""}
        ${v.status === "rejected" || v.status === "cancelled" ? `<div class="bold" style="color:#b42318">${esc(status.toUpperCase())} — NOT PAYABLE</div>` : ""}
      </div>
      <div style="text-align:right">
        <div class="bold" style="font-size:15px">${esc(v.voucher_number)}</div>
        <div class="xs muted">${esc(format(new Date(v.trip_date), "dd MMM yyyy"))}</div>
      </div>
    </div>
    <div>
      <div class="big" style="font-size:16px; font-weight:700">${esc(v.person?.full_name ?? "")}</div>
      <div class="muted">${esc(v.person?.employee_code ?? "")}${v.person?.production_departments?.name ? ` · ${esc(v.person.production_departments.name)}` : ""}</div>
    </div>
    <div class="facts">
      <div><span class="muted">Gate pass</span> <b>${esc(p?.pass_number ?? "")}</b></div>
      <div><span class="muted">Trip date</span> <b>${esc(format(new Date(v.trip_date), "dd MMM yyyy"))}</b></div>
      ${p?.gate_out_at ? `<div><span class="muted">Out</span> <b>${esc(fmtDT(p.gate_out_at))}</b></div>` : ""}
      ${p?.gate_in_at ? `<div><span class="muted">In</span> <b>${esc(fmtDT(p.gate_in_at))}</b></div>` : ""}
      ${v.destination ? `<div><span class="muted">Destination</span> <b>${esc(v.destination)}</b></div>` : ""}
      ${v.purpose ? `<div><span class="muted">Purpose</span> <b>${esc(v.purpose)}</b></div>` : ""}
      <div style="grid-column: span 2"><span class="muted">Route / areas</span> <b>${esc(v.route ?? "")}</b></div>
      ${v.start_km != null
        ? `<div><span class="muted">Odometer</span> <b>${esc(Number(v.start_km).toLocaleString())} → ${esc(Number(v.end_km).toLocaleString())}</b></div>`
        : `<div><span class="muted">Kilometres</span> <b>entered by hand</b></div>`}
      <div><span class="muted">Distance</span> <b>${esc(fmtKm(v.km))}</b></div>
      <div><span class="muted">Rate</span> <b>Rs ${esc(Number(v.rate_per_km).toLocaleString(undefined, { maximumFractionDigits: 2 }))} / km</b></div>
      <div><span class="muted">Status</span> <b>${esc(status)}</b></div>
      ${v.notes ? `<div style="grid-column: span 2"><span class="muted">Notes</span> ${esc(v.notes)}</div>` : ""}
    </div>
    <div class="amount">
      <span>Amount payable in cash</span>
      <b>${esc(fmtRs(v.amount))}</b>
    </div>
    <div class="sign">
      <div>Claimed by<br><b>${esc(v.creator?.full_name ?? "")}</b><br><span class="muted">${esc(fmtDT(v.created_at))}</span></div>
      <div>Approved by<br><b>${esc(v.approver?.full_name ?? "")}</b>${approverRoleLabel(v) ? ` <span class="muted">(${esc(approverRoleLabel(v))})</span>` : ""}<br><span class="muted">${v.approved_at ? esc(fmtDT(v.approved_at)) : "&nbsp;"}</span></div>
      <div>Paid by (cashier)<br><b>${esc(v.payer?.full_name ?? "")}</b><br>&nbsp;</div>
      <div>Received by<br>&nbsp;<br>&nbsp;</div>
    </div>
  </div>`;
}

/** Print cash vouchers two to an A4 sheet. Each item's `pass` adds the gate times when it is at hand. */
export function printTripFuelVouchers(items: { voucher: TripFuelVoucher; pass?: VoucherPass | null }[]) {
  if (items.length === 0) return;
  const sheets: string[] = [];
  for (let i = 0; i < items.length; i += 2) {
    const slots = items.slice(i, i + 2).map(({ voucher, pass }) => `<div class="tfv-slot">${tripFuelVoucherHtml(voucher, pass)}</div>`);
    sheets.push(`<div class="tfv-sheet">${slots.join("")}</div>`);
  }
  const title = items.length === 1 ? items[0].voucher.voucher_number : `Trip fuel vouchers (${items.length})`;
  printDocument(title, `<style>${TFV_PRINT_CSS}</style>${sheets.join("")}`);
}

/** Print one cash voucher (top half of the sheet). `pass` adds the gate times when it is at hand. */
export function printTripFuelVoucher(v: TripFuelVoucher, pass?: VoucherPass | null) {
  printTripFuelVouchers([{ voucher: v, pass }]);
}
