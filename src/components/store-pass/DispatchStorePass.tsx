import { Link } from "react-router-dom";
import { format } from "date-fns";
import { spStatusMeta, type DispatchStorePass } from "@/lib/storePass";

// Store pass no. / issue time for dispatch lists. Read-only: the dispatch
// pages keep working exactly as before, this is an extra column.

export function StorePassNoCell({ sp }: { sp?: DispatchStorePass }) {
  if (!sp) return <span className="text-muted-foreground">—</span>;
  return (
    <div>
      <Link to={`/store-pass/passes/${sp.store_pass_id}`} className="font-mono text-sm text-primary hover:underline">
        {sp.pass_number}
      </Link>
      <div className="text-xs text-muted-foreground whitespace-nowrap">
        {sp.status === "issued" && sp.issued_at ? format(new Date(sp.issued_at), "dd MMM, HH:mm") : spStatusMeta(sp.status).label}
      </div>
    </div>
  );
}
