import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Download, Copy, Trash2, CheckCircle, Lock, Undo2, BarChart3 } from "lucide-react";
import * as XLSX from "xlsx";
import {
  BudgetHeader,
  BudgetPeriod,
  budgetMonths,
  monthLabel,
  periodKey,
} from "@/lib/accounting/budgetActuals";

const sb = supabase as any;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface CoAAccount {
  id: string;
  code: string;
  name: string;
  account_type: "revenue" | "expense";
  sub_category: string | null;
}

// cells[accountId][periodKey] = raw input string
type CellMap = Record<string, Record<string, string>>;

const fyLabelFor = (startYear: number, startMonth: number, numMonths: number) => {
  const endIdx = startMonth - 1 + numMonths - 1;
  const endYear = startYear + Math.floor(endIdx / 12);
  return endYear === startYear ? `${startYear}` : `${startYear}-${String(endYear).slice(2)}`;
};

const statusBadge = (status: string) => {
  if (status === "active") return <Badge className="bg-green-500/10 text-green-600 border-green-500/20">Active</Badge>;
  if (status === "closed") return <Badge variant="secondary">Closed</Badge>;
  return <Badge variant="outline">Draft</Badge>;
};

export default function AccountingBudgetsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [selectedBudgetId, setSelectedBudgetId] = useState<string>("");
  const [cells, setCells] = useState<CellMap>({});
  const [dirty, setDirty] = useState(false);
  const [addAccountId, setAddAccountId] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [copySourceId, setCopySourceId] = useState("");

  // Default new budgets to the Pakistani July–June fiscal year.
  const now = new Date();
  const defaultStartYear = now.getMonth() + 1 >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  const [createForm, setCreateForm] = useState({
    name: "",
    start_year: defaultStartYear,
    start_month: 7,
    num_months: 12,
  });

  const { data: budgets = [], isLoading } = useQuery({
    queryKey: ["acc-budgets"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_budgets")
        .select("*")
        .order("start_year", { ascending: false })
        .order("start_month", { ascending: false });
      if (error) throw error;
      return (data || []) as BudgetHeader[];
    },
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["acc-budget-accounts"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_chart_of_accounts")
        .select("id, code, name, account_type, sub_category")
        .eq("is_active", true)
        .not("sub_category", "is", null)
        .in("account_type", ["revenue", "expense"])
        .order("code");
      if (error) throw error;
      return (data || []) as CoAAccount[];
    },
  });

  const budget = budgets.find((b) => b.id === selectedBudgetId) || null;
  const months = useMemo<BudgetPeriod[]>(() => (budget ? budgetMonths(budget) : []), [budget]);
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const { data: lines = [] } = useQuery({
    queryKey: ["acc-budget-lines", selectedBudgetId],
    enabled: !!selectedBudgetId,
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_budget_lines")
        .select("account_id, period_year, period_month, amount")
        .eq("budget_id", selectedBudgetId);
      if (error) throw error;
      return data || [];
    },
  });

  // Load fetched lines into the editable grid whenever the budget changes.
  useEffect(() => {
    const next: CellMap = {};
    lines.forEach((l: any) => {
      const key = periodKey({ year: l.period_year, month: l.period_month });
      if (!next[l.account_id]) next[l.account_id] = {};
      next[l.account_id][key] = Number(l.amount) ? String(Number(l.amount)) : "";
    });
    setCells(next);
    setDirty(false);
  }, [lines, selectedBudgetId]);

  useEffect(() => {
    if (!selectedBudgetId && budgets.length) {
      setSelectedBudgetId((budgets.find((b) => b.status === "active") || budgets[0]).id);
    }
  }, [budgets, selectedBudgetId]);

  const editable = budget?.status !== "closed";

  const rows = useMemo(() => {
    return Object.keys(cells)
      .map((id) => accountById.get(id))
      .filter((a): a is CoAAccount => !!a)
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [cells, accountById]);

  const revenueRows = rows.filter((r) => r.account_type === "revenue");
  const expenseRows = rows.filter((r) => r.account_type === "expense");

  const cellValue = (accountId: string, p: BudgetPeriod) => cells[accountId]?.[periodKey(p)] ?? "";
  const cellNumber = (accountId: string, p: BudgetPeriod) => {
    const v = parseFloat(cellValue(accountId, p));
    return isNaN(v) ? 0 : v;
  };
  const rowTotal = (accountId: string) => months.reduce((s, p) => s + cellNumber(accountId, p), 0);
  const colTotal = (list: CoAAccount[], p: BudgetPeriod) => list.reduce((s, r) => s + cellNumber(r.id, p), 0);
  const listTotal = (list: CoAAccount[]) => list.reduce((s, r) => s + rowTotal(r.id), 0);

  const setCell = (accountId: string, p: BudgetPeriod, value: string) => {
    setCells((prev) => ({
      ...prev,
      [accountId]: { ...(prev[accountId] || {}), [periodKey(p)]: value },
    }));
    setDirty(true);
  };

  // Typing an annual figure spreads it evenly across the budget's months.
  const spreadAnnual = (accountId: string, raw: string) => {
    const total = parseFloat(raw);
    if (isNaN(total) || !months.length) return;
    const per = Math.round((total / months.length) * 100) / 100;
    setCells((prev) => {
      const row: Record<string, string> = {};
      months.forEach((p, i) => {
        // Put the rounding remainder in the last month so the total is exact.
        const amt = i === months.length - 1 ? Math.round((total - per * (months.length - 1)) * 100) / 100 : per;
        row[periodKey(p)] = amt ? String(amt) : "";
      });
      return { ...prev, [accountId]: row };
    });
    setDirty(true);
  };

  const addAccountRow = (accountId: string) => {
    if (!accountId || cells[accountId]) return;
    setCells((prev) => ({ ...prev, [accountId]: {} }));
    setAddAccountId("");
  };

  const removeAccountRow = (accountId: string) => {
    setCells((prev) => {
      const next = { ...prev };
      delete next[accountId];
      return next;
    });
    setDirty(true);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const label = fyLabelFor(createForm.start_year, createForm.start_month, createForm.num_months);
      const { data, error } = await sb
        .from("accounting_budgets")
        .insert({
          name: createForm.name.trim() || `FY ${label} Operating Budget`,
          fiscal_year_label: label,
          start_year: createForm.start_year,
          start_month: createForm.start_month,
          num_months: createForm.num_months,
          status: "draft",
          created_by: user?.id,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      toast.success("Budget created");
      setIsCreateOpen(false);
      setCreateForm({ name: "", start_year: defaultStartYear, start_month: 7, num_months: 12 });
      queryClient.invalidateQueries({ queryKey: ["acc-budgets"] });
      setSelectedBudgetId(id);
    },
    onError: (e: any) => toast.error("Failed to create budget: " + e.message),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!budget) return;
      const upserts: any[] = [];
      Object.entries(cells).forEach(([accountId, row]) => {
        months.forEach((p) => {
          const v = parseFloat(row[periodKey(p)] || "");
          upserts.push({
            budget_id: budget.id,
            account_id: accountId,
            period_year: p.year,
            period_month: p.month,
            amount: isNaN(v) ? 0 : v,
          });
        });
      });
      // Remove lines for accounts taken out of the grid, then upsert the rest.
      const keptIds = Object.keys(cells);
      let del = sb.from("accounting_budget_lines").delete().eq("budget_id", budget.id);
      if (keptIds.length) del = del.not("account_id", "in", `(${keptIds.join(",")})`);
      const { error: delError } = await del;
      if (delError) throw delError;
      if (upserts.length) {
        const { error } = await sb
          .from("accounting_budget_lines")
          .upsert(upserts, { onConflict: "budget_id,account_id,period_year,period_month" });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Budget saved");
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["acc-budget-lines", selectedBudgetId] });
    },
    onError: (e: any) => toast.error("Failed to save budget: " + e.message),
  });

  const statusMutation = useMutation({
    mutationFn: async (status: "draft" | "active" | "closed") => {
      if (!budget) return;
      const patch: any = { status };
      if (status === "active") {
        patch.approved_by = user?.id;
        patch.approved_at = new Date().toISOString();
      }
      const { error } = await sb.from("accounting_budgets").update(patch).eq("id", budget.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Budget status updated");
      queryClient.invalidateQueries({ queryKey: ["acc-budgets"] });
    },
    onError: (e: any) => toast.error("Failed to update status: " + e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("accounting_budgets").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Budget deleted");
      setSelectedBudgetId("");
      queryClient.invalidateQueries({ queryKey: ["acc-budgets"] });
    },
    onError: (e: any) => toast.error("Failed to delete budget: " + e.message),
  });

  const copyMutation = useMutation({
    mutationFn: async (sourceId: string) => {
      if (!budget) return;
      const { data, error } = await sb
        .from("accounting_budget_lines")
        .select("account_id, period_year, period_month, amount")
        .eq("budget_id", sourceId);
      if (error) throw error;
      const source = budgets.find((b) => b.id === sourceId);
      if (!source) return;
      const sourceMonths = budgetMonths(source);
      const idxByKey = new Map(sourceMonths.map((p, i) => [periodKey(p), i]));
      const next: CellMap = {};
      (data || []).forEach((l: any) => {
        const i = idxByKey.get(periodKey({ year: l.period_year, month: l.period_month }));
        if (i === undefined || i >= months.length) return;
        if (!next[l.account_id]) next[l.account_id] = {};
        next[l.account_id][periodKey(months[i])] = Number(l.amount) ? String(Number(l.amount)) : "";
      });
      setCells(next);
      setDirty(true);
    },
    onSuccess: () => toast.success("Copied amounts month-by-month — review and save"),
    onError: (e: any) => toast.error("Failed to copy: " + e.message),
  });

  const handleExport = () => {
    if (!budget) return;
    const data = rows.map((r) => {
      const row: Record<string, any> = { Code: r.code, Account: r.name, Type: r.account_type };
      months.forEach((p) => (row[monthLabel(p)] = cellNumber(r.id, p)));
      row["Annual Total"] = rowTotal(r.id);
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Budget");
    XLSX.writeFile(wb, `Budget_${budget.fiscal_year_label}.xlsx`);
  };

  const availableAccounts = accounts.filter((a) => !cells[a.id]);

  const renderRows = (list: CoAAccount[], groupTitle: string) => {
    if (!list.length) return null;
    return (
      <>
        <TableRow className="bg-muted/60">
          <TableCell colSpan={months.length + 3} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground py-2">
            {groupTitle}
          </TableCell>
        </TableRow>
        {list.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="sticky left-0 bg-background z-10 min-w-[220px]">
              <span className="font-mono text-xs text-muted-foreground mr-2">{r.code}</span>
              <span className="text-sm">{r.name}</span>
            </TableCell>
            {months.map((p) => (
              <TableCell key={periodKey(p)} className="p-1">
                <Input
                  type="number"
                  step="0.01"
                  disabled={!editable}
                  className="h-8 w-[110px] text-right text-xs"
                  value={cellValue(r.id, p)}
                  onChange={(e) => setCell(r.id, p, e.target.value)}
                />
              </TableCell>
            ))}
            <TableCell className="text-right text-xs font-semibold bg-muted/40">
              {editable ? (
                <Input
                  type="number"
                  step="0.01"
                  placeholder={rowTotal(r.id).toLocaleString()}
                  title="Type an annual amount and press Enter to spread it evenly across all months"
                  className="h-8 w-[120px] text-right text-xs font-semibold"
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  onBlur={(e) => {
                    if (e.target.value !== "") {
                      spreadAnnual(r.id, e.target.value);
                      e.target.value = "";
                    }
                  }}
                />
              ) : (
                <>Rs. {rowTotal(r.id).toLocaleString()}</>
              )}
            </TableCell>
            <TableCell className="p-1">
              {editable && (
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeAccountRow(r.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
        <TableRow className="bg-muted/30 font-semibold">
          <TableCell className="sticky left-0 bg-muted/30 z-10 text-xs">Total {groupTitle}</TableCell>
          {months.map((p) => (
            <TableCell key={periodKey(p)} className="text-right text-xs">
              {colTotal(list, p).toLocaleString()}
            </TableCell>
          ))}
          <TableCell className="text-right text-xs">Rs. {listTotal(list).toLocaleString()}</TableCell>
          <TableCell />
        </TableRow>
      </>
    );
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <PageHeader title="Budgets" description="Monthly budgets per account head, tracked against the ledger" />
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/accounting/budget-vs-actual"><BarChart3 className="h-4 w-4 mr-1" />Budget vs Actual</Link>
            </Button>
            <Button size="sm" onClick={() => setIsCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />New Budget
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">All Budgets</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Budget</TableHead>
                  <TableHead>Fiscal Year</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>}
                {!isLoading && !budgets.length && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No budgets yet — create your first one</TableCell></TableRow>
                )}
                {budgets.map((b) => {
                  const bm = budgetMonths(b);
                  return (
                    <TableRow key={b.id} className={b.id === selectedBudgetId ? "bg-primary/5" : ""}>
                      <TableCell className="font-medium">{b.name}</TableCell>
                      <TableCell>{b.fiscal_year_label}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {monthLabel(bm[0])} – {monthLabel(bm[bm.length - 1])}
                      </TableCell>
                      <TableCell>{statusBadge(b.status)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant={b.id === selectedBudgetId ? "default" : "outline"} className="h-7" onClick={() => setSelectedBudgetId(b.id)}>
                            Open
                          </Button>
                          {b.status === "draft" && (
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                              onClick={() => { if (window.confirm(`Delete budget "${b.name}" and all its lines?`)) deleteMutation.mutate(b.id); }}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {budget && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <CardTitle className="text-base flex items-center gap-2">
                  Editor — {budget.name} {statusBadge(budget.status)}
                  {dirty && <Badge variant="outline" className="text-amber-600 border-amber-300">Unsaved changes</Badge>}
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  {editable && (
                    <>
                      <Select value={addAccountId} onValueChange={addAccountRow}>
                        <SelectTrigger className="w-[220px] h-8 text-xs">
                          <SelectValue placeholder="+ Add account row" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableAccounts.map((a) => (
                            <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={copySourceId} onValueChange={(v) => { setCopySourceId(""); copyMutation.mutate(v); }}>
                        <SelectTrigger className="w-[190px] h-8 text-xs">
                          <span className="flex items-center gap-1"><Copy className="h-3 w-3" />Copy from budget…</span>
                        </SelectTrigger>
                        <SelectContent>
                          {budgets.filter((b) => b.id !== budget.id).map((b) => (
                            <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  )}
                  <Button size="sm" variant="outline" className="h-8" onClick={handleExport}>
                    <Download className="h-4 w-4 mr-1" />XLSX
                  </Button>
                  {budget.status === "draft" && (
                    <Button size="sm" className="h-8 bg-green-600 hover:bg-green-700" onClick={() => statusMutation.mutate("active")}>
                      <CheckCircle className="h-4 w-4 mr-1" />Activate
                    </Button>
                  )}
                  {budget.status === "active" && (
                    <Button size="sm" variant="outline" className="h-8" onClick={() => statusMutation.mutate("closed")}>
                      <Lock className="h-4 w-4 mr-1" />Close
                    </Button>
                  )}
                  {budget.status === "closed" && (
                    <Button size="sm" variant="outline" className="h-8" onClick={() => statusMutation.mutate("draft")}>
                      <Undo2 className="h-4 w-4 mr-1" />Reopen
                    </Button>
                  )}
                  {editable && (
                    <Button size="sm" className="h-8" disabled={!dirty || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                      {saveMutation.isPending ? "Saving…" : "Save"}
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Amounts in PKR. Type in the <b>Annual</b> column to spread a yearly amount evenly across all months.
                {budget.approved_at && <> · Activated {new Date(budget.approved_at).toLocaleDateString()}</>}
              </p>
            </CardHeader>
            <CardContent>
              {!rows.length ? (
                <div className="text-center text-muted-foreground py-10 text-sm">
                  No account rows yet — use “Add account row” or “Copy from budget” to get started.
                </div>
              ) : (
                <div className="overflow-x-auto border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky left-0 bg-background z-10 min-w-[220px]">Account</TableHead>
                        {months.map((p) => (
                          <TableHead key={periodKey(p)} className="text-right">{monthLabel(p)}</TableHead>
                        ))}
                        <TableHead className="text-right">Annual</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {renderRows(revenueRows, "Revenue")}
                      {renderRows(expenseRows, "Expenses")}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Budget</DialogTitle>
              <DialogDescription>Defaults to the July–June fiscal year — adjust if you budget on a different cycle.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  placeholder={`FY ${fyLabelFor(createForm.start_year, createForm.start_month, createForm.num_months)} Operating Budget`}
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>Start Month</Label>
                  <Select value={String(createForm.start_month)} onValueChange={(v) => setCreateForm({ ...createForm, start_month: parseInt(v) })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MONTH_NAMES.map((m, i) => (
                        <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Start Year</Label>
                  <Input
                    type="number"
                    value={createForm.start_year}
                    onChange={(e) => setCreateForm({ ...createForm, start_year: parseInt(e.target.value) || defaultStartYear })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Months</Label>
                  <Input
                    type="number"
                    min={1}
                    max={24}
                    value={createForm.num_months}
                    onChange={(e) => setCreateForm({ ...createForm, num_months: Math.min(24, Math.max(1, parseInt(e.target.value) || 12)) })}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
              <Button disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>Create Budget</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
