// Machine monitor status helpers
// Statuses are stored as a text[] in machine_monitor_machines.custom_statuses.
// We use prefixes to group reasons:
//   "breakdown:<reason>"  -> Breakdown reason add-on
//   "perf:<reason>"       -> Performance Issue reason add-on
// Stored current_status format:
//   "Running"
//   "Breakdown — <reason>"
//   "Performance Issue — <reason>"
// Legacy values without prefix are mapped: "Running" stays Running,
// "Breakdown" stays Breakdown (no reason), anything else => Performance Issue.

export const BASE_STATUSES = ["Running", "Breakdown", "Performance Issue"] as const;
export type BaseStatus = typeof BASE_STATUSES[number];

export const SEPARATOR = " — ";

export const DEFAULT_BREAKDOWN_REASONS = [
  "Wire Break",
  "Motor Failure",
  "Sensor Fault",
  "Power Failure",
  "Mechanical Jam",
];

export const DEFAULT_PERFORMANCE_REASONS = [
  "Cooling Delay",
  "Slow Speed",
  "Material Jam",
  "Quality Issue",
  "Operator Idle",
];

export function splitReasonGroups(stored: string[] | null | undefined) {
  const arr = stored || [];
  const breakdown_reasons: string[] = [];
  const performance_issue_reasons: string[] = [];
  const legacy: string[] = [];
  arr.forEach((s) => {
    if (typeof s !== "string") return;
    if (s.startsWith("breakdown:")) breakdown_reasons.push(s.substring("breakdown:".length));
    else if (s.startsWith("perf:")) performance_issue_reasons.push(s.substring("perf:".length));
    else legacy.push(s);
  });
  // Backfill defaults if both groups empty
  if (breakdown_reasons.length === 0 && performance_issue_reasons.length === 0) {
    // Map legacy values: anything not Running/Breakdown is treated as a performance reason
    legacy.forEach((s) => {
      if (s === "Running" || s === "Breakdown" || s === "Performance Issue") return;
      performance_issue_reasons.push(s);
    });
    if (breakdown_reasons.length === 0) breakdown_reasons.push(...DEFAULT_BREAKDOWN_REASONS);
    if (performance_issue_reasons.length === 0) performance_issue_reasons.push(...DEFAULT_PERFORMANCE_REASONS);
  }
  return { breakdown_reasons, performance_issue_reasons };
}

export function joinReasonGroups(breakdown_reasons: string[], performance_issue_reasons: string[]): string[] {
  return [
    ...breakdown_reasons.map((r) => `breakdown:${r}`),
    ...performance_issue_reasons.map((r) => `perf:${r}`),
  ];
}

export function parseStatus(status: string | null | undefined): { base: BaseStatus; reason: string | null } {
  const s = (status || "").trim();
  if (!s) return { base: "Running", reason: null };
  if (s === "Running") return { base: "Running", reason: null };
  // Find separator
  const idx = s.indexOf(SEPARATOR);
  if (idx > 0) {
    const base = s.substring(0, idx).trim();
    const reason = s.substring(idx + SEPARATOR.length).trim();
    if (base === "Breakdown") return { base: "Breakdown", reason };
    if (base === "Performance Issue") return { base: "Performance Issue", reason };
  }
  // Legacy single-value
  if (s === "Breakdown") return { base: "Breakdown", reason: null };
  if (s === "Performance Issue") return { base: "Performance Issue", reason: null };
  // Anything else (Idle, Stopped, Setup, etc.) -> treat as Performance Issue with reason
  return { base: "Performance Issue", reason: s };
}

export function buildStatus(base: BaseStatus, reason: string | null): string {
  if (base === "Running") return "Running";
  if (!reason) return base;
  return `${base}${SEPARATOR}${reason}`;
}

export function statusColorClass(status: string): string {
  const { base } = parseStatus(status);
  if (base === "Running") return "bg-green-100 text-green-700 border-green-300";
  if (base === "Breakdown") return "bg-red-100 text-red-700 border-red-300";
  return "bg-yellow-100 text-yellow-700 border-yellow-300";
}
