import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface SearchableSelectOption {
  value: string;
  label: string;
  /** Optional secondary text shown after the label (e.g. product code, party type) */
  secondary?: string;
  /** Optional extra haystack text used for matching but not displayed (e.g. customer code, NTN) */
  search?: string;
}

interface SearchableSelectProps {
  value: string;
  onValueChange: (v: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  emptyText?: string;
  /** Tailwind width class for the trigger button (default w-full) */
  triggerClassName?: string;
  /** Disable user interaction */
  disabled?: boolean;
  /** Sort options alphabetically by label before rendering (default true) */
  sortAlpha?: boolean;
}

/**
 * Drop-in replacement for the standard <Select> used across posting forms.
 *
 * - Typeahead filter (matches label + secondary + search haystack)
 * - Alpha-sorted by default — fastest visual scan when typing the first letter
 * - Keyboard friendly (cmdk handles arrow keys + enter)
 * - Designed for long lists (chart of accounts, parties, products) where the
 *   plain Select forces a manual scroll
 */
export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  emptyText = "No matches.",
  triggerClassName = "w-full",
  disabled,
  sortAlpha = true,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);

  const sorted = useMemo(() => {
    if (!sortAlpha) return options;
    return [...options].sort((a, b) => (a.label || "").localeCompare(b.label || "", undefined, { sensitivity: "base" }));
  }, [options, sortAlpha]);

  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("justify-between font-normal", triggerClassName)}
        >
          <span className="truncate text-left">
            {selected ? (
              <>
                {selected.label}
                {selected.secondary && <span className="text-xs text-muted-foreground ml-1">{selected.secondary}</span>}
              </>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)] min-w-[280px]" align="start">
        <Command
          filter={(itemValue, search) => {
            // itemValue is whatever we pass as <CommandItem value=...>. We build it
            // to include label + secondary + search so any of them can match.
            const haystack = itemValue.toLowerCase();
            const needle = search.toLowerCase();
            return haystack.includes(needle) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Type to search…" />
          <CommandList className="max-h-[320px]">
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {sorted.map((opt) => {
                const cmdValue = `${opt.label} ${opt.secondary || ""} ${opt.search || ""}`.trim();
                return (
                  <CommandItem
                    key={opt.value}
                    value={cmdValue}
                    onSelect={() => {
                      onValueChange(opt.value);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", value === opt.value ? "opacity-100" : "opacity-0")} />
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
