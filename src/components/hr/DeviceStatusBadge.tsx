import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { bioDb, bridgeState, fmtDateTime, type DeviceStatusRow } from "@/lib/biometricAttendance";
import { cn } from "@/lib/utils";

const META = {
  online: { label: "Online", cls: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
  device_offline: { label: "Device offline", cls: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  bridge_offline: { label: "Offline", cls: "bg-red-500/15 text-red-600 border-red-500/30" },
  never: { label: "No bridge yet", cls: "bg-muted text-muted-foreground" },
} as const;

export function useDeviceStatus() {
  return useQuery({
    queryKey: ["device-status"],
    refetchInterval: 30_000,
    queryFn: async (): Promise<DeviceStatusRow[]> => {
      const { data, error } = await bioDb.from("device_status").select("*").order("device_serial");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Online / Offline badge with last sync and bridge version. */
export function DeviceStatusBadge({ className }: { className?: string }) {
  const { data = [] } = useDeviceStatus();
  const s = data[0] ?? null;
  const meta = META[bridgeState(s)];
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-sm", className)}>
      <Badge variant="outline" className={cn("gap-1.5", meta.cls)}>
        <span className="h-2 w-2 rounded-full bg-current" />
        {meta.label}
      </Badge>
      {s && (
        <span className="text-muted-foreground">
          {s.device_serial} · last sync {fmtDateTime(s.last_sync_at)} · bridge v{s.bridge_version ?? "?"} ·
          heard {fmtDateTime(s.received_at)}
        </span>
      )}
    </div>
  );
}
