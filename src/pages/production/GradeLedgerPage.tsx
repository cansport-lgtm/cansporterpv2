import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, startOfMonth } from "date-fns";
import { Link } from "react-router-dom";
import { BookOpen, Loader2, Info, Settings2, Shuffle, Trash2, PackagePlus, AlertTriangle } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  LEDGER_BUCKETS, LEDGER_SOURCE, DEPARTMENT_LABEL, bucketLabel, fmtQty,
  type LedgerSettings,
} from "@/lib/gradeLedger";

type SummaryRow = {
  bucket: string;
  grade_id: string;
  grade_code: string;
  grade_name: string;
  opening: number;
  produced: number;
  consumed: number;
  regrade_in: number;
  regrade_out: number;
  adjustment_in: number;
  adjustment_out: number;
  packing_out: number;
  closing: number;
};

type MovementRow = {
  movement_id: string;
  txn_date: string;
  bucket: string;
  grade_id: string;
  grade_code: string;
  qty_in: number;
  qty_out: number;
  balance: number;
  source_type: string;
  department_code: string | null;
  reference: string | null;
  remarks: string | null;
  entered_by: string | null;
};

type TransferRow = {
  id: string;
  txn_date: string;
  grade_id: string;
  quantity: number;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
  grades: { code: string; name: string } | null;
  app_users: { full_name: string | null } | null;
};

const signed = (inQty: number, outQty: number) => {
  const net = Number(inQty || 0) - Number(outQty || 0);
  if (!net) return "—";
  return net > 0 ? `+${fmtQty(net)}` : `−${fmtQty(-net)}`;
};

