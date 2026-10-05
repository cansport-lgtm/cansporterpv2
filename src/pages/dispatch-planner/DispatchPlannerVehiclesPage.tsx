import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Truck } from "lucide-react";
import { toast } from "sonner";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { dpDb, errorMessage, fetchVehicles, sum, type PlannerVehicle } from "@/lib/dispatchPlanner";

type Form = {
  registration_no: string; vehicle_type: "own" | "hired"; carton_capacity: string; transporter_name: string;
  default_driver_name: string; default_driver_contact: string; is_active: boolean; remarks: string;
};
const empty: Form = { registration_no: "", vehicle_type: "own", carton_capacity: "", transporter_name: "", default_driver_name: "", default_driver_contact: "", is_active: true, remarks: "" };

export default function DispatchPlannerVehiclesPage() {
  const queryClient = useQueryClient();
  const { hasRole } = useAuth();
  const canManage = hasRole("super_admin") || hasRole("dispatch_planner_manager");
  const [editing, setEditing] = useState<{ id: string | null; form: Form } | null>(null);

  const { data: vehicles = [], isLoading } = useQuery({ queryKey: ["dp-vehicles", "all"], queryFn: () => fetchVehicles(false) });
  const active = vehicles.filter((v) => v.is_active);

  const save = useMutation({
    mutationFn: async (p: { id: string | null; form: Form }) => {
      const { error } = await dpDb.rpc("dispatch_planner_vehicle_save", {
        p_id: p.id,
        p_data: { ...p.form, carton_capacity: Number(p.form.carton_capacity) },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dp-vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["dp-suggest"] });
      toast.success("Vehicle saved");
      setEditing(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const openEdit = (v: PlannerVehicle) => setEditing({
    id: v.id,
    form: {
      registration_no: v.registration_no, vehicle_type: v.vehicle_type, carton_capacity: String(v.carton_capacity),
      transporter_name: v.transporter_name ?? "", default_driver_name: v.default_driver_name ?? "",
      default_driver_contact: v.default_driver_contact ?? "", is_active: v.is_active, remarks: v.remarks ?? "",
    },
  });
  const setF = (patch: Partial<Form>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title="Planner Vehicles"
          description={`The fleet the suggestion fills, by carton capacity. Active fleet: ${active.length} vehicle(s), ${sum(active.map((v) => v.carton_capacity))} cartons a day. Used only by the planner.`}
          icon={Truck}
        >
          {canManage && <Button size="sm" onClick={() => setEditing({ id: null, form: empty })}><Plus className="h-4 w-4 mr-1" /> Add vehicle</Button>}
        </PageHeader>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Registration</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Carton capacity</TableHead>
                  <TableHead>Transporter</TableHead>
                  <TableHead>Default driver</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Remarks</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>}
                {!isLoading && vehicles.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No vehicles yet. Without a fleet the planner puts every day's lines in one load with no capacity check.</TableCell></TableRow>}
                {vehicles.map((v) => (
                  <TableRow key={v.id} className={!v.is_active ? "opacity-60" : ""}>
                    <TableCell className="font-mono font-semibold">{v.registration_no}</TableCell>
                    <TableCell className="capitalize">{v.vehicle_type}</TableCell>
                    <TableCell className="text-right tabular-nums">{v.carton_capacity}</TableCell>
                    <TableCell>{v.transporter_name ?? "—"}</TableCell>
                    <TableCell>{v.default_driver_name ?? "—"}{v.default_driver_contact ? <span className="text-xs text-muted-foreground"> · {v.default_driver_contact}</span> : null}</TableCell>
                    <TableCell><Badge variant={v.is_active ? "success" : "secondary"}>{v.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell className="max-w-[240px] truncate text-xs text-muted-foreground">{v.remarks ?? ""}</TableCell>
                    <TableCell className="text-right">{canManage && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(v)}><Pencil className="h-4 w-4" /></Button>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing?.id ? "Edit vehicle" : "Add vehicle"}</DialogTitle>
              <DialogDescription>Capacity is in cartons per trip. An inactive vehicle is left out of the suggestion.</DialogDescription>
            </DialogHeader>
            {editing && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Registration no *</Label><Input value={editing.form.registration_no} onChange={(e) => setF({ registration_no: e.target.value })} placeholder="LEA-1234" /></div>
                <div className="space-y-1">
                  <Label>Type</Label>
                  <Select value={editing.form.vehicle_type} onValueChange={(v) => setF({ vehicle_type: v as Form["vehicle_type"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="own">Own</SelectItem><SelectItem value="hired">Hired</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label>Carton capacity *</Label><Input type="number" min={1} value={editing.form.carton_capacity} onChange={(e) => setF({ carton_capacity: e.target.value })} /></div>
                <div className="space-y-1"><Label>Transporter</Label><Input value={editing.form.transporter_name} onChange={(e) => setF({ transporter_name: e.target.value })} /></div>
                <div className="space-y-1"><Label>Default driver</Label><Input value={editing.form.default_driver_name} onChange={(e) => setF({ default_driver_name: e.target.value })} /></div>
                <div className="space-y-1"><Label>Driver contact</Label><Input value={editing.form.default_driver_contact} onChange={(e) => setF({ default_driver_contact: e.target.value })} /></div>
                <div className="col-span-2 space-y-1"><Label>Remarks</Label><Textarea rows={2} value={editing.form.remarks} onChange={(e) => setF({ remarks: e.target.value })} /></div>
                <div className="col-span-2 flex items-center gap-2"><Switch checked={editing.form.is_active} onCheckedChange={(v) => setF({ is_active: v })} /><Label>Active (counted in the fleet)</Label></div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={() => editing && save.mutate(editing)} disabled={save.isPending}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
