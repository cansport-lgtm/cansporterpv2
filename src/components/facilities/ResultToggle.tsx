import { cn } from "@/lib/utils";

export type ResultOption = { value: string; label: string; tone: "ok" | "warn" | "bad" | "na" };

const TONE: Record<ResultOption["tone"], string> = {
  ok: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200",
  warn: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200",
  bad: "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-200",
  na: "bg-muted text-foreground border-border",
};

/** A row of big tap targets for one line's result (phone first). */
export function ResultToggle({
  value, options, onChange, disabled,
}: {
  value: string | null;
  options: ResultOption[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex-1 min-w-[64px] rounded-md border px-2 py-2 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
              on ? TONE[o.tone] : "bg-background text-muted-foreground border-border hover:bg-muted",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