export default function GradeLedgerPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, hasRole, hasModulePermission } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  const canTransfer = isSuperAdmin || hasModulePermission("production", "create");

  const [tab, setTab] = useState("summary");
  const [fromDate, setFromDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [bucketFilter, setBucketFilter] = useState("all");
  const [gradeFilter, setGradeFilter] = useState("all");

  const [transfer, setTransfer] = useState({
    txn_date: format(new Date(), "yyyy-MM-dd"),
    grade_id: "",
    quantity: "",
    remarks: "",
  });

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["grade-ledger-settings"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("grade_ledger_settings").select("*").maybeSingle();
      if (error) throw error;
      return (data || null) as LedgerSettings | null;
    },
  });

  const { data: grades = [] } = useQuery({
    queryKey: ["grades"],
    queryFn: async () => {
      const { data, error } = await supabase.from("grades").select("*").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: summary = [], isLoading: summaryLoading } = useQuery<SummaryRow[]>({
    queryKey: ["grade-ledger-summary", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("grade_ledger_summary", { p_from: fromDate, p_to: toDate });
      if (error) throw error;
      return (data || []) as SummaryRow[];
    },
    enabled: !!settings && !!fromDate && !!toDate,
  });

  const { data: movements = [], isLoading: movementsLoading } = useQuery<MovementRow[]>({
    queryKey: ["grade-ledger-movements", fromDate, toDate, bucketFilter, gradeFilter],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("grade_ledger_movements", {
        p_from: fromDate,
        p_to: toDate,
        p_bucket: bucketFilter === "all" ? null : bucketFilter,
        p_grade: gradeFilter === "all" ? null : gradeFilter,
      });
      if (error) throw error;
      return (data || []) as MovementRow[];
    },
    enabled: !!settings && tab === "ledger" && !!fromDate && !!toDate,
  });

  const { data: transfers = [], isLoading: transfersLoading } = useQuery<TransferRow[]>({
    queryKey: ["grade-packing-transfers", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("grade_packing_transfers")
        .select("id, txn_date, grade_id, quantity, remarks, created_by, created_at, grades(code, name), app_users(full_name)")
        .gte("txn_date", fromDate)
        .lte("txn_date", toDate)
        .order("txn_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as TransferRow[];
    },
    enabled: !!settings && tab === "packing",
  });

  const { data: ballBalance } = useQuery({
    queryKey: ["grade-ledger-balance", "BALL", transfer.grade_id, transfer.txn_date],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("grade_ledger_balance", {
        p_bucket: "BALL", p_grade: transfer.grade_id, p_as_of: transfer.txn_date,
      });
      if (error) throw error;
      return Number(data || 0);
    },
    enabled: !!settings && !!transfer.grade_id && !!transfer.txn_date,
  });

  const invalidateLedger = () => {
    queryClient.invalidateQueries({ queryKey: ["grade-ledger-summary"] });
    queryClient.invalidateQueries({ queryKey: ["grade-ledger-movements"] });
    queryClient.invalidateQueries({ queryKey: ["grade-ledger-balance"] });
    queryClient.invalidateQueries({ queryKey: ["grade-packing-transfers"] });
  };

  const addTransfer = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("grade_packing_transfer_add", {
        p_date: transfer.txn_date,
        p_grade: transfer.grade_id,
        p_quantity: Number(transfer.quantity),
        p_remarks: transfer.remarks || null,
      });
      if (error) throw error;
      return Number(data);
    },
    onSuccess: (after) => {
      toast(after < 0
        ? { title: "Saved with a warning", description: `Ball stock for this grade is now ${fmtQty(after)} (negative). Check the entries or ask a super admin to adjust.`, variant: "destructive" }
        : { title: "Transfer saved", description: `Ball stock left for this grade: ${fmtQty(after)} bags` });
      setTransfer((t) => ({ ...t, quantity: "", remarks: "" }));
      invalidateLedger();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteTransfer = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("grade_packing_transfer_delete", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Transfer deleted" });
      invalidateLedger();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const summaryByBucket = useMemo(() => {
    const rows = bucketFilter === "all" ? summary : summary.filter((r) => r.bucket === bucketFilter);
    return LEDGER_BUCKETS
      .map((b) => ({ ...b, rows: rows.filter((r) => r.bucket === b.value) }))
      .filter((b) => b.rows.length > 0);
  }, [summary, bucketFilter]);

  const negatives = summary.filter((r) => Number(r.closing) < 0);

  const openLedger = (bucket: string, gradeId: string) => {
    setBucketFilter(bucket);
    setGradeFilter(gradeId);
    setTab("ledger");
  };

  const today = format(new Date(), "yyyy-MM-dd");

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title="Grade Stock Ledger"
          description="Grade-wise Coly, Jorr and Ball stock from posted production entries"
          icon={BookOpen}
          iconColor="bg-primary text-primary-foreground"
        >
          <Button variant="outline" asChild>
            <Link to="/production/regrades"><Shuffle className="h-4 w-4 mr-2" /> Regrades</Link>
          </Button>
          {isSuperAdmin && (
            <Button variant="outline" asChild>
              <Link to="/production/grade-ledger/setup"><Settings2 className="h-4 w-4 mr-2" /> Opening &amp; adjustments</Link>
            </Button>
          )}
        </PageHeader>

        {settingsLoading ? null : !settings ? (
          <Card>
            <CardContent className="py-10 text-center space-y-2">
              <p className="font-medium">The grade ledger is not set up yet.</p>
              <p className="text-sm text-muted-foreground">
                A super admin needs to choose the cutover date and enter opening balances.
              </p>
              {isSuperAdmin && (
                <Button asChild className="mt-2">
                  <Link to="/production/grade-ledger/setup">Set up now</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex items-start gap-2 rounded-lg bg-sky-500/[0.06] ring-1 ring-inset ring-sky-500/20 px-3 py-2 text-[12.5px] text-sky-900 dark:text-sky-200">
              <Info className="h-4 w-4 text-sky-500 shrink-0 mt-0.5" />
              <span>
                Counting from {format(new Date(settings.cutover_date), "dd MMM yyyy")}. Only posted entries count.
                Each Jorr bag uses 1 Coly bag and each Final / Fancy Final bag uses 1 Jorr bag of the same
                grade (OK + rejected). Negative stock warns until{" "}
                {format(new Date(settings.block_negative_from), "dd MMM yyyy")} and is blocked from then on.
              </span>
            </div>

            <Card>
              <CardContent className="p-3 md:p-4 flex flex-wrap items-end gap-3">
                <div>
                  <Label className="text-xs">From</Label>
                  <Input type="date" className="w-40" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">To</Label>
                  <Input type="date" className="w-40" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Stage</Label>
                  <Select value={bucketFilter} onValueChange={setBucketFilter}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All stages</SelectItem>
                      {LEDGER_BUCKETS.map((b) => (
                        <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {tab === "ledger" && (
                  <div>
                    <Label className="text-xs">Grade</Label>
                    <Select value={gradeFilter} onValueChange={setGradeFilter}>
                      <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All grades</SelectItem>
                        {grades.map((g: any) => (
                          <SelectItem key={g.id} value={g.id}>{g.code} - {g.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </CardContent>
            </Card>

            {negatives.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg bg-destructive/[0.06] ring-1 ring-inset ring-destructive/20 px-3 py-2 text-[12.5px] text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Negative closing stock:{" "}
                  {negatives.map((r) => `${bucketLabel(r.bucket)} ${r.grade_code} (${fmtQty(r.closing)})`).join(", ")}.
                  Check the entries' grades, the opening balance, or ask a super admin to post an adjustment.
                </span>
              </div>
            )}

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="ledger">Ledger</TabsTrigger>
                <TabsTrigger value="packing">Transfer to Packing</TabsTrigger>
              </TabsList>

              <TabsContent value="summary" className="space-y-4">
                {summaryLoading ? (
                  <div className="flex items-center justify-center py-10 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading
                  </div>
                ) : !summaryByBucket.length ? (
                  <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No stock or movements in this period.</CardContent></Card>
                ) : summaryByBucket.map((b) => {
                  const tot = (k: keyof SummaryRow) => b.rows.reduce((s, r) => s + Number(r[k] || 0), 0);
                  return (
                    <Card key={b.value}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">
                          {b.label} stock <span className="text-sm font-normal text-muted-foreground">— made by {b.from}</span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-0">
                        <div className="overflow-x-auto">
                          <Table className="min-w-[900px]">
                            <TableHeader>
                              <TableRow>
                                <TableHead>Grade</TableHead>
                                <TableHead className="text-right">Opening</TableHead>
                                <TableHead className="text-right">Produced</TableHead>
                                <TableHead className="text-right">Consumed</TableHead>
                                <TableHead className="text-right">Regrade</TableHead>
                                <TableHead className="text-right">Adjustment</TableHead>
                                {b.value === "BALL" && <TableHead className="text-right">To packing</TableHead>}
                                <TableHead className="text-right">Closing</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {b.rows.map((r) => (
                                <TableRow key={r.grade_id} className="cursor-pointer" onClick={() => openLedger(r.bucket, r.grade_id)}>
                                  <TableCell className="font-display font-bold">{r.grade_code}</TableCell>
                                  <TableCell className="text-right tabular-nums">{fmtQty(r.opening)}</TableCell>
                                  <TableCell className="text-right tabular-nums text-emerald-600">{Number(r.produced) ? `+${fmtQty(r.produced)}` : "—"}</TableCell>
                                  <TableCell className="text-right tabular-nums text-destructive">{Number(r.consumed) ? `−${fmtQty(r.consumed)}` : "—"}</TableCell>
                                  <TableCell className="text-right tabular-nums">{signed(r.regrade_in, r.regrade_out)}</TableCell>
                                  <TableCell className="text-right tabular-nums">{signed(r.adjustment_in, r.adjustment_out)}</TableCell>
                                  {b.value === "BALL" && (
                                    <TableCell className="text-right tabular-nums text-destructive">{Number(r.packing_out) ? `−${fmtQty(r.packing_out)}` : "—"}</TableCell>
                                  )}
                                  <TableCell className={`text-right tabular-nums font-bold ${Number(r.closing) < 0 ? "text-destructive" : ""}`}>{fmtQty(r.closing)}</TableCell>
                                </TableRow>
                              ))}
                              <TableRow className="bg-muted/40 font-semibold">
                                <TableCell>Total</TableCell>
                                <TableCell className="text-right tabular-nums">{fmtQty(tot("opening"))}</TableCell>
                                <TableCell className="text-right tabular-nums">{fmtQty(tot("produced"))}</TableCell>
                                <TableCell className="text-right tabular-nums">{fmtQty(tot("consumed"))}</TableCell>
                                <TableCell className="text-right tabular-nums">{signed(tot("regrade_in"), tot("regrade_out"))}</TableCell>
                                <TableCell className="text-right tabular-nums">{signed(tot("adjustment_in"), tot("adjustment_out"))}</TableCell>
                                {b.value === "BALL" && <TableCell className="text-right tabular-nums">{fmtQty(tot("packing_out"))}</TableCell>}
                                <TableCell className="text-right tabular-nums">{fmtQty(tot("closing"))}</TableCell>
                              </TableRow>
                            </TableBody>
                          </Table>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
                {summaryByBucket.length > 0 && (
                  <p className="text-xs text-muted-foreground">All quantities in bags. Click a grade to open its ledger.</p>
                )}
              </TabsContent>

              <TabsContent value="ledger">
                <Card>
                  <CardContent className="p-0">
                    {movementsLoading ? (
                      <div className="flex items-center justify-center py-10 text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading
                      </div>
                    ) : !movements.length ? (
                      <div className="py-10 text-center text-sm text-muted-foreground">No movements in this period.</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table className="min-w-[1000px]">
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead>Stage</TableHead>
                              <TableHead>Grade</TableHead>
                              <TableHead>Movement</TableHead>
                              <TableHead>Reference / remarks</TableHead>
                              <TableHead className="text-right">In</TableHead>
                              <TableHead className="text-right">Out</TableHead>
                              <TableHead className="text-right">Balance</TableHead>
                              <TableHead>Entered by</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {movements.map((m) => {
                              const src = LEDGER_SOURCE[m.source_type] ?? { label: m.source_type, variant: "secondary" as const };
                              const dept = m.department_code ? DEPARTMENT_LABEL[m.department_code] ?? m.department_code : null;
                              return (
                                <TableRow key={m.movement_id}>
                                  <TableCell className="whitespace-nowrap text-muted-foreground text-sm">
                                    {format(new Date(m.txn_date), "dd MMM yyyy")}
                                  </TableCell>
                                  <TableCell className="font-semibold">{bucketLabel(m.bucket)}</TableCell>
                                  <TableCell className="font-display font-bold">{m.grade_code}</TableCell>
                                  <TableCell>
                                    <Badge variant={src.variant}>{src.label}{dept ? ` · ${dept}` : ""}</Badge>
                                  </TableCell>
                                  <TableCell className="text-sm text-muted-foreground max-w-[260px] truncate">
                                    {[m.reference, m.remarks].filter(Boolean).join(" — ") || "—"}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums font-semibold text-emerald-600">
                                    {Number(m.qty_in) ? `+${fmtQty(m.qty_in)}` : "—"}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums font-semibold text-destructive">
                                    {Number(m.qty_out) ? `−${fmtQty(m.qty_out)}` : "—"}
                                  </TableCell>
                                  <TableCell className={`text-right tabular-nums font-bold ${Number(m.balance) < 0 ? "text-destructive" : ""}`}>
                                    {fmtQty(m.balance)}
                                  </TableCell>
                                  <TableCell className="text-muted-foreground text-sm whitespace-nowrap">{m.entered_by ?? "—"}</TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="packing" className="space-y-4">
                {canTransfer && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <PackagePlus className="h-4 w-4" /> Hand over Ball bags to Packing
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-wrap items-end gap-3">
                      <div>
                        <Label className="text-xs">Date</Label>
                        <Input type="date" className="w-40" value={transfer.txn_date} max={today}
                          onChange={(e) => setTransfer({ ...transfer, txn_date: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-xs">Grade</Label>
                        <Select value={transfer.grade_id} onValueChange={(v) => setTransfer({ ...transfer, grade_id: v })}>
                          <SelectTrigger className="w-44"><SelectValue placeholder="Select grade" /></SelectTrigger>
                          <SelectContent>
                            {grades.map((g: any) => (
                              <SelectItem key={g.id} value={g.id}>{g.code} - {g.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Bags</Label>
                        <Input type="number" className="w-28" value={transfer.quantity} min={0}
                          onChange={(e) => setTransfer({ ...transfer, quantity: e.target.value })} />
                      </div>
                      <div className="flex-1 min-w-[200px]">
                        <Label className="text-xs">Remarks</Label>
                        <Input value={transfer.remarks} placeholder="Optional"
                          onChange={(e) => setTransfer({ ...transfer, remarks: e.target.value })} />
                      </div>
                      <Button
                        onClick={() => addTransfer.mutate()}
                        disabled={!transfer.grade_id || !(Number(transfer.quantity) > 0) || addTransfer.isPending}
                      >
                        {addTransfer.isPending ? "Saving..." : "Save transfer"}
                      </Button>
                      {transfer.grade_id && ballBalance !== undefined && (
                        <p className={`w-full text-xs ${ballBalance - Number(transfer.quantity || 0) < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                          Ball stock for this grade on {transfer.txn_date}: {fmtQty(ballBalance)} bags
                          {Number(transfer.quantity) > 0 && ` → ${fmtQty(ballBalance - Number(transfer.quantity))} after this transfer`}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardContent className="p-0">
                    {transfersLoading ? (
                      <div className="flex items-center justify-center py-10 text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading
                      </div>
                    ) : !transfers.length ? (
                      <div className="py-10 text-center text-sm text-muted-foreground">No transfers to packing in this period.</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table className="min-w-[700px]">
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead>Grade</TableHead>
                              <TableHead className="text-right">Bags</TableHead>
                              <TableHead>Remarks</TableHead>
                              <TableHead>Entered by</TableHead>
                              <TableHead />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {transfers.map((t) => {
                              const canDelete = isSuperAdmin
                                || (t.created_by === user?.id && format(new Date(t.created_at), "yyyy-MM-dd") === today);
                              return (
                                <TableRow key={t.id}>
                                  <TableCell className="whitespace-nowrap text-muted-foreground text-sm">{format(new Date(t.txn_date), "dd MMM yyyy")}</TableCell>
                                  <TableCell className="font-display font-bold">{t.grades?.code}</TableCell>
                                  <TableCell className="text-right tabular-nums font-semibold">{fmtQty(t.quantity)}</TableCell>
                                  <TableCell className="text-sm text-muted-foreground">{t.remarks ?? "—"}</TableCell>
                                  <TableCell className="text-sm text-muted-foreground">{t.app_users?.full_name ?? "—"}</TableCell>
                                  <TableCell className="text-right">
                                    {canDelete && (
                                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                                        disabled={deleteTransfer.isPending}
                                        onClick={() => { if (window.confirm("Delete this transfer?")) deleteTransfer.mutate(t.id); }}>
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </ERPLayout>
  );
}
