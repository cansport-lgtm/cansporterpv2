import { useState, useMemo, useEffect } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Plus, CheckCircle2, XCircle, Trash2, Fuel, Printer } from "lucide-react";
import {
  SALES_FUEL_KEYS, computeTrip, factorForDate, fmtMoney, printSalesFuelVouchers,
  useDefaultPetrolPrice, useEmployeeCodes, useLastEndOdometer, useRateFactors, type SalesFuelTrip,
} from "@/lib/salesFuel";

interface AppUser { id: string; full_name: string; }
interface Vehicle { id: string; user_id: string; vehicle_type: string; registration_no: string | null; mileage_kmpl: number; is_active: boolean; }
interface Customer { id: string; name: string; sales_segment: string; }

const STATUS_COLORS: Record<string, string> = {
  Submitted: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  Approved: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  Rejected: "bg-red-500/10 text-red-700 border-red-500/30",
  Paid: "bg-blue-500/10 text-blue-700 border-blue-500/30",
};

/** Roles that may post a trip for another salesman and approve trips. */
const MANAGER_ROLES = ["super_admin", "admin", "manager", "private_label_manager"];

export default function SalesFuelTripsPage() {
  const qc = useQueryClient();
  const { user, roles } = useAuth();
  const isManager = roles.some((r) => MANAGER_ROLES.includes(r.role as string));
  const [open, setOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // form
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [userId, setUserId] = useState(user?.id || "");
  const [vehicleId, setVehicleId] = useState<string>("none");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [purpose, setPurpose] = useState("");
  const [startOdo, setStartOdo] = useState("");
  const [endOdo, setEndOdo] = useState("");
  const [price, setPrice] = useState("");
  const [priceTouched, setPriceTouched] = useState(false);
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
    queryKey: [SALES_FUEL_KEYS.trips],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_fuel_trips" as any).select("*").order("trip_date", { ascending: false }).order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data as unknown as SalesFuelTrip[];
    },
  });

  const { data: factors } = useRateFactors();
  const { data: codes } = useEmployeeCodes();
  const { data: defaultPrice } = useDefaultPetrolPrice(open ? userId : undefined);
  const { data: lastEndOdo } = useLastEndOdometer(open ? userId : undefined);

  // Last typed price (else the price list) pre-fills the field until the salesman edits it.
  useEffect(() => {
    if (open && !priceTouched && defaultPrice != null) setPrice(String(defaultPrice));
  }, [open, defaultPrice, priceTouched]);
  useEffect(() => {
    if (open && lastEndOdo != null && startOdo === "") setStartOdo(String(lastEndOdo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lastEndOdo]);

  const userMap = useMemo(() => Object.fromEntries((users || []).map(u => [u.id, u.full_name])), [users]);
  const vehicleMap = useMemo(() => Object.fromEntries((vehicles || []).map(v => [v.id, v])), [vehicles]);
  const customerMap = useMemo(() => Object.fromEntries((customers || []).map(c => [c.id, c.name])), [customers]);
  const userLabel = (id: string) => `${userMap[id] || "—"}${codes?.[id] ? ` (${codes[id]})` : ""}`;

  const userVehicles = useMemo(() => (vehicles || []).filter(v => v.user_id === userId), [vehicles, userId]);

  const filtered = useMemo(() => {
    let list = trips || [];
    if (statusFilter !== "all") list = list.filter(t => t.status === statusFilter);
    if (userFilter !== "all") list = list.filter(t => t.user_id === userFilter);
    return list;
  }, [trips, statusFilter, userFilter]);

  const reset = () => {
    setDate(new Date().toISOString().slice(0, 10));
    setUserId(user?.id || ""); setVehicleId("none"); setFrom(""); setTo(""); setPurpose("");
    setStartOdo(""); setEndOdo(""); setPrice(""); setPriceTouched(false);
    setCustomerId("none"); setRemarks("");
  };
  const close = () => { setOpen(false); reset(); };

  const factor = useMemo(() => factorForDate(factors, date), [factors, date]);
  const live = useMemo(
    () => computeTrip(parseFloat(startOdo) || 0, parseFloat(endOdo) || 0, parseFloat(price) || 0, factor ? Number(factor.factor) : null),
    [startOdo, endOdo, price, factor],
  );

  const voucherCtx = {
    userName: (id: string) => userMap[id] || "",
    employeeCode: (id: string) => codes?.[id] || "",
    vehicleLabel: (id: string | null) => { const v = id ? vehicleMap[id] : null; return v ? `${v.vehicle_type}${v.registration_no ? ` · ${v.registration_no}` : ""}` : "—"; },
    customerName: (id: string | null) => (id ? customerMap[id] || "—" : "—"),
  };

  const create = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Salesperson is required");
      if (!startOdo || !endOdo) throw new Error("Start & end odometer required");
      if (parseFloat(endOdo) <= parseFloat(startOdo)) throw new Error("End odometer must be greater than start");
      const p = parseFloat(price);
      if (!p || p <= 0) throw new Error("Enter today's petrol price (Rs per litre)");
      if (!factor) throw new Error("No multiplying factor is set for this date. Ask the super admin to set it under Fuel Prices & Factor.");
      const payload: any = {
        trip_date: date, user_id: userId,
        vehicle_id: vehicleId === "none" ? null : vehicleId,
        from_location: from.trim() || null, to_location: to.trim() || null, purpose: purpose.trim() || null,
        start_odometer: parseFloat(startOdo), end_odometer: parseFloat(endOdo),
        fuel_price_entered: p,
        customer_id: customerId === "none" ? null : customerId,
        status: "Submitted", created_by: user?.id || null, remarks: remarks.trim() || null,
      };
      const { data, error } = await supabase.from("sales_fuel_trips" as any).insert(payload).select("*").single();
      if (error) throw error;
      return data as unknown as SalesFuelTrip;
    },
    onSuccess: (trip) => {
      qc.invalidateQueries({ queryKey: [SALES_FUEL_KEYS.trips] });
      qc.invalidateQueries({ queryKey: [SALES_FUEL_KEYS.lastPrice] });
      qc.invalidateQueries({ queryKey: ["sales_fuel_last_end_odo"] });
      toast.success(`Trip posted · ${trip.voucher_number ?? ""} · Rs ${fmtMoney(trip.amount)}`);
      close();
      printSalesFuelVouchers([trip], voucherCtx);
    },
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: [SALES_FUEL_KEYS.trips] }); toast.success("Updated"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sales_fuel_trips" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [SALES_FUEL_KEYS.trips] }); toast.success("Deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalAmt = filtered.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const totalKm = filtered.reduce((s, t) => s + (Number(t.km) || 0), 0);
  const selectedTrips = filtered.filter((t) => selected.has(t.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allSelected = filtered.length > 0 && filtered.every((t) => selected.has(t.id));

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Sales Fuel Trips" description="Log customer-visit trips. Rate per km = petrol price (salesman) × factor (super admin); amount = km × rate." />

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">Trips shown</div><div className="text-2xl font-bold">{filtered.length}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">Total Km</div><div className="text-2xl font-bold">{totalKm.toFixed(1)}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">Total Amount</div><div className="text-2xl font-bold">Rs. {totalAmt.toFixed(0)}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">Factor today</div><div className="text-2xl font-bold">{(() => { const f = factorForDate(factors, new Date().toISOString().slice(0, 10)); return f ? Number(f.factor).toFixed(4) : "not set"; })()}</div><div className="text-xs text-muted-foreground">set by super admin</div></CardContent></Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-lg flex items-center gap-2"><Fuel className="h-5 w-5" /> Trip Log</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              {selectedTrips.length > 0 && (
                <Button variant="outline" onClick={() => printSalesFuelVouchers(selectedTrips, voucherCtx)}>
                  <Printer className="h-4 w-4 mr-2" />Print {selectedTrips.length} voucher{selectedTrips.length > 1 ? "s" : ""} (2 per page)
                </Button>
              )}
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
                        {isManager ? (
                          <Select value={userId} onValueChange={(v) => { setUserId(v); setVehicleId("none"); setPriceTouched(false); setStartOdo(""); }}>
                            <SelectTrigger className="bg-background"><SelectValue placeholder="Select" /></SelectTrigger>
                            <SelectContent className="bg-background z-50 max-h-60">
                              {users?.map(u => <SelectItem key={u.id} value={u.id}>{userLabel(u.id)}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input value={userLabel(userId)} readOnly className="bg-muted" />
                        )}
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
                              {v.vehicle_type}{v.registration_no ? ` · ${v.registration_no}` : ""}
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

                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-2">Distance</div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-2">
                        <Label>Start Odo (km) *</Label>
                        <Input type="number" step="0.1" value={startOdo} onChange={(e) => setStartOdo(e.target.value)} required />
                        {lastEndOdo != null && <p className="text-xs text-muted-foreground">Last trip ended at {Number(lastEndOdo).toLocaleString()}</p>}
                      </div>
                      <div className="space-y-2"><Label>End Odo (km) *</Label><Input type="number" step="0.1" value={endOdo} onChange={(e) => setEndOdo(e.target.value)} required /></div>
                      <div className="space-y-2"><Label>Km (auto)</Label><Input value={live.km.toFixed(1)} readOnly className="bg-muted" /></div>
                    </div>

                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-2">Amount</div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="space-y-2">
                        <Label>Petrol price (Rs/L) *</Label>
                        <Input type="number" step="0.01" min="0" value={price} onChange={(e) => { setPrice(e.target.value); setPriceTouched(true); }} required />
                        <p className="text-xs text-muted-foreground">Today's pump price</p>
                      </div>
                      <div className="space-y-2">
                        <Label>× Factor</Label>
                        <Input value={factor ? Number(factor.factor).toFixed(4) : "not set"} readOnly className="bg-muted font-medium" />
                        <p className="text-xs text-muted-foreground">Super admin{factor ? ` · from ${factor.effective_date}` : ""}</p>
                      </div>
                      <div className="space-y-2">
                        <Label>= Rate / km</Label>
                        <Input value={fmtMoney(live.rate)} readOnly className="bg-muted font-medium" />
                      </div>
                      <div className="space-y-2">
                        <Label>Voucher amount</Label>
                        <Input value={live.amount != null ? `Rs ${fmtMoney(live.amount)}` : "—"} readOnly className="bg-emerald-500/10 font-semibold text-emerald-700" />
                        <p className="text-xs text-muted-foreground">rate × km</p>
                      </div>
                    </div>
                    {!factor && <p className="text-sm text-amber-700">No multiplying factor is set for {date}. The super admin sets it under Fuel Prices &amp; Factor.</p>}

                    <div className="space-y-2">
                      <Label>Remarks</Label>
                      <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" onClick={close}>Cancel</Button>
                      <Button type="submit" disabled={create.isPending}>
                        <Printer className="h-4 w-4 mr-2" />Post trip &amp; print voucher
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Posting needs End Odo above Start Odo. The voucher prints twice on one A4 page (Accounts copy + Salesman copy).</p>
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
                    <TableHead className="w-8"><Checkbox checked={allSelected} onCheckedChange={(c) => setSelected(c ? new Set(filtered.map((t) => t.id)) : new Set())} aria-label="Select all" /></TableHead>
                    <TableHead>Voucher</TableHead>
                    <TableHead>Date</TableHead><TableHead>Salesperson</TableHead>
                    <TableHead>Route</TableHead><TableHead>Customer</TableHead>
                    <TableHead className="text-right">Km</TableHead>
                    <TableHead className="text-right">Rs/L</TableHead>
                    <TableHead className="text-right">Factor</TableHead>
                    <TableHead className="text-right">Rate/km</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={13} className="text-center">Loading...</TableCell></TableRow>
                  ) : !filtered.length ? (
                    <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground">No trips</TableCell></TableRow>
                  ) : filtered.map((t) => (
                    <TableRow key={t.id} data-state={selected.has(t.id) ? "selected" : undefined}>
                      <TableCell><Checkbox checked={selected.has(t.id)} onCheckedChange={() => toggle(t.id)} aria-label="Select trip" /></TableCell>
                      <TableCell className="font-mono text-xs">{t.voucher_number || "—"}</TableCell>
                      <TableCell>{t.trip_date}</TableCell>
                      <TableCell className="font-medium">{userLabel(t.user_id)}</TableCell>
                      <TableCell className="text-xs">
                        {(t.from_location || "—")} → {(t.to_location || "—")}
                        {t.purpose && <div className="text-muted-foreground">{t.purpose}</div>}
                      </TableCell>
                      <TableCell className="text-xs">{t.customer_id ? customerMap[t.customer_id] || "—" : "—"}</TableCell>
                      <TableCell className="text-right">{Number(t.km).toFixed(1)}</TableCell>
                      <TableCell className="text-right">{t.fuel_price_snapshot != null ? Number(t.fuel_price_snapshot).toFixed(2) : "—"}</TableCell>
                      <TableCell className="text-right">{t.rate_factor_snapshot != null ? Number(t.rate_factor_snapshot).toFixed(4) : "—"}</TableCell>
                      <TableCell className="text-right">{t.rate_per_km != null ? Number(t.rate_per_km).toFixed(2) : "—"}</TableCell>
                      <TableCell className="text-right font-semibold">{t.amount != null ? `Rs. ${fmtMoney(t.amount)}` : "—"}</TableCell>
                      <TableCell><Badge className={STATUS_COLORS[t.status] || ""} variant="outline">{t.status}</Badge></TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button variant="ghost" size="icon" title="Print voucher" onClick={() => printSalesFuelVouchers([t], voucherCtx)}>
                          <Printer className="h-4 w-4" />
                        </Button>
                        {t.status === "Submitted" && isManager && (
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
                        {t.status !== "Paid" && (isManager || t.user_id === user?.id) && (
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
