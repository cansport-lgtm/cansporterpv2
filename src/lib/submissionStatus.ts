// Month status of a daily report: which days were submitted on time, late, left as a draft or missed.
// Pure functions so the dashboard card and any later report can share one set of rules.

export type DayState =
  | "submitted"
  | "late"
  | "draft"
  | "missing"
  | "pending"
  | "upcoming"
  | "not_required";

export type SubmissionHealth = "on_track" | "watch" | "behind" | "new";

/** What the source records say about one calendar day. */
export type DayRecord = {
  /** Submitted (or approved) report exists. */
  done: boolean;
  /** When it was submitted (ISO timestamp). Used to tell on time from late. */
  submittedAt?: string | null;
  /** A draft, or a report sent back for changes, exists but is not submitted. */
  started?: boolean;
  /** False when the day had no activity to report on. Defaults to true. */
  active?: boolean;
};

export type MonthDay = { date: string; state: DayState };

export type MonthSummary = {
  days: MonthDay[];
  due: number;
  done: number;
  late: number;
  drafts: number;
  missing: number;
  pct: number | null;
  streak: number;
  lastSubmitted: string | null;
  todayState: DayState;
  health: SubmissionHealth;
};

const KARACHI = "Asia/Karachi";

/** yyyy-MM-dd for an instant, in Pakistan time. */
export function karachiDate(d: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: KARACHI }).format(typeof d === "string" ? new Date(d) : d);
}

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = parts(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function isSunday(date: string): boolean {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0;
}

/** Every date of the month that contains `anyDate`. */
export function monthDates(anyDate: string): string[] {
  const [y, m] = parts(anyDate);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${y}-${String(m).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`);
}

/**
 * A report is late when it was submitted after the end of the day after the report date.
 * Sundays, public holidays, days before tracking started and days with nothing to report are not required.
 */
export function summariseMonth(args: {
  today: string;
  startDate: string;
  holidays: ReadonlySet<string>;
  records: ReadonlyMap<string, DayRecord>;
}): MonthSummary {
  const { today, startDate, holidays, records } = args;

  const days: MonthDay[] = monthDates(today).map((date) => {
    const rec = records.get(date);
    let state: DayState;
    if (date < startDate || isSunday(date) || holidays.has(date) || rec?.active === false) state = "not_required";
    else if (date > today) state = "upcoming";
    else if (rec?.done) state = rec.submittedAt && karachiDate(rec.submittedAt) > addDays(date, 1) ? "late" : "submitted";
    else if (date === today) state = "pending";
    else state = rec?.started ? "draft" : "missing";
    return { date, state };
  });

  const past = days.filter((d) => d.date < today && ["submitted", "late", "draft", "missing"].includes(d.state));
  const late = past.filter((d) => d.state === "late").length;
  const drafts = past.filter((d) => d.state === "draft").length;
  const missing = past.filter((d) => d.state === "draft" || d.state === "missing").length;
  const done = past.length - missing;
  const pct = past.length ? Math.round((done / past.length) * 1000) / 10 : null;

  let streak = 0;
  for (let i = past.length - 1; i >= 0 && (past[i].state === "draft" || past[i].state === "missing"); i--) streak++;

  const got = past.filter((d) => d.state === "submitted" || d.state === "late");
  const health: SubmissionHealth =
    pct === null ? "new" : streak >= 3 || pct < 80 ? "behind" : pct < 95 || streak > 0 ? "watch" : "on_track";

  return {
    days,
    due: past.length,
    done,
    late,
    drafts,
    missing,
    pct,
    streak,
    lastSubmitted: got.length ? got[got.length - 1].date : null,
    todayState: days.find((d) => d.date === today)?.state ?? "upcoming",
    health,
  };
}
