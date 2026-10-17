import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format, startOfMonth } from "date-fns";
import { Fuel, Printer } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { fmtDT, ppDb, todayPk, useMyEmployee } from "@/lib/personGatePass";
import { FUEL_KEYS, FUEL_SELECT, fmtKm, fmtRs, fuelStatusMeta, isApprovedFuel, printTripFuelVouchers, type TripFuelVoucher } from "@/lib/tripFuel";

type UnclaimedPass = { id: string; pass_number: string; pass_date: string; destination: string | null; reason: string | null; gate_out_at: string | null; gate_in_at: string | null };

/**
 * Self-service: the trip fuel vouchers of the staff member linked to the login, for staff paid travel
 * allowance (employees.travel_allowance_allowed). Approved vouchers print two to an A4 sheet for the cashier;
 * finished company work trips with no claim yet link to the pass page to claim.
 */
export default function MyTravelVouchersPage() {
  const { user } = useAuth();
  const { data: me, isLoading: meLoading } = useMyEmployee(user?.id);
  const allowed = Boolean(me?.travel_allowance_allowed);
  const [fromDate, setFromDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(todayPk());
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const { data: vouchers = [], isLoading } = useQuery<TripFuelVoucher[]>({
    queryKey: [FUEL_KEYS.mine, me?.id, fromDate, toDate],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await ppDb
        .from("staff_trip_fuel_vouchers")
        .select(FUEL_SELECT)
        .eq("employee_id", me!.id)
        .gte("trip_date", fromDate)
        .lte("trip_date", toDate)
        .order("trip_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: unclaimed = [] } = useQuery<UnclaimedPass[]>({
    queryKey: [FUEL_KEYS.mine, "unclaimed", me?.id, fromDate, toDate],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await ppDb
        .from("staff_gate_passes")
        .select("id, pass_number, pass_date, destination, reason, gate_out_at, gate_in_at, fuel:staff_trip_fuel_vouchers(status)")
        .eq("employee_id", me!.id)
        .eq("pass_kind", "official_duty")
        .in("status", ["returned", "not_returned"])
        .not("gate_out_at", "is", null)
        .gte("pass_date", fromDate)
        .lte("pass_date", toDate)
        .order("pass_date", { ascending: false });
      if (error) return [];
      return (data ?? []).filter((p: { fuel?: { status: string }[] }) => !(p.fuel ?? []).some((f) => ["pending_approval", "approved", "paid"].includes(f.status)));
    },
  });

  const printable = useMemo(() => vouchers.filter((v) => isApprovedFuel(v.status)), [vouchers]);
  const selected = printable.filter((v) => picked.has(v.id));
  const totals = useMemo(() => ({
    approved: printable.reduce((s, v) => s + Number(v.amount), 0),
    km: printable.reduce((s, v) => s + Number(v.km), 0),
    awaiting: vouchers.filter((v) => v.status === "pending_approval").length,
  }), [printable, vouchers]);

  const toggle = (id: string, on: boolean) => setPicked((prev) => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  });
  const allPicked = printable.length > 0 && selected.length === printable.length;
  const print = (list: TripFuelVoucher[]) => printTripFuelVouchers(list.map((voucher) => ({ voucher })));

  const header = <PageHeader title="My Travel Vouchers" description="Your trip fuel vouchers. Print the approved ones (two to a page) and collect the cash from the cashier" icon={Fuel} iconColor="bg-amber-600 text-white" />;

  if (!meLoading && (!me || !allowed)) {
    return (
      <ERPLayout>
        <div className="w-full max-w-2xl space-y-4">
          {header}
          <Card><CardContent className="p-6 text-center text-muted-foreground">
            {!me
              ? "Your login is not linked to a staff record yet. Ask HR to link your login on the Employees page."
              : "Travel allowance is not enabled for you, so you have no travel vouchers. If you should be paid travel allowance, ask HR to turn it on on the Employees page."}
          </CardContent></Card>
        </div>
      </ERPLayout>
    );
  }

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        {header}

        <Card>
          <CardContent className="p-3 sm:p-4 flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="mtv-from" className="text-xs">From</Label>
              <Input id="mtv-from" type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPicked(new Set()); }} />
            </div>
            <div>
              <Label htmlFor="mtv-to" className="text-xs">To</Label>
              <Input id="mtv-to" type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPicked(new Set()); }} />
            </div>
            <div className="flex flex-wrap gap-2 sm:ml-auto">
              <Button variant="outline" disabled={selected.length === 0} onClick={() => print(selected)}>
                <Printer className="h-4 w-4 mr-1" /> Print selected ({selected.length})
              </Button>
              <Button disabled={printable.length === 0} onClick={() => print(printable)}>
                <Printer className="h-4 w-4 mr-1" /> Print all approved ({printable.length})
              </Button>
            </div>
            <p className="basis-full text-xs text-muted-foreground">Vouchers print two to an A4 page with a cut line between them. Only approved vouchers can be printed for the cashier.</p>
          </CardContent>
        </Card>

        {unclaimed.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Trips not claimed yet</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {unclaimed.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
                  <div>
                    <span className="font-mono font-semibold">{p.pass_number}</span>
                    <span className="text-muted-foreground"> · {format(new Date(p.pass_date), "dd MMM")}{p.destination ? ` · ${p.destination}` : ""}</span>
                    {p.gate_out_at && <div className="text-xs text-muted-foreground">Out {fmtDT(p.gate_out_at)}{p.gate_in_at ? ` · In ${fmtDT(p.gate_in_at)}` : ""}</div>}
                  </div>
                  <Button asChild size="sm" variant="outline"><Link to={`/my-gate-pass/${p.id}`}><Fuel className="h-4 w-4 mr-1" /> Claim fuel</Link></Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0">
            <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 text-xs text-muted-foreground border-b">
              <span><b className="text-foreground">{vouchers.length}</b> vouchers</span>
              <span><b className="text-foreground">{printable.length}</b> approved · <b className="text-foreground">{fmtRs(totals.approved)}</b> · {fmtKm(totals.km)}</span>
              {totals.awaiting > 0 && <span><b className="text-foreground">{totals.awaiting}</b> awaiting HR approval</span>}
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <Checkbox aria-label="Select all approved" checked={allPicked} disabled={printable.length === 0}
                        onCheckedChange={(c) => setPicked(c ? new Set(printable.map((v) => v.id)) : new Set())} />
                    </TableHead>
                    <TableHead>Voucher</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Route</TableHead>
                    <TableHead className="text-right">Km</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading || meLoading ? (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                  ) : vouchers.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No travel vouchers for these dates.</TableCell></TableRow>
                  ) : vouchers.map((v) => {
                    const st = fuelStatusMeta(v.status);
                    const canPrint = isApprovedFuel(v.status);
                    return (
                      <TableRow key={v.id}>
                        <TableCell>
                          {canPrint && <Checkbox aria-label={`Select ${v.voucher_number}`} checked={picked.has(v.id)} onCheckedChange={(c) => toggle(v.id, Boolean(c))} />}
                        </TableCell>
                        <TableCell className="font-mono font-semibold">
                          <Link to={`/my-gate-pass/${v.pass_id}`} className="hover:underline">{v.voucher_number}</Link>
                          <div className="text-[11px] text-muted-foreground font-sans">{v.pass?.pass_number}</div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{format(new Date(v.trip_date), "dd MMM")}</TableCell>
                        <TableCell className="max-w-[260px] truncate" title={v.route ?? ""}>{v.destination ? <span className="font-medium">{v.destination} · </span> : null}{v.route}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">{fmtKm(v.km)}</TableCell>
                        <TableCell className="text-right font-semibold whitespace-nowrap">{fmtRs(v.amount)}</TableCell>
                        <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {canPrint && <Button variant="ghost" size="sm" aria-label={`Print ${v.voucher_number}`} onClick={() => print([v])}><Printer className="h-4 w-4" /></Button>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
