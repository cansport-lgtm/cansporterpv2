import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addMonths, format } from "date-fns";
import { Link } from "react-router-dom";
import { Settings2, Lock, Unlock, Loader2, BookOpen, Save } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  CUTOVER_OPTIONS, LEDGER_BUCKETS, bucketLabel, fmtQty,
  type LedgerBucket, type LedgerSettings,
} from "@/lib/gradeLedger";

type OpeningRow = { bucket: LedgerBucket; grade_id: string; quantity: number };
type AdjustmentRow = {
  id: string;
  txn_date: string;
  bucket: string;
  quantity: number;
  reason: string;
  reference: string | null;
  created_at: string;
  grades: { code: string; name: string } | null;
  app_users: { full_name: string | null } | null;
};

const key = (bucket: string, gradeId: string) => `${bucket}:${gradeId}`;

export default function GradeLedgerSetupPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

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

  const { data: openings = [] } = useQuery<OpeningRow[]>({
    queryKey: ["grade-ledger-openings"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("grade_ledger_openings").select("bucket, grade_id, quantity");
      if (error) throw error;
      return (data || []) as OpeningRow[];
    },
  });

  const { data: adjustments = [], isLoading: adjLoading } = useQuery<AdjustmentRow[]>({
    queryKey: ["grade-ledger-adjustments"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("grade_ledger_adjustments")
        .select("id, txn_date, bucket, quantity, reason, reference, created_at, grades(code, name), app_users(full_name)")
        .order("txn_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data || []) as AdjustmentRow[];
    },
  });

  // --- Settings -------------------------------------------------------------
  const [cutover, setCutover] = useState(CUTOVER_OPTIONS[0]);
  const [blockFrom, setBlockFrom] = useState(format(addMonths(new Date(CUTOVER_OPTIONS[0]), 1), "yyyy-MM-dd"));

  useEffect(() => {
    if (settings) {
      setCutover(settings.cutover_date);
      setBlockFrom(settings.block_negative_from);
    }
  }, [settings]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["grade-ledger-settings"] });
    queryClient.invalidateQueries({ queryKey: ["grade-ledger-openings"] });
    queryClient.invalidateQueries({ queryKey: ["grade-ledger-adjustments"] });
    queryClient.invalidateQueries({ queryKey: ["grade-ledger-summary"] });
    queryClient.invalidateQueries({ queryKey: ["grade-ledger-movements"] });
    queryClient.invalidateQueries({ queryKey: ["grade-ledger-balance"] });
  };

  const saveSettings = useMutation({
    mutationFn: async (locked: boolean) => {
      const { error } = await (supabase as any).rpc("grade_ledger_save_settings", {
        p_cutover: cutover, p_block_from: blockFrom, p_opening_locked: locked,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Settings saved" }); invalidate(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // --- Opening balances -----------------------------------------------------
  const [draft, setDraft] = useState<Record<string, string>>({});
  const savedOpening = useMemo(() => {
    const m: Record<string, number> = {};
    openings.forEach((o) => { m[key(o.bucket, o.grade_id)] = Number(o.quantity); });
    return m;
  }, [openings]);

  useEffect(() => {
    const m: Record<string, string> = {};
    Object.entries(savedOpening).forEach(([k, v]) => { m[k] = String(v); });
    setDraft(m);
  }, [savedOpening]);

  const changedRows = useMemo(() => {
    const rows: { bucket: string; grade_id: string; quantity: number }[] = [];
    grades.forEach((g: any) => LEDGER_BUCKETS.forEach((b) => {
      const k = key(b.value, g.id);
      const next = Number(draft[k] || 0);
      if (next !== (savedOpening[k] || 0)) rows.push({ bucket: b.value, grade_id: g.id, quantity: next });
    }));
    return rows;
  }, [draft, savedOpening, grades]);

  const saveOpenings = useMutation({
    mutationFn: async () => {
      if (changedRows.some((r) => !(r.quantity >= 0))) throw new Error("Opening balances cannot be negative.");
      const { error } = await (supabase as any).rpc("grade_ledger_save_openings", { p_rows: changedRows });
      if (error) throw error;
      return changedRows.length;
    },
    onSuccess: (n) => { toast({ title: "Opening balances saved", description: `${n} value(s) updated` }); invalidate(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const openingTotals = LEDGER_BUCKETS.map((b) =>
    grades.reduce((s: number, g: any) => s + Number(draft[key(b.value, g.id)] || 0), 0));

  // --- Adjustments ----------------------------------------------------------
  const [adj, setAdj] = useState({
    txn_date: format(new Date(), "yyyy-MM-dd"),
    bucket: "" as string,
    grade_id: "",
    direction: "remove" as "add" | "remove",
    quantity: "",
    reason: "",
    reference: "",
  });

  const { data: adjBalance } = useQuery({
    queryKey: ["grade-ledger-balance", adj.bucket, adj.grade_id, adj.txn_date],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("grade_ledger_balance", {
        p_bucket: adj.bucket, p_grade: adj.grade_id, p_as_of: adj.txn_date,
      });
      if (error) throw error;
      return Number(data || 0);
    },
    enabled: !!settings && !!adj.bucket && !!adj.grade_id && !!adj.txn_date,
  });

  const signedQty = (adj.direction === "add" ? 1 : -1) * Number(adj.quantity || 0);

  const addAdjustment = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("grade_ledger_add_adjustment", {
        p_date: adj.txn_date,
        p_bucket: adj.bucket,
        p_grade: adj.grade_id,
        p_quantity: signedQty,
        p_reason: adj.reason,
        p_reference: adj.reference || null,
      });
      if (error) throw error;
      return Number(data);
    },
    onSuccess: (after) => {
      toast(after < 0
        ? { title: "Adjustment posted with a warning", description: `Balance is now ${fmtQty(after)} (negative).`, variant: "destructive" }
        : { title: "Adjustment posted", description: `New balance: ${fmtQty(after)} bags` });
      setAdj((a) => ({ ...a, quantity: "", reason: "", reference: "" }));
      invalidate();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const locked = !!settings?.opening_locked;

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title="Grade Ledger Setup"
          description="Cutover date, opening balances and stock adjustments (super admin only)"
          icon={Settings2}
          iconColor="bg-primary text-primary-foreground"
        >
          <Button variant="outline" asChild>
            <Link to="/production/grade-ledger"><BookOpen className="h-4 w-4 mr-2" /> Grade ledger</Link>
          </Button>
        </PageHeader>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              Settings
              {settings && (locked
                ? <Badge variant="secondary"><Lock className="h-3 w-3 mr-1" /> Opening locked</Badge>
                : <Badge variant="warning"><Unlock className="h-3 w-3 mr-1" /> Opening editable</Badge>)}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            {settingsLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
              <>
                <div>
                  <Label className="text-xs">Start counting from (cutover)</Label>
                  <Select value={cutover} onValueChange={(v) => { setCutover(v); if (!settings) setBlockFrom(format(addMonths(new Date(v), 1), "yyyy-MM-dd")); }} disabled={locked}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CUTOVER_OPTIONS.map((d) => (
                        <SelectItem key={d} value={d}>{format(new Date(d), "dd MMM yyyy")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Block negative stock from</Label>
                  <Input type="date" className="w-44" value={blockFrom} min={cutover} onChange={(e) => setBlockFrom(e.target.value)} />
                </div>
                <Button onClick={() => saveSettings.mutate(locked)} disabled={saveSettings.isPending}>
                  <Save className="h-4 w-4 mr-2" /> Save settings
                </Button>
                {settings && (
                  <Button variant="outline" onClick={() => {
                    const msg = locked
                      ? "Unlock the opening balances? They can then be changed again, which changes every balance after the cutover."
                      : "Lock the opening balances? After locking, stock can only be corrected with adjustments.";
                    if (window.confirm(msg)) saveSettings.mutate(!locked);
                  }} disabled={saveSettings.isPending}>
                    {locked ? <><Unlock className="h-4 w-4 mr-2" /> Unlock opening</> : <><Lock className="h-4 w-4 mr-2" /> Lock opening</>}
                  </Button>
                )}
                <p className="w-full text-xs text-muted-foreground">
                  Until the blocking date, entries that take a grade's stock below zero are saved with a warning.
                  From that date on they are refused.
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {settings && (
          <Tabs defaultValue="opening">
            <TabsList>
              <TabsTrigger value="opening">Opening balances</TabsTrigger>
              <TabsTrigger value="adjustments">Adjustments</TabsTrigger>
            </TabsList>

            <TabsContent value="opening">
              <Card>
                <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base">
                    Physical stock on {format(new Date(settings.cutover_date), "dd MMM yyyy")} (bags)
                  </CardTitle>
                  <Button onClick={() => saveOpenings.mutate()} disabled={locked || !changedRows.length || saveOpenings.isPending}>
                    {saveOpenings.isPending ? "Saving..." : `Save${changedRows.length ? ` (${changedRows.length})` : ""}`}
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table className="min-w-[600px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Grade</TableHead>
                          {LEDGER_BUCKETS.map((b) => <TableHead key={b.value} className="text-right">{b.label}</TableHead>)}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {grades.map((g: any) => (
                          <TableRow key={g.id}>
                            <TableCell className="font-display font-bold">{g.code} <span className="font-normal text-muted-foreground text-xs">{g.name !== g.code ? g.name : ""}</span></TableCell>
                            {LEDGER_BUCKETS.map((b) => {
                              const k = key(b.value, g.id);
                              return (
                                <TableCell key={b.value} className="text-right">
                                  <Input type="number" min={0} className="w-28 ml-auto text-right" disabled={locked}
                                    value={draft[k] ?? ""} placeholder="0"
                                    onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ))}
                        <TableRow className="bg-muted/40 font-semibold">
                          <TableCell>Total</TableCell>
                          {openingTotals.map((t, i) => <TableCell key={i} className="text-right tabular-nums pr-6">{fmtQty(t)}</TableCell>)}
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="adjustments" className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Post an adjustment</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <Label className="text-xs">Date</Label>
                      <Input type="date" className="w-40" value={adj.txn_date} min={settings.cutover_date}
                        onChange={(e) => setAdj({ ...adj, txn_date: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs">Stage</Label>
                      <Select value={adj.bucket} onValueChange={(v) => setAdj({ ...adj, bucket: v })}>
                        <SelectTrigger className="w-32"><SelectValue placeholder="Stage" /></SelectTrigger>
                        <SelectContent>
                          {LEDGER_BUCKETS.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Grade</Label>
                      <Select value={adj.grade_id} onValueChange={(v) => setAdj({ ...adj, grade_id: v })}>
                        <SelectTrigger className="w-44"><SelectValue placeholder="Grade" /></SelectTrigger>
                        <SelectContent>
                          {grades.map((g: any) => <SelectItem key={g.id} value={g.id}>{g.code} - {g.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Direction</Label>
                      <Select value={adj.direction} onValueChange={(v: "add" | "remove") => setAdj({ ...adj, direction: v })}>
                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="add">Add stock (+)</SelectItem>
                          <SelectItem value="remove">Remove stock (−)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Bags</Label>
                      <Input type="number" className="w-28" min={0} value={adj.quantity}
                        onChange={(e) => setAdj({ ...adj, quantity: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs">Reference</Label>
                      <Input className="w-44" value={adj.reference} placeholder="e.g. count sheet no."
                        onChange={(e) => setAdj({ ...adj, reference: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Reason *</Label>
                    <Textarea rows={2} value={adj.reason} placeholder="What discrepancy was reported and how it was verified"
                      onChange={(e) => setAdj({ ...adj, reason: e.target.value })} />
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button onClick={() => addAdjustment.mutate()}
                      disabled={!adj.bucket || !adj.grade_id || !(Number(adj.quantity) > 0) || !adj.reason.trim() || addAdjustment.isPending}>
                      {addAdjustment.isPending ? "Posting..." : "Post adjustment"}
                    </Button>
                    {adj.bucket && adj.grade_id && adjBalance !== undefined && (
                      <span className="text-sm text-muted-foreground">
                        Book balance on {adj.txn_date}: <b>{fmtQty(adjBalance)}</b>
                        {Number(adj.quantity) > 0 && <> → <b className={adjBalance + signedQty < 0 ? "text-destructive" : ""}>{fmtQty(adjBalance + signedQty)}</b></>}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Adjustment register</CardTitle></CardHeader>
                <CardContent className="p-0">
                  {adjLoading ? (
                    <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading</div>
                  ) : !adjustments.length ? (
                    <div className="py-10 text-center text-sm text-muted-foreground">No adjustments yet.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table className="min-w-[800px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Stage</TableHead>
                            <TableHead>Grade</TableHead>
                            <TableHead className="text-right">Bags</TableHead>
                            <TableHead>Reason</TableHead>
                            <TableHead>Reference</TableHead>
                            <TableHead>Posted by</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {adjustments.map((a) => (
                            <TableRow key={a.id}>
                              <TableCell className="whitespace-nowrap text-muted-foreground text-sm">{format(new Date(a.txn_date), "dd MMM yyyy")}</TableCell>
                              <TableCell className="font-semibold">{bucketLabel(a.bucket)}</TableCell>
                              <TableCell className="font-display font-bold">{a.grades?.code}</TableCell>
                              <TableCell className={`text-right tabular-nums font-semibold ${Number(a.quantity) < 0 ? "text-destructive" : "text-emerald-600"}`}>
                                {Number(a.quantity) > 0 ? "+" : "−"}{fmtQty(Math.abs(Number(a.quantity)))}
                              </TableCell>
                              <TableCell className="text-sm max-w-[320px]">{a.reason}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">{a.reference ?? "—"}</TableCell>
                              <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                                {a.app_users?.full_name ?? "—"} · {format(new Date(a.created_at), "dd MMM HH:mm")}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </ERPLayout>
  );
}
