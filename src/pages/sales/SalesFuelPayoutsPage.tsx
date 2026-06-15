import { useState, useMemo } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Printer, FileText, CheckCircle2 } from "lucide-react";

interface AppUser { id: string; full_name: string; }
interface Trip {
  id: string; trip_date: string; user_id: string;
  from_location: string | null; to_location: string | null;
  km: number; litres: number | null; amount: number | null;
  fuel_price_snapshot: number | null; mileage_kmpl_snapshot: number | null;
  status: string; payout_id: string | null;
}
interface Payout {
  id: string; payout_number: string; user_id: string;
  week_start: string; week_end: string;
  total_km: number; total_litres: number; total_amount: number;
  status: string; generated_at: string; paid_at: string | null;
}

// Monday of the week containing date
function mondayOf(d: Date) {
  const x = new Date(d); const day = x.getDay(); const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff); x.setHours(0,0,0,0); return x;
}
function isoDate(d: Date) { return d.toISOString().slice(0,10); }

export default function SalesFuelPayoutsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const today = new Date();
  const defMon = mondayOf(today);
  const defSun = new Date(defMon); defSun.setDate(defMon.getDate() + 6);
  const [weekStart, setWeekStart] = useState(isoDate(defMon));
  const [weekEnd, setWeekEnd] = useState(isoDate(defSun));

  const { data: users } = useQuery({
    queryKey: ["app_users_active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_users").select("id,full_name").eq("is_active", true).order("full_name");
      if (error) throw error;
      return data as unknown as AppUser[];
    },
  });

  const { data: approvedTrips } = useQuery({
    queryKey: ["sft_unpaid_approved", weekStart, weekEnd],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_fuel_trips" as any).select("*")
        .eq("status", "Approved").is("payout_id", null)
        .gte("trip_date", weekStart).lte("trip_date", weekEnd);
      if (error) throw error;
      return data as unknown as Trip[];
    },
  });

  const { data: payouts } = useQuery({
    queryKey: ["sales_fuel_payouts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_fuel_payouts" as any).select("*").order("generated_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data as unknown as Payout[];
    },
  });

  const userMap = useMemo(() => Object.fromEntries((users || []).map(u => [u.id, u.full_name])), [users]);

  // group eligible by user
  const eligibleByUser = useMemo(() => {
    const map = new Map<string, Trip[]>();
    (approvedTrips || []).forEach(t => {
      if (!map.has(t.user_id)) map.set(t.user_id, []);
      map.get(t.user_id)!.push(t);
    });
    return map;
  }, [approvedTrips]);

  const generate = useMutation({
    mutationFn: async (uid: string) => {
      const list = eligibleByUser.get(uid) || [];
      if (!list.length) throw new Error("No eligible trips");
      const total_km = list.reduce((s, t) => s + (Number(t.km) || 0), 0);
      const total_litres = list.reduce((s, t) => s + (Number(t.litres) || 0), 0);
      const total_amount = list.reduce((s, t) => s + (Number(t.amount) || 0), 0);
      const { data, error } = await supabase.from("sales_fuel_payouts" as any).insert({
        user_id: uid, week_start: weekStart, week_end: weekEnd,
        total_km, total_litres, total_amount,
        status: "Generated", generated_by: user?.id || null,
      }).select("id").single();
      if (error) throw error;
      const payoutId = (data as any).id;
      const ids = list.map(t => t.id);
      const { error: e2 } = await supabase.from("sales_fuel_trips" as any).update({ payout_id: payoutId }).in("id", ids);
      if (e2) throw e2;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sft_unpaid_approved"] });
      qc.invalidateQueries({ queryKey: ["sales_fuel_payouts"] });
      toast.success("Payout generated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const markPaid = useMutation({
    mutationFn: async (p: Payout) => {
      const { error } = await supabase.from("sales_fuel_payouts" as any).update({
        status: "Paid", paid_by: user?.id || null, paid_at: new Date().toISOString(),
      }).eq("id", p.id);
      if (error) throw error;
      const { error: e2 } = await supabase.from("sales_fuel_trips" as any).update({ status: "Paid" }).eq("payout_id", p.id);
      if (e2) throw e2;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales_fuel_payouts"] });
      qc.invalidateQueries({ queryKey: ["sales_fuel_trips"] });
      toast.success("Marked paid");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // print preview state
  const [printPayout, setPrintPayout] = useState<Payout | null>(null);
  const [printTrips, setPrintTrips] = useState<Trip[]>([]);

  const openPrint = async (p: Payout) => {
    const { data, error } = await supabase.from("sales_fuel_trips" as any).select("*").eq("payout_id", p.id).order("trip_date");
    if (error) { toast.error(error.message); return; }
    setPrintTrips(data as unknown as Trip[]);
    setPrintPayout(p);
  };

  const printStatement = () => {
    if (!printPayout) return;
    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${printPayout.payout_number}</title>
<style>
@page { size: A4; margin: 15mm; }
body { font-family: Arial, sans-serif; color:#111; }
h1 { font-size:18px; margin:0; }
h2 { font-size:14px; margin:6px 0 0; color:#444; }
.muted { color:#666; font-size:12px; }
table { width:100%; border-collapse:collapse; margin-top:12px; font-size:12px; }
th, td { border:1px solid #999; padding:6px 8px; text-align:left; }
th { background:#f0f0f0; }
.right { text-align:right; }
.foot { margin-top:30px; display:flex; justify-content:space-between; font-size:12px; }
.sign { width:30%; border-top:1px solid #444; padding-top:6px; text-align:center; }
</style></head><body>
<h1>CANSPORT GLOBAL INDUSTRIES</h1>
<h2>FUEL PAYOUT STATEMENT — ${printPayout.payout_number}</h2>
<div class="muted">Salesperson: <b>${userMap[printPayout.user_id] || "—"}</b> &nbsp;·&nbsp; Week: ${printPayout.week_start} to ${printPayout.week_end} &nbsp;·&nbsp; Generated: ${new Date(printPayout.generated_at).toLocaleDateString()}</div>
<table>
<thead><tr><th>#</th><th>Date</th><th>Route</th><th class="right">Km</th><th class="right">Litres</th><th class="right">Rs./L</th><th class="right">Amount (Rs.)</th></tr></thead>
<tbody>
${printTrips.map((t,i) => `<tr><td>${i+1}</td><td>${t.trip_date}</td><td>${(t.from_location||"—")} → ${(t.to_location||"—")}</td>
<td class="right">${Number(t.km).toFixed(1)}</td><td class="right">${t.litres!=null?Number(t.litres).toFixed(2):"—"}</td>
<td class="right">${t.fuel_price_snapshot!=null?Number(t.fuel_price_snapshot).toFixed(2):"—"}</td>
<td class="right">${t.amount!=null?Number(t.amount).toFixed(0):"—"}</td></tr>`).join("")}
<tr><td colspan="3"><b>TOTAL</b></td>
<td class="right"><b>${Number(printPayout.total_km).toFixed(1)}</b></td>
<td class="right"><b>${Number(printPayout.total_litres).toFixed(2)}</b></td>
<td></td>
<td class="right"><b>Rs. ${Number(printPayout.total_amount).toFixed(0)}</b></td></tr>
</tbody></table>
<div class="foot">
  <div class="sign">Prepared By</div>
  <div class="sign">Approved By</div>
  <div class="sign">Received By (Salesperson)</div>
</div>
<p class="muted" style="margin-top:18px">Calculation: Amount = (Km ÷ Mileage km/L) × Fuel Price/L. Snapshots locked at the time of approval.</p>
</body></html>`;
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    w.document.write(html); w.document.close();
    setTimeout(() => w.print(), 300);
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Fuel Weekly Payouts" description="Group approved trips into a weekly payout per salesperson" />

        <Tabs defaultValue="generate">
          <TabsList>
            <TabsTrigger value="generate">Generate Payouts</TabsTrigger>
            <TabsTrigger value="history">Payout History</TabsTrigger>
          </TabsList>

          <TabsContent value="generate" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Week Range</CardTitle>
              </CardHeader>
              <CardContent className="flex gap-4 items-end">
                <div className="space-y-1">
                  <Label>Week Start</Label>
                  <Input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Week End</Label>
                  <Input type="date" value={weekEnd} onChange={(e) => setWeekEnd(e.target.value)} />
                </div>
                <div className="text-sm text-muted-foreground pb-2">
                  Includes approved + unpaid trips in this range.
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-lg">Eligible by Salesperson</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Salesperson</TableHead>
                      <TableHead className="text-right">Trips</TableHead>
                      <TableHead className="text-right">Total Km</TableHead>
                      <TableHead className="text-right">Total Litres</TableHead>
                      <TableHead className="text-right">Total Amount</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {eligibleByUser.size === 0 ? (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No eligible trips in this week</TableCell></TableRow>
                    ) : Array.from(eligibleByUser.entries()).map(([uid, list]) => {
                      const km = list.reduce((s,t)=>s+(Number(t.km)||0),0);
                      const lit = list.reduce((s,t)=>s+(Number(t.litres)||0),0);
                      const amt = list.reduce((s,t)=>s+(Number(t.amount)||0),0);
                      return (
                        <TableRow key={uid}>
                          <TableCell className="font-medium">{userMap[uid] || "—"}</TableCell>
                          <TableCell className="text-right">{list.length}</TableCell>
                          <TableCell className="text-right">{km.toFixed(1)}</TableCell>
                          <TableCell className="text-right">{lit.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-semibold">Rs. {amt.toFixed(0)}</TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" onClick={() => generate.mutate(uid)} disabled={generate.isPending}>
                              <FileText className="h-4 w-4 mr-1" /> Generate
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card>
              <CardHeader><CardTitle className="text-lg">Payout History</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Payout #</TableHead><TableHead>Salesperson</TableHead>
                      <TableHead>Week</TableHead><TableHead className="text-right">Km</TableHead>
                      <TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!payouts?.length ? (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No payouts yet</TableCell></TableRow>
                    ) : payouts.map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs">{p.payout_number}</TableCell>
                        <TableCell className="font-medium">{userMap[p.user_id] || "—"}</TableCell>
                        <TableCell className="text-xs">{p.week_start} → {p.week_end}</TableCell>
                        <TableCell className="text-right">{Number(p.total_km).toFixed(1)}</TableCell>
                        <TableCell className="text-right font-semibold">Rs. {Number(p.total_amount).toFixed(0)}</TableCell>
                        <TableCell>
                          <Badge variant={p.status === "Paid" ? "default" : "secondary"}>{p.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <Button variant="ghost" size="icon" title="Print" onClick={() => openPrint(p)}>
                            <Printer className="h-4 w-4" />
                          </Button>
                          {p.status !== "Paid" && (
                            <Button variant="ghost" size="icon" title="Mark Paid" onClick={() => { if (confirm("Mark this payout as Paid?")) markPaid.mutate(p); }}>
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={!!printPayout} onOpenChange={(o) => { if (!o) { setPrintPayout(null); setPrintTrips([]); } }}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{printPayout?.payout_number} — {printPayout && userMap[printPayout.user_id]}</DialogTitle></DialogHeader>
            {printPayout && (
              <div className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  Week: {printPayout.week_start} → {printPayout.week_end} · Total: <b>Rs. {Number(printPayout.total_amount).toFixed(0)}</b>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Date</TableHead><TableHead>Route</TableHead><TableHead className="text-right">Km</TableHead><TableHead className="text-right">L</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {printTrips.map(t => (
                      <TableRow key={t.id}>
                        <TableCell>{t.trip_date}</TableCell>
                        <TableCell className="text-xs">{(t.from_location||"—")} → {(t.to_location||"—")}</TableCell>
                        <TableCell className="text-right">{Number(t.km).toFixed(1)}</TableCell>
                        <TableCell className="text-right">{t.litres!=null?Number(t.litres).toFixed(2):"—"}</TableCell>
                        <TableCell className="text-right">{t.amount!=null?`Rs. ${Number(t.amount).toFixed(0)}`:"—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex justify-end">
                  <Button onClick={printStatement}><Printer className="h-4 w-4 mr-2" /> Print Statement</Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
