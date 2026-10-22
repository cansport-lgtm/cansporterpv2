// Private Label Sales fuel trips: price × factor pricing, meter photos and the
// printed voucher. Rules live in the database:
// supabase/migrations/20261112120000_sales_fuel_rate_factor_planner.sql.
//
//   rate per km = petrol price (typed by the salesman) × factor (super admin)
//   amount      = km × rate per km
//
// The trigger freezes price, factor, rate and amount on the trip row; this
// file only mirrors the arithmetic for the live preview in the form.

import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { esc, printDocument } from "@/lib/printDocument";

export const METER_PHOTO_BUCKET = "trip-odometer-photos";

export interface SalesFuelTrip {
  id: string; trip_date: string; user_id: string; vehicle_id: string | null;
  from_location: string | null; to_location: string | null; purpose: string | null;
  start_odometer: number; end_odometer: number; km: number;
  customer_id: string | null; visit_id: string | null;
  mileage_kmpl_snapshot: number | null; fuel_price_snapshot: number | null;
  fuel_price_entered: number | null; rate_factor_snapshot: number | null; rate_per_km: number | null;
  litres: number | null; amount: number | null;
  odo_start_photo_url: string | null; odo_end_photo_url: string | null;
  voucher_number: string | null;
  status: string; approved_by: string | null; approved_at: string | null; rejected_reason: string | null;
  payout_id: string | null; remarks: string | null; created_by: string | null; created_at: string;
}

export interface RateFactor { id: string; effective_date: string; factor: number; note: string | null; created_by: string | null; created_at: string; }

export const SALES_FUEL_KEYS = {
  trips: "sales_fuel_trips",
  factors: "sales_fuel_rate_factors",
  lastPrice: "sales_fuel_last_price",
  prices: "sales_fuel_prices",
  employeeCodes: "sales_employee_codes",
};

/** Every factor ever set, newest first. */
export function useRateFactors() {
  return useQuery<RateFactor[]>({
    queryKey: [SALES_FUEL_KEYS.factors],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_fuel_rate_factors" as any)
        .select("*")
        .order("effective_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as RateFactor[];
    },
  });
}

/** The factor in force on a date (newest effective_date on or before it), as the trigger picks it. */
export function factorForDate(factors: RateFactor[] | undefined, date: string): RateFactor | null {
  if (!factors?.length) return null;
  return factors.find((f) => f.effective_date <= date) ?? null;
}

/** The petrol price the salesman typed on their most recent trip, else the super admin's price list. */
export function useDefaultPetrolPrice(userId: string | undefined) {
  return useQuery<number | null>({
    queryKey: [SALES_FUEL_KEYS.lastPrice, userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data } = await supabase
        .from("sales_fuel_trips" as any)
        .select("fuel_price_entered")
        .eq("user_id", userId)
        .not("fuel_price_entered", "is", null)
        .order("trip_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const last = (data as any)?.fuel_price_entered;
      if (last != null && Number(last) > 0) return Number(last);
      const { data: p } = await supabase
        .from("sales_fuel_prices" as any)
        .select("price_per_litre")
        .lte("effective_date", new Date().toISOString().slice(0, 10))
        .order("effective_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      const list = (p as any)?.price_per_litre;
      return list != null ? Number(list) : null;
    },
  });
}

/** The last End Odo this salesman posted, to pre-fill the next Start Odo. */
export function useLastEndOdometer(userId: string | undefined) {
  return useQuery<number | null>({
    queryKey: ["sales_fuel_last_end_odo", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data } = await supabase
        .from("sales_fuel_trips" as any)
        .select("end_odometer")
        .eq("user_id", userId)
        .order("trip_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const v = (data as any)?.end_odometer;
      return v != null ? Number(v) : null;
    },
  });
}

/** app_user id → employee code (the SE ids), for the users that have a staff record. */
export function useEmployeeCodes() {
  return useQuery<Record<string, string>>({
    queryKey: [SALES_FUEL_KEYS.employeeCodes],
    queryFn: async () => {
      const { data } = await supabase
        .from("employees" as any)
        .select("app_user_id, employee_code")
        .not("app_user_id", "is", null);
      const map: Record<string, string> = {};
      ((data ?? []) as any[]).forEach((e) => { if (e.app_user_id && e.employee_code) map[e.app_user_id] = e.employee_code; });
      return map;
    },
  });
}

/** Mirror of the trigger arithmetic for the live preview. */
export function computeTrip(startOdo: number, endOdo: number, price: number, factor: number | null) {
  const km = Math.max(endOdo - startOdo, 0);
  const rate = factor != null ? Math.round(price * factor * 100) / 100 : null;
  const amount = rate != null ? Math.round(km * rate * 100) / 100 : null;
  return { km, rate, amount };
}

export const fmtMoney = (n: number | null | undefined, digits = 2) =>
  n == null ? "—" : Number(n).toLocaleString("en-PK", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Upload one vehicle-meter photo; returns its public URL. */
export async function uploadMeterPhoto(file: File, prefix: string): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image");
  if (file.size > 5 * 1024 * 1024) throw new Error("Image must be smaller than 5 MB");
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `sales/${prefix}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(METER_PHOTO_BUCKET).upload(path, file, { cacheControl: "3600", upsert: true });
  if (error) throw error;
  return supabase.storage.from(METER_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}

// ---------------------------------------------------------------------------
// Amount in words (Pakistani style: lakh / crore)
// ---------------------------------------------------------------------------
const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} hundred`); n %= 100; }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "")); }
  else if (n > 0) parts.push(ONES[n]);
  return parts.join(" ");
}
export function amountInWords(amount: number): string {
  const rupees = Math.floor(Math.abs(amount));
  const paisa = Math.round((Math.abs(amount) - rupees) * 100);
  if (rupees === 0 && paisa === 0) return "Rupees zero only";
  const parts: string[] = [];
  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const rest = rupees % 1000;
  if (crore) parts.push(`${below1000(crore)} crore`);
  if (lakh) parts.push(`${below1000(lakh)} lakh`);
  if (thousand) parts.push(`${below1000(thousand)} thousand`);
  if (rest) parts.push(below1000(rest));
  let s = `Rupees ${parts.join(" ")}`.trim();
  if (paisa) s += ` and ${below1000(paisa)} paisa`;
  return `${s} only`;
}

