// 2-hour update clock for the Private Label / Company Job Orders floor page.
// Every open order must get a floor update (production or a "no progress"
// check-in) at least every 2 working hours. Only shift time counts, so an
// order updated at 19:30 is not overdue when the shift starts next morning.
// Times are the floor screen's local time.

export const SHIFT_START_HOUR = 8;
export const SHIFT_END_HOUR = 20;
/** Days the clock runs, as Date.getDay() (0 = Sunday). */
export const SHIFT_DAYS = [1, 2, 3, 4, 5, 6];
export const UPDATE_EVERY_MS = 2 * 60 * 60 * 1000;
export const WARN_BEFORE_MS = 30 * 60 * 1000;
/** While anything is overdue the siren repeats this often. */
export const ALARM_REPEAT_MS = 5 * 60 * 1000;
export const ALARM_SECONDS = 10;

export type UpdateState = "ok" | "due_soon" | "overdue" | "done";

export interface UpdateStatus {
  state: UpdateState;
  /** Shift time since the last update. */
  elapsedMs: number;
  /** Shift time left before the order is overdue (negative once overdue). */
  remainingMs: number;
}

const shiftBounds = (day: Date) => {
  const start = new Date(day);
  start.setHours(SHIFT_START_HOUR, 0, 0, 0);
  const end = new Date(day);
  end.setHours(SHIFT_END_HOUR, 0, 0, 0);
  return [start.getTime(), end.getTime()] as const;
};

export function isShiftTime(d: Date) {
  if (!SHIFT_DAYS.includes(d.getDay())) return false;
  const [start, end] = shiftBounds(d);
  return d.getTime() >= start && d.getTime() < end;
}

/** Shift time between two moments, in ms. */
export function shiftMsBetween(from: Date, to: Date) {
  if (to <= from) return 0;
  let total = 0;
  const day = new Date(from);
  day.setHours(0, 0, 0, 0);
  // Capped: an order untouched for months is overdue either way.
  for (let i = 0; i < 400 && day <= to; i++) {
    if (SHIFT_DAYS.includes(day.getDay())) {
      const [start, end] = shiftBounds(day);
      total += Math.max(0, Math.min(end, to.getTime()) - Math.max(start, from.getTime()));
    }
    day.setDate(day.getDate() + 1);
  }
  return total;
}

export function updateStatus(lastActivityAt: string | null, isDone: boolean, now: Date): UpdateStatus {
  if (isDone || !lastActivityAt) return { state: "done", elapsedMs: 0, remainingMs: UPDATE_EVERY_MS };
  const elapsedMs = shiftMsBetween(new Date(lastActivityAt), now);
  const remainingMs = UPDATE_EVERY_MS - elapsedMs;
  const state: UpdateState = remainingMs <= 0 ? "overdue" : remainingMs <= WARN_BEFORE_MS ? "due_soon" : "ok";
  return { state, elapsedMs, remainingMs };
}

/** "2h 05m", "45m", "under 1m". */
export function formatDuration(ms: number) {
  const mins = Math.floor(Math.abs(ms) / 60000);
  if (mins < 1) return "under 1m";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}
