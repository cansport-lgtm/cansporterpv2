import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { SearchableSelectOption } from "./SearchableSelect";

interface MultiSearchableSelectProps {
  values: string[];
  onValuesChange: (v: string[]) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  emptyText?: string;
  /** Tailwind width class for the trigger button (default w-full) */
  triggerClassName?: string;
  disabled?: boolean;
  /** Sort options alphabetically by label before rendering (default true) */
  sortAlpha?: boolean;
  /** Max chips shown in the trigger before collapsing into "+N more" (default 3) */
  maxChips?: number;
}

/**
 * Multi-select counterpart of <SearchableSelect>: typeahead list with check
 * marks, "Select all" / "Clear" shortcuts, and removable chips in the trigger.
 * The popover stays open while picking so several items can be ticked quickly.
 */
export function MultiSearchableSelect({
  values,
  onValuesChange,
  options,
  placeholder = "Select…",
  emptyText = "No matches.",
  triggerClassName = "w-full",
  disabled,
  sortAlpha = true,
  maxChips = 3,
}: MultiSearchableSelectProps) {
  const [open, setOpen] = useState(false);

  const sorted = useMemo(() => {
    if (!sortAlpha) return options;
    return [...options].sort((a, b) => (a.label || "").localeCompare(b.label || "", undefined, { sensitivity: "base" }));
  }, [options, sortAlpha]);

  const selectedSet = useMemo(() => new Set(values), [values]);
  const selected = sorted.filter((o) => selectedSet.has(o.value));

  const toggle = (value: string) => {
    onValuesChange(selectedSet.has(value) ? values.filter((v) => v !== value) : [...values, value]);
  };

  const allSelected = sorted.length > 0 && sorted.every((o) => selectedSet.has(o.value));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("justify-between font-normal h-auto min-h-10", triggerClassName)}
        >
          <span className="flex flex-wrap gap-1 text-left min-w-0">
            {selected.length === 0 ? (
              <span className="text-muted-foreground">{placeholder}</span>
            ) : (
              <>
                {selected.slice(0, maxChips).map((o) => (
                  <span
                    key={o.value}
                    className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs max-w-[220px]"
                  >
                    <span className="truncate">{o.label}</span>
                    <span
                      role="button"
                      tabIndex={-1}
                      aria-label={`Remove ${o.label}`}
                      className="opacity-60 hover:opacity-100"
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(o.value);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </span>
                  </span>
                ))}
                {selected.length > maxChips && (
                  <span className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs">
                    +{selected.length - maxChips} more
                  </span>
                )}
              </>
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)] min-w-[280px]" align="start">
        <Command
          filter={(itemValue, search) => (itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}
        >
          <CommandInput placeholder="Type to search…" />
          <div className="flex items-center justify-between border-b px-2 py-1.5 text-xs">
            <span className="text-muted-foreground">{values.length} selected</span>
            <div className="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={allSelected}
                onClick={() => onValuesChange(Array.from(new Set([...values, ...sorted.map((o) => o.value)])))}
              >
                Select all
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={values.length === 0}
                onClick={() => onValuesChange([])}
              >
                Clear
              </Button>
            </div>
          </div>
          <CommandList className="max-h-[320px]">
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {sorted.map((opt) => {
                const cmdValue = `${opt.label} ${opt.secondary || ""} ${opt.search || ""} ${opt.value}`.trim();
                const isSelected = selectedSet.has(opt.value);
                return (
                  <CommandItem key={opt.value} value={cmdValue} onSelect={() => toggle(opt.value)}>
                    <span
                      className={cn(
                        "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                        isSelected ? "bg-primary text-primary-foreground" : "opacity-50"
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate">
                      {opt.label}
                      {opt.secondary && <span className="text-xs text-muted-foreground ml-1">{opt.secondary}</span>}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
