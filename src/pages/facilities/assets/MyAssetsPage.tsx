import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Check, Loader2 } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, fcDb, fmtDate } from "@/lib/facilities";
import {
  MOVEMENT_SELECT, acknowledgeMovement, conditionMeta, loadCustody, loadEmployeeSims, loadMyEmployee, type MovementRow,
} from "@/lib/facilitiesAssets";

/**
 * Self service: the office assets and SIMs the logged-in user's employee
 * record holds, and the issues still waiting for their acknowledgement.
 */
export default function MyAssetsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: ["facilities-my-employee", user?.id],
    enabled: Boolean(user?.id),
    queryFn: () => loadMyEmployee(user!.id),
  });
  const { data: custody = [] } = useQuery({ queryKey: ["facilities-asset-custody"], queryFn: loadCustody, enabled: Boolean(me) });
  const { data: sims = [] } = useQuery({
    queryKey: ["facilities-employee-sims", me?.id], enabled: Boolean(me), queryFn: () => loadEmployeeSims(me!.id),
  });
  const { data: pending = [] } = useQuery<MovementRow[]>({
    queryKey: ["facilities-my-pending-acks", me?.id],
    enabled: Boolean(me),
    queryFn: async () => {
      const { data, error } = await fcDb
        .from("facilities_asset_movements").select(MOVEMENT_SELECT)
        .eq("to_employee_id", me!.id).eq("ack_status", "pending").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const ack = useMutation({
    mutationFn: (id: string) => acknowledgeMovement(id),
    onSuccess: () => {
      toast({ title: "Receipt acknowledged" });
      queryClient.invalidateQueries({ queryKey: ["facilities-my-pending-acks"] });
      queryClient.invalidateQueries({ queryKey: ["facilities-asset-movements"] });
    },
    onError: (e) => toast({ title: "Not acknowledged", description: errorMessage(e), variant: "destructive" }),
  });

  const mine = custody.filter((r) => r.holder_employee_id === me?.id);

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title="My Assets" description="The office assets and SIM cards issued to you" icon={Archive} />

        {!meLoading && !me && (
          <Card><CardContent className="pt-4 text-sm text-muted-foreground">
            Your login is not linked to a staff record. Ask HR to link it on HR › Employees.
          </CardContent></Card>
        )}

        {pending.length > 0 && (
          <Card className="border-amber-300">
            <CardHeader className="pb-2"><CardTitle className="text-base">Waiting for your acknowledgement</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {pending.map((m) => (
                <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3">
                  <div>
                    <div className="font-medium"><span className="font-mono text-xs text-muted-foreground">{m.asset?.asset_code}</span> {m.asset?.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {m.movement_type === "transfer" ? "Transferred to you" : "Issued to you"} on {fmtDate(m.movement_date)}
                      {m.accessories ? ` · ${m.accessories}` : ""} · condition {conditionMeta(m.condition).label.toLowerCase()}
                    </div>
                  </div>
                  <Button onClick={() => ack.mutate(m.id)} disabled={ack.isPending}>
                    {ack.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />} I received it
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Office assets with me</CardTitle></CardHeader>
          <CardContent>
            {mine.length === 0 ? (
              <p className="text-sm text-muted-foreground">No office asset is issued to you.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {mine.map((a) => {
                  const cond = conditionMeta(a.condition);
                  return (
                    <li key={a.fixed_asset_id} className="rounded border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium"><span className="font-mono text-xs text-muted-foreground">{a.asset_code}</span> {a.name}</span>
                        <Badge variant={cond.variant}>{cond.label}</Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">Since {fmtDate(a.since)}{a.accessories ? ` · ${a.accessories}` : ""}</div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">SIM cards with me</CardTitle></CardHeader>
          <CardContent>
            {sims.length === 0 ? (
              <p className="text-sm text-muted-foreground">No company SIM is issued to you.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {sims.map((s) => (
                  <li key={s.id} className="rounded border p-3 flex items-center justify-between gap-2">
                    <span className="font-mono">{s.sim_number}</span>
                    <span className="text-sm text-muted-foreground">{s.network} · {s.status.replace(/_/g, " ")}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
