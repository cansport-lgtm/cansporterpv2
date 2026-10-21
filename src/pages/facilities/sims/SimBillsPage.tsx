import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, Receipt, RotateCcw, Save, Send } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { TimelineList } from "@/components/facilities/TimelineList";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { errorMessage, facilitiesCan, fcDb, fmtDateTime, fmtMoney, todayPk } from "@/lib/facilities";
import {
  SIM_BILL_LINE_SELECT, SIM_BILL_SELECT, SIM_NETWORKS, fmtMonth, monthStart, noteSimBillLine, postSimBill,
  reopenSimBill, saveSimBillLines, startSimBill, type SimBill, type SimBillLine, type SimOverLimitRow,
} from "@/lib/facilitiesSims";

export default function SimBillsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { roles } = useAuth();
  const canManage = facilitiesCan(roles, "manage");
  const canOperate = facilitiesCan(roles, "operate");

  const [tab, setTab] = useState<"bills" | "over">("bills");
  const [month, setMonth] = useState(todayPk().slice(0, 7));
  const [network, setNetwork] = useState<string>(SIM_NETWORKS[0]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const billMonth = monthStart(month);

  // All bills of the chosen month (one per network) and the recent history.
  const { data: bills = [] } = useQuery<SimBill[]>({
    queryKey: ["facilities-sim-bills"],
    queryFn: async () => {
      const { data, error } = await fcDb.from("facilities_sim_bills").select(SIM_BILL_SELECT)
        .order("bill_month", { ascending: false }).order("network").limit(120);
      if (error) throw error;
      return data ?? [];
    },
  });
  const bill = bills.find((b) => b.bill_month === billMonth && b.network === network) ?? null;

  const { data: lines = [], isLoading: linesLoading } = useQuery<SimBillLine[]>({
    queryKey: ["facilities-sim-bill-lines", bill?.id],
    enabled: Boolean(bill?.id),
    queryFn: async () => {
      const { data, error } = await fcDb.from("facilities_sim_bill_lines").select(SIM_BILL_LINE_SELECT).eq("bill_id", bill?.id);
      if (error) throw error;
      const rows = (data ?? []) as SimBillLine[];
      return rows.sort((a, b) => (a.sim?.sim_number ?? "").localeCompare(b.sim?.sim_number ?? ""));
    },
  });
  useEffect(() => {
    const a: Record<string, string> = {}; const n: Record<string, string> = {};
    for (const l of lines) { a[l.id] = String(l.amount ?? 0); n[l.id] = l.note ?? ""; }
    setAmounts(a); setNotes(n);
  }, [lines]);

  const { data: overRows = [] } = useQuery<SimOverLimitRow[]>({
    queryKey: ["facilities-sim-over-limit"],
    enabled: tab === "over",
    queryFn: async () => {
      const { data, error } = await fcDb.from("v_facilities_sim_over_limit").select("*").order("total_over", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["facilities-sim-bills"] });
    queryClient.invalidateQueries({ queryKey: ["facilities-sim-bill-lines"] });
    queryClient.invalidateQueries({ queryKey: ["facilities-events", "sim_bill"] });
    queryClient.invalidateQueries({ queryKey: ["facilities-sim-over-limit"] });
    queryClient.invalidateQueries({ queryKey: ["facilities-sim-over-last-month"] });
  };
  const fail = (e: unknown) => toast({ title: "Not saved", description: errorMessage(e), variant: "destructive" });

  const startMutation = useMutation({
    mutationFn: () => startSimBill(network, billMonth),
    onSuccess: () => { toast({ title: `${network} bill for ${fmtMonth(billMonth)} started` }); refresh(); },
    onError: fail,
  });
  const saveMutation = useMutation({
    mutationFn: () => saveSimBillLines(bill?.id as string, lines.map((l) => ({ id: l.id, amount: Number(amounts[l.id] || 0) }))),
    onSuccess: () => { toast({ title: "Amounts saved" }); refresh(); },
    onError: fail,
  });
  const postMutation = useMutation({
    mutationFn: async () => {
      await saveSimBillLines(bill?.id as string, lines.map((l) => ({ id: l.id, amount: Number(amounts[l.id] || 0) })));
      await postSimBill(bill?.id as string);
    },
    onSuccess: () => { toast({ title: "Bill posted", description: "Over-limit lines are flagged; the company bears them." }); refresh(); },
    onError: fail,
  });
  const reopenMutation = useMutation({
    mutationFn: () => reopenSimBill(bill?.id as string),
    onSuccess: () => { toast({ title: "Bill reopened" }); refresh(); },
    onError: fail,
  });
  const noteMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => noteSimBillLine(id, note),
    onSuccess: () => { toast({ title: "Note saved" }); refresh(); },
    onError: fail,
  });

  const liveTotal = useMemo(() => lines.reduce((s, l) => s + Number(amounts[l.id] || 0), 0), [lines, amounts]);
  const liveOver = useMemo(() => lines.reduce((s, l) => s + Math.max(Number(amounts[l.id] || 0) - Number(l.monthly_limit), 0), 0), [lines, amounts]);
  const liveOverCount = useMemo(() => lines.filter((l) => Number(amounts[l.id] || 0) > Number(l.monthly_limit)).length, [lines, amounts]);
  const posted = bill?.status === "posted";
  const dirty = lines.some((l) => Number(amounts[l.id] || 0) !== Number(l.amount));

  const monthBills = bills.filter((b) => b.bill_month === billMonth);

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title="SIM Monthly Bills" description="One bill run per network per month. Over-limit amounts are flagged and reported; the company bears them." icon={Receipt}>
          <Button variant="outline" asChild><Link to="/facilities/sims"><ArrowLeft className="h-4 w-4 mr-1" /> SIM register</Link></Button>
        </PageHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "bills" | "over")}>
          <TabsList>
            <TabsTrigger value="bills">Bills</TabsTrigger>
            <TabsTrigger value="over">Over-limit report (6 months)</TabsTrigger>
          </TabsList>
        </Tabs>

        {tab === "bills" ? (
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <div className="space-y-4 min-w-0">
              <Card>
                <CardContent className="p-4 flex flex-wrap items-end gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="bill-month">Month</Label>
                    <Input id="bill-month" type="month" value={month} max={todayPk().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} className="w-[170px]" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="bill-network">Network</Label>
                    <Select value={network} onValueChange={setNetwork}>
                      <SelectTrigger id="bill-network" className="w-[150px]"><SelectValue /></SelectTrigger>
                      <SelectContent>{SIM_NETWORKS.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {!bill && canOperate && (
                    <Button onClick={() => startMutation.mutate()} disabled={startMutation.isPending || !month}>
                      {startMutation.isPending ? "Starting…" : `Enter ${network} bill for ${fmtMonth(billMonth)}`}
                    </Button>
                  )}
                  {bill && (
                    <div className="flex items-center gap-2 ml-auto">
                      <Badge variant={posted ? "success" : "warning"}>{posted ? "Posted" : "Draft"}</Badge>
                      {posted && bill.posted_at && <span className="text-xs text-muted-foreground">{fmtDateTime(bill.posted_at)} · {bill.posted_by_user?.full_name ?? ""}</span>}
                    </div>
                  )}
                </CardContent>
              </Card>

              {bill ? (
                <Card>
                  <CardHeader className="pb-2 flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                    <CardTitle className="text-base">{bill.network} · {fmtMonth(bill.bill_month)}</CardTitle>
                    <div className="flex flex-wrap gap-2">
                      {!posted && canOperate && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !dirty}>
                            <Save className="h-4 w-4 mr-1" /> Save amounts
                          </Button>
                          <Button size="sm" onClick={() => postMutation.mutate()} disabled={postMutation.isPending}>
                            <Send className="h-4 w-4 mr-1" /> {postMutation.isPending ? "Posting…" : "Post bill"}
                          </Button>
                        </>
                      )}
                      {posted && canManage && (
                        <Button size="sm" variant="outline" onClick={() => reopenMutation.mutate()} disabled={reopenMutation.isPending}>
                          <RotateCcw className="h-4 w-4 mr-1" /> Reopen
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="p-0 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Number</TableHead>
                          <TableHead>Holder</TableHead>
                          <TableHead className="text-right">Limit</TableHead>
                          <TableHead className="text-right w-[140px]">Bill (PKR)</TableHead>
                          <TableHead className="text-right">Over limit</TableHead>
                          <TableHead>{posted ? "Note (company bears)" : ""}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {linesLoading ? (
                          <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
                        ) : lines.map((l) => {
                          const amt = Number(amounts[l.id] || 0);
                          const over = posted ? Number(l.over_limit) : Math.max(amt - Number(l.monthly_limit), 0);
                          return (
                            <TableRow key={l.id} className={cn(over > 0 && "bg-amber-50/60 dark:bg-amber-950/20")}>
                              <TableCell className="font-mono whitespace-nowrap">
                                {l.sim?.sim_number}
                                {l.sim?.package_name && <div className="font-sans text-xs text-muted-foreground">{l.sim.package_name}</div>}
                              </TableCell>
                              <TableCell>{l.holder ? `${l.holder.full_name} (${l.holder.employee_code})` : <span className="text-muted-foreground">no holder</span>}</TableCell>
                              <TableCell className="text-right tabular-nums">{fmtMoney(l.monthly_limit)}</TableCell>
                              <TableCell className="text-right">
                                {posted || !canOperate ? (
                                  <span className="tabular-nums">{fmtMoney(l.amount)}</span>
                                ) : (
                                  <Input id={`amt-${l.id}`} type="number" min={0} step="1" className="text-right h-8"
                                    value={amounts[l.id] ?? ""} onChange={(e) => setAmounts({ ...amounts, [l.id]: e.target.value })} />
                                )}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {over > 0 ? <Badge variant="warning">{fmtMoney(over)}</Badge> : <span className="text-muted-foreground">—</span>}
                              </TableCell>
                              <TableCell>
                                {posted && over > 0 && (
                                  canManage ? (
                                    <div className="flex gap-1">
                                      <Input id={`note-${l.id}`} className="h-8" placeholder="optional" value={notes[l.id] ?? ""}
                                        onChange={(e) => setNotes({ ...notes, [l.id]: e.target.value })} />
                                      <Button size="sm" variant="ghost" disabled={noteMutation.isPending || (notes[l.id] ?? "") === (l.note ?? "")}
                                        onClick={() => noteMutation.mutate({ id: l.id, note: notes[l.id] ?? "" })}>Save</Button>
                                    </div>
                                  ) : (l.note ?? "")
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {lines.length > 0 && (
                          <TableRow className="font-medium">
                            <TableCell colSpan={3}>Total · {lines.length} numbers · {posted ? bill.over_limit_count : liveOverCount} over limit</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtMoney(posted ? bill.total_amount : liveTotal)}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtMoney(posted ? bill.over_limit_total : liveOver)}</TableCell>
                            <TableCell />
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              ) : (
                <Card><CardContent className="p-6 text-sm text-muted-foreground">
                  No {network} bill entered for {fmtMonth(billMonth)} yet.{canOperate ? " Start it above: one line per issued number, prefilled with the package cost." : ""}
                </CardContent></Card>
              )}

              {bill && <TimelineList documentType="sim_bill" documentId={bill.id} />}
            </div>

            <div className="space-y-4 min-w-0">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">{fmtMonth(billMonth)} · all networks</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {SIM_NETWORKS.map((n) => {
                    const b = monthBills.find((x) => x.network === n);
                    return (
                      <button key={n} type="button" onClick={() => setNetwork(n)}
                        className={cn("w-full flex items-center justify-between rounded-md border px-3 py-2 text-left hover:bg-muted", n === network && "border-primary")}>
                        <span>{n}</span>
                        {b ? (
                          <span className="flex items-center gap-2">
                            <span className="tabular-nums">{fmtMoney(b.total_amount)}</span>
                            <Badge variant={b.status === "posted" ? "success" : "warning"}>{b.status}</Badge>
                          </span>
                        ) : <span className="text-muted-foreground">not entered</span>}
                      </button>
                    );
                  })}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Recent bills</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader><TableRow><TableHead>Month</TableHead><TableHead>Network</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Over</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {bills.slice(0, 12).map((b) => (
                        <TableRow key={b.id} className="cursor-pointer" onClick={() => { setMonth(b.bill_month.slice(0, 7)); setNetwork(b.network); }}>
                          <TableCell className="whitespace-nowrap">{fmtMonth(b.bill_month)}</TableCell>
                          <TableCell>{b.network} {b.status === "draft" && <Badge variant="warning" className="ml-1">draft</Badge>}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtMoney(b.total_amount)}</TableCell>
                          <TableCell className="text-right tabular-nums">{b.over_limit_count ? `${b.over_limit_count} · ${fmtMoney(b.over_limit_total)}` : "—"}</TableCell>
                        </TableRow>
                      ))}
                      {bills.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4">No bills yet.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Numbers over their limit in the last 6 months</CardTitle>
              <p className="text-sm text-muted-foreground">For information only: the company bears the bill. Repeat offenders may need a bigger package or a word.</p>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Number</TableHead><TableHead>Network</TableHead><TableHead>Holder</TableHead>
                    <TableHead className="text-right">Months over</TableHead><TableHead className="text-right">Total over (PKR)</TableHead><TableHead>Last</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overRows.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No number went over its limit.</TableCell></TableRow>
                  ) : overRows.map((r) => (
                    <TableRow key={r.sim_id} className={cn(r.months_over >= 3 && "bg-amber-50/60 dark:bg-amber-950/20")}>
                      <TableCell className="font-mono">{r.sim_number}</TableCell>
                      <TableCell>{r.network}</TableCell>
                      <TableCell>{r.holder_name ? `${r.holder_name} (${r.holder_code})` : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.months_over}{r.months_over >= 3 && <Badge variant="warning" className="ml-2">repeat</Badge>}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(r.total_over)}</TableCell>
                      <TableCell className="whitespace-nowrap">{fmtMonth(r.last_month_over)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </ERPLayout>
  );
}
