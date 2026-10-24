import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { dispatchOrder, producedPct } from "@/lib/privateLabelJobOrder";

/** What the confirmation needs to know about the order. */
export interface DispatchTarget {
  id: string;
  number: string;
  /** Customer / brand line, or "Company products". */
  label: string;
  orderedDz: number;
  producedDz: number;
  productionDone: boolean;
}

interface Props {
  target: DispatchTarget | null;
  onClose: (dispatched: boolean) => void;
}

/**
 * Dispatch confirmation, shared by the job order lists, the order dialogs
 * and the Floor sequence dialog. Dispatching is final: the order leaves the
 * floor display and the floor queue. Below 100% produced a note is required.
 */
export function PrivateLabelDispatchDialog({ target, onClose }: Props) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const short = target ? Math.max(0, target.orderedDz - target.producedDz) : 0;
  const needsNote = short > 0;

  const dispatch = useMutation({
    mutationFn: () => dispatchOrder(target!.id, note),
    onSuccess: () => {
      toast.success(`${target!.number} dispatched`);
      qc.invalidateQueries({ queryKey: ["pljo-list"] });
      qc.invalidateQueries({ queryKey: ["pljo-detail", target!.id] });
      qc.invalidateQueries({ queryKey: ["pljo-log", target!.id] });
      qc.invalidateQueries({ queryKey: ["pljo-floor-sequence"] });
      setNote("");
      onClose(true);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && !dispatch.isPending && onClose(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            Dispatch {target?.number}?
          </DialogTitle>
          <DialogDescription>
            The order leaves the floor display and the floor sequence. A dispatched order is final and can't be changed.
          </DialogDescription>
        </DialogHeader>

        {target && (
          <div className="space-y-4">
            <div className="rounded-lg border p-3 text-sm">
              <div className="font-medium">{target.label}</div>
              <div className="mt-2 flex justify-between">
                <span className="text-muted-foreground">Produced</span>
                <span className={cn("font-semibold", needsNote ? "text-amber-700" : "text-green-700")}>
                  {target.producedDz.toLocaleString()} / {target.orderedDz.toLocaleString()} Dz (
                  {producedPct(target.producedDz, target.orderedDz)}%)
                </span>
              </div>
              <Progress
                value={producedPct(target.producedDz, target.orderedDz)}
                className={cn("mt-1 h-2", !needsNote && "[&>div]:bg-green-600")}
              />
              {target.productionDone && (
                <div className="mt-1 text-xs font-medium text-green-700">Marked production done on the floor</div>
              )}
              {needsNote && (
                <div className="mt-1 text-xs font-medium text-amber-700">
                  {short.toLocaleString()} Dz not produced yet
                </div>
              )}
            </div>

            <div className="space-y-1">
              <Label>
                Note {needsNote ? <span className="text-destructive">(required below 100%)</span> : "(optional)"}
              </Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={needsNote ? "e.g. partial dispatch, balance cancelled by customer" : "e.g. vehicle / gate pass reference"}
                rows={3}
                maxLength={500}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)} disabled={dispatch.isPending}>
            Back
          </Button>
          <Button
            onClick={() => dispatch.mutate()}
            disabled={dispatch.isPending || (needsNote && note.trim().length === 0)}
          >
            {dispatch.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Truck className="mr-2 h-4 w-4" />}
            Dispatch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
