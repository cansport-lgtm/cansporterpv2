// Floor page: "no progress" check-in for one job order. Saves a reason and
// restarts the order's 2-hour update clock without entering dozens.
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FloorPinError, floorCheckin, type FloorOrder } from "@/lib/privateLabelJobOrder";

const REASONS = [
  "Material waiting",
  "Machine down",
  "Worker shortage",
  "Waiting QC / approval",
  "Working on another order",
  "Other",
];

interface Props {
  pin: string;
  order: FloorOrder;
  enteredBy: string;
  onEnteredByChange: (name: string) => void;
  onClose: (saved: boolean) => void;
  onPinError: (e: FloorPinError) => void;
}

export function PrivateLabelFloorCheckinDialog({ pin, order, enteredBy, onEnteredByChange, onClose, onPinError }: Props) {
  const [reason, setReason] = useState("");
  const [other, setOther] = useState("");
  const [saving, setSaving] = useState(false);

  const finalReason = reason === "Other" ? other.trim() : reason;

  const save = async () => {
    if (!finalReason) {
      toast.error(reason === "Other" ? "Write the reason" : "Choose a reason");
      return;
    }
    if (!enteredBy.trim()) {
      toast.error("Enter your name");
      return;
    }
    setSaving(true);
    try {
      await floorCheckin(pin, order.id, reason === "Other" ? `Other: ${finalReason}` : finalReason, enteredBy);
      toast.success("Check-in saved. The 2-hour clock has restarted.");
      onClose(true);
    } catch (e) {
      if (e instanceof FloorPinError) onPinError(e);
      else toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>No progress — {order.pl_job_order_number}</DialogTitle>
          <DialogDescription>
            Nothing was made on this order? Choose why. This restarts the 2-hour update clock and is saved with the order.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          {REASONS.map((r) => (
            <Button
              key={r}
              type="button"
              variant={reason === r ? "default" : "outline"}
              className="h-auto justify-start whitespace-normal py-3 text-left"
              onClick={() => setReason(r)}
            >
              {r}
            </Button>
          ))}
        </div>
        {reason === "Other" && <Input placeholder="Reason" value={other} maxLength={150} onChange={(e) => setOther(e.target.value)} />}

        <div className="space-y-1">
          <Label>Your name</Label>
          <Input value={enteredBy} onChange={(e) => onEnteredByChange(e.target.value)} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save check-in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
