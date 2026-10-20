// Staff official timing (employees.duty_start_time / duty_end_time / duty_hours
// / late_grace_minutes): shared by HR Employees, Attendance, Time Sheet and
// Punctuality Analytics.

export const DEFAULT_DUTY_START = "09:00";
export const DEFAULT_DUTY_END = "18:00";
export const DEFAULT_DUTY_HOURS = 8;
export const DEFAULT_LATE_GRACE_MINUTES = 15;

export interface OfficialTiming {
  duty_start_time?: string | null;
  duty_end_time?: string | null;
  duty_hours?: number | null;
  late_grace_minutes?: number | null;
}

// "HH:MM" or "HH:MM:SS" → minutes since midnight; null when blank/invalid.
export const timeToMinutes = (t?: string | null): number | null => {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h)) return null;
  return h * 60 + (Number.isNaN(m) ? 0 : m);
};

export const minutesToTime = (mins: number) => {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

// DB time comes back as "09:00:00"; inputs want "09:00".
export const shortTime = (t?: string | null) => (t ? t.slice(0, 5) : "");

export const graceOf = (e?: OfficialTiming | null) =>
  e?.late_grace_minutes ?? DEFAULT_LATE_GRACE_MINUTES;

// Last on-time check-in, e.g. 09:00 + 15 min → "09:15".
export const lateAfter = (e?: OfficialTiming | null) =>
  minutesToTime((timeToMinutes(e?.duty_start_time) ?? timeToMinutes(DEFAULT_DUTY_START)!) + graceOf(e));

// Late = checked in after duty start + grace.
export const isLateCheckIn = (checkIn: string | null | undefined, e?: OfficialTiming | null) => {
  const ci = timeToMinutes(checkIn);
  if (ci === null) return false;
  return ci > timeToMinutes(lateAfter(e))!;
};

// Hours between start and end (overnight shifts wrap past midnight).
export const hoursBetween = (start?: string | null, end?: string | null): number | null => {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (s === null || e === null) return null;
  const diff = e > s ? e - s : e + 1440 - s;
  return Math.round((diff / 60) * 2) / 2;
};

// "09:00–18:00 · 8h"
export const formatTiming = (e?: OfficialTiming | null) => {
  const start = shortTime(e?.duty_start_time) || DEFAULT_DUTY_START;
  const end = shortTime(e?.duty_end_time) || DEFAULT_DUTY_END;
  return `${start}–${end} · ${e?.duty_hours ?? DEFAULT_DUTY_HOURS}h`;
};
