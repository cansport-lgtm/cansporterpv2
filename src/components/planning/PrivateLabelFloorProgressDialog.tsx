// Floor page: enter dozens produced per line (size, or product on company
// orders) for one private label / company product job order.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  FloorPinError,
  addFloorProgress,
  fetchFloorProgress,
  producedPct as pct,
  type FloorOrder,
} from "@/lib/privateLabelJobOrder";

interface Props {
  pin: string;
  order: FloorOrder;
  enteredBy: string;
  onEnteredByChange: (name: string) => void;
  onClose: (saved: boolean) => void;
  onPinError: (e: FloorPinError) => void;
}

export function PrivateLabelFloorProgressDialog({ pin, order, enteredBy, onEnteredByChange, onClose, onPinError }: Props) {
  const [adding, setAdding] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["pljo-floor-progress", order.id, pin],
    queryFn: () => fetchFloorProgress(pin, order.id),
  });

  const entries = Object.entries(adding)
    .map(([item_id, v]) => ({ item_id, dozens: Number(v) }))
    .filter((e) => Number.isFinite(e.dozens) && e.dozens !== 0);

  const save = async () => {
    if (!enteredBy.trim()) {
      toast.error("Enter your name");
      return;
    }
    setSaving(true);
    try {
      const { completed } = await addFloorProgress(pin, order.id, entries, enteredBy);
      if (completed) toast.success(`${order.pl_job_order_number} is 100% done and has moved off the list`);
      else toast.success("Production saved");
      onClose(true);
    } catch (e) {
      if (e instanceof FloorPinError) onPinError(e);
      else toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const isCompany = order.order_type === "company";
  const lines = data?.lines ?? [];
  const ordered = lines.reduce((s, l) => s + l.ordered, 0);
  const done = lines.reduce((s, l) => s + l.done, 0);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Production — {order.pl_job_order_number} · {order.customer_name ?? "Company products"}
          </DialogTitle>
          <DialogDescription>
            Enter the dozens made now for each {isCompany ? "product" : "size"}. They are added to what is already done. Use a minus number to
            correct a mistake.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="font-medium">Overall</span>
                <span>
                  {done.toLocaleString()} / {ordered.toLocaleString()} Dz ({pct(done, ordered)}%)
                </span>
              </div>
              <Progress value={pct(done, ordered)} />
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{isCompany ? "Product" : "Size"}</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">Done</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="w-32">Add now (Dz)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => {
                  const balance = l.ordered - l.done;
                  return (
                    <TableRow key={l.item_id}>
                      <TableCell>
                        <div className="font-medium">
                          {l.product_name ? (
                            <>
                              <span className="font-mono text-xs font-normal text-muted-foreground">{l.product_code}</span>{" "}
                              {l.product_name}
                            </>
                          ) : (
                            l.size_name
                          )}
                          {l.color_name && <span className="font-normal text-muted-foreground"> · {l.color_name}</span>}
                        </div>
                        <div className="text-xs text-muted-foreground">{l.packing_label}</div>
                      </TableCell>
                      <TableCell className="text-right">{l.ordered.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{l.done.toLocaleString()}</TableCell>
                      <TableCell className={cn("text-right", balance <= 0 && "text-green-600")}>
                        {balance <= 0 ? (balance < 0 ? `+${(-balance).toLocaleString()}` : "✓") : balance.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.5"
                          value={adding[l.item_id] ?? ""}
                          onChange={(e) => setAdding((a) => ({ ...a, [l.item_id]: e.target.value }))}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-1">
                <Label>Your name</Label>
                <Input value={enteredBy} onChange={(e) => onEnteredByChange(e.target.value)} className="w-56" />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onClose(false)}>
                  Cancel
                </Button>
                <Button onClick={save} disabled={saving || entries.length === 0}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save
                </Button>
              </div>
            </div>

            {(data?.entries.length ?? 0) > 0 && (
              <div>
                <div className="mb-1 text-sm font-medium">Recent entries</div>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                  {data!.entries.map((e) => (
                    <li key={e.id}>
                      {format(new Date(e.created_at), "dd MMM HH:mm")} · {e.size_name} ·{" "}
                      <span className={cn("font-medium", e.dozens < 0 ? "text-destructive" : "text-foreground")}>
                        {e.dozens > 0 ? "+" : ""}
                        {e.dozens.toLocaleString()} Dz
                      </span>
                      {e.entered_by_name ? ` · ${e.entered_by_name}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
