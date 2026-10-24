// Salesman Planner (Private Label Sales): a free-text plan, one line per point,
// kept per salesman for a day, a week or any range, and printed.
// Table: sales_salesman_plans (supabase/migrations/20261112120000_sales_fuel_rate_factor_planner.sql).

import { addDays, format, startOfWeek } from "date-fns";
import { esc, printDocument } from "@/lib/printDocument";

export type PlanKind = "day" | "week" | "custom";
export type PlanStatus = "Draft" | "Submitted";

export interface SalesmanPlan {
  id: string; plan_number: string | null; user_id: string; plan_kind: PlanKind;
  from_date: string; to_date: string; title: string | null; body: string;
  status: PlanStatus; submitted_at: string | null; created_by: string | null; created_at: string; updated_at: string;
}

export const PLAN_KIND_LABEL: Record<PlanKind, string> = { day: "Single day", week: "Week (Mon–Sat)", custom: "Custom dates" };
export const PLANS_KEY = "sales_salesman_plans";

/** Monday–Saturday of the week holding `date` (yyyy-MM-dd). */
export function weekRange(date: string): { from: string; to: string } {
  const monday = startOfWeek(new Date(date), { weekStartsOn: 1 });
  return { from: format(monday, "yyyy-MM-dd"), to: format(addDays(monday, 5), "yyyy-MM-dd") };
}

export function planPeriodLabel(p: Pick<SalesmanPlan, "from_date" | "to_date">): string {
  const f = new Date(p.from_date), t = new Date(p.to_date);
  if (p.from_date === p.to_date) return format(f, "EEE dd MMM yyyy");
  return `${format(f, "EEE dd MMM")} – ${format(t, "EEE dd MMM yyyy")}`;
}

export type PlanLine = { kind: "heading" | "bullet"; text: string };

/** One line = one point. "-", "•" or "*" starts a bullet; any other non-empty line is a heading (a day, a city). */
export function parsePlanLines(body: string): PlanLine[] {
  return body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^[-•*]\s*(.*)$/);
      return m ? { kind: "bullet", text: m[1] } : { kind: "heading", text: l };
    });
}

export const countPlanPoints = (body: string) => parsePlanLines(body).filter((l) => l.kind === "bullet").length;

function planLinesHtml(lines: PlanLine[]): string {
  let html = "";
  let open = false;
  for (const l of lines) {
    if (l.kind === "heading") {
      if (open) { html += "</ul>"; open = false; }
      html += `<div class="h">${esc(l.text)}</div>`;
    } else {
      if (!open) { html += "<ul>"; open = true; }
      html += `<li>${esc(l.text)}</li>`;
    }
  }
  if (open) html += "</ul>";
  return html;
}

const PLAN_PRINT_CSS = `
  @page { size: A4; margin: 14mm; }
  body { padding: 0; font-size: 12.5px; }
  .pln { page-break-after: always; break-after: page; }
  .pln:last-child { page-break-after: auto; break-after: auto; }
  .pln .hd { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1.5px solid #222; padding-bottom: 8px; margin-bottom: 10px; }
  .pln .co { font-weight: 700; font-size: 15px; }
  .pln .co small { display: block; font-weight: 400; font-size: 10px; color: #555; }
  .pln .ti { text-align: right; }
  .pln .ti .t { font-weight: 700; letter-spacing: .1em; font-size: 12px; }
  .pln .ti .no { font-family: monospace; font-size: 12px; }
  .pln .kv { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 16px; font-size: 11.5px; margin-bottom: 14px; }
  .pln .kv div { display: grid; grid-template-columns: 90px 1fr; gap: 6px; padding: 2px 0; border-bottom: 1px dotted #bbb; }
  .pln .kv span { color: #555; }
  .pln h2 { font-size: 15px; margin: 0 0 8px; }
  .pln .h { font-weight: 700; margin: 10px 0 2px; }
  .pln ul { margin: 2px 0 0; padding-left: 20px; }
  .pln li { margin: 3px 0; }
  .pln .sign { display: flex; gap: 24px; margin-top: 44px; }
  .pln .sign div { flex: 1; border-top: 1px solid #222; padding-top: 4px; font-size: 10px; text-align: center; color: #444; }
`;

export function planHtml(p: SalesmanPlan, salesman: string, code: string | undefined): string {
  return `
  <div class="pln">
    <div class="hd">
      <div class="co">Cansport Global Industries<small>Private Label Sales · Salesman Plan</small></div>
      <div class="ti"><div class="t">SALESMAN PLAN</div><div class="no">${esc(p.plan_number ?? "")}</div></div>
    </div>
    <div class="kv">
      <div><span>Salesman</span><b>${esc(salesman)}${code ? ` (${esc(code)})` : ""}</b></div>
      <div><span>Plan period</span><b>${esc(planPeriodLabel(p))}</b></div>
      <div><span>Kind</span><b>${esc(PLAN_KIND_LABEL[p.plan_kind] ?? p.plan_kind)}</b></div>
      <div><span>Status</span><b>${esc(p.status)}${p.submitted_at ? ` · ${esc(format(new Date(p.submitted_at), "dd MMM yyyy HH:mm"))}` : ""}</b></div>
    </div>
    ${p.title ? `<h2>${esc(p.title)}</h2>` : ""}
    ${planLinesHtml(parsePlanLines(p.body))}
    <div class="sign"><div>Salesman</div><div>Sales Manager</div><div>Super Admin</div></div>
  </div>`;
}

/** Print one plan per A4 page. */
export function printSalesmanPlans(plans: SalesmanPlan[], userName: (id: string) => string, employeeCode: (id: string) => string | undefined) {
  if (!plans.length) return;
  const title = plans.length === 1 ? plans[0].plan_number ?? "Salesman plan" : `Salesman plans (${plans.length})`;
  printDocument(title, `<style>${PLAN_PRINT_CSS}</style>${plans.map((p) => planHtml(p, userName(p.user_id), employeeCode(p.user_id))).join("")}`);
}
