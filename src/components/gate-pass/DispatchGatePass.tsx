import { Link } from "react-router-dom";
import { format } from "date-fns";
import { statusMeta, type DispatchGatePass } from "@/lib/gatePass";

// Gate pass no. / gate-out time for dispatch lists. Read-only: the dispatch
// pages keep working exactly as before, these are extra columns.

export function GatePassNoCell({ gp }: { gp?: DispatchGatePass }) {
  if (!gp) return <span className="text-muted-foreground">—</span>;
  return (
    <div>
      <Link to={`/gate-pass/passes/${gp.gate_pass_id}`} className="font-mono text-sm text-primary hover:underline">
        {gp.pass_number}
      </Link>
      {gp.status !== "out" && <div className="text-xs text-muted-foreground">{statusMeta(gp.status).label}</div>}
    </div>
  );
}

export function GateOutCell({ gp }: { gp?: DispatchGatePass }) {
  if (!gp?.gate_out_at) return <span className="text-muted-foreground">—</span>;
  return <span className="text-sm whitespace-nowrap">{format(new Date(gp.gate_out_at), "dd MMM, HH:mm")}</span>;
}
