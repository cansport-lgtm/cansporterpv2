import { type ReactNode, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, startOfMonth } from "date-fns";
import { ArrowDownWideNarrow, ArrowRight, Clock, Coins, Info, Plus, XCircle } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import {
  DowngradeDetailDialog,
  DowngradeStatusBadge,
  GradeChange,
} from "@/components/rejections/DowngradeDetailDialog";
import {
  type Downgrade,
  type GradeRateRow,
  DOWNGRADES_KEY,
  cancelDowngrade,
  dgDb,
  fmtDate,
  rateForGrade,
  rs,
  submitDowngrade,
} from "@/lib/rwDowngrades";

const OTHER_ITEM = "__other__";

const emptyForm = (name: string) => ({
  requesterName: name,
  departmentId: "",
  itemGradeId: "",
  itemText: "",
  quantity: "",
  unit: "pcs",
  originalGradeId: "",
  proposedGradeId: "",
  issue: "",
  why: "",
  reason: "",
  originalRate: "",
  downgradedRate: "",
});

/** Downgrade forms: raise a form, see every form and its approval status, print it. */
export default function RWDowngradesPage() {
  const qc = useQueryClient();
  const { user, hasModulePermission } = useAuth();
  const canRequest = hasModulePermission("rejections_wastages", "create");

  const [fromDate, setFromDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [statusFilter, setStatusFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [viewing, setViewing] = useState<Downgrade | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => emptyForm(user?.full_name ?? ""));
  const [formError, setFormError] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: [DOWNGRADES_KEY, fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await dgDb
        .from("rw_downgrades")
        .select("*")
        .gte("request_date", fromDate)
        .lte("request_date", toDate)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as Downgrade[];
    },
  });

  const { data: depts = [] } = useQuery({
    queryKey: ["dg-depts"],
    queryFn: async () => {
      const { data } = await supabase.from("production_departments").select("id, name").eq("is_active", true).order("name");
      return (data || []) as { id: string; name: string }[];
    },
  });

  const { data: grades = [] } = useQuery({
    queryKey: ["dg-grades"],
    queryFn: async () => {
      const { data } = await supabase.from("grades").select("id, code, name").eq("is_active", true).order("name");
      return (data || []) as { id: string; code: string; name: string }[];
    },
  });

  const { data: rates = [] } = useQuery({
    queryKey: ["dg-cheap-ball-rates"],
    queryFn: async () => {
      const { data } = await dgDb.from("rw_defect_rates").select("grade_id, standard_cost, is_active, updated_at");
      return (data || []) as GradeRateRow[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (statusFilter === "all" || r.status === statusFilter) &&
        (deptFilter === "all" || r.department_id === deptFilter) &&
        (!q ||
          [r.downgrade_no, r.item_name, r.requester_name, r.original_grade_name, r.proposed_grade_name]
            .some((v) => (v || "").toLowerCase().includes(q))),
    );
  }, [rows, statusFilter, deptFilter, search]);

  const pending = rows.filter((r) => r.status === "pending");
  const approved = rows.filter((r) => r.status === "approved");
  const rejected = rows.filter((r) => r.status === "rejected");
  const approvedLoss = approved.reduce((s, r) => s + Number(r.cost_loss || 0), 0);

  const set = <K extends keyof ReturnType<typeof emptyForm>>(k: K, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const pickGrade = (k: "originalGradeId" | "proposedGradeId", gradeId: string) => {
    const rate = rateForGrade(rates, gradeId);
    setForm((f) => ({
      ...f,
      [k]: gradeId,
      ...(k === "originalGradeId"
        ? { originalRate: rate !== undefined ? String(rate) : "" }
        : { downgradedRate: rate !== undefined ? String(rate) : "" }),
    }));
  };

  const r1 = parseFloat(form.originalRate) || 0;
  const r2 = parseFloat(form.downgradedRate) || 0;
  const qty = parseFloat(form.quantity) || 0;
  const loss = Math.max(r1 - r2, 0) * qty;

  const submit = useMutation({
    mutationFn: async () => {
      const isOther = form.itemGradeId === OTHER_ITEM;
      const missing: string[] = [];
      if (!form.requesterName.trim()) missing.push("Name");
      if (!form.departmentId) missing.push("Department");
      if (!form.itemGradeId || (isOther && !form.itemText.trim())) missing.push("Item Name");
      if (!(qty > 0)) missing.push("Quantity");
      if (!form.originalGradeId) missing.push("Original Grade");
      if (!form.proposedGradeId) missing.push("Proposed Downgrade");
      if (!form.issue.trim()) missing.push("Issue");
      if (!form.why.trim()) missing.push("Why original grade cannot be used");
      if (!form.reason.trim()) missing.push("Reason for converting");
      if (missing.length) throw new Error(`Fill in: ${missing.join(", ")}.`);
      if (form.originalGradeId === form.proposedGradeId)
        throw new Error("The proposed downgrade must be different from the original grade.");
      if (r2 > r1) throw new Error("The downgraded rate cannot be higher than the original grade rate.");

      return submitDowngrade({
        requesterName: form.requesterName.trim(),
        departmentId: form.departmentId,
        itemGradeId: isOther ? null : form.itemGradeId,
        itemName: isOther ? form.itemText.trim() : grades.find((g) => g.id === form.itemGradeId)?.name ?? "",
        quantity: qty,
        unit: form.unit,
        originalGradeId: form.originalGradeId,
        proposedGradeId: form.proposedGradeId,
        issue: form.issue.trim(),
        whyOriginalUnusable: form.why.trim(),
        reasonForConverting: form.reason.trim(),
        originalRate: r1,
        downgradedRate: r2,
      });
    },
    onSuccess: (no) => {
      toast.success(`${no} submitted. Waiting for Super Admin approval.`);
      qc.invalidateQueries({ queryKey: [DOWNGRADES_KEY] });
      setOpen(false);
      setForm(emptyForm(user?.full_name ?? ""));
      setFormError("");
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => cancelDowngrade(id),
    onSuccess: () => {
      toast.success("Form cancelled");
      qc.invalidateQueries({ queryKey: [DOWNGRADES_KEY] });
      setViewing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openNew = () => {
    setForm(emptyForm(user?.full_name ?? ""));
    setFormError("");
    setOpen(true);
  };

  return (
    <ERPLayout>
      <div className="w-full max-w-full space-y-4 overflow-x-hidden">
        <PageHeader
          title="Downgrade Requests"
          description="Downgrade forms with their reason, cost difference and approval status"
          icon={ArrowDownWideNarrow}
          iconColor="bg-amber-500 text-white"
        >
          {canRequest && (
            <Button onClick={openNew}>
              <Plus className="mr-2 h-4 w-4" /> New Downgrade Form
            </Button>
          )}
        </PageHeader>

        <div className="flex items-start gap-2 rounded-lg bg-sky-500/[0.06] px-3 py-2 text-[12.5px] text-sky-900 ring-1 ring-inset ring-sky-500/20 dark:text-sky-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
          <span>
            For logs and tracking only. A downgrade does not move stock, post to the Ball Ledger or change production
            quantities. Only a Super Admin can approve it; once approved, its loss is reported in R&amp;W Analytics. A
            rejected form is closed — raise a new one if the downgrade is still needed.
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard title="Pending Approval" value={pending.length} icon={Clock} />
          <MetricCard title="Approved" value={approved.length} icon={ArrowDownWideNarrow}
            description={`${approved.reduce((s, r) => s + Number(r.quantity || 0), 0).toLocaleString()} units downgraded`} />
          <MetricCard title="Downgrade Loss" value={rs(approvedLoss)} icon={Coins} description="Approved forms only" />
          <MetricCard title="Rejected" value={rejected.length} icon={XCircle} />
        </div>

        <Card>
          <CardContent className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 md:grid-cols-5 md:p-4">
            <div className="md:col-span-1">
              <Label className="text-xs">Search</Label>
              <Input placeholder="DG no., item, name" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Department</Label>
              <Select value={deptFilter} onValueChange={setDeptFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {depts.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Loading</div>
            ) : !filtered.length ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No downgrade forms in this period.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[960px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>DG No.</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead>Grade change</TableHead>
                      <TableHead className="text-right">Loss</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-display font-semibold">{r.downgrade_no}</TableCell>
                        <TableCell>{fmtDate(r.request_date)}</TableCell>
                        <TableCell>{r.requester_name}</TableCell>
                        <TableCell>{r.department_name || "—"}</TableCell>
                        <TableCell>{r.item_name}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {Number(r.quantity).toLocaleString()} {r.unit}
                        </TableCell>
                        <TableCell><GradeChange from={r.original_grade_name} to={r.proposed_grade_name} /></TableCell>
                        <TableCell className="text-right tabular-nums">{rs(r.cost_loss)}</TableCell>
                        <TableCell><DowngradeStatusBadge status={r.status} /></TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => setViewing(r)}>View / Print</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <DowngradeDetailDialog
          downgrade={viewing}
          onOpenChange={(o) => !o && setViewing(null)}
          actions={
            viewing?.status === "pending" && viewing.requested_by === user?.id ? (
              <Button variant="outline" className="text-destructive" disabled={cancel.isPending}
                onClick={() => cancel.mutate(viewing.id)}>
                Cancel form
              </Button>
            ) : null
          }
        />

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>New Downgrade Form</DialogTitle>
              <p className="text-sm text-muted-foreground">The DG number is assigned when you submit.</p>
            </DialogHeader>

            <form
              className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]"
              onSubmit={(e) => { e.preventDefault(); setFormError(""); submit.mutate(); }}
            >
              <div className="min-w-0 space-y-4">
                <FormSection n={1} title="Basic details">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="dg-name">Name *</Label>
                      <Input id="dg-name" value={form.requesterName} onChange={(e) => set("requesterName", e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label>Department *</Label>
                      <Select value={form.departmentId} onValueChange={(v) => set("departmentId", v)}>
                        <SelectTrigger><SelectValue placeholder="Pick department" /></SelectTrigger>
                        <SelectContent>
                          {depts.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Item Name *</Label>
                      <Select value={form.itemGradeId} onValueChange={(v) => set("itemGradeId", v)}>
                        <SelectTrigger><SelectValue placeholder="Pick from grades" /></SelectTrigger>
                        <SelectContent>
                          {grades.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                          <SelectItem value={OTHER_ITEM}>Other (type the item)</SelectItem>
                        </SelectContent>
                      </Select>
                      {form.itemGradeId === OTHER_ITEM && (
                        <Input placeholder="Type the item name" value={form.itemText}
                          onChange={(e) => set("itemText", e.target.value)} />
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="dg-qty">Quantity *</Label>
                      <div className="flex gap-2">
                        <Input id="dg-qty" type="number" min="0" step="any" value={form.quantity}
                          onChange={(e) => set("quantity", e.target.value)} />
                        <Select value={form.unit} onValueChange={(v) => set("unit", v)}>
                          <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {["pcs", "doz", "kg"].map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 items-end gap-3 sm:col-span-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                      <div className="space-y-1">
                        <Label>Original Grade *</Label>
                        <Select value={form.originalGradeId} onValueChange={(v) => pickGrade("originalGradeId", v)}>
                          <SelectTrigger><SelectValue placeholder="From Grade Master" /></SelectTrigger>
                          <SelectContent>
                            {grades.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <ArrowRight className="mb-2.5 hidden h-4 w-4 text-muted-foreground sm:block" />
                      <div className="space-y-1">
                        <Label>Proposed Downgrade *</Label>
                        <Select value={form.proposedGradeId} onValueChange={(v) => pickGrade("proposedGradeId", v)}>
                          <SelectTrigger><SelectValue placeholder="From Grade Master" /></SelectTrigger>
                          <SelectContent>
                            {grades.filter((g) => g.id !== form.originalGradeId).map((g) => (
                              <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </FormSection>

                <FormSection n={2} title="Reason for downgrading">
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label htmlFor="dg-issue">Issue *</Label>
                      <Textarea id="dg-issue" rows={2} placeholder="What is wrong with the item?"
                        value={form.issue} onChange={(e) => set("issue", e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="dg-why">Why original grade cannot be used *</Label>
                      <Textarea id="dg-why" rows={2} value={form.why} onChange={(e) => set("why", e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="dg-reason">Reason for converting *</Label>
                      <Textarea id="dg-reason" rows={2} value={form.reason} onChange={(e) => set("reason", e.target.value)} />
                    </div>
                  </div>
                </FormSection>

                <FormSection n={3} title="Approval">
                  <p className="text-sm text-muted-foreground">
                    Goes to the Super Admin for approval when you submit.
                  </p>
                </FormSection>
              </div>

              <aside className="h-fit space-y-3 rounded-lg border p-3 lg:sticky lg:top-0">
                <h3 className="text-sm font-semibold">Downgrade costing</h3>
                <div className="space-y-1">
                  <Label htmlFor="dg-r1" className="text-xs">Original grade rate (Rs. / {form.unit})</Label>
                  <Input id="dg-r1" type="number" min="0" step="any" value={form.originalRate}
                    onChange={(e) => set("originalRate", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="dg-r2" className="text-xs">Downgraded rate (Rs. / {form.unit})</Label>
                  <Input id="dg-r2" type="number" min="0" step="any" value={form.downgradedRate}
                    onChange={(e) => set("downgradedRate", e.target.value)} />
                </div>
                <div className="space-y-1 text-sm tabular-nums">
                  <div className="flex justify-between"><span className="text-muted-foreground">Difference</span><span>{rs(r1 - r2)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Quantity</span><span>{qty.toLocaleString()} {form.unit}</span></div>
                  <div className="flex items-baseline justify-between border-t pt-2">
                    <span className="text-muted-foreground">Downgrade loss</span>
                    <span className="font-display text-lg font-semibold text-destructive">{rs(loss)}</span>
                  </div>
                </div>
                <p className="rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
                  (Original rate − Downgraded rate) × Quantity. Rates fill in from Cheap Ball Rates when a grade has one;
                  you can edit them. No stock impact; counted in R&amp;W Analytics once approved.
                </p>
              </aside>

              <div className="space-y-2 lg:col-span-2">
                {formError && <p className="text-sm text-destructive">{formError}</p>}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={submit.isPending}>
                    {submit.isPending ? "Submitting…" : "Submit for approval"}
                  </Button>
                </div>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}

function FormSection({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
          {n}
        </span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}
