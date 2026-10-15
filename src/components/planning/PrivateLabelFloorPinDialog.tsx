import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchFloorPinStatus, setFloorPin } from "@/lib/privateLabelJobOrder";

const FLOOR_PATH = "/floor/private-label";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Super admin: set the PIN that unlocks the private label floor page. */
export function PrivateLabelFloorPinDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const floorUrl = `${window.location.origin}${FLOOR_PATH}`;

  const { data: status } = useQuery({
    queryKey: ["pljo-floor-pin-status"],
    queryFn: fetchFloorPinStatus,
    enabled: open,
  });

  const save = useMutation({
    mutationFn: () => setFloorPin(pin),
    onSuccess: () => {
      toast.success("Floor PIN saved. Floor screens using the old PIN are locked.");
      setPin("");
      setConfirm("");
      qc.invalidateQueries({ queryKey: ["pljo-floor-pin-status"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const valid = /^\d{4,8}$/.test(pin) && pin === confirm;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Floor PIN</DialogTitle>
          <DialogDescription>
            Supervisors open the floor page with this PIN to view and print issued private label job orders.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Floor page</Label>
            <div className="flex gap-2">
              <Input readOnly value={floorUrl} className="font-mono text-xs" />
              <Button
                variant="outline"
                size="icon"
                title="Copy link"
                onClick={() => navigator.clipboard.writeText(floorUrl).then(() => toast.success("Link copied"))}
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" title="Open" asChild>
                <a href={FLOOR_PATH} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            {status?.is_set
              ? `PIN last changed ${status.changed_at ? format(new Date(status.changed_at), "dd MMM yyyy HH:mm") : ""}.`
              : "No PIN set yet: the floor page cannot be opened until you set one."}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>New PIN (4–8 digits)</Label>
              <Input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={8}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <div className="space-y-1">
              <Label>Confirm PIN</Label>
              <Input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))}
              />
            </div>
          </div>
          {confirm.length > 0 && pin !== confirm && <p className="text-sm text-destructive">The PINs do not match</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate()} disabled={!valid || save.isPending}>
              {status?.is_set ? "Change PIN" : "Set PIN"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
