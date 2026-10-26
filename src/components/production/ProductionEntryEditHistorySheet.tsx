import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  EDIT_FIELD_LABELS,
  formatEditValue,
  useProductionEntryEdits,
  type ProductionEntryEdit,
} from "@/lib/productionEntryEdits";

interface Props {
  /** Entry whose history to show; null keeps the sheet closed. */
  entryId: string | null;
  onClose: () => void;
}

const FIELD_ORDER = Object.keys(EDIT_FIELD_LABELS);

/** Names for id fields so the diff reads "Jorr → Final", not two uuids. */
export function useEditValueLookups(enabled: boolean) {
  return useQuery({
    queryKey: ["production-entry-edit-lookups"],
    queryFn: async () => {
      const [d, s, g, m, u] = await Promise.all([
        supabase.from("production_departments").select("id, name"),
        supabase.from("production_sub_departments").select("id, name"),
        supabase.from("grades").select("id, code"),
        supabase.from("machines").select("id, name"),
        supabase.from("app_users").select("id, full_name"),
      ]);
      const map: Record<string, string> = {};
      for (const r of d.data ?? []) map[r.id] = r.name;
      for (const r of s.data ?? []) map[r.id] = r.name;
      for (const r of g.data ?? []) map[r.id] = r.code;
      for (const r of m.data ?? []) map[r.id] = r.name;
      for (const r of u.data ?? []) map[r.id] = r.full_name;
      return map;
    },
    enabled,
    staleTime: 10 * 60 * 1000,
  });
}

export function displayEditValue(field: string, value: unknown, lookups: Record<string, string> | undefined): string {
  if (typeof value === "string" && lookups && lookups[value]) return lookups[value];
  if (field === "entry_date" && typeof value === "string") {
    try {
      return format(new Date(value), "dd MMM yyyy");
    } catch {
      return value;
    }
  }
  return formatEditValue(field, value);
}

/** One edit, as a list of "Field: old → new" lines. */
export function EditChangeList({ edit, lookups }: { edit: ProductionEntryEdit; lookups?: Record<string, string> }) {
  const fields = FIELD_ORDER.filter((f) => edit.changes && Object.prototype.hasOwnProperty.call(edit.changes, f));
  if (fields.length === 0) return <p className="text-sm text-muted-foreground">{edit.summary}</p>;
  return (
    <ul className="space-y-1 text-sm">
      {fields.map((f) => {
        const c = edit.changes[f];
        return (
          <li key={f} className="flex flex-wrap items-baseline gap-x-2">
            <span className="w-28 shrink-0 text-muted-foreground">{EDIT_FIELD_LABELS[f] ?? f}</span>
            <span className="line-through decoration-red-400 text-muted-foreground">{displayEditValue(f, c.old, lookups)}</span>
            <span aria-hidden>→</span>
            <span className="rounded-sm bg-amber-100 px-1 font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-100">
              {displayEditValue(f, c.new, lookups)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function ProductionEntryEditHistorySheet({ entryId, onClose }: Props) {
  const open = !!entryId;
  const { data: edits, isLoading } = useProductionEntryEdits(entryId);
  const { data: lookups } = useEditValueLookups(open);
  const head = edits?.[0];

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Edit history</SheetTitle>
          <SheetDescription>
            {head
              ? `${head.department_name ?? "Production"} · ${format(new Date(head.entry_date), "dd MMM yyyy")} · ${head.shift ?? ""} · Grade ${head.grade_code ?? "?"}`
              : "Every change made to this production entry after it was first saved."}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && (edits?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">No edits recorded for this entry.</p>
          )}
          {edits?.map((e) => (
            <div key={e.id} className="rounded-lg border border-orange-200 bg-orange-50/40 p-3 dark:border-orange-900 dark:bg-orange-950/20">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">
                  Edit #{e.edit_no} · {e.edited_by_name ?? "Unknown user"}
                </div>
                <div className="text-xs text-muted-foreground">{format(new Date(e.edited_at), "dd MMM yyyy HH:mm")}</div>
              </div>
              <div className="mt-2">
                <EditChangeList edit={e} lookups={lookups} />
              </div>
              <p className="mt-2 text-sm">
                <span className="text-muted-foreground">Reason: </span>
                {e.reason}
              </p>
              <div className="mt-2">
                {e.acknowledged_at ? (
                  <Badge variant="success">
                    Acknowledged by {e.acknowledged_by_user?.full_name ?? "super admin"} ·{" "}
                    {format(new Date(e.acknowledged_at), "dd MMM HH:mm")}
                  </Badge>
                ) : (
                  <Badge variant="warning">Awaiting super admin acknowledgement</Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
