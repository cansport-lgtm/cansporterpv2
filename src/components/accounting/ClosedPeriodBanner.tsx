import { Lock } from "lucide-react";
import { format } from "date-fns";
import { useClosingDate } from "@/lib/accounting/periodLock";

export function ClosedPeriodBanner() {
  const { closedThrough } = useClosingDate();
  if (!closedThrough) return null;
  return (
    <div className="mb-3 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <Lock className="h-3.5 w-3.5 shrink-0" />
      Books are closed through <strong>{format(new Date(`${closedThrough}T00:00:00`), "dd MMM yyyy")}</strong>. Entries dated on or before this date cannot be posted or edited.
    </div>
  );
}
