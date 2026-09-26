import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, startOfMonth } from "date-fns";
import { Link } from "react-router-dom";
import { Shuffle, Loader2, BookOpen, CheckCircle2, XCircle, Undo2, ArrowRight } from "lucide-react";

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
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { LEDGER_BUCKETS, bucketLabel, fmtQty, type LedgerSettings } from "@/lib/gradeLedger";

type RegradeRow = {
  id: string;
  request_number: string;
  txn_date: string;
  bucket: string;
  from_grade_id: string;
  to_grade_id: string;
  quantity: number;
  reason: string;
  status: "Pending" | "Approved" | "Rejected" | "Cancelled";
  requested_by: string | null;
  requested_at: string;
  reviewed_at: string | null;
  review_remarks: string | null;
  from_grade: { code: string; name: string } | null;
  to_grade: { code: string; name: string } | null;
  requester: { full_name: string | null } | null;
  reviewer: { full_name: string | null } | null;
};

const STATUS_VARIANT: Record<string, "warning" | "success" | "destructive" | "secondary"> = {
  Pending: "warning",
  Approved: "success",
  Rejected: "destructive",
  Cancelled: "secondary",
};

const SELECT =
  "id, request_number, txn_date, bucket, from_grade_id, to_grade_id, quantity, reason, status," +
  "requested_by, requested_at, reviewed_at, review_remarks," +
  "from_grade:grades!grade_regrade_requests_from_grade_id_fkey(code, name)," +
  "to_grade:grades!grade_regrade_requests_to_grade_id_fkey(code, name)," +
  "requester:app_users!grade_regrade_requests_requested_by_fkey(full_name)," +
  "reviewer:app_users!grade_regrade_requests_reviewed_by_fkey(full_name)";

