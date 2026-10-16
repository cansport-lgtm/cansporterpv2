import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2, FileText, Loader2, LogOut, Pencil, Plus, ScanLine, Truck } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/gatePass";
import {
  fmtInAt, giDb, inwardReference, inwardStatusMeta, kindMeta, type InwardEntry,
} from "@/lib/gateInward";

/**
 * Inward mode on the Gate Check page: open an inward entry by its GIN number
 * (scan or typed) to see it and tap "Vehicle left"; or start a new entry.
 * `lookupId` changes on every Open / scan.
 */
export function InwardGatePanel({ number, lookupId, onReset }: { number: string | null; lookupId: number; onReset: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const loggedRef = useRef(-1);
  const [left, setLeft] = useState<string | null>(null);

  const { data: entry, isFetching, isFetched } = useQuery<InwardEntry | null>({
    queryKey: ["gate-check-inward", number],
    enabled: Boolean(number),
    queryFn: async () => {
      const { data, error } = await giDb.from("v_gate_inward_register").select("*").eq("entry_number", number).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => { setLeft(null); }, [lookupId]);

  // An entry that is no longer at the gate was opened again: just log it (no alarm).
  useEffect(() => {
    if (!entry || isFetching || loggedRef.current === lookupId) return;
    loggedRef.current = lookupId;
    if (entry.status !== "at_gate") giDb.rpc("gate_inward_log_rescan", { p_id: entry.id });
  }, [entry, isFetching, lookupId]);

  const vehicleOut = useMutation({
    mutationFn: async () => {
      const { data, error } = await giDb.rpc("gate_inward_vehicle_out", { p_id: entry!.id });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (at) => {
      setLeft(at);
      queryClient.invalidateQueries({ queryKey: ["gate-check-inward", number] });
      queryClient.invalidateQueries({ queryKey: ["gate-inward"] });
    },
    onError: (e) => toast({ title: "Could not record", description: errorMessage(e), variant: "destructive" }),
  });

  if (!number) {
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="text-sm text-muted-foreground">
            A vehicle bringing goods in? Record it before it is unloaded. Scan or type a GIN number to open an entry made earlier.
          </div>
          <Button className="w-full h-14 text-lg font-bold" onClick={() => navigate("/gate-pass/inward/new")}>
            <Plus className="h-5 w-5 mr-2" /> New inward entry
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (isFetching && !entry) {
    return <div className="flex justify-center py-8 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (isFetched && !isFetching && !entry) {
    return (
      <Card><CardContent className="p-6 text-center space-y-3">
        <div className="text-muted-foreground">No inward entry {number}.</div>
        <Button variant="outline" className="w-full h-11" onClick={onReset}><ScanLine className="h-5 w-5 mr-2" /> Check another</Button>
      </CardContent></Card>
    );
  }
  if (!entry) return null;

  const kind = kindMeta(entry.entry_kind);
  const status = inwardStatusMeta(entry.status);
  const ref = inwardReference(entry);
  const outAt = left ?? entry.vehicle_out_at;
  const canEdit = entry.status === "at_gate" && entry.created_by === user?.id;

  return (
    <>
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="font-display text-2xl font-bold">{entry.entry_number}</div>
            <span className={`text-xs font-semibold rounded-full px-2 py-1 ring-1 ring-inset ${kind.badgeClass}`}>Inward · {kind.label}</span>
          </div>
          <div className="text-sm">
            <b>{entry.party_name}</b>{ref ? <span className="text-muted-foreground"> · {ref}</span> : null}
          </div>
          <div className="text-sm">
            Vehicle <b>{entry.vehicle_number}</b>{entry.driver_name ? <> · Driver <b>{entry.driver_name}</b></> : null}
          </div>
          <div className="text-sm text-muted-foreground">In at {fmtInAt(entry.in_at)} · by {entry.created_by_name ?? "—"}</div>
          <div className="flex items-center gap-2 pt-1">
            <Badge variant={status.variant}>{status.label}</Badge>
            {outAt && <span className="text-xs text-muted-foreground">Vehicle left {fmtInAt(outAt)}</span>}
          </div>
        </CardContent>
      </Card>

      {left ? (
        <Card className="border-emerald-300 bg-emerald-50">
          <CardContent className="p-5 text-center space-y-2">
            <CheckCircle2 className="h-12 w-12 text-emerald-700 mx-auto" />
            <div className="text-xl font-bold text-emerald-800">Vehicle left — recorded</div>
            <Button className="w-full h-12 mt-2" onClick={onReset}><ScanLine className="h-5 w-5 mr-2" /> Check the next one</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="sticky bottom-0 bg-background/95 backdrop-blur py-3 space-y-2">
          {entry.status === "at_gate" && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex gap-2">
              <Truck className="h-5 w-5 shrink-0 text-amber-700" />
              Still at the gate: the store has not received it yet. Tap below when the empty vehicle goes out.
            </div>
          )}
          {!outAt && (
            <Button className="w-full h-14 text-lg font-bold" disabled={vehicleOut.isPending} onClick={() => vehicleOut.mutate()}>
              {vehicleOut.isPending ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <LogOut className="h-5 w-5 mr-2" />}
              Vehicle left
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 h-11" asChild>
              <Link to={`/gate-pass/inward/${entry.id}`}><FileText className="h-4 w-4 mr-1" /> Open / print slip</Link>
            </Button>
            {canEdit && (
              <Button variant="outline" className="flex-1 h-11" asChild>
                <Link to={`/gate-pass/inward/edit/${entry.id}`}><Pencil className="h-4 w-4 mr-1" /> Edit</Link>
              </Button>
            )}
          </div>
          <Button variant="ghost" className="w-full h-10" onClick={onReset}>Check another</Button>
        </div>
      )}
    </>
  );
}
