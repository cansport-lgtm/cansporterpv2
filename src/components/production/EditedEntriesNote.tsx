import { Link } from "react-router-dom";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { countEditedEntries, ENTRY_EDITS_ROUTE, type EditedEntryFlags } from "@/lib/productionEntryEdits";

interface EditedEntriesNoteProps {
  entries: ReadonlyArray<EditedEntryFlags> | null | undefined;
  /** Shown before the count, e.g. "This figure". Default: "Includes". */
  prefix?: string;
  className?: string;
  /** Link the note to the edit log (default true). */
  link?: boolean;
}

/**
 * "Includes N edited entries" note for totals, charts and reports built from
 * production entries, so an aggregate never hides that its inputs changed.
 * Renders nothing when no entry in the set was edited.
 */
export function EditedEntriesNote({ entries, prefix = "Includes", className, link = true }: EditedEntriesNoteProps) {
  const n = countEditedEntries(entries);
  if (n === 0) return null;
  const text = `${prefix} ${n} edited ${n === 1 ? "entry" : "entries"}`;
  const inner = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-orange-300 bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-800 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-200",
        className,
      )}
    >
      <Pencil className="h-3 w-3" />
      {text}
    </span>
  );
  if (!link) return inner;
  return (
    <Link to={ENTRY_EDITS_ROUTE} className="hover:opacity-80" title="Open the production entry edit log">
      {inner}
    </Link>
  );
}
