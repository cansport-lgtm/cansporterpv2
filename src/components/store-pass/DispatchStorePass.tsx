import { useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Link2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { spStatusMeta, type DispatchStorePass } from "@/lib/storePass";
import { LinkStorePassDialog } from "./LinkStorePassDialog";

// Store pass no. / issue time for dispatch lists. Read-only by default: the
// dispatch pages keep working exactly as before, this is an extra column.
// With `dispatch` given (only for roles that may link — the dispatch operator),
// the cell also opens the Link store pass dialog.

export function StorePassNoCell({ sp, dispatch }: { sp?: DispatchStorePass; dispatch?: { id: string; dispatch_number: string } }) {
  const { hasModulePermission } = useAuth();
  const [open, setOpen] = useState(false);
  // The dispatch operator has no Store Pass pages: show the number without a link.
  const canOpenPass = hasModulePermission("store_pass", "view");

  const number = sp ? (
    <div>
      {canOpenPass ? (
        <Link to={`/store-pass/passes/${sp.store_pass_id}`} className="font-mono text-sm text-primary hover:underline">{sp.pass_number}</Link>
      ) : (
        <span className="font-mono text-sm">{sp.pass_number}</span>
      )}
      <div className="text-xs text-muted-foreground whitespace-nowrap">
        {sp.status === "issued" && sp.issued_at ? format(new Date(sp.issued_at), "dd MMM, HH:mm") : spStatusMeta(sp.status).label}
      </div>
    </div>
  ) : (
    <span className="text-muted-foreground">—</span>
  );

  if (!dispatch) return number;
  return (
    <div className="flex items-center gap-1">
      {number}
      <Button
        variant={sp ? "ghost" : "outline"} size="sm" className="h-7 px-2 text-xs"
        title={sp ? `Change the store pass of ${dispatch.dispatch_number}` : `Link ${dispatch.dispatch_number} to its store pass`}
        onClick={() => setOpen(true)}
      >
        <Link2 className="h-3.5 w-3.5 mr-1" /> {sp ? "Change" : "Link"}
      </Button>
      {open && <LinkStorePassDialog dispatch={dispatch} current={sp} open={open} onOpenChange={setOpen} />}
    </div>
  );
}