// ---------------------------------------------------------------------------
// Voucher printing: two to an A4 sheet
// ---------------------------------------------------------------------------
export interface VoucherContext {
  userName: (id: string) => string;
  employeeCode: (id: string) => string;
  vehicleLabel: (id: string | null) => string;
  customerName: (id: string | null) => string;
}

const SFV_PRINT_CSS = `
  @page { size: A4; margin: 10mm; }
  body { padding: 0; font-size: 12px; }
  .sfv-sheet { height: 277mm; display: flex; flex-direction: column; page-break-after: always; break-after: page; }
  .sfv-sheet:last-child { page-break-after: auto; break-after: auto; }
  .sfv-slot { height: 50%; overflow: hidden; padding: 3mm 0; display: flex; flex-direction: column; }
  .sfv-slot + .sfv-slot { border-top: 1px dashed #999; }
  .sfv { border: 1.5px solid #222; padding: 12px 16px; flex: 1; display: flex; flex-direction: column; }
  .sfv .hd { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1.5px solid #222; padding-bottom: 6px; margin-bottom: 8px; }
  .sfv .co { font-weight: 700; font-size: 15px; }
  .sfv .co small { display: block; font-weight: 400; font-size: 10px; color: #555; }
  .sfv .ti { text-align: right; }
  .sfv .ti .copy { font-size: 9px; letter-spacing: .12em; color: #777; }
  .sfv .ti .t { font-weight: 700; letter-spacing: .1em; font-size: 12px; }
  .sfv .ti .no { font-family: monospace; font-size: 12px; }
  .sfv .kv { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 16px; font-size: 11.5px; }
  .sfv .kv div { display: grid; grid-template-columns: 96px 1fr; gap: 6px; padding: 2px 0; border-bottom: 1px dotted #bbb; }
  .sfv .kv span { color: #555; }
  .sfv .kv b { font-weight: 600; }
  .sfv table { width: 100%; border-collapse: collapse; margin-top: 8px; border: 1px solid #222; font-size: 11.5px; }
  .sfv th { background: #f1f1f1; border-bottom: 1px solid #222; padding: 4px 8px; text-align: right; font-size: 10px; text-transform: uppercase; }
  .sfv th:first-child, .sfv td:first-child { text-align: left; }
  .sfv td { padding: 4px 8px; text-align: right; border-bottom: 0; }
  .sfv tr.tot td { border-top: 1.5px solid #222; font-weight: 700; font-size: 13px; }
  .sfv tr.tot td small { font-weight: 400; font-size: 10px; color: #555; }
  .sfv .warn { font-weight: 700; color: #b45309; font-size: 10px; margin-top: 4px; }
  .sfv .photos { font-size: 10px; color: #555; margin-top: 6px; }
  .sfv .sign { display: flex; gap: 16px; margin-top: auto; padding-top: 18px; }
  .sfv .sign div { flex: 1; border-top: 1px solid #222; padding-top: 3px; font-size: 9.5px; text-align: center; color: #444; }
`;

