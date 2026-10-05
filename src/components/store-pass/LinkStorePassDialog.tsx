import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link2, Loader2, Unlink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  errorMessage, fmtQty, spDb, spStatusMeta, type DispatchStorePass, type LinkCandidate,
} from "@/lib/storePass";

// The dispatch operator puts a dispatch (DC) on the store pass the keeper issued
// for it. Dispatch-centric: opened from the Store pass column of the Domestic
// Dispatch page. Picks ONE pass; the pass keeps its other links.

type Props = {
  dispatch: { id: string; dispatch_number: string };
  current?: DispatchStorePass;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const INVALIDATE = ["dispatch-store-pass", "store-passes", "store-gate-tracking", "store-gate-recon", "store-pass-link-candidates"];

export function LinkStorePassDialog({ dispatch, current, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [picked, setPicked] = useState<string | null>(null);

  const { data: candidates = [], isLoading } = useQuery<LinkCandidate[]>({
    queryKey: ["store-pass-link-candidates", dispatch.id],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await spDb.rpc("store_pass_link_candidates", { p_dispatch_id: dispatch.id });
      if (error) throw error;
      return (data ?? []) as LinkCandidate[];
    },
  });
  useEffect(() => {
    if (!open) return;
    // Preselect: the pass it is on, else the one whose plan number is this DC.
    const cur = candidates.find((c) => c.is_current) ?? candidates.find((c) => c.plan_matches);
    setPicked(cur?.store_pass_id ?? null);
  }, [open, candidates]);

  const done = (msg: string) => {
    INVALIDATE.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
    toast({ title: msg });
    onOpenChange(false);
  };
  const fail = (e: unknown) => toast({ title: "Could not link", description: errorMessage(e), variant: "destructive" });

  const attach = useMutation({
    mutationFn: async (storePassId: string) => {
      const { error } = await spDb.rpc("store_pass_attach_dispatch", { p_store_pass_id: storePassId, p_dispatch_id: dispatch.id });
      if (error) throw error;
    },
    onSuccess: () => done(`${dispatch.dispatch_number} linked to its store pass`),
    onError: fail,
  });
  const detach = useMutation({
    mutationFn: async () => {
      const { error } = await spDb.rpc("store_pass_detach_dispatch", { p_dispatch_id: dispatch.id });
      if (error) throw error;
    },
    onSuccess: () => done(`${dispatch.dispatch_number} unlinked from ${current?.pass_number ?? "its store pass"}`),
    onError: fail,
  });
  const busy = attach.isPending || detach.isPending;
  const changed = picked !== (current?.store_pass_id ?? null);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Link {dispatch.dispatch_number} to a store pass</DialogTitle>
          <DialogDescription>
            Pick the store pass the keeper issued for these goods. Passes whose plan number is this dispatch come first.
            A dispatch can be on one live store pass; a pass may cover several dispatches.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-auto border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Store pass</TableHead>
                <TableHead>Plan no.</TableHead>
                <TableHead>Handed over to</TableHead>
                <TableHead className="text-right">Items · dz / ctn</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Linked to</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : candidates.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">No store pass to link. The store keeper has not issued one yet.</TableCell></TableRow>
              ) : candidates.map((c) => {
                const checked = picked === c.store_pass_id;
                return (
                  <TableRow key={c.store_pass_id} className={cn("cursor-pointer", checked && "bg-primary/5", c.plan_matches && !checked && "bg-emerald-50/60")}
                    onClick={() => setPicked(checked ? null : c.store_pass_id)}>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox aria-label={`Pick ${c.pass_number}`} checked={checked} onCheckedChange={(v) => setPicked(v === true ? c.store_pass_id : null)} />
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-sm font-semibold">{c.pass_number}</div>
                      <div className="text-xs text-muted-foreground">{format(new Date(c.pass_date), "dd MMM")} · {spStatusMeta(c.status).label}{c.created_by_name ? ` · ${c.created_by_name}` : ""}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {c.dispatch_plan_no ?? "—"}
                      {c.plan_matches && <div className="text-[11px] font-semibold text-emerald-700">matches this DC</div>}
                    </TableCell>
                    <TableCell className="text-sm">{c.received_by_name ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm whitespace-nowrap">{c.item_count} · {fmtQty(c.quantity)} / {Number(c.packages)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{c.issued_at ? format(new Date(c.issued_at), "dd MMM HH:mm") : "not yet"}</TableCell>
                    <TableCell className="text-xs">
                      {c.is_current ? <span className="font-semibold text-primary">this dispatch{c.linked_count > 1 ? ` + ${c.linked_count - 1}` : ""}</span>
                        : c.linked_count ? <span className="text-amber-700">{c.linked_dispatches}</span>
                        : <span className="text-muted-foreground">not linked</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {current && (
              <Button variant="ghost" className="text-destructive" disabled={busy} onClick={() => detach.mutate()}>
                {detach.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Unlink className="h-4 w-4 mr-1" />} Unlink from {current.pass_number}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Back</Button>
            <Button disabled={busy || !picked || !changed} onClick={() => picked && attach.mutate(picked)}>
              {attach.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Link2 className="h-4 w-4 mr-1" />} Link to {candidates.find((c) => c.store_pass_id === picked)?.pass_number ?? "store pass"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
