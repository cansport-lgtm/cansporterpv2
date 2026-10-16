import { Link } from "react-router-dom";
import { format } from "date-fns";
import { statusMeta, type DispatchGatePass } from "@/lib/gatePass";
import { fmtRs, payerLabel, voucherStatusMeta, type FreightLogRow } from "@/lib/gatePassFreight";

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

/** Freight of the dispatch's gate pass: who paid, or the voucher and whether it is paid. */
export function FreightCell({ fr }: { fr?: FreightLogRow }) {
  if (!fr) return <span className="text-muted-foreground">—</span>;
  if (fr.payer !== "company") return <span className="text-xs text-muted-foreground">{payerLabel(fr.payer)}</span>;
  if (!fr.voucher_number) {
    return <span className="text-xs whitespace-nowrap">{fmtRs(fr.amount)} <span className="text-muted-foreground">· {fr.gate_out_at ? "no voucher" : "at gate out"}</span></span>;
  }
  const st = voucherStatusMeta(fr.voucher_status);
  return (
    <div className="text-xs whitespace-nowrap">
      <span className="font-mono">{fr.voucher_number}</span> · {fmtRs(fr.amount)}
      <div className={st.variant === "success" ? "text-emerald-700" : st.variant === "warning" ? "text-amber-700" : "text-muted-foreground"}>{st.label}</div>
    </div>
  );
}
