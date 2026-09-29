import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format, subDays } from "date-fns";
import { Siren } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { gpDb } from "@/lib/gatePass";

type RescanRow = {
  id: string;
  message: string | null;
  created_at: string;
  actor: { full_name: string | null } | null;
  gate_passes: { id: string; pass_number: string; party_name: string } | null;
};

// Old passes scanned again at the gate in the last `days` days. Hidden when there are none.
export function RescanAlerts({ days = 7 }: { days?: number }) {
  const { data: rows = [] } = useQuery<RescanRow[]>({
    queryKey: ["gate-pass-rescans", days],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await gpDb
        .from("gate_pass_events")
        .select("id, message, created_at, actor:app_users!gate_pass_events_created_by_fkey(full_name), gate_passes(id, pass_number, party_name)")
        .eq("event", "rescan_attempt")
        .gte("created_at", subDays(new Date(), days).toISOString())
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  if (rows.length === 0) return null;
  return (
    <Card className="border-red-300 bg-red-50/70">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 text-red-700">
          <Siren className="h-4 w-4" /> Old passes scanned again at the gate · last {days} days · {rows.length}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-col sm:flex-row sm:items-center gap-x-3 text-sm border-b border-red-200 last:border-0 pb-1.5">
            <span className="text-xs text-muted-foreground whitespace-nowrap">{format(new Date(r.created_at), "dd MMM HH:mm")}</span>
            {r.gate_passes ? (
              <Link to={`/gate-pass/passes/${r.gate_passes.id}`} className="font-semibold text-red-800 hover:underline whitespace-nowrap">
                {r.gate_passes.pass_number}
              </Link>
            ) : null}
            <span className="truncate">{r.gate_passes?.party_name}</span>
            <span className="text-xs text-red-900 sm:ml-auto sm:text-right">
              by {r.actor?.full_name ?? "gate"}{r.message ? ` — ${r.message}` : ""}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