export default function RegradePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  // hasRole() is also true for super_admin.
  const canRequest = hasRole("manager") || hasRole("operational_manager");

  const [tab, setTab] = useState("pending");
  const [fromDate, setFromDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [statusFilter, setStatusFilter] = useState("all");
  const [review, setReview] = useState<{ row: RegradeRow; approve: boolean } | null>(null);
  const [reviewRemarks, setReviewRemarks] = useState("");

  const [form, setForm] = useState({
    txn_date: format(new Date(), "yyyy-MM-dd"),
    bucket: "JORR",
    from_grade_id: "",
    to_grade_id: "",
    quantity: "",
    reason: "",
  });

  const { data: settings } = useQuery({
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

  const { data: pending = [], isLoading: pendingLoading } = useQuery<RegradeRow[]>({
    queryKey: ["grade-regrades", "pending"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("grade_regrade_requests").select(SELECT)
        .eq("status", "Pending")
        .order("requested_at", { ascending: true });
      if (error) throw error;
      return (data || []) as RegradeRow[];
    },
  });

  const { data: history = [], isLoading: historyLoading } = useQuery<RegradeRow[]>({
    queryKey: ["grade-regrades", "range", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("grade_regrade_requests").select(SELECT)
        .gte("txn_date", fromDate)
        .lte("txn_date", toDate)
        .order("txn_date", { ascending: false })
        .order("requested_at", { ascending: false });
      if (error) throw error;
      return (data || []) as RegradeRow[];
    },
    enabled: tab !== "pending",
  });

  const { data: fromBalance } = useQuery({
    queryKey: ["grade-ledger-balance", form.bucket, form.from_grade_id, form.txn_date],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("grade_ledger_balance", {
        p_bucket: form.bucket, p_grade: form.from_grade_id, p_as_of: form.txn_date,
      });
      if (error) throw error;
      return Number(data || 0);
    },
    enabled: !!settings && !!form.from_grade_id && !!form.txn_date,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["grade-regrades"] });
    queryClient.invalidateQueries({ queryKey: ["grade-ledger-summary"] });
    queryClient.invalidateQueries({ queryKey: ["grade-ledger-movements"] });
    queryClient.invalidateQueries({ queryKey: ["grade-ledger-balance"] });
  };

  const submitRequest = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("grade_regrade_request", {
        p_date: form.txn_date,
        p_bucket: form.bucket,
        p_from_grade: form.from_grade_id,
        p_to_grade: form.to_grade_id,
        p_quantity: Number(form.quantity),
        p_reason: form.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Regrade requested", description: "It will count in the ledger once a super admin approves it." });
      setForm((f) => ({ ...f, quantity: "", reason: "" }));
      invalidate();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const reviewMutation = useMutation({
    mutationFn: async () => {
      if (!review) return null;
      const { data, error } = await (supabase as any).rpc("grade_regrade_review", {
        p_id: review.row.id, p_approve: review.approve, p_remarks: reviewRemarks || null,
      });
      if (error) throw error;
      return data as number | null;
    },
    onSuccess: (after) => {
      const approved = review?.approve;
      toast(approved && after !== null && Number(after) < 0
        ? { title: "Approved with a warning", description: `The old grade's stock is now ${fmtQty(Number(after))} (negative).`, variant: "destructive" }
        : { title: approved ? "Regrade approved" : "Regrade rejected" });
      setReview(null);
      setReviewRemarks("");
      invalidate();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("grade_regrade_cancel", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Request cancelled" }); invalidate(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filteredHistory = statusFilter === "all" ? history : history.filter((r) => r.status === statusFilter);

  // Approved regrades in the period, per stage and grade pair, plus the total
  // taken out of each grade — "how much have we regraded".
  const tracking = useMemo(() => {
    const approved = history.filter((r) => r.status === "Approved");
    const pairs = new Map<string, { bucket: string; from: string; to: string; qty: number; count: number }>();
    const byFrom = new Map<string, { bucket: string; grade: string; qty: number }>();
    approved.forEach((r) => {
      const from = r.from_grade?.code?.trim() ?? "?";
      const to = r.to_grade?.code?.trim() ?? "?";
      const pk = `${r.bucket}|${from}|${to}`;
      const p = pairs.get(pk) ?? { bucket: r.bucket, from, to, qty: 0, count: 0 };
      p.qty += Number(r.quantity); p.count += 1;
      pairs.set(pk, p);
      const fk = `${r.bucket}|${from}`;
      const f = byFrom.get(fk) ?? { bucket: r.bucket, grade: from, qty: 0 };
      f.qty += Number(r.quantity);
      byFrom.set(fk, f);
    });
    const order = (b: string) => LEDGER_BUCKETS.findIndex((x) => x.value === b);
    return {
      total: approved.reduce((s, r) => s + Number(r.quantity), 0),
      count: approved.length,
      pairs: [...pairs.values()].sort((a, b) => order(a.bucket) - order(b.bucket) || b.qty - a.qty),
      byFrom: [...byFrom.values()].sort((a, b) => order(a.bucket) - order(b.bucket) || b.qty - a.qty),
    };
  }, [history]);

  const renderRows = (rows: RegradeRow[], showActions: boolean) => (
    <div className="overflow-x-auto">
      <Table className="min-w-[1000px]">
        <TableHeader>
          <TableRow>
            <TableHead>No.</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Regrade</TableHead>
            <TableHead className="text-right">Bags</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Requested by</TableHead>
            <TableHead>Status</TableHead>
            {showActions && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-mono text-xs">{r.request_number}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground text-sm">{format(new Date(r.txn_date), "dd MMM yyyy")}</TableCell>
              <TableCell className="font-semibold">{bucketLabel(r.bucket)}</TableCell>
              <TableCell className="whitespace-nowrap font-display font-bold">
                {r.from_grade?.code} <ArrowRight className="inline h-3.5 w-3.5 mx-1 text-muted-foreground" /> {r.to_grade?.code}
              </TableCell>
              <TableCell className="text-right tabular-nums font-semibold">{fmtQty(r.quantity)}</TableCell>
              <TableCell className="text-sm max-w-[260px]">{r.reason}</TableCell>
              <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                {r.requester?.full_name ?? "—"} · {format(new Date(r.requested_at), "dd MMM HH:mm")}
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                {r.status !== "Pending" && (r.reviewer?.full_name || r.review_remarks) && (
                  <div className="text-xs text-muted-foreground mt-1 max-w-[220px]">
                    {r.reviewer?.full_name}{r.review_remarks ? ` — ${r.review_remarks}` : ""}
                  </div>
                )}
              </TableCell>
              {showActions && (
                <TableCell className="text-right whitespace-nowrap">
                  {isSuperAdmin && (
                    <>
                      <Button size="sm" variant="ghost" className="text-emerald-600" onClick={() => { setReviewRemarks(""); setReview({ row: r, approve: true }); }}>
                        <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { setReviewRemarks(""); setReview({ row: r, approve: false }); }}>
                        <XCircle className="h-4 w-4 mr-1" /> Reject
                      </Button>
                    </>
                  )}
                  {(r.requested_by === user?.id || isSuperAdmin) && (
                    <Button size="sm" variant="ghost" disabled={cancelMutation.isPending}
                      onClick={() => { if (window.confirm(`Cancel request ${r.request_number}?`)) cancelMutation.mutate(r.id); }}>
                      <Undo2 className="h-4 w-4 mr-1" /> Cancel
                    </Button>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  const dateRange = (
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
        {tab === "register" && (
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {Object.keys(STATUS_VARIANT).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title="Regrades"
          description="Grade changes of Coly, Jorr or Ball stock — requested by managers, approved by a super admin"
          icon={Shuffle}
          iconColor="bg-primary text-primary-foreground"
        >
          <Button variant="outline" asChild>
            <Link to="/production/grade-ledger"><BookOpen className="h-4 w-4 mr-2" /> Grade ledger</Link>
          </Button>
        </PageHeader>

        {!settings ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
            The grade ledger is not set up yet, so regrades cannot be requested.
          </CardContent></Card>
        ) : canRequest && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Request a regrade</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <Label className="text-xs">Date</Label>
                  <Input type="date" className="w-40" value={form.txn_date} min={settings.cutover_date}
                    onChange={(e) => setForm({ ...form, txn_date: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Stage</Label>
                  <Select value={form.bucket} onValueChange={(v) => setForm({ ...form, bucket: v })}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LEDGER_BUCKETS.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">From grade</Label>
                  <Select value={form.from_grade_id} onValueChange={(v) => setForm({ ...form, from_grade_id: v })}>
                    <SelectTrigger className="w-44"><SelectValue placeholder="Current grade" /></SelectTrigger>
                    <SelectContent>
                      {grades.map((g: any) => <SelectItem key={g.id} value={g.id}>{g.code} - {g.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">To grade</Label>
                  <Select value={form.to_grade_id} onValueChange={(v) => setForm({ ...form, to_grade_id: v })}>
                    <SelectTrigger className="w-44"><SelectValue placeholder="New grade" /></SelectTrigger>
                    <SelectContent>
                      {grades.filter((g: any) => g.id !== form.from_grade_id).map((g: any) => (
                        <SelectItem key={g.id} value={g.id}>{g.code} - {g.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Bags</Label>
                  <Input type="number" className="w-28" min={0} value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Reason *</Label>
                <Textarea rows={2} value={form.reason} placeholder="Why the grade is changing"
                  onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => submitRequest.mutate()}
                  disabled={!form.from_grade_id || !form.to_grade_id || form.from_grade_id === form.to_grade_id
                    || !(Number(form.quantity) > 0) || !form.reason.trim() || submitRequest.isPending}>
                  {submitRequest.isPending ? "Submitting..." : "Submit for approval"}
                </Button>
                {form.from_grade_id && fromBalance !== undefined && (
                  <span className={`text-sm ${fromBalance - Number(form.quantity || 0) < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {bucketLabel(form.bucket)} stock of the current grade on {form.txn_date}: <b>{fmtQty(fromBalance)}</b> bags
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="pending">Pending{pending.length ? ` (${pending.length})` : ""}</TabsTrigger>
            <TabsTrigger value="tracking">Regrade tracking</TabsTrigger>
            <TabsTrigger value="register">All requests</TabsTrigger>
          </TabsList>

          <TabsContent value="pending">
            <Card>
              <CardContent className="p-0">
                {pendingLoading ? (
                  <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading</div>
                ) : !pending.length ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">No requests waiting for approval.</div>
                ) : renderRows(pending, true)}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tracking" className="space-y-4">
            {dateRange}
            {historyLoading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading</div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Card><CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">Bags regraded (approved)</div>
                    <div className="text-2xl font-bold tabular-nums">{fmtQty(tracking.total)}</div>
                  </CardContent></Card>
                  <Card><CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">Approved requests</div>
                    <div className="text-2xl font-bold tabular-nums">{tracking.count}</div>
                  </CardContent></Card>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-base">By grade change</CardTitle></CardHeader>
                    <CardContent className="p-0">
                      {!tracking.pairs.length ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">No approved regrades in this period.</div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Stage</TableHead>
                              <TableHead>From → To</TableHead>
                              <TableHead className="text-right">Requests</TableHead>
                              <TableHead className="text-right">Bags</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {tracking.pairs.map((p) => (
                              <TableRow key={`${p.bucket}|${p.from}|${p.to}`}>
                                <TableCell className="font-semibold">{bucketLabel(p.bucket)}</TableCell>
                                <TableCell className="font-display font-bold whitespace-nowrap">
                                  {p.from} <ArrowRight className="inline h-3.5 w-3.5 mx-1 text-muted-foreground" /> {p.to}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">{p.count}</TableCell>
                                <TableCell className="text-right tabular-nums font-semibold">{fmtQty(p.qty)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-base">Taken out of each grade</CardTitle></CardHeader>
                    <CardContent className="p-0">
                      {!tracking.byFrom.length ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">No approved regrades in this period.</div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Stage</TableHead>
                              <TableHead>Grade</TableHead>
                              <TableHead className="text-right">Bags regraded</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {tracking.byFrom.map((f) => (
                              <TableRow key={`${f.bucket}|${f.grade}`}>
                                <TableCell className="font-semibold">{bucketLabel(f.bucket)}</TableCell>
                                <TableCell className="font-display font-bold">{f.grade}</TableCell>
                                <TableCell className="text-right tabular-nums font-semibold">{fmtQty(f.qty)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="register" className="space-y-4">
            {dateRange}
            <Card>
              <CardContent className="p-0">
                {historyLoading ? (
                  <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading</div>
                ) : !filteredHistory.length ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">No requests in this period.</div>
                ) : renderRows(filteredHistory, false)}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={!!review} onOpenChange={(open) => { if (!open) setReview(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{review?.approve ? "Approve" : "Reject"} {review?.row.request_number}</DialogTitle>
            </DialogHeader>
            {review && (
              <div className="space-y-3 text-sm">
                <p>
                  {fmtQty(review.row.quantity)} bags of {bucketLabel(review.row.bucket)}{" "}
                  <b>{review.row.from_grade?.code}</b> → <b>{review.row.to_grade?.code}</b> on{" "}
                  {format(new Date(review.row.txn_date), "dd MMM yyyy")}.
                </p>
                <p className="text-muted-foreground">Reason: {review.row.reason}</p>
                <div>
                  <Label className="text-xs">Remarks{review.approve ? "" : " *"}</Label>
                  <Textarea rows={2} value={reviewRemarks} onChange={(e) => setReviewRemarks(e.target.value)} />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setReview(null)}>Close</Button>
              <Button
                variant={review?.approve ? "default" : "destructive"}
                disabled={reviewMutation.isPending || (!!review && !review.approve && !reviewRemarks.trim())}
                onClick={() => reviewMutation.mutate()}
              >
                {reviewMutation.isPending ? "Saving..." : review?.approve ? "Approve" : "Reject"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
