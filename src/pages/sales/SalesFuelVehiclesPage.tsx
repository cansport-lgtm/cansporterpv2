import { useState, useMemo } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";

interface AppUser { id: string; full_name: string; user_id: string; }
interface Vehicle {
  id: string;
  user_id: string;
  vehicle_type: string;
  registration_no: string | null;
  mileage_kmpl: number;
  is_active: boolean;
  remarks: string | null;
}

const TYPES = ["Bike", "Car", "Pickup", "Other"];

export default function SalesFuelVehiclesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [userId, setUserId] = useState("");
  const [type, setType] = useState("Bike");
  const [reg, setReg] = useState("");
  const [mileage, setMileage] = useState<string>("");
  const [active, setActive] = useState(true);
  const [remarks, setRemarks] = useState("");

  const { data: users } = useQuery({
    queryKey: ["app_users_active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_users").select("id,full_name,user_id").eq("is_active", true).order("full_name");
      if (error) throw error;
      return data as unknown as AppUser[];
    },
  });

  const { data: vehicles, isLoading } = useQuery({
    queryKey: ["sales_fuel_vehicles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_fuel_vehicles" as any).select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Vehicle[];
    },
  });

  const userMap = useMemo(() => Object.fromEntries((users || []).map(u => [u.id, u.full_name])), [users]);

  const reset = () => { setEditing(null); setUserId(""); setType("Bike"); setReg(""); setMileage(""); setActive(true); setRemarks(""); };
  const close = () => { setOpen(false); reset(); };
  const edit = (v: Vehicle) => {
    setEditing(v); setUserId(v.user_id); setType(v.vehicle_type); setReg(v.registration_no || "");
    setMileage(String(v.mileage_kmpl)); setActive(v.is_active); setRemarks(v.remarks || ""); setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Salesperson is required");
      const m = parseFloat(mileage);
      if (!m || m <= 0) throw new Error("Mileage (km/L) must be > 0");
      const payload = {
        user_id: userId, vehicle_type: type, registration_no: reg.trim() || null,
        mileage_kmpl: m, is_active: active, remarks: remarks.trim() || null,
      };
      if (editing) {
        const { error } = await supabase.from("sales_fuel_vehicles" as any).update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("sales_fuel_vehicles" as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sales_fuel_vehicles"] }); toast.success(editing ? "Updated" : "Added"); close(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sales_fuel_vehicles" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sales_fuel_vehicles"] }); toast.success("Deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Sales Vehicles" description="Per-salesperson vehicle and mileage (km/L) for fuel calculation" />
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Vehicles</CardTitle>
            <Dialog open={open} onOpenChange={(o) => { if (!o) close(); else setOpen(true); }}>
              <DialogTrigger asChild>
                <Button onClick={reset}><Plus className="h-4 w-4 mr-2" />Add Vehicle</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>{editing ? "Edit Vehicle" : "New Vehicle"}</DialogTitle></DialogHeader>
                <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Salesperson *</Label>
                    <Select value={userId} onValueChange={setUserId}>
                      <SelectTrigger className="bg-background"><SelectValue placeholder="Select salesperson" /></SelectTrigger>
                      <SelectContent className="bg-background z-50 max-h-60">
                        {users?.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Vehicle Type *</Label>
                      <Select value={type} onValueChange={setType}>
                        <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-background z-50">
                          {TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Registration #</Label>
                      <Input value={reg} onChange={(e) => setReg(e.target.value)} placeholder="e.g. ABC-123" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Mileage (km/L) *</Label>
                    <Input type="number" step="0.01" min="0" value={mileage} onChange={(e) => setMileage(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Remarks</Label>
                    <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Active</Label>
                    <Switch checked={active} onCheckedChange={setActive} />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={close}>Cancel</Button>
                    <Button type="submit" disabled={save.isPending}>{editing ? "Update" : "Create"}</Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Salesperson</TableHead><TableHead>Type</TableHead>
                  <TableHead>Reg #</TableHead><TableHead>Mileage (km/L)</TableHead>
                  <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center">Loading...</TableCell></TableRow>
                ) : !vehicles?.length ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No vehicles yet</TableCell></TableRow>
                ) : vehicles.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">{userMap[v.user_id] || "—"}</TableCell>
                    <TableCell>{v.vehicle_type}</TableCell>
                    <TableCell>{v.registration_no || "—"}</TableCell>
                    <TableCell>{Number(v.mileage_kmpl).toFixed(2)}</TableCell>
                    <TableCell><Badge variant={v.is_active ? "default" : "secondary"}>{v.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => edit(v)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => { if (confirm("Delete this vehicle?")) del.mutate(v.id); }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
