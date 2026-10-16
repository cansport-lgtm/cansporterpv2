import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { errorMessage, fmtQty, gpDb, sortedItems, type GatePass } from "@/lib/gatePass";
import { PhotoInput } from "./PhotoInput";

// The guard's weighment of a scrap vehicle: empty truck first, then after each
// category is loaded. No rates are shown here (the guard cannot read them).

export type WeighResult = { status: "out" | "held"; problems: string[] };

export function ScrapWeighPanel({
  pass, vehicle, vehicleOk, onDone,
}: {
  pass: GatePass;
  vehicle: string;
  vehicleOk: boolean;
  onDone: (r: WeighResult) => void;
}) {
  const { toast } = useToast();
  const lines = sortedItems(pass);
  const [tare, setTare] = useState({ reading: "", slip: "" });
  const [loads, setLoads] = useState<Record<string, { reading: string; slip: string }>>({});
  const [photo, setPhoto] = useState("");
  const [note, setNote] = useState("");

  // Net per category = its reading − the reading before it (in weighing order).
  let prev = Number(tare.reading) || 0;
  const nets = lines.map((l) => {
    const r = Number(loads[l.id]?.reading);
    const net = loads[l.id]?.reading && tare.reading ? r - prev : null;
    if (loads[l.id]?.reading) prev = r;
    return { line: l, net };
  });
  const complete = Boolean(tare.reading) && nets.every((n) => n.net !== null);
  const ordered = nets.every((n) => n.net === null || n.net > 0);
  const totalNet = nets.reduce((s, n) => s + (n.net ?? 0), 0);
  const approved = lines.reduce((s, l) => s + Number(l.estimated_quantity ?? l.quantity), 0);

  const weigh = useMutation({
    mutationFn: async () => {
      const readings = [
        { scrap_category_id: null, reading: tare.reading, slip: tare.slip },
        ...lines.map((l) => ({ scrap_category_id: l.scrap_category_id, reading: loads[l.id]?.reading, slip: loads[l.id]?.slip })),
      ];
      const { data, error } = await gpDb.rpc("gate_pass_scrap_weigh", {
        p_id: pass.id, p_readings: readings, p_vehicle: vehicle, p_photo_path: photo, p_note: note,
      });
      if (error) throw error;
      return data as WeighResult;
    },
    onSuccess: onDone,
    onError: (e) => toast({ title: "Could not record the weighment", description: errorMessage(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground px-1">Weigh the truck</div>
      <Card>
        <CardContent className="p-3 grid grid-cols-[1fr_110px] gap-2 items-end">
          <div>
            <Label htmlFor="w-tare" className="font-semibold">1. Empty truck (kg)</Label>
            <Input id="w-tare" inputMode="decimal" type="number" className="h-12 text-lg font-bold" value={tare.reading}
              onChange={(e) => setTare({ ...tare, reading: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="w-tare-slip" className="text-xs">Slip no.</Label>
            <Input id="w-tare-slip" className="h-12" value={tare.slip} onChange={(e) => setTare({ ...tare, slip: e.target.value })} />
          </div>
        </CardContent>
      </Card>
      {nets.map(({ line, net }, idx) => (
        <Card key={line.id} className={cn("border-2", net !== null && (net > 0 ? "border-emerald-300" : "border-red-400"))}>
          <CardContent className="p-3 space-y-1">
            <div className="grid grid-cols-[1fr_110px] gap-2 items-end">
              <div>
                <Label htmlFor={`w-${line.id}`} className="font-semibold">{idx + 2}. After loading {line.description} (kg)</Label>
                <Input id={`w-${line.id}`} inputMode="decimal" type="number" className="h-12 text-lg font-bold" value={loads[line.id]?.reading ?? ""}
                  onChange={(e) => setLoads((s) => ({ ...s, [line.id]: { slip: "", ...s[line.id], reading: e.target.value } }))} />
              </div>
              <div>
                <Label htmlFor={`ws-${line.id}`} className="text-xs">Slip no.</Label>
                <Input id={`ws-${line.id}`} className="h-12" value={loads[line.id]?.slip ?? ""}
                  onChange={(e) => setLoads((s) => ({ ...s, [line.id]: { reading: "", ...s[line.id], slip: e.target.value } }))} />
              </div>
            </div>
            <div className="text-sm">
              Approved: {fmtQty(line.estimated_quantity ?? line.quantity)} {line.uom}
              {net !== null && <span className={cn("ml-2 font-bold", net > 0 ? "text-emerald-700" : "text-red-700")}>Net {fmtQty(net)} {line.uom}</span>}
            </div>
          </CardContent>
        </Card>
      ))}
      <Card>
        <CardContent className="p-3 space-y-2">
          <Label htmlFor="w-photo" className="font-semibold">Photo of the weighbridge slip *</Label>
          <PhotoInput id="w-photo" label="Take photo of slip" folder="weighbridge" value={photo} onChange={setPhoto} />
        </CardContent>
      </Card>
      {complete && (
        <div className={cn("rounded-xl border p-3 text-sm",
          totalNet > approved * 1.1 || !vehicleOk || !ordered ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-900")}>
          Total net {fmtQty(totalNet)} kg against an approved {fmtQty(approved)} kg.
          {!ordered && " Each reading must be higher than the one before."}
          {!vehicleOk && " The vehicle number does not match the pass."}
        </div>
      )}
      {complete && (totalNet > approved * 1.1 || !vehicleOk) && (
        <div className="space-y-2">
          <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900 flex gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0 text-red-700" />
            This will hold the vehicle. The office and the manager will be told.
          </div>
          <Label htmlFor="w-note" className="text-sm font-semibold">Note for the manager</Label>
          <Textarea id="w-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}
      <div className="sticky bottom-0 bg-background/95 backdrop-blur py-3">
        <Button className="w-full h-14 text-lg font-bold" disabled={!complete || !ordered || !photo || weigh.isPending}
          onClick={() => weigh.mutate()}>
          {weigh.isPending && <Loader2 className="h-5 w-5 mr-2 animate-spin" />}
          {!complete ? "Enter every reading first" : !photo ? "Take the slip photo first" : "Save weighment"}
        </Button>
      </div>
    </div>
  );
}