function voucherHtml(t: SalesFuelTrip, ctx: VoucherContext, copy: string) {
  const code = ctx.employeeCode(t.user_id);
  const route = [t.from_location, t.to_location].filter(Boolean).join(" → ");
  const notPayable = t.status === "Rejected" ? "REJECTED — NOT PAYABLE" : t.status === "Submitted" ? "NOT APPROVED YET — NOT PAYABLE" : "";
  return `
  <div class="sfv">
    <div class="hd">
      <div class="co">Cansport Global Industries<small>Private Label Sales · Fuel Trip Voucher</small></div>
      <div class="ti"><div class="copy">${esc(copy)}</div><div class="t">FUEL VOUCHER</div><div class="no">${esc(t.voucher_number ?? "")}</div></div>
    </div>
    <div class="kv">
      <div><span>Salesman</span><b>${esc(ctx.userName(t.user_id))}${code ? ` (${esc(code)})` : ""}</b></div>
      <div><span>Trip date</span><b>${esc(format(new Date(t.trip_date), "EEE dd MMM yyyy"))}</b></div>
      <div><span>Vehicle</span><b>${esc(ctx.vehicleLabel(t.vehicle_id))}</b></div>
      <div><span>Customer</span><b>${esc(ctx.customerName(t.customer_id))}</b></div>
      <div><span>Route</span><b>${esc(route || "—")}</b></div>
      <div><span>Purpose</span><b>${esc(t.purpose ?? "—")}</b></div>
      <div><span>Start / End odo</span><b>${esc(Number(t.start_odometer).toLocaleString())} → ${esc(Number(t.end_odometer).toLocaleString())} km</b></div>
      <div><span>Posted</span><b>${esc(format(new Date(t.created_at), "dd MMM yyyy HH:mm"))}</b></div>
    </div>
    <table>
      <thead><tr><th>Km</th><th>Petrol price (Rs/L)</th><th>× Factor</th><th>= Rate / km</th><th>Amount (Rs)</th></tr></thead>
      <tbody>
        <tr>
          <td>${esc(Number(t.km).toFixed(1))}</td>
          <td>${esc(fmtMoney(t.fuel_price_snapshot))}</td>
          <td>${t.rate_factor_snapshot != null ? esc(Number(t.rate_factor_snapshot).toFixed(4)) : "—"}</td>
          <td>${esc(fmtMoney(t.rate_per_km))}</td>
          <td>${esc(fmtMoney(t.amount))}</td>
        </tr>
        <tr class="tot"><td colspan="4">Total payable &nbsp;<small>${esc(amountInWords(Number(t.amount ?? 0)))}</small></td><td>Rs ${esc(fmtMoney(t.amount))}</td></tr>
      </tbody>
    </table>
    ${notPayable ? `<div class="warn">${esc(notPayable)}</div>` : ""}
    <div class="photos">Meter photos on file: ${t.odo_start_photo_url ? "start ✓" : "start ✗"} · ${t.odo_end_photo_url ? "end ✓" : "end ✗"}${t.remarks ? ` · ${esc(t.remarks)}` : ""}</div>
    <div class="sign"><div>Salesman</div><div>Approved by (Sales Manager)</div><div>Paid by (Accounts)</div><div>Received by</div></div>
  </div>`;
}

/**
 * Print vouchers two to an A4 sheet. A single voucher is printed twice on the
 * one sheet (Accounts copy + Salesman copy); a selection pairs up, each as the
 * Accounts copy, with a cut line between.
 */
export function printSalesFuelVouchers(trips: SalesFuelTrip[], ctx: VoucherContext) {
  if (!trips.length) return;
  const slots: string[] = trips.length === 1
    ? [voucherHtml(trips[0], ctx, "ACCOUNTS COPY"), voucherHtml(trips[0], ctx, "SALESMAN COPY")]
    : trips.map((t) => voucherHtml(t, ctx, "ACCOUNTS COPY"));
  const sheets: string[] = [];
  for (let i = 0; i < slots.length; i += 2) {
    sheets.push(`<div class="sfv-sheet">${slots.slice(i, i + 2).map((s) => `<div class="sfv-slot">${s}</div>`).join("")}</div>`);
  }
  const title = trips.length === 1 ? trips[0].voucher_number ?? "Fuel voucher" : `Fuel vouchers (${trips.length})`;
  printDocument(title, `<style>${SFV_PRINT_CSS}</style>${sheets.join("")}`);
}
