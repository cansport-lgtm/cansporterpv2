import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { CalendarCheck } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  karachiDate,
  monthDates,
  summariseMonth,
  type DayRecord,
  type DayState,
  type MonthSummary,
  type SubmissionHealth,
} from "@/lib/submissionStatus";

// These tables and functions are not in the generated Supabase types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type ReportKey = "loss" | "rw" | "key";

// Submissions are tracked from this day for all three reports.
const TRACKING_START = "2026-11-27";

const REPORTS: { key: ReportKey; title: string; link: string }[] = [
  { key: "loss", title: "Loss reason report", link: "/labour/mph-loss-reasons" },
  { key: "rw", title: "Rejection and wastage daily report", link: "/rejections/daily-report" },
  { key: "key", title: "Key material usage submission", link: "/consumption/key-raw-materials" },
];

const HEALTH: Record<SubmissionHealth, { label: string; cls: string }> = {
  on_track: { label: "On track", cls: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  watch: { label: "Watch", cls: "border-amber-300 bg-amber-50 text-amber-700" },
  behind: { label: "Behind", cls: "border-red-600 bg-red-600 text-white" },
  new: { label: "New", cls: "border-border bg-muted text-muted-foreground" },
};

const DAY_CLS: Record<DayState, string> = {
  submitted: "bg-emerald-100 text-emerald-900",
  late: "bg-amber-200 text-amber-900",
  missing: "bg-red-600 text-white font-semibold",
  draft: "border border-red-500 bg-red-50 text-red-800",
  pending: "border border-dashed border-foreground/50",
  upcoming: "text-muted-foreground/60",
  not_required: "text-muted-foreground/40",
};

const DAY_TEXT: Record<DayState, string> = {
  submitted: "submitted",
  late: "submitted late",
  missing: "missing",
  draft: "draft, not submitted",
  pending: "due today",
  upcoming: "not yet due",
  not_required: "not required",
};

type Source = { startDate: string; records: Map<string, DayRecord> };

type DayRow = { report_date: string; is_active: boolean; status: string; submitted_at: string | null };

function fromDayRows(rows: DayRow[]): Map<string, DayRecord> {
  const m = new Map<string, DayRecord>();
  rows.forEach((r) =>
    m.set(r.report_date, {
      done: r.status === "submitted" || r.status === "approved",
      submittedAt: r.submitted_at,
      started: r.status === "draft" || r.status === "rejected",
      active: r.is_active,
    }),
  );
  return m;
}

/** Everything the card needs, fetched once for the month. */
function useSubmissionSources(today: string) {
  const dates = monthDates(today);
  const from = dates[0];
  const to = dates[dates.length - 1];

  return useQuery({
    queryKey: ["ceo-submission-status", from],
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const [holidayRes, lossRes, rwSetRes, keySetRes, rwDays, keyDays] = await Promise.all([
        db.from("public_holidays").select("holiday_date").eq("is_active", true).gte("holiday_date", from).lte("holiday_date", to),
        db.from("mph_loss_reports").select("report_date, status, submitted_at").gte("report_date", from).lte("report_date", to),
        db.from("rw_daily_report_settings").select("enabled").maybeSingle(),
        db.from("consumption_key_rm_remark_settings").select("enabled").maybeSingle(),
        db.rpc("rw_daily_report_days", { p_from: from, p_to: today }),
        db.rpc("key_rm_remark_days", { p_from: from, p_to: today }),
      ]);
      for (const r of [holidayRes, lossRes, rwDays, keyDays]) if (r.error) throw r.error;

      const holidays = new Set<string>((holidayRes.data ?? []).map((h: { holiday_date: string }) => h.holiday_date));

      const loss = new Map<string, DayRecord>();
      (lossRes.data ?? []).forEach((r: { report_date: string; status: string; submitted_at: string | null }) =>
        loss.set(r.report_date, {
          done: r.status === "submitted" && !!r.submitted_at,
          submittedAt: r.submitted_at,
          started: r.status === "draft",
        }),
      );

      // A report that is switched off has no due days.
      const NEVER = "9999-12-31";
      const sources: Record<ReportKey, Source> = {
        loss: { startDate: TRACKING_START, records: loss },
        rw: { startDate: rwSetRes.data?.enabled ? TRACKING_START : NEVER, records: fromDayRows(rwDays.data ?? []) },
        key: { startDate: keySetRes.data?.enabled ? TRACKING_START : NEVER, records: fromDayRows(keyDays.data ?? []) },
      };
      return { holidays, sources };
    },
  });
}

function fmtDay(d: string) {
  return format(parseISO(d), "d MMM");
}

function Calendar({ summary }: { summary: MonthSummary }) {
  // Monday first. Blank cells line the first day up under its weekday.
  const lead = (parseISO(summary.days[0].date).getDay() + 6) % 7;
  return (
    <div className="grid grid-cols-7 gap-1" role="group" aria-label="Day by day">
      {["M", "T", "W", "T", "F", "S", "S"].map((w, i) => (
        <span key={i} className="text-center text-[11px] text-muted-foreground">{w}</span>
      ))}
      {Array.from({ length: lead }).map((_, i) => <span key={`b${i}`} />)}
      {summary.days.map((d) => (
        <span
          key={d.date}
          title={`${fmtDay(d.date)}: ${DAY_TEXT[d.state]}`}
          aria-label={`${fmtDay(d.date)}: ${DAY_TEXT[d.state]}`}
          className={cn("flex aspect-square max-h-8 items-center justify-center rounded-md text-xs tabular-nums", DAY_CLS[d.state])}
        >
          {Number(d.date.slice(8))}
        </span>
      ))}
    </div>
  );
}

