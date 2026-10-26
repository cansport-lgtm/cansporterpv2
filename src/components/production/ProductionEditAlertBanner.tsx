import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { AlertOctagon, Check, CheckCheck, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { primeGateAlarm } from "@/lib/gateAlarm";
import {
  acknowledgeAllProductionEntryEdits,
  acknowledgeProductionEntryEdits,
  ENTRY_EDITS_ROUTE,
  useUnacknowledgedProductionEntryEdits,
  useProductionEntriesLive,
} from "@/lib/productionEntryEdits";

/**
 * Super admin extra alert: a red bar at the top of every page listing the
 * production entry edits nobody has acknowledged yet. It stays until each
 * edit is acknowledged (here or on the edit log page). Also unlocks sound on
 * the first tap so the arrival alarm (see useNotifications) can play.
 */
export function ProductionEditAlertBanner() {
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);

  const { data: open = [] } = useUnacknowledgedProductionEntryEdits(50);
  useProductionEntriesLive([]);

  // Browsers only allow sound after a user gesture: prime once per page load.
  useEffect(() => {
    if (!isSuperAdmin) return;
    const prime = () => {
      primeGateAlarm();
      window.removeEventListener("pointerdown", prime);
      window.removeEventListener("keydown", prime);
    };
    window.addEventListener("pointerdown", prime);
    window.addEventListener("keydown", prime);
    return () => {
      window.removeEventListener("pointerdown", prime);
      window.removeEventListener("keydown", prime);
    };
  }, [isSuperAdmin]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["production-entry-edits-open"] });
    queryClient.invalidateQueries({ queryKey: ["production-entry-edits"] });
    queryClient.invalidateQueries({ queryKey: ["production-entry-edits-log"] });
  };

  const ackOne = useMutation({
    mutationFn: (id: string) => acknowledgeProductionEntryEdits([id]),
    onSuccess: refresh,
    onError: (e: Error) => toast({ title: "Could not acknowledge", description: e.message, variant: "destructive" }),
  });
  const ackAll = useMutation({
    mutationFn: acknowledgeAllProductionEntryEdits,
    onSuccess: (n) => {
      refresh();
      toast({ title: "Acknowledged", description: `${n} edit${n === 1 ? "" : "s"} acknowledged.` });
    },
    onError: (e: Error) => toast({ title: "Could not acknowledge", description: e.message, variant: "destructive" }),
  });

  if (!isSuperAdmin || open.length === 0) return null;

  const shown = expanded ? open : open.slice(0, 3);

  return (
    <div
      role="alert"
      className="border-b-2 border-red-600 bg-red-600 text-white shadow-md dark:bg-red-700"
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 sm:px-4">
        <AlertOctagon className="h-5 w-5 shrink-0 animate-pulse" />
        <div className="min-w-0 flex-1 text-sm font-semibold">
          {open.length} production entry edit{open.length === 1 ? "" : "s"} need{open.length === 1 ? "s" : ""} your acknowledgement
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 bg-white/15 text-white hover:bg-white/25"
          onClick={() => navigate(`${ENTRY_EDITS_ROUTE}?open=1`)}
        >
          Open log
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 bg-white text-red-700 hover:bg-red-50"
          onClick={() => ackAll.mutate()}
          disabled={ackAll.isPending}
        >
          <CheckCheck className="mr-1 h-4 w-4" />
          Acknowledge all
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-white hover:bg-white/20"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>
      <ul className="divide-y divide-white/20 border-t border-white/20 bg-red-700/60 text-xs dark:bg-red-800/60">
        {shown.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 sm:px-4">
            <span className="font-semibold">
              {e.department_name ?? "Production"} · {format(new Date(e.entry_date), "dd MMM")} · {e.shift ?? ""} · {e.grade_code ?? "?"}
            </span>
            <span className="min-w-0 flex-1 truncate">{e.summary}</span>
            <span className="opacity-90">
              {e.edited_by_name ?? "Unknown"} · {format(new Date(e.edited_at), "dd MMM HH:mm")}
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded bg-white/15 px-2 py-0.5 font-medium hover:bg-white/30 disabled:opacity-50"
              onClick={() => ackOne.mutate(e.id)}
              disabled={ackOne.isPending}
            >
              <Check className="h-3 w-3" /> Acknowledge
            </button>
          </li>
        ))}
        {!expanded && open.length > 3 && (
          <li className="px-3 py-1 opacity-90 sm:px-4">
            <button type="button" className="underline" onClick={() => setExpanded(true)}>
              and {open.length - 3} more…
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
