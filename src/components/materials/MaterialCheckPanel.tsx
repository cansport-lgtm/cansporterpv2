import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type CheckLine,
  type CheckResult,
  fmtQty,
  hasIssues,
  issueCounts,
  PURCHASE_STATUS_LABEL,
  RESULT_LABEL,
  sortLines,
} from "@/lib/productMaterials";

const RESULT_BADGE: Record<CheckResult, string> = {
  short: "bg-red-600 text-white",
  below_min: "bg-red-50 text-red-700 border border-red-300 dark:bg-red-950/40 dark:text-red-300",
  unknown: "bg-red-50 text-red-700 border border-red-300 dark:bg-red-950/40 dark:text-red-300",
  not_set: "bg-amber-50 text-amber-800 border border-amber-300 dark:bg-amber-950/40 dark:text-amber-300",
  ok: "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300",
};

export function ResultBadge({ line }: { line: Pick<CheckLine, "result" | "stock_after" | "unit"> }) {
  const label =
    line.result === "short" && line.stock_after != null
      ? `Short ${fmtQty(-line.stock_after)}`
      : RESULT_LABEL[line.result];
  return (
    <span className={cn("inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", RESULT_BADGE[line.result])}>
      {label}
    </span>
  );
}

interface Props {
  lines: CheckLine[];
  // preview: Draft / not yet approved — nothing saved, nobody notified.
  mode: "preview" | "saved";
  savedAt?: string | null;
  closedReason?: string | null;
  showPurchaseStatus?: boolean;
}

// The red "Raw material check" box shown on an order.
export function MaterialCheckPanel({ lines, mode, savedAt, closedReason, showPurchaseStatus }: Props) {
  const sorted = sortLines(lines);
  const problems = sorted.filter((l) => l.result !== "ok" || l.count_is_old);
  const fine = sorted.filter((l) => l.result === "ok" && !l.count_is_old);
  const counts = issueCounts(lines);
  const bad = hasIssues(lines);

  if (lines.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        No order lines with products yet — nothing to check.
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border",
        bad ? "border-red-300 dark:border-red-900" : "border-emerald-200 dark:border-emerald-900",
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-start gap-3 px-4 py-3",
          bad ? "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200" : "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
        )}
      >
        {bad ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" /> : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />}
        <div className="flex-1 min-w-[220px]">
          <div className="font-semibold">
            {mode === "preview" ? "Stock preview" : "Raw material check"}
            {bad && (
              <span className="ml-2 font-normal">
                {[
                  counts.short && `${counts.short} short`,
                  counts.below_min && `${counts.below_min} below min stock`,
                  counts.unknown && `${counts.unknown} stock unknown`,
                  counts.not_set && `${counts.not_set} materials not set`,
                  counts.old && `${counts.old} old count`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm opacity-90">
            {mode === "preview"
              ? "Only you can see this — no one is notified until the order is confirmed / approved."
              : "Warning only — the order is not blocked. The system only suggests what to buy; Purchase decides and creates the PO."}
          </p>
        </div>
        {mode === "saved" && savedAt && (
          <span className="text-xs opacity-80 whitespace-nowrap">
            {closedReason ? `Closed (${closedReason}) · ` : "Snapshot saved · "}
            {new Date(savedAt).toLocaleString()}
          </span>
        )}
      </div>

      {problems.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2">Material</th>
                <th className="px-3 py-2">Used by</th>
                <th className="px-3 py-2 text-right">Needed (incl. wastage)</th>
                <th className="px-3 py-2 text-right">Stock now</th>
                <th className="px-3 py-2 text-right">After order</th>
                <th className="px-3 py-2 text-right">Min stock</th>
                <th className="px-3 py-2">Result</th>
                <th className="px-3 py-2 text-right">Suggest buying</th>
                {showPurchaseStatus && <th className="px-4 py-2">Purchase status</th>}
              </tr>
            </thead>
            <tbody>
              {problems.map((l, i) => (
                <tr key={(l.item_id ?? l.item_name) + i} className="border-t bg-red-50/40 dark:bg-red-950/10">
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{l.item_name}</div>
                    {l.slots && <div className="text-xs text-muted-foreground">{l.slots}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {l.result === "not_set" ? "Set materials on Products / SKUs" : l.used_by}
                  </td>
                  <td className="px-3 py-2.5 text-right">{l.result === "not_set" ? `${fmtQty(l.needed)} dz` : fmtQty(l.needed, l.unit)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {fmtQty(l.stock_now, l.unit)}
                    <div className="text-xs text-muted-foreground">
                      {l.result === "not_set"
                        ? ""
                        : l.last_count_date
                          ? `count ${l.last_count_date} + GRN`
                          : "never counted"}
                    </div>
                  </td>
                  <td className={cn("px-3 py-2.5 text-right font-semibold", (l.stock_after ?? 0) < 0 && "text-red-600")}>
                    {fmtQty(l.stock_after, l.unit)}
                  </td>
                  <td className="px-3 py-2.5 text-right">{fmtQty(l.min_stock, l.unit)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col items-start gap-1">
                      <ResultBadge line={l} />
                      {l.count_is_old && l.result !== "unknown" && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 border border-amber-300 dark:bg-amber-950/40 dark:text-amber-300">
                          Old count
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold">
                    {l.result === "unknown" ? "Count first" : l.suggest_qty ? fmtQty(l.suggest_qty, l.unit) : "—"}
                  </td>
                  {showPurchaseStatus && (
                    <td className="px-4 py-2.5 text-xs">
                      {l.purchase_status ? PURCHASE_STATUS_LABEL[l.purchase_status] : "—"}
                      {l.po_reference ? ` · ${l.po_reference}` : ""}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {fine.length > 0 && (
        <div className="flex items-start gap-2 border-t px-4 py-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <span>
            {fine.length} material{fine.length === 1 ? "" : "s"} fine — {fine.map((l) => l.item_name).join(", ")}
          </span>
        </div>
      )}
      <div className="border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
        Stock now = last stock count + GRN received since. Suggest buying = needed − stock now + min stock (never above max stock).
      </div>
    </div>
  );
}
