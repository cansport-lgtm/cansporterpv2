import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { employeeLabel, errorMessage, loadActiveEmployees, todayPk } from "@/lib/facilities";
import {
  CONDITION_META, MOVEMENT_LABEL, moveAsset, type AssetCondition, type CustodyRow, type MovementType,
} from "@/lib/facilitiesAssets";

/**
 * Record one movement of an office asset: issue (store → employee), return
 * (employee → store), transfer (employee → employee) or a physical
 * verification. The database checks the asset's current holder.
 */
export function AssetMovementDialog({
  asset, type, open, onOpenChange,
}: {
  asset: CustodyRow | null;
  type: MovementType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [toEmployee, setToEmployee] = useState("");
  const [date, setDate] = useState(todayPk());
  const [condition, setCondition] = useState<AssetCondition>("good");
  const [accessories, setAccessories] = useState("");
  const [remarks, setRemarks] = useState("");
  const [onPaper, setOnPaper] = useState(false);

  useEffect(() => {
    if (!open) return;
    setToEmployee("");
    setDate(todayPk());
    setCondition(asset?.condition ?? "good");
    setAccessories(asset?.accessories ?? "");
    setRemarks("");
    setOnPaper(false);
  }, [open, asset]);

  const { data: employees = [] } = useQuery({ queryKey: ["facilities-employees"], queryFn: loadActiveEmployees, enabled: open });
  const needsEmployee = type === "issue" || type === "transfer";
  const candidates = useMemo(
    () => employees.filter((e) => e.id !== asset?.holder_employee_id),
    [employees, asset?.holder_employee_id],
  );

  const mutation = useMutation({
    mutationFn: () => moveAsset({
      fixed_asset_id: asset!.fixed_asset_id,
      movement_type: type,
      from_employee_id: asset!.holder_employee_id,
      to_employee_id: needsEmployee ? toEmployee : null,
      movement_date: date,
      condition,
      accessories,
      remarks,
      on_paper: onPaper,
    }),
    onSuccess: () => {
      toast({ title: `${MOVEMENT_LABEL[type]} recorded`, description: `${asset?.asset_code} ${asset?.name}` });
      queryClient.invalidateQueries({ queryKey: ["facilities-asset-custody"] });
      queryClient.invalidateQueries({ queryKey: ["facilities-asset-movements"] });
      onOpenChange(false);
    },
    onError: (e) => toast({ title: "Not saved", description: errorMessage(e), variant: "destructive" }),
  });

  const title: Record<MovementType, string> = {
    issue: "Issue to an employee",
    return: "Return to the admin store",
    transfer: "Transfer to another employee",
    verify: "Physical verification",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title[type]}</DialogTitle>
          <DialogDescription>
            {asset ? `${asset.asset_code} · ${asset.name}` : ""}
            {asset?.holder ? ` · now with ${asset.holder}` : " · in the admin store"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {needsEmployee && (
            <div className="grid gap-1.5">
              <Label htmlFor="am-to">{type === "issue" ? "Issue to" : "Transfer to"}</Label>
              <Select value={toEmployee} onValueChange={setToEmployee}>
                <SelectTrigger id="am-to"><SelectValue placeholder="Choose the employee" /></SelectTrigger>
                <SelectContent>
                  {candidates.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{employeeLabel(e)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="am-date">Date</Label>
              <Input id="am-date" type="date" value={date} max={todayPk()} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="am-cond">Condition{type === "return" ? " on return" : ""}</Label>
              <Select value={condition} onValueChange={(v) => setCondition(v as AssetCondition)}>
                <SelectTrigger id="am-cond"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CONDITION_META) as AssetCondition[]).map((c) => (
                    <SelectItem key={c} value={c}>{CONDITION_META[c].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="am-acc">Accessories</Label>
            <Input id="am-acc" placeholder="Charger, bag, mouse…" value={accessories} onChange={(e) => setAccessories(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="am-rem">Remarks</Label>
            <Textarea id="am-rem" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
          {needsEmployee && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox id="am-paper" checked={onPaper} onCheckedChange={(v) => setOnPaper(v === true)} />
              Employee signed on paper (no acknowledgement on the phone needed)
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !asset || (needsEmployee && !toEmployee)}>
            {mutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Save {MOVEMENT_LABEL[type].toLowerCase()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
