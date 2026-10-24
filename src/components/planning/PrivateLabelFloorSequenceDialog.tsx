import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, Factory, Loader2, RefreshCw, Tag, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { updateStatus } from "@/lib/floorUpdateClock";
import { fetchFloorSequence, producedPct, setFloorSequence, type FloorSequenceOrder } from "@/lib/privateLabelJobOrder";
import { PrivateLabelDispatchDialog, type DispatchTarget } from "@/components/planning/PrivateLabelDispatchDialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const priorityColor = (p: string) => {
  switch (p) {
    case "critical":
      return "bg-red-100 text-red-800 border-red-200";
    case "high":
      return "bg-orange-100 text-orange-800 border-orange-200";
    case "medium":
      return "bg-blue-100 text-blue-800 border-blue-200";
    default:
      return "bg-slate-100 text-slate-700 border-slate-200";
  }
};

const move = (list: string[], from: number, to: number) => {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [id] = next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
};

/**
 * Floor sequence: the order in which the floor display lists every Issued
 * order (private label and company products share one queue). Move rows with
 * the buttons and Save; the whole list is written in one go.
 */
export function PrivateLabelFloorSequenceDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const { data: orders = [], isLoading, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["pljo-floor-sequence"],
    queryFn: fetchFloorSequence,
    enabled: open,
  });

  // Working order of ids; reset whenever a fresh list arrives.
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    setIds(orders.map((o) => o.id));
  }, [orders]);

  const byId = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);
  const [dispatchTarget, setDispatchTarget] = useState<DispatchTarget | null>(null);
  const original = useMemo(() => orders.map((o) => o.id).join(","), [orders]);
  const dirty = ids.join(",") !== original;
  const now = new Date();

  const save = useMutation({
    mutationFn: () => setFloorSequence(ids),
    onSuccess: ({ changed }) => {
      toast.success(changed === 0 ? "Floor sequence unchanged" : `Floor sequence saved (${changed} moved)`);
      qc.invalidateQueries({ queryKey: ["pljo-floor-sequence"] });
      qc.invalidateQueries({ queryKey: ["pljo-list"] });
      qc.invalidateQueries({ queryKey: ["pljo-detail"] });
      qc.invalidateQueries({ queryKey: ["pljo-log"] });
      onOpenChange(false);
    },
    onError: (e: Error) => {
      toast.error(e.message);
      // The set of issued orders changed under us: show the live list.
      if (/changed since/i.test(e.message)) refetch();
    },
  });

  const rowInfo = (o: FloorSequenceOrder) => {
    const total = o.private_label_job_order_items.reduce((s, l) => s + Number(l.quantity || 0), 0);
    const done = o.private_label_job_order_progress.reduce((s, p) => s + Number(p.dozens), 0);
    const lastProgress = o.private_label_job_order_progress.reduce<string | null>(
      (m, p) => (!m || p.created_at > m ? p.created_at : m),
      null,
    );
    const lastCheckin = o.private_label_job_order_floor_checkins.reduce<string | null>(
      (m, k) => (!m || k.created_at > m ? k.created_at : m),
      null,
    );
    const lastActivity = [o.issued_at, o.updated_at, lastProgress, lastCheckin]
      .filter((v): v is string => !!v)
      .sort()
      .pop();
    const update = updateStatus(lastActivity ?? null, !!o.production_done_at, now);
    const grade =
      o.grades?.name ??
      Array.from(new Set(o.private_label_job_order_items.map((l) => l.products?.grades?.name).filter(Boolean))).join(", ");
    return { total, done, update, grade };
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Floor sequence</DialogTitle>
          <DialogDescription>
            The order the floor display lists issued job orders in: 1 is next. Private label and company product orders
            share one queue. New orders join at the end when they are issued.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {orders.length} issued {orders.length === 1 ? "order" : "orders"}
            {dataUpdatedAt ? ` · loaded ${format(dataUpdatedAt, "HH:mm:ss")}` : ""}
            {dirty && " · unsaved moves"}
          </span>
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn("mr-1 h-3.5 w-3.5", isFetching && "animate-spin")} />
            Reload
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : ids.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No issued job orders to sequence.</p>
        ) : (
          <ol className="space-y-2">
            {ids.map((id, i) => {
              const o = byId.get(id);
              if (!o) return null;
              const { total, done, update, grade } = rowInfo(o);
              const isCompany = o.order_type === "company";
              const changed = (o.private_label_floor_sequence?.seq ?? null) !== i + 1;
              return (
                <li
                  key={id}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border p-2",
                    o.production_done_at && "bg-green-50/50",
                    update.state === "overdue" && "border-red-400 bg-red-50/50",
                    changed && "border-primary/60",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg font-extrabold",
                      i === 0 ? "bg-primary text-primary-foreground" : "bg-muted",
                    )}
                  >
                    {i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{o.pl_job_order_number}</span>
                      {isCompany ? (
                        <Badge variant="outline" className="border-sky-300 bg-sky-50 text-sky-700">
                          <Factory className="mr-1 h-3 w-3" />
                          Company
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700">
                          <Tag className="mr-1 h-3 w-3" />
                          Private Label
                        </Badge>
                      )}
                      <Badge variant="outline" className={priorityColor(o.priority)}>
                        {o.priority}
                      </Badge>
                      {o.production_done_at && (
                        <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700">
                          Production done
                        </Badge>
                      )}
                      {update.state === "overdue" && (
                        <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700">
                          Update overdue
                        </Badge>
                      )}
                      {changed && (
                        <span className="text-xs text-primary">
                          was {o.private_label_floor_sequence?.seq ?? "—"}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-sm">
                      <span className="font-medium">
                        {isCompany
                          ? o.private_label_job_order_items.map((l) => l.products?.name).filter(Boolean).join(", ") || "Company products"
                          : o.customers?.name}
                      </span>
                      {o.brand_name && <span className="text-muted-foreground"> · {o.brand_name}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {grade && <>Grade {grade} · </>}
                      {done.toLocaleString()} / {total.toLocaleString()} Dz ({producedPct(done, total)}%) · Required by{" "}
                      {o.required_by_date ? format(parseISO(o.required_by_date), "dd MMM yyyy") : "—"}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className={cn("mr-2 h-9 w-9", o.production_done_at && "border-green-500 text-green-700 hover:bg-green-50")}
                      title={dirty ? "Save or reset the sequence first" : "Dispatch: remove from the floor"}
                      disabled={dirty || save.isPending}
                      onClick={() =>
                        setDispatchTarget({
                          id: o.id,
                          number: o.pl_job_order_number,
                          label: isCompany
                            ? o.private_label_job_order_items.map((l) => l.products?.name).filter(Boolean).join(", ") || "Company products"
                            : [o.customers?.name, o.brand_name].filter(Boolean).join(" · "),
                          orderedDz: total,
                          producedDz: done,
                          productionDone: !!o.production_done_at,
                        })
                      }
                    >
                      <Truck className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-9 w-9" title="Move to top" disabled={i === 0} onClick={() => setIds(move(ids, i, 0))}>
                      <ArrowUpToLine className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-9 w-9" title="Move up" disabled={i === 0} onClick={() => setIds(move(ids, i, i - 1))}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-9 w-9" title="Move down" disabled={i === ids.length - 1} onClick={() => setIds(move(ids, i, i + 1))}>
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-9 w-9" title="Move to bottom" disabled={i === ids.length - 1} onClick={() => setIds(move(ids, i, ids.length - 1))}>
                      <ArrowDownToLine className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setIds(orders.map((o) => o.id))} disabled={!dirty || save.isPending}>
            Reset
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Close
          </Button>
          <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending || ids.length === 0}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save sequence
          </Button>
        </DialogFooter>
      </DialogContent>
      <PrivateLabelDispatchDialog
        target={dispatchTarget}
        onClose={(dispatched) => {
          setDispatchTarget(null);
          if (dispatched) refetch();
        }}
      />
    </Dialog>
  );
}
