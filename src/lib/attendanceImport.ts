// Parsing helpers for the HR attendance Excel import.
//
// Excel rewrites cells when a sheet is edited and saved: "06" becomes the
// number 6, "09:00" becomes the day-fraction 0.375, and dates become serial
// numbers or locale text such as 14/11/2026. These helpers accept all of those
// so a file that looks right in Excel is not rejected.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const pad = (n: number) => String(n).padStart(2, "0");

const isBlank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

/** Header key used to match columns: "Employee Code", "employee_code", "EMP CODE " all compare equal-ish. */
export const normalizeHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

const HEADER_ALIASES: Record<string, string[]> = {
  code: ["employeecode", "empcode", "code", "employeeid", "empid", "employeeno", "empno", "id"],
  date: ["date", "attendancedate"],
  checkIn: ["checkin", "timein", "intime", "in"],
  checkOut: ["checkout", "timeout", "outtime", "out"],
  status: ["status", "attendancestatus"],
  remarks: ["remarks", "remark", "note", "notes"],
};

export type AttendanceField = keyof typeof HEADER_ALIASES;

/** Pull the known fields out of a sheet row regardless of header spelling/case. */
export function readRow(row: Record<string, unknown>): Record<AttendanceField, unknown> {
  const byKey = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) byKey.set(normalizeHeader(k), v);
  const out = {} as Record<AttendanceField, unknown>;
  for (const field of Object.keys(HEADER_ALIASES) as AttendanceField[]) {
    const alias = HEADER_ALIASES[field].find((a) => byKey.has(a));
    out[field] = alias ? byKey.get(alias) : undefined;
  }
  return out;
}

/** Comparison key for employee codes: trims, upper-cases and drops leading zeros ("06" == 6 == "006"). */
export function codeKey(v: unknown): string {
  const s = String(v ?? "").trim().toUpperCase();
  if (/^\d+(\.0+)?$/.test(s)) return String(parseInt(s, 10));
  return s;
}

/** Returns yyyy-MM-dd, or null when the value is not a recognisable date. Blank returns undefined. */
export function parseDate(v: unknown): string | null | undefined {
  if (isBlank(v)) return undefined;
  if (v instanceof Date) {
    return isNaN(v.getTime()) ? null : `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  if (typeof v === "number") {
    // Excel serial date (days since 1899-12-30)
    if (v < 1) return null;
    const d = new Date(Math.round((Math.floor(v) - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(v).trim();
  const build = (y: number, m: number, d: number) => {
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  };
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); // 2026-11-14
  if (m) return build(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/); // 14/11/2026 (day first)
  if (m) return build(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[-/ .]([A-Za-z]{3,})[-/ .,]+(\d{2,4})/); // 14-Nov-26
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    return mi < 0 ? null : build(+m[3], mi + 1, +m[1]);
  }
  m = s.match(/^([A-Za-z]{3,})[-/ .]+(\d{1,2})[-/ .,]+(\d{2,4})/); // Nov 14, 2026
  if (m) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    return mi < 0 ? null : build(+m[3], mi + 1, +m[2]);
  }
  return null;
}

/** Returns HH:mm:ss, or null when the value is not a recognisable time. Blank returns undefined. */
export function parseTime(v: unknown): string | null | undefined {
  if (isBlank(v)) return undefined;
  if (v instanceof Date) {
    return isNaN(v.getTime()) ? null : `${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
  }
  if (typeof v === "number") {
    // Excel time = fraction of a day (a date-time keeps only its time part)
    const secs = Math.round((v - Math.floor(v)) * 86400) % 86400;
    return `${pad(Math.floor(secs / 3600))}:${pad(Math.floor((secs % 3600) / 60))}:${pad(secs % 60)}`;
  }
  const s = String(v).trim();
  if (/^[-–—]+$/.test(s)) return undefined; // "-" placeholder means no time
  const m = s.match(/^(\d{1,2})(?:[:.](\d{2}))?(?:[:.](\d{2}))?\s*([AaPp])\.?\s*[Mm]?\.?$/) ||
    s.match(/^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?()$/);
  if (!m) return null;
  let h = +m[1];
  const min = +(m[2] || 0);
  const sec = +(m[3] || 0);
  const ap = (m[4] || "").toLowerCase();
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === "p" && h < 12) h += 12;
    if (ap === "a" && h === 12) h = 0;
  }
  if (h > 23 || min > 59 || sec > 59) return null;
  return `${pad(h)}:${pad(min)}:${pad(sec)}`;
}

const STATUS_ALIASES: Record<string, string> = {
  present: "present", p: "present",
  absent: "absent", a: "absent",
  halfday: "half_day", hd: "half_day", h: "half_day",
  late: "late", l: "late",
  onleave: "on_leave", leave: "on_leave", ol: "on_leave",
};

/** Returns a valid status value, or null when unrecognised. Blank defaults to "present". */
export function parseStatus(v: unknown): string | null {
  if (isBlank(v)) return "present";
  return STATUS_ALIASES[normalizeHeader(String(v))] ?? null;
}
