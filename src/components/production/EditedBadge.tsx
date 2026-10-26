import { useState } from "react";
import { Pencil } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isEditedEntry, type EditedEntryFlags } from "@/lib/productionEntryEdits";
import { ProductionEntryEditHistorySheet } from "./ProductionEntryEditHistorySheet";

interface EditedBadgeProps {
  /** The production entry row (needs id plus the edit flag columns). */
  entry: (EditedEntryFlags & { id: string; last_edited_by_user?: { full_name: string | null } | null }) | null | undefined;
  /** Compact: icon and count only. */
  compact?: boolean;
  className?: string;
}

/**
 * Orange "Edited ×N" chip shown wherever a production entry appears once it
 * has been changed after its first save. Click / tap opens the full edit
 * history (who, when, why, old → new). Renders nothing for untouched entries.
 */
export function EditedBadge({ entry, compact = false, className }: EditedBadgeProps) {
  const [open, setOpen] = useState(false);
  if (!entry || !isEditedEntry(entry)) return null;

  const count = Number(entry.edit_count ?? 0);
  const when = entry.last_edited_at ? formatDistanceToNow(new Date(entry.last_edited_at), { addSuffix: true }) : null;
  const who = entry.last_edited_by_user?.full_name ?? null;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
            }}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border border-orange-300 bg-orange-100 text-orange-800 font-semibold leading-none",
              "hover:bg-orange-200 focus:outline-none focus:ring-2 focus:ring-orange-400 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-200",
              compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
              className,
            )}
            aria-label={`Edited ${count} time${count === 1 ? "" : "s"}. Show edit history`}
          >
            <Pencil className={compact ? "h-2.5 w-2.5" : "h-3 w-3"} />
            {compact ? `×${count}` : `Edited ×${count}`}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          <div className="font-medium">
            Edited {count} time{count === 1 ? "" : "s"}
            {who ? ` · last by ${who}` : ""}
            {when ? ` ${when}` : ""}
          </div>
          {entry.last_edit_reason && <div className="mt-0.5 text-muted-foreground">Reason: {entry.last_edit_reason}</div>}
          <div className="mt-0.5 text-muted-foreground">Click for full history</div>
        </TooltipContent>
      </Tooltip>
      <ProductionEntryEditHistorySheet entryId={open ? entry.id : null} onClose={() => setOpen(false)} />
    </>
  );
}