function ReportCard({ title, link, summary, startDate, today }: {
  title: string; link: string; summary: MonthSummary; startDate: string; today: string;
}) {
  const h = HEALTH[summary.health];
  const todayText: Partial<Record<DayState, string>> = {
    submitted: "submitted", late: "submitted late", draft: "draft, not submitted",
    pending: "due, not yet submitted", missing: "missing",
  };
  return (
    <Card className={cn("min-w-0", summary.health === "behind" && "border-red-500")}>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-sm font-medium leading-snug">
          <Link to={link} className="hover:underline">{title}</Link>
        </CardTitle>
        <span className={cn("shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium", h.cls)}>{h.label}</span>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline gap-1.5">
          <span className="text-4xl font-semibold tabular-nums leading-none">{summary.pct === null ? "—" : summary.pct}</span>
          <span className="text-sm text-muted-foreground">% of due days submitted</span>
        </div>
        <p className="text-sm text-muted-foreground tabular-nums">
          <b className="font-medium text-foreground">{summary.done}</b> of <b className="font-medium text-foreground">{summary.due}</b> days submitted ·{" "}
          <b className="font-medium text-foreground">{summary.missing}</b> missing
        </p>
        <Calendar summary={summary} />
        <p className="min-h-[3em] text-sm leading-snug">
          {summary.due === 0 ? (
            <>No days due yet. Tracking starts <b className="font-medium">{startDate >= "9999" ? "when the report is switched on" : fmtDay(startDate)}</b>.</>
          ) : summary.streak > 0 ? (
            <>
              Not submitted for <b className="font-medium">{summary.streak}</b> {summary.streak === 1 ? "day" : "days in a row"}.
              {summary.lastSubmitted && <> Last submitted <b className="font-medium">{fmtDay(summary.lastSubmitted)}</b>.</>}
              {summary.drafts > 0 && <> <b className="font-medium">{summary.drafts}</b> {summary.drafts === 1 ? "day is" : "days are"} still drafts.</>}
            </>
          ) : (
            <>
              Last submitted <b className="font-medium">{summary.lastSubmitted ? fmtDay(summary.lastSubmitted) : "never"}</b>.
              {summary.late > 0 && <> <b className="font-medium">{summary.late}</b> {summary.late === 1 ? "day was" : "days were"} late.</>}
            </>
          )}
          <span className="block text-muted-foreground">
            Today ({fmtDay(today)}): {todayText[summary.todayState] ?? DAY_TEXT[summary.todayState]}.
          </span>
        </p>
      </CardContent>
    </Card>
  );
}

const LEGEND: [DayState, string][] = [
  ["submitted", "Submitted on time"], ["late", "Submitted late"], ["missing", "Missing"],
  ["draft", "Draft, not submitted"], ["pending", "Due today"], ["not_required", "Not required"],
];

/** CEO dashboard: are the three daily reports being submitted this month? */
export function SubmissionStatusCard() {
  const today = karachiDate(new Date());
  const { data, isLoading, error } = useSubmissionSources(today);

  const summaries = data
    ? REPORTS.map((r) => ({
        ...r,
        startDate: data.sources[r.key].startDate,
        summary: summariseMonth({ today, startDate: data.sources[r.key].startDate, holidays: data.holidays, records: data.sources[r.key].records }),
      }))
    : [];

  const onTrack = summaries.filter((s) => s.summary.health === "on_track").length;
  const started = summaries.filter((s) => s.summary.health !== "new");
  const worst = started.slice().sort((a, b) => (a.summary.pct ?? 0) - (b.summary.pct ?? 0))[0];
  const newCount = summaries.length - started.length;

  return (
    <section className="space-y-3" aria-label="Report submissions this month">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <CalendarCheck className="h-4 w-4" /> Daily report submissions · {format(parseISO(today), "MMMM yyyy")}
        </h2>
        {data && (
          <p className="text-sm text-muted-foreground">
            <b className="font-medium text-foreground">{onTrack}</b> of {summaries.length} submissions are on track this month.
            {worst && worst.summary.health !== "on_track" && (
              <> <b className="font-medium text-foreground">{worst.title}</b> is furthest behind, at <b className="font-medium text-foreground">{worst.summary.pct}</b>% of due days submitted.</>
            )}
            {newCount > 0 && <> <b className="font-medium text-foreground">{newCount}</b> {newCount === 1 ? "report has" : "reports have"} no due days yet.</>}
          </p>
        )}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading submission status…</p>}
      {error && <p className="text-sm text-red-600">Could not load submission status.</p>}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {summaries.map((s) => (
              <ReportCard key={s.key} title={s.title} link={s.link} summary={s.summary} startDate={s.startDate} today={today} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {LEGEND.map(([state, label]) => (
              <span key={state} className="inline-flex items-center gap-1.5">
                <i className={cn("inline-block h-3.5 w-3.5 rounded", DAY_CLS[state])} /> {label}
              </span>
            ))}
          </div>
          <p className="max-w-3xl text-xs text-muted-foreground">
            Percent is submitted days (on time or late) out of days due before today. A draft counts as not submitted. A report is late when it is
            submitted after the end of the next day. Sundays, public holidays, days before a report started being tracked and days with nothing to
            report are not required. On track: 95% or more and no gap in the last days. Watch: 80% to 95%, or a recent gap. Behind: under 80%, or 3 or
            more days missing in a row.
          </p>
        </>
      )}
    </section>
  );
}
