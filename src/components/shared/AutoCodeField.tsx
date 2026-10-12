import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Master-data codes are assigned by the database (auto_code_series +
 * trg_00_auto_code) when a record is inserted with a blank code. Forms show
 * the code here read-only: the existing code when editing, or a preview of
 * the next code when creating. The preview is advisory — the trigger
 * recomputes at save time, so concurrent saves never collide.
 */

/** Preview of the code the database will assign to a new record. */
export function useNextCode(entity: string, group?: string | null, enabled = true) {
  return useQuery({
    queryKey: ["auto-code", entity, group ?? null],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("auto_code_preview", {
        p_entity: entity,
        p_group: group ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    enabled,
    staleTime: 0,
    gcTime: 0,
  });
}

interface AutoCodeFieldProps {
  /** Entity key in auto_code_series (usually the table name). */
  entity: string;
  /** Value of the series' grouping column (item type, category, ...), if any. */
  group?: string | null;
  /** The record's current code when editing; omit/empty when creating. */
  value?: string | null;
  /** True when editing an existing record. */
  isEdit?: boolean;
  label?: string;
  id?: string;
  className?: string;
}

export function AutoCodeField({
  entity,
  group,
  value,
  isEdit = false,
  label = "Code",
  id,
  className,
}: AutoCodeFieldProps) {
  const { data: nextCode, isLoading } = useNextCode(entity, group, !isEdit);

  const shown = isEdit ? value || "" : nextCode || "";
  const placeholder = isEdit ? "" : isLoading ? "Generating…" : "Auto-generated";

  return (
    <div className={className ?? "space-y-2"}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={shown} placeholder={placeholder} readOnly disabled className="font-mono" />
      {!isEdit && (
        <p className="text-xs text-muted-foreground">Auto-generated — assigned when you save.</p>
      )}
    </div>
  );
}
