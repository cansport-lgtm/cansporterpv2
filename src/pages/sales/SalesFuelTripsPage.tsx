import { useState, useMemo } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Plus, CheckCircle2, XCircle, Trash2, Fuel } from "lucide-react";

interface AppUser { id: string; full_name: string; }
interface Vehicle { id: string; user_id: string; vehicle_type: string; registration_no: string | null; mileage_kmpl: number; is_active: boolean; }
interface Customer { id: string; name: string; sales_segment: string; }
interface Trip {
  id: string; trip_date: string; user_id: string; vehicle_id: string | null;
  from_location: string | null; to_location: string | null; purpose: string | null;
  start_odometer: number; end_odometer: number; km: number;
  customer_id: string | null; visit_id: string | null;
  mileage_kmpl_snapshot: number | null; fuel_price_snapshot: number | null;
  litres: number | null; amount: number | null;
  status: string; approved_at: string | null; rejected_reason: string | null;
  payout_id: string | null; remarks: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  Submitted: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  Approved: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  Rejected: "bg-red-500/10 text-red-700 border-red-500/30",
  Paid: "bg-blue-500/10 text-blue-700 border-blue-500/30",
};

export default function SalesFuelTripsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");

  // form
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [userId, setUserId] = useState(user?.id || "");
  const [vehicleId, setVehicleId] = useState<string>("none");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [purpose, setPurpose] = useState("");
  const [startOdo, setStartOdo] = useState("");
  const [endOdo, setEndOdo] = useState("");
  const [customerId, setCustomerId] = useState<string>("none");
  const [remarks, setRemarks] = useState("");

  const { data: users } = useQuery({
    queryKey: ["app_users_active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_users").select("id,full_name").eq("is_active", true).order("full_name");
      if (error) throw error;
      return data as unknown as AppUser[];
    },
  });

  const { data: vehicles } = useQuery({
    queryKey: ["sales_fuel_vehicles", "active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_fuel_vehicles" as any).select("*").eq("is_active", true);
      if (error) throw error;
      return data as unknown as Vehicle[];
    },
  });

  const { data: customers } = useQuery({
    queryKey: ["customers_private_label"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("id,name,sales_segment").eq("sales_segment", "private_label" as any).order("name");
      if (error) throw error;
      return data as unknown as Customer[];
    },
  });

  const { data: trips, isLoading } = useQuery({
    queryKey: ["sales_fuel_trips"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_fuel_trips" as any).select("*").order("trip_date", { ascending: false }).limit(500);
      if (error) throw error;
      return data as unknown as Trip[];
    },
  });

  const userMap = useMemo(() => Object.fromEntries((users || []).map(u => [u.id, u.full_name])), [users]);
  const vehicleMap = useMemo(() => Object.fromEntries((vehicles || []).map(v => [v.id, v])), [vehicles]);
  const customerMap = useMemo(() => Object.fromEntries((customers || []).map(c => [c.id, c.name])), [customers]);

  const userVehicles = useMemo(
    () => (vehicles || []).filter(v => v.user_id === userId),
    [vehicles, userId]
  );

  const filtered = useMemo(() => {
    let list = trips || [];
    if (statusFilter !== "all") list = list.filter(t => t.status === statusFilter);
    if (userFilter !== "all") list = list.filter(t => t.user_id === userFilter);
    return list;
  }, [trips, statusFilter, userFilter]);

  const reset = () => {
    setDate(new Date().toISOString().slice(0, 10));
    setUserId(user?.id || ""); setVehicleId("none"); setFrom(""); setTo(""); setPurpose("");
    setStartOdo(""); setEndOdo(""); setCustomerId("none"); setRemarks("");
  };
  const close = () => { setOpen(false); reset(); };

  const liveKm = useMemo(() => {
    const s = parseFloat(startOdo) || 0; const e = parseFloat(endOdo) || 0;
    return Math.max(e - s, 0);
  }, [startOdo, endOdo]);

  const create = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Salesperson is required");
      if (!startOdo || !endOdo) throw new Error("Start & end odometer required");
      if (parseFloat(endOdo) <= parseFloat(startOdo)) throw new Error("End odometer must be greater than start");
      const payload: any = {
        trip_date: date, user_id: userId,
        vehicle_id: vehicleId === "none" ? null : vehicleId,
        from_location: from.trim() || null, to_location: to.trim() || null, purpose: purpose.trim() || null,
        start_odometer: parseFloat(startOdo), end_odometer: parseFloat(endOdo),
        customer_id: customerId === "none" ? null : customerId,
        status: "Submitted", created_by: user?.id || null, remarks: remarks.trim() || null,
      };
      const { error } = await supabase.from("sales_fuel_trips" as any).insert(payload);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sales_fuel_trips"] }); toast.success("Trip submitted"); close(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, reason }: { id: string; status: string; reason?: string }) => {
      const payload: any = { status };
      if (status === "Approved") payload.approved_by = user?.id || null;
      if (status === "Rejected") payload.rejected_reason = reason || null;
      const { error } = await supabase.from("sales_fuel_trips" as any).update(payload).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sales_fuel_trips"] }); toast.success("Updated"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sales_fuel_trips" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sales_fuel_trips"] }); toast.success("Deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalAmt = filtered.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const totalKm = filtered.reduce((s, t) => s + (Number(t.km) || 0), 0);

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Sales Fuel Trips" description="Log customer-visit trips. Payment = (km ÷ mileage) × fuel price." />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">Trips shown</div><div className="text-2xl font-bold">{filtered.length}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">Total Km</div><div className="text-2xl font-bold">{totalKm.toFixed(1)}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">Total Amount</div><div className="text-2xl font-bold">Rs. {totalAmt.toFixed(0)}</div></CardContent></Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-lg flex items-center gap-2"><Fuel className="h-5 w-5" /> Trip Log</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={userFilter} onValueChange={setUserFilter}>
                <SelectTrigger className="w-44 bg-background"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-background z-50 max-h-60">
                  <SelectItem value="all">All Salespeople</SelectItem>
                  {users?.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36 bg-background"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-background z-50">
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="Submitted">Submitted</SelectItem>
                  <SelectItem value="Approved">Approved</SelectItem>
                  <SelectItem value="Rejected">Rejected</SelectItem>
                  <SelectItem value="Paid">Paid</SelectItem>
                </SelectContent>
              </Select>
              <Dialog open={open} onOpenChange={(o) => { if (!o) close(); else { reset(); setOpen(true); } }}>
                <DialogTrigger asChild>
                  <Button><Plus className="h-4 w-4 mr-2" />New Trip</Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader><DialogTitle>New Trip Entry</DialogTitle></DialogHeader>
                  <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Date *</Label>
                        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                      </div>
                      <div className="space-y-2">
                        <Label>Salesperson *</Label>
                        <Select value={userId} onValueChange={(v) => { setUserId(v); setVehicleId("none"); }}>
                          <SelectTrigger className="bg-background"><SelectValue placeholder="Select" /></SelectTrigger>
                          <SelectContent className="bg-background z-50 max-h-60">
                            {users?.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Vehicle</Label>
                      <Select value={vehicleId} onValueChange={setVehicleId}>
                        <SelectTrigger className="bg-background"><SelectValue placeholder="Auto-pick active vehicle" /></SelectTrigger>
                        <SelectContent className="bg-background z-50 max-h-60">
                          <SelectItem value="none">Auto (active vehicle)</SelectItem>
                          {userVehicles.map(v => (
                            <SelectItem key={v.id} value={v.id}>
                              {v.vehicle_type}{v.registration_no ? ` · ${v.registration_no}` : ""} ({v.mileage_kmpl} km/L)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2"><Label>From</Label><Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="e.g. Office" /></div>
                      <div className="space-y-2"><Label>To</Label><Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="e.g. Customer city" /></div>
                    </div>
                    <div className="space-y-2">
                      <Label>Purpose</Label>
                      <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Customer visit / Order delivery / etc." />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-2"><Label>Start Odo *</Label><Input type="number" step="0.1" value={startOdo} onChange={(e) => setStartOdo(e.target.value)} required /></div>
                      <div className="space-y-2"><Label>End Odo *</Label><Input type="number" step="0.1" value={endOdo} onChange={(e) => setEndOdo(e.target.value)} required /></div>
                      <div className="space-y-2"><Label>Km (auto)</Label><Input value={liveKm.toFixed(1)} readOnly className="bg-muted" /></div>
                    </div>
                    <div className="space-y-2">
                      <Label>Customer (optional)</Label>
                      <Select value={customerId} onValueChange={setCustomerId}>
                        <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-background z-50 max-h-60">
                          <SelectItem value="none">No customer</SelectItem>
                          {customers?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Remarks</Label>
                      <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" onClick={close}>Cancel</Button>
                      <Button type="submit" disabled={create.isPending}>Submit Trip</Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead><TableHead>Salesperson</TableHead>
                    <TableHead>Route</TableHead><TableHead>Customer</TableHead>
                    <TableHead className="text-right">Km</TableHead>
                    <TableHead className="text-right">L</TableHead>
                    <TableHead className="text-right">Rs./L</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={10} className="text-center">Loading...</TableCell></TableRow>
                  ) : !filtered.length ? (
                    <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground">No trips</TableCell></TableRow>
                  ) : filtered.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>{t.trip_date}</TableCell>
                      <TableCell className="font-medium">{userMap[t.user_id] || "—"}</TableCell>
                      <TableCell className="text-xs">
                        {(t.from_location || "—")} → {(t.to_location || "—")}
                        {t.purpose && <div className="text-muted-foreground">{t.purpose}</div>}
                      </TableCell>
                      <TableCell className="text-xs">{t.customer_id ? customerMap[t.customer_id] || "—" : "—"}</TableCell>
                      <TableCell className="text-right">{Number(t.km).toFixed(1)}</TableCell>
                      <TableCell className="text-right">{t.litres != null ? Number(t.litres).toFixed(2) : "—"}</TableCell>
                      <TableCell className="text-right">{t.fuel_price_snapshot != null ? Number(t.fuel_price_snapshot).toFixed(2) : "—"}</TableCell>
                      <TableCell className="text-right font-semibold">{t.amount != null ? `Rs. ${Number(t.amount).toFixed(0)}` : "—"}</TableCell>
                      <TableCell><Badge className={STATUS_COLORS[t.status] || ""} variant="outline">{t.status}</Badge></TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {t.status === "Submitted" && (
                          <>
                            <Button variant="ghost" size="icon" title="Approve" onClick={() => updateStatus.mutate({ id: t.id, status: "Approved" })}>
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            </Button>
                            <Button variant="ghost" size="icon" title="Reject" onClick={() => {
                              const r = prompt("Reason for rejection?"); if (r != null) updateStatus.mutate({ id: t.id, status: "Rejected", reason: r });
                            }}>
                              <XCircle className="h-4 w-4 text-red-600" />
                            </Button>
                          </>
                        )}
                        {t.status !== "Paid" && (
                          <Button variant="ghost" size="icon" title="Delete" onClick={() => { if (confirm("Delete trip?")) del.mutate(t.id); }}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
