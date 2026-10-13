import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format, formatDistanceStrict } from "date-fns";
import { Siren } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { gpDb, isSuperAdmin, passTypeMeta, statusMeta } from "@/lib/gatePass";

const UNSCANNED_STATUSES = ["draft", "pending_approval", "approved", "held"];

type Settings = { unscanned_alert_enabled: boolean; unscanned_alert_hours: number; unscanned_alert_time: string };
type Row = {
  id: string; pass_number: string; pass_type: string; status: string; party_name: string; created_at: string;
  creator: { full_name: string | null } | null;
  gate_pass_unscanned_alerts: { alert_count: number } | null;
};

const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;

// Super admins only: goods passes not scanned at the gate within the set hours of being created.
export function UnscannedAlerts() {
  const { roles } = useAuth();
  const superAdmin = isSuperAdmin(roles);

  const { data: settings } = useQuery<Settings | null>({
    queryKey: ["gate-pass-settings", "unscanned"],
    enabled: superAdmin,
    queryFn: async () => {
      const { data } = await gpDb.from("gate_pass_settings")
        .select("unscanned_alert_enabled, unscanned_alert_hours, unscanned_alert_time").maybeSingle();
      return data ?? null;
    },
  });
  const hours = settings?.unscanned_alert_hours ?? 24;

  const { data: rows = [] } = useQuery<Row[]>({
    queryKey: ["gate-pass-unscanned", hours],
    enabled: superAdmin && !!settings?.unscanned_alert_enabled,
    refetchInterval: 60_000,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();
      const { data, error } = await gpDb
        .from("gate_passes")
        .select("id, pass_number, pass_type, status, party_name, created_at, creator:app_users!gate_passes_created_by_fkey(full_name), gate_pass_unscanned_alerts(alert_count)")
        .in("status", UNSCANNED_STATUSES)
        .lt("created_at", cutoff)
        .order("created_at")
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!superAdmin || !settings?.unscanned_alert_enabled || rows.length === 0) return null;
  const at = settings.unscanned_alert_time.slice(0, 5);
  return (
    <Card className="border-red-300 bg-red-50/70">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex flex-wrap items-center gap-x-2 gap-y-1 text-red-700">
          <Siren className="h-4 w-4" /> Gate passes not scanned for more than {hours} hours · {rows.length}
          <span className="text-xs font-normal text-red-900 sm:ml-auto">Super admins are alerted every day at {at} until each pass is scanned or cancelled</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {rows.map((r) => {
          const count = r.gate_pass_unscanned_alerts?.alert_count ?? 0;
          return (
            <div key={r.id} className="flex flex-col sm:flex-row sm:items-center gap-x-3 gap-y-0.5 text-sm border-b border-red-200 last:border-0 pb-1.5">
              <Link to={`/gate-pass/passes/${r.id}`} className="font-mono font-semibold text-red-800 hover:underline whitespace-nowrap">{r.pass_number}</Link>
              <span className="text-xs text-muted-foreground whitespace-nowrap">{passTypeMeta(r.pass_type).label}</span>
              <span className="truncate">{r.party_name}</span>
              <Badge variant={statusMeta(r.status).variant} className="w-fit">{statusMeta(r.status).label}</Badge>
              <span className="text-xs text-muted-foreground whitespace-nowrap sm:ml-auto">
                created {format(new Date(r.created_at), "dd MMM HH:mm")}{r.creator?.full_name ? ` by ${r.creator.full_name}` : ""}
              </span>
              <span className="font-semibold text-red-700 whitespace-nowrap">{formatDistanceStrict(new Date(r.created_at), new Date())}</span>
              <span className="text-xs text-red-900 whitespace-nowrap">{count ? `${ordinal(count)} alert` : "alert due"}</span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
