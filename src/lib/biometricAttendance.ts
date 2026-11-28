// Biometric attendance bridge (ZKTeco device -> LAN bridge -> ERP).
// Data arrives through /api/bridge/* (see api/bridge, docs/BIOMETRIC_BRIDGE.md);
// tables: supabase/migrations/20261201130000_biometric_bridge.sql.
// Device times are Asia/Karachi: days are always rendered and grouped in that zone.

import { supabase } from "@/integrations/supabase/client";

export const bioDb = supabase as any;

export const DEVICE_TZ = "Asia/Karachi";
/** No heartbeat for longer than this = bridge offline, whatever deviceOnline says. */
export const HEARTBEAT_STALE_MS = 3 * 60 * 1000;

export type DeviceStatusRow = {
  device_serial: string;
  device_online: boolean;
  user_count: number | null;
  log_count: number | null;
  last_sync_at: string | null;
  bridge_version: string | null;
  received_at: string;
};

export type BridgeState = "online" | "device_offline" | "bridge_offline" | "never";

export function bridgeState(s: DeviceStatusRow | null | undefined, now = Date.now()): BridgeState {
  if (!s) return "never";
  if (now - new Date(s.received_at).getTime() > HEARTBEAT_STALE_MS) return "bridge_offline";
  return s.device_online ? "online" : "device_offline";
}

export type DeviceUser = {
  id: string;
  device_serial: string;
  user_id: string;
  name: string;
  card_no: string;
  privilege: number;
  employee_id: string | null;
  mapped_manually: boolean;
  employee?: { id: string; employee_code: string; full_name: string } | null;
};

export type PunchLog = {
  id: number;
  user_id: string;
  punched_at: string;
  verify_mode: string;
  state: string;
  device_serial: string;
};

export type DailyRow = {
  day: string;
  user_id: string;
  device_name: string | null;
  employee_id: string | null;
  employee_code: string | null;
  employee_name: string | null;
  first_in: string;
  last_out: string;
  punches: number;
  hours_worked: number | null;
};

const dtf = new Intl.DateTimeFormat("en-GB", {
  timeZone: DEVICE_TZ, year: "numeric", month: "short", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
const tf = new Intl.DateTimeFormat("en-GB", {
  timeZone: DEVICE_TZ, hour: "2-digit", minute: "2-digit", hour12: false,
});

export const fmtDateTime = (iso?: string | null) => (iso ? dtf.format(new Date(iso)) : "—");
export const fmtTime = (iso?: string | null) => (iso ? tf.format(new Date(iso)) : "—");

/** Today's date (YYYY-MM-DD) in the device zone. */
export const todayKarachi = (offsetDays = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: DEVICE_TZ }).format(new Date(Date.now() + offsetDays * 86400000));

/** Start of a Karachi calendar day / start of the next one, as ISO instants. */
export const dayStartIso = (ymd: string) => `${ymd}T00:00:00+05:00`;
export const nextDayStartIso = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.toISOString().slice(0, 10)}T00:00:00+05:00`;
};

export const fmtHours = (h: number | null | undefined) => {
  if (h == null) return "—";
  const m = Math.round(Number(h) * 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};

export const verifyLabel = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
