import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format, startOfMonth } from "date-fns";
import { Download, Fuel, Printer, Save, Search } from "lucide-react";
import * as XLSX from "xlsx";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, fmtDT, hasAnyRole, ppDb, todayPk } from "@/lib/personGatePass";
import {
  FUEL_APPROVE_ROLES, FUEL_FILTER_STATUSES, FUEL_KEYS, FUEL_SELECT, FUEL_SETTINGS_ROLES, FUEL_STATUS_META, fmtKm, fmtRs, fuelStatusMeta,
  isApprovedFuel, printTripFuelVoucher, useTripFuelSettings, type TripFuelVoucher,
} from "@/lib/tripFuel";

/**
 * Trip fuel vouchers: the register of every voucher (approved ones are what the cashier pays in cash against the
 * printed voucher, nothing is recorded for the payment), export, and the rate settings.
 */
export default function TripFuelVouchersPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { roles } = useAuth();
  const canSettings = hasAnyRole(roles, FUEL_SETTINGS_ROLES);
  const isHr = hasAnyRole(roles, FUEL_APPROVE_ROLES);
  const today = todayPk();
  const [fromDate, setFromDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(today);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((v) => {
      if (statusFilter === "approved" ? !isApprovedFuel(v.status) : statusFilter !== "all" && v.status !== statusFilter) return false;
      if (!q) return true;
      return [v.voucher_number, v.pass?.pass_number, v.person?.employee_code, v.person?.full_name, v.route, v.destination]
        .some((s) => (s ?? "").toLowerCase().includes(q));
    });
  }, [rows, statusFilter, search]);

  const totals = useMemo(() => ({
    approved: filtered.filter((v) => isApprovedFuel(v.status)).reduce((s, v) => s + Number(v.amount), 0),
    approvedCount: filtered.filter((v) => isApprovedFuel(v.status)).length,
    awaiting: filtered.filter((v) => v.status === "pending_approval").reduce((s, v) => s + Number(v.amount), 0),
    km: filtered.filter((v) => isApprovedFuel(v.status)).reduce((s, v) => s + Number(v.km), 0),
  }), [filtered]);

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
      "Approved at": v.approved_at ? format(new Date(v.approved_at), "dd MMM yyyy HH:mm") : "", Remarks: v.approval_remarks ?? v.cancel_reason ?? "",
    }))), "Vouchers");
    XLSX.writeFile(wb, `trip-fuel-vouchers-${fromDate}-to-${toDate}.xlsx`);
  };

  const rateValue = rate ?? String(settings?.fuel_rate_per_km ?? "");
  const maxKmValue = maxKm ?? String(settings?.fuel_max_km_per_trip ?? "");

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title="Trip Fuel Vouchers" description="Cash vouchers for staff company work trips. The HR manager approves; the cashier pays in cash against the printed voucher" icon={Fuel} iconColor="bg-amber-600 text-white" />

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
                  {FUEL_FILTER_STATUSES.map((v) => <SelectItem key={v} value={v}>{FUEL_STATUS_META[v].label}</SelectItem>)}
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
              <span><b className="text-foreground">{totals.approvedCount}</b> approved · <b className="text-foreground">{fmtRs(totals.approved)}</b> · {fmtKm(totals.km)}</span>
              <span><b className="text-foreground">{fmtRs(totals.awaiting)}</b> awaiting HR approval</span>
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
                    <TableHead>Approved by</TableHead>
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
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{v.approved_at ? `${v.approver?.full_name ?? ""} · ${fmtDT(v.approved_at)}` : ""}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <Button variant="ghost" size="sm" onClick={() => printTripFuelVoucher(v)}><Printer className="h-4 w-4" /></Button>
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
    </ERPLayout>
  );
}
