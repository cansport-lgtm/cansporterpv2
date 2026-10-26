import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  EDIT_FIELD_LABELS,
  editedOriginal,
  formatEditValue,
  isEditedField,
  type EditedEntryFlags,
} from "@/lib/productionEntryEdits";

/** Tailwind classes that mark an edited figure (amber background + underline). */
export const EDITED_VALUE_CLASS =
  "rounded-sm bg-amber-100 px-1 ring-1 ring-inset ring-amber-300 text-amber-900 underline decoration-amber-500 decoration-dotted underline-offset-2 dark:bg-amber-950/60 dark:text-amber-100 dark:ring-amber-700";

/** Classes for a whole table cell / card row of an edited field. */
export function editedCellClass(entry: EditedEntryFlags | null | undefined, field: string, base?: string): string {
  return cn(base, isEditedField(entry, field) && "bg-amber-50 dark:bg-amber-950/30");
}

interface EditedValueProps {
  entry: EditedEntryFlags | null | undefined;
  /** Column name on production_entries, e.g. "quantity_produced". */
  field: string;
  children: ReactNode;
  className?: string;
  /** Optional resolver for id fields (department / grade) so "was X" shows a name. */
  formatOriginal?: (value: unknown) => string;
}

/**
 * Wraps a displayed figure. When the field was edited after the first save,
 * the figure is highlighted in amber and the tooltip shows the original value.
 * Untouched fields render the children unchanged.
 */
export function EditedValue({ entry, field, children, className, formatOriginal }: EditedValueProps) {
  if (!isEditedField(entry, field)) return <>{children}</>;
  const original = editedOriginal(entry, field);
  const was = formatOriginal ? formatOriginal(original) : formatEditValue(field, original);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn(EDITED_VALUE_CLASS, className)}>{children}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <span className="font-medium">{EDIT_FIELD_LABELS[field] ?? field} edited</span>
        <span className="text-muted-foreground"> · was {was}</span>
      </TooltipContent>
    </Tooltip>
  );
}
