import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Ban } from "lucide-react";
import { cn } from "@/lib/utils";
import { spDb, type GateStoreStatus } from "@/lib/storePass";
import type { GatePass } from "@/lib/gatePass";

// On the Gate Check page: a sales pass whose domestic dispatch has no issued
// store pass. The setting store_pass_settings.required_at_gate decides:
// warn → the guard may continue (logged, store managers told); block → the
// database refuses the check and the button is disabled here too.
export function StorePassGateNotice({ pass, onStatus }: { pass: GatePass; onStatus?: (blocked: boolean) => void }) {
  const { data } = useQuery<GateStoreStatus>({
    queryKey: ["store-pass-gate-status", pass.id, pass.status],
    enabled: pass.pass_type === "sales",
    queryFn: async () => {
      const { data, error } = await spDb.rpc("store_pass_gate_status", { p_gate_pass_id: pass.id });
      // Missing until the store pass migration is applied: no notice, never break the gate.
      if (error) return { mode: "off", missing: [] };
      return data as GateStoreStatus;
    },
  });
  const blocked = Boolean(data && data.mode === "block" && data.missing.length > 0);
  useEffect(() => { onStatus?.(blocked); }, [blocked, onStatus]);

  if (!data || data.mode === "off" || data.missing.length === 0) return null;
  const block = data.mode === "block";
  return (
    <div role="alert" className={cn("rounded-xl border p-3 flex gap-3 text-sm",
      block ? "border-red-300 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-900")}>
      {block ? <Ban className="h-5 w-5 shrink-0 text-red-700" /> : <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" />}
      <div className="space-y-1">
        <div className="font-bold">No store pass for {data.missing.join(", ")}</div>
        <div>
          {block
            ? "The store has not issued a store pass for this dispatch. The vehicle cannot leave until it does. Call the store."
            : "The store has not issued a store pass for this dispatch. You may still count and let the vehicle out; the store managers are being told and it will show in today's reconciliation."}
        </div>
      </div>
    </div>
  );
}
