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
  pending_approval: { label: "Awaiting HR approval", variant: "warning" },
  approved: { label: "Approved · collect cash", variant: "info" },
  paid: { label: "Paid", variant: "success" },
  rejected: { label: "Rejected", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

export const fuelStatusMeta = (s: string) => FUEL_STATUS_META[s as TripFuelStatus] ?? { label: s, variant: "secondary" as const };

export const FUEL_APPROVE_ROLES = ["super_admin", "hr_manager"];
export const FUEL_PAY_ROLES = ["super_admin", "pettycash_handler", "expenses_manager", "expenses_officer"];
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
  approval_remarks: string | null;
  paid_by: string | null;
  paid_at: string | null;
  paid_remarks: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  person?: { employee_code: string; full_name: string; photo_url: string | null; production_departments?: { name: string } | null } | null;
  pass?: { pass_number: string; gate_out_at: string | null; gate_in_at: string | null } | null;
  creator?: { full_name: string | null } | null;
  approver?: { full_name: string | null } | null;
  payer?: { full_name: string | null } | null;
};

export const FUEL_SELECT =
  "*," +
  "person:employees(employee_code, full_name, photo_url, production_departments(name))," +
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

export const fmtKm = (n: number | null | undefined) => (n == null ? "—" : `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`);
export const fmtRs = (n: number | null | undefined) => (n == null ? "—" : `Rs ${Math.round(Number(n)).toLocaleString()}`);

/** Print the cash voucher. `pass` adds the gate times when it is at hand. */
export function printTripFuelVoucher(v: TripFuelVoucher, pass?: Pick<PersonGatePass, "pass_number" | "gate_out_at" | "gate_in_at"> | null) {
  const p = pass ?? v.pass;
  const status = fuelStatusMeta(v.status).label;
  const body = `
  <style>
    .tfv { max-width: 520px; margin: 0 auto; border: 1px solid #999; padding: 16px 18px; }
    .tfv .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; font-size: 12px; margin-top: 12px; }
    .tfv .amount { margin-top: 14px; border: 2px solid #111; padding: 10px 12px; display: flex; justify-content: space-between; align-items: baseline; }
    .tfv .amount b { font-size: 22px; }
    .tfv .sign { display: flex; gap: 12px; margin-top: 42px; }
    .tfv .sign div { flex: 1; border-top: 1px solid #111; padding-top: 4px; font-size: 10px; text-align: center; }
  </style>
  <div class="wrap tfv">
    <div class="head" style="margin-bottom:8px; padding-bottom:8px">
      <div>
        <h1 style="font-size:16px">Cansport Global Industries</h1>
        <div class="bold" style="margin-top:6px; letter-spacing:.08em; font-size:13px">TRIP FUEL · CASH PAYMENT VOUCHER</div>
        ${v.status === "pending_approval" ? `<div class="bold" style="color:#b45309">NOT APPROVED YET — NOT PAYABLE</div>` : ""}
        ${v.status === "rejected" || v.status === "cancelled" ? `<div class="bold" style="color:#b42318">${esc(status.toUpperCase())} — NOT PAYABLE</div>` : ""}
      </div>
      <div style="text-align:right">
        <div class="bold" style="font-size:16px">${esc(v.voucher_number)}</div>
        <div class="xs muted">${esc(format(new Date(v.trip_date), "dd MMM yyyy"))}</div>
      </div>
    </div>
    <div>
      <div class="big" style="font-size:18px; font-weight:700">${esc(v.person?.full_name ?? "")}</div>
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
      <div>Approved by (HR)<br><b>${esc(v.approver?.full_name ?? "")}</b><br><span class="muted">${v.approved_at ? esc(fmtDT(v.approved_at)) : "&nbsp;"}</span></div>
      <div>Paid by (cashier)<br><b>${esc(v.payer?.full_name ?? "")}</b><br><span class="muted">${v.paid_at ? esc(fmtDT(v.paid_at)) : "&nbsp;"}</span></div>
      <div>Received by<br>&nbsp;<br>&nbsp;</div>
    </div>
  </div>`;
  printDocument(v.voucher_number, body);
}
