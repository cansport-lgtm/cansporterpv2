import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format, startOfMonth } from "date-fns";
import { Banknote, Download, Fuel, Printer, Save, Search } from "lucide-react";
import * as XLSX from "xlsx";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { errorMessage, fmtDT, hasAnyRole, ppDb, todayPk } from "@/lib/personGatePass";
import {
  FUEL_APPROVE_ROLES, FUEL_KEYS, FUEL_PAY_ROLES, FUEL_SELECT, FUEL_SETTINGS_ROLES, FUEL_STATUS_META, fmtKm, fmtRs, fuelStatusMeta,
  invalidateTripFuelQueries, printTripFuelVoucher, useTripFuelSettings, type TripFuelVoucher,
} from "@/lib/tripFuel";

/** The cashier's queue of trip fuel vouchers: approved ones to pay, history, export, and the rate settings. */
export default function TripFuelVouchersPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { roles } = useAuth();
  const canPay = hasAnyRole(roles, FUEL_PAY_ROLES);
  const canSettings = hasAnyRole(roles, FUEL_SETTINGS_ROLES);
  const isHr = hasAnyRole(roles, FUEL_APPROVE_ROLES);
  const today = todayPk();
  const [fromDate, setFromDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(today);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [payTarget, setPayTarget] = useState<TripFuelVoucher | null>(null);
  const [payRemarks, setPayRemarks] = useState("");
  const { data: settings } = useTripFuelSettings();
  const [rate, setRate] = useState<string | null>(null);
  const [maxKm, setMaxKm] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery<TripFuelVoucher[]>({
    queryKey: [FUEL_KEYS.list, fromDate, toDate],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await ppDb
        .from("staff_trip_fuel_vouchers")
        .select(FUEL_SELECT)
        .gte("trip_date", fromDate)
        .lte("trip_date", toDate)
        .order("trip_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Approved vouchers waiting for cash, whatever their date.
  const { data: toPay = [] } = useQuery<TripFuelVoucher[]>({
    queryKey: [FUEL_KEYS.pending, "approved"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await ppDb.from("staff_trip_fuel_vouchers").select(FUEL_SELECT).eq("status", "approved").order("approved_at");
      if (error) return [];
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((v) => {
      if (statusFilter !== "all" && v.status !== statusFilter) return false;
      if (!q) return true;
      return [v.voucher_number, v.pass?.pass_number, v.person?.employee_code, v.person?.full_name, v.route, v.destination]
        .some((s) => (s ?? "").toLowerCase().includes(q));
    });
  }, [rows, statusFilter, search]);

  const totals = useMemo(() => ({
    paid: filtered.filter((v) => v.status === "paid").reduce((s, v) => s + Number(v.amount), 0),
    approved: filtered.filter((v) => v.status === "approved").reduce((s, v) => s + Number(v.amount), 0),
    km: filtered.filter((v) => ["approved", "paid"].includes(v.status)).reduce((s, v) => s + Number(v.km), 0),
  }), [filtered]);

  const pay = useMutation({
    mutationFn: async ({ id, remarks }: { id: string; remarks: string }) => {
      const { error } = await ppDb.rpc("staff_trip_fuel_pay", { p_id: id, p_remarks: remarks || null });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Marked paid" }); setPayTarget(null); setPayRemarks(""); invalidateTripFuelQueries(queryClient); },
    onError: (e) => toast({ title: "Could not mark paid", description: errorMessage(e), variant: "destructive" }),
  });

  const saveSettings = useMutation({
    mutationFn: async () => {
      const { error } = await ppDb.rpc("staff_trip_fuel_settings_save", {
        p_rate_per_km: rate === null ? null : Number(rate),
        p_max_km_per_trip: maxKm === null ? null : Number(maxKm),
      });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Settings saved" }); setRate(null); setMaxKm(null); queryClient.invalidateQueries({ queryKey: [FUEL_KEYS.settings] }); },
    onError: (e) => toast({ title: "Could not save", description: errorMessage(e), variant: "destructive" }),
  });

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filtered.map((v) => ({
      Voucher: v.voucher_number, "Trip date": v.trip_date, Pass: v.pass?.pass_number ?? "", Code: v.person?.employee_code ?? "", Name: v.person?.full_name ?? "",
      Department: v.person?.production_departments?.name ?? "", Destination: v.destination ?? "", Route: v.route ?? "",
      "Start km": v.start_km ?? "", "End km": v.end_km ?? "", Km: Number(v.km), "Rate / km": Number(v.rate_per_km), Amount: Number(v.amount),
      Status: fuelStatusMeta(v.status).label, "Claimed by": v.creator?.full_name ?? "", "Approved by": v.approver?.full_name ?? "",
      "Approved at": v.approved_at ? format(new Date(v.approved_at), "dd MMM yyyy HH:mm") : "", "Paid by": v.payer?.full_name ?? "",
      "Paid at": v.paid_at ? format(new Date(v.paid_at), "dd MMM yyyy HH:mm") : "", Remarks: v.paid_remarks ?? v.approval_remarks ?? v.cancel_reason ?? "",
    }))), "Vouchers");
    XLSX.writeFile(wb, `trip-fuel-vouchers-${fromDate}-to-${toDate}.xlsx`);
  };

  const rateValue = rate ?? String(settings?.fuel_rate_per_km ?? "");
  const maxKmValue = maxKm ?? String(settings?.fuel_max_km_per_trip ?? "");

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title="Trip Fuel Vouchers" description="Cash vouchers for staff company work trips: approved by the HR manager, paid in cash by the cashier against the printed voucher" icon={Fuel} iconColor="bg-amber-600 text-white" />

        {canSettings && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Settings</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="tfv-rate">Fuel rate per km (Rs)</Label>
                <Input id="tfv-rate" type="number" inputMode="decimal" min={0} step="0.5" className="w-40" value={rateValue} onChange={(e) => setRate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="tfv-max">Max km per trip</Label>
                <Input id="tfv-max" type="number" inputMode="numeric" min={1} className="w-40" value={maxKmValue} onChange={(e) => setMaxKm(e.target.value)} />
              </div>
              <Button size="sm" disabled={(rate === null && maxKm === null) || saveSettings.isPending} onClick={() => saveSettings.mutate()}><Save className="h-4 w-4 mr-1" /> Save</Button>
              <p className="text-xs text-muted-foreground basis-full">Every claim is km × this rate. The rate is frozen on each voucher when it is claimed, so changing it never alters old vouchers.</p>
            </CardContent>
          </Card>
        )}
        {!canSettings && Number(settings?.fuel_rate_per_km ?? 0) <= 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">The fuel rate per km is not set yet. Ask a super admin to set it here.</div>
        )}

        <Card className={cn(toPay.length && "border-sky-300")}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Banknote className="h-4 w-4" /> Approved · waiting for cash · {toPay.length}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {toPay.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">Nothing to pay.</div>
            ) : toPay.map((v) => (
              <div key={v.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-200 bg-sky-50/40 p-3">
                <div className="min-w-0">
                  <div className="font-semibold">
                    <Link to={`/hr/gate-pass/${v.pass_id}`} className="font-mono hover:underline">{v.voucher_number}</Link> · {v.person?.employee_code} {v.person?.full_name}
                  </div>
                  <div className="text-xs text-muted-foreground">{format(new Date(v.trip_date), "dd MMM")} · {v.pass?.pass_number} · {v.route} · approved by {v.approver?.full_name ?? "HR"} {fmtDT(v.approved_at)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right mr-2">
                    <div className="text-lg font-bold">{fmtRs(v.amount)}</div>
                    <div className="text-xs text-muted-foreground">{fmtKm(v.km)}</div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => printTripFuelVoucher(v)}><Printer className="h-4 w-4 mr-1" /> Print</Button>
                  {canPay && <Button size="sm" onClick={() => setPayTarget(v)}><Banknote className="h-4 w-4 mr-1" /> Mark paid</Button>}
                </div>
              </div>
            ))}
            {!canPay && toPay.length > 0 && <div className="text-xs text-muted-foreground">Only the cashier (petty cash handler / expenses) can mark a voucher paid.</div>}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 sm:p-4 grid grid-cols-2 md:grid-cols-6 gap-3">
            <div>
              <Label htmlFor="tfv-from" className="text-xs">From</Label>
              <Input id="tfv-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="tfv-to" className="text-xs">To</Label>
              <Input id="tfv-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {Object.entries(FUEL_STATUS_META).map(([v, m]) => <SelectItem key={v} value={v}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label htmlFor="tfv-search" className="text-xs">Search</Label>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input id="tfv-search" className="pl-8" placeholder="Voucher, pass, staff code, name, route" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
            <div className="flex items-end">
              <Button variant="outline" className="w-full" onClick={exportExcel}><Download className="h-4 w-4 mr-1" /> Export Excel</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 text-xs text-muted-foreground border-b">
              <span><b className="text-foreground">{filtered.length}</b> vouchers</span>
              <span><b className="text-foreground">{fmtKm(totals.km)}</b> approved or paid</span>
              <span><b className="text-foreground">{fmtRs(totals.paid)}</b> paid</span>
              <span><b className="text-foreground">{fmtRs(totals.approved)}</b> approved, not yet paid</span>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Voucher</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Staff</TableHead>
                    <TableHead>Route</TableHead>
                    <TableHead className="text-right">Km</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Paid</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No vouchers for this filter.</TableCell></TableRow>
                  ) : filtered.map((v) => {
                    const st = fuelStatusMeta(v.status);
                    return (
                      <TableRow key={v.id}>
                        <TableCell className="font-mono font-semibold">
                          <Link to={`/hr/gate-pass/${v.pass_id}`} className="hover:underline">{v.voucher_number}</Link>
                          <div className="text-[11px] text-muted-foreground font-sans">{v.pass?.pass_number}</div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{format(new Date(v.trip_date), "dd MMM")}</TableCell>
                        <TableCell>
                          <div className="font-medium">{v.person?.full_name}</div>
                          <div className="text-xs text-muted-foreground">{v.person?.employee_code}{v.person?.production_departments?.name ? ` · ${v.person.production_departments.name}` : ""}</div>
                        </TableCell>
                        <TableCell className="max-w-[260px] truncate" title={v.route ?? ""}>{v.destination ? <span className="font-medium">{v.destination} · </span> : null}{v.route}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">{fmtKm(v.km)}</TableCell>
                        <TableCell className="text-right font-semibold whitespace-nowrap">{fmtRs(v.amount)}</TableCell>
                        <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{v.paid_at ? `${v.payer?.full_name ?? ""} · ${fmtDT(v.paid_at)}` : ""}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <Button variant="ghost" size="sm" onClick={() => printTripFuelVoucher(v)}><Printer className="h-4 w-4" /></Button>
                          {canPay && v.status === "approved" && <Button size="sm" variant="outline" onClick={() => setPayTarget(v)}>Mark paid</Button>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {isHr && <p className="text-xs text-muted-foreground">Claims waiting for approval are on HR → Gate Pass Approvals and on each pass page.</p>}
      </div>

      <Dialog open={payTarget !== null} onOpenChange={(o) => { if (!o) { setPayTarget(null); setPayRemarks(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark {payTarget?.voucher_number} paid</DialogTitle>
            <DialogDescription>Confirm that {fmtRs(payTarget?.amount)} was handed over in cash to {payTarget?.person?.full_name}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="tfv-pay-remarks">Remarks (optional)</Label>
            <Textarea id="tfv-pay-remarks" rows={2} value={payRemarks} onChange={(e) => setPayRemarks(e.target.value)} placeholder="e.g. Paid from drawer, receipt signed" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayTarget(null)}>Back</Button>
            <Button disabled={pay.isPending} onClick={() => payTarget && pay.mutate({ id: payTarget.id, remarks: payRemarks })}><Banknote className="h-4 w-4 mr-1" /> Mark paid</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
