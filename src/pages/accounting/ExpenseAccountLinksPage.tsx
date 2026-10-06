import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format, startOfYear } from "date-fns";
import { AlertTriangle, CheckCircle2, Link2, Save, Sparkles, Trash2 } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  LINK_EDIT_ROLES, TRIP_FUEL_KEY, elDb, invalidateExpenseLinkQueries, suggestExpenseAccount, useExpenseLinks, useLinkAccounts,
  usePettyCashCategories, useReconciliation, type LinkSourceType,
} from "@/lib/expenseLinks";
import { fmtRs } from "@/lib/tripFuel";

type Draft = { expenseId: string; fundingId: string; tolerance: string; compareFrom: string; suggested?: boolean };
type SourceRow = { ref: string; type: LinkSourceType; key: string; label: string; group: string };

const errorMessage = (e: unknown) => (e as { message?: string })?.message ?? "Something went wrong.";

/**
 * Accounting master: which expense account each operational expense source is
 * posted to, which cash account funds it, a tolerance and a start date. The
 * Expense Reconciliation and the Staff Trip Fuel Analysis compare against it.
 */
export default function ExpenseAccountLinksPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { roles } = useAuth();
  const canEdit = roles.some((r) => LINK_EDIT_ROLES.includes(r.role));

  const { data: links = [], isLoading } = useExpenseLinks();
  const { data: accounts } = useLinkAccounts();
  const { data: categories = [] } = usePettyCashCategories();
  const yearStart = format(startOfYear(new Date()), "yyyy-MM-dd");
  const today = format(new Date(), "yyyy-MM-dd");
  const { data: recon = [] } = useReconciliation(yearStart, today);

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const sources: SourceRow[] = useMemo(() => [
    { ref: `trip_fuel:${TRIP_FUEL_KEY}`, type: "trip_fuel", key: TRIP_FUEL_KEY, label: "Staff Trip Fuel", group: "Staff" },
    ...categories.map((c) => ({ ref: `petty_cash_category:${c.id}`, type: "petty_cash_category" as const, key: c.id, label: c.name, group: "Petty cash categories" })),
  ], [categories]);

  const linkByRef = useMemo(() => new Map(links.map((l) => [`${l.source_type}:${l.source_key}`, l])), [links]);
  const pettyCashAccount = accounts?.funding.find((a) => a.code === "6002") ?? accounts?.funding.find((a) => /petty/i.test(a.name));

  // Unlinked sources that have amounts this year.
  const unlinkedActivity = useMemo(() => {
    const map = new Map<string, number>();
    recon.filter((r) => r.row_kind === "unlinked").forEach((r) => map.set(r.source_refs[0], (map.get(r.source_refs[0]) ?? 0) + r.source_amount));
    return map;
  }, [recon]);

  // Sources that share an expense account are compared together.
  const sharedAccounts = useMemo(() => {
    const count = new Map<string, number>();
    links.forEach((l) => count.set(l.expense_account_id, (count.get(l.expense_account_id) ?? 0) + 1));
    return new Set([...count.entries()].filter(([, n]) => n > 1).map(([id]) => id));
  }, [links]);

  useEffect(() => { setDrafts({}); }, [links]);

  const draftFor = (s: SourceRow): Draft => {
    const d = drafts[s.ref];
    if (d) return d;
    const l = linkByRef.get(s.ref);
    return {
      expenseId: l?.expense_account_id ?? "",
      fundingId: l?.funding_account_id ?? "",
      tolerance: String(l?.tolerance ?? 1),
      compareFrom: l?.compare_from ?? "",
    };
  };
  const setDraft = (s: SourceRow, patch: Partial<Draft>) => setDrafts((all) => ({ ...all, [s.ref]: { ...draftFor(s), ...patch, suggested: patch.suggested ?? false } }));

  const isDirty = (s: SourceRow) => {
    const l = linkByRef.get(s.ref);
    const d = drafts[s.ref];
    if (!d) return false;
    if (!l) return Boolean(d.expenseId);
    return d.expenseId !== l.expense_account_id || d.fundingId !== (l.funding_account_id ?? "") || Number(d.tolerance) !== l.tolerance || d.compareFrom !== (l.compare_from ?? "");
  };

  const save = useMutation({
    mutationFn: async (s: SourceRow) => {
      const d = draftFor(s);
      if (!d.expenseId) throw new Error(`Choose the expense account for ${s.label}.`);
      const { error } = await elDb.rpc("expense_account_link_save", {
        p_source_type: s.type,
        p_source_key: s.key,
        p_expense_account_id: d.expenseId,
        p_funding_account_id: d.fundingId || null,
        p_tolerance: Number(d.tolerance || 1),
        p_notes: null,
        p_compare_from: d.compareFrom || null,
      });
      if (error) throw error;
      return s.label;
    },
    onSuccess: (label) => { toast({ title: "Link saved", description: label }); invalidateExpenseLinkQueries(queryClient); },
    onError: (e) => toast({ title: "Could not save", description: errorMessage(e), variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await elDb.rpc("expense_account_link_delete", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Link removed" }); invalidateExpenseLinkQueries(queryClient); },
    onError: (e) => toast({ title: "Could not remove", description: errorMessage(e), variant: "destructive" }),
  });

  const suggest = () => {
    if (!accounts) return;
    let n = 0;
    const next: Record<string, Draft> = { ...drafts };
    sources.forEach((s) => {
      if (s.type !== "petty_cash_category" || linkByRef.has(s.ref) || next[s.ref]?.expenseId) return;
      const hit = suggestExpenseAccount(s.label, accounts.expense);
      if (!hit) return;
      next[s.ref] = { expenseId: hit.id, fundingId: pettyCashAccount?.id ?? "", tolerance: "1", compareFrom: "", suggested: true };
      n += 1;
    });
    setDrafts(next);
    toast({ title: n ? `${n} suggestion${n > 1 ? "s" : ""} filled in` : "No new suggestions", description: n ? "Check each one and press Save. Nothing is saved until you do." : "The remaining categories need an account chosen by hand." });
  };

  const dirtyCount = sources.filter(isDirty).length;
  const saveAll = async () => {
    for (const s of sources.filter(isDirty)) {
      try { await save.mutateAsync(s); } catch { break; }
    }
  };

  const expenseOptions = (accounts?.expense ?? []).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}`, search: `${a.code} ${a.name}` }));
  const fundingOptions = [{ value: "none", label: "Any posting on the account" }, ...(accounts?.funding ?? []).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}`, search: `${a.code} ${a.name}` }))];
  const unlinkedCount = sources.filter((s) => !linkByRef.has(s.ref)).length;
  const activeUnlinked = sources.filter((s) => !linkByRef.has(s.ref) && (unlinkedActivity.get(s.ref) ?? 0) > 0);

  return (
    <ERPLayout>
      <div className="w-full max-w-full space-y-4">
        <PageHeader
          title="Expense Account Links"
          description="Which ledger account each petty cash category and staff trip fuel is posted to. The reconciliation warns when the ledger and the operational records differ."
          icon={Link2}
          iconColor="bg-indigo-600 text-white"
        >
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild><Link to="/accounting/expense-reconciliation">Open reconciliation</Link></Button>
            {canEdit && <Button variant="outline" size="sm" onClick={suggest}><Sparkles className="h-4 w-4 mr-1" /> Suggest by name</Button>}
            {canEdit && <Button size="sm" disabled={!dirtyCount || save.isPending} onClick={saveAll}><Save className="h-4 w-4 mr-1" /> Save {dirtyCount ? `${dirtyCount} change${dirtyCount > 1 ? "s" : ""}` : "changes"}</Button>}
          </div>
        </PageHeader>

        {!canEdit && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">You can view the links. Only a super admin or an accounting manager can change them.</div>
        )}

        <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
          <div><b className="text-foreground">How it is compared.</b> For each linked account and month, the amount paid or recorded by the source is set against the net debit on that account in the ledger. The ledger side counts only vouchers that also touch the funding account, such as Petty Cash 6002.</div>
          <div>Petty cash counts every expense entry that is not rejected, by entry date. Trip fuel counts vouchers marked paid, by the date the cashier paid them. Nothing before the compare-from date is counted, on either side.</div>
          <div>Sources that share an expense account are compared together against that one account. They should share the same compare-from date.</div>
        </div>

        {activeUnlinked.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <b>{activeUnlinked.length} source{activeUnlinked.length > 1 ? "s have" : " has"} amounts this year but no linked account:</b>{" "}
              {activeUnlinked.map((s) => `${s.label} (${fmtRs(unlinkedActivity.get(s.ref) ?? 0)})`).join(", ")}.
            </div>
          </div>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Sources · {sources.length - unlinkedCount} linked, {unlinkedCount} not linked</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead className="min-w-[260px]">Expense account</TableHead>
                    <TableHead className="min-w-[220px]">Funding (cash) account</TableHead>
                    <TableHead className="w-28">Tolerance Rs</TableHead>
                    <TableHead className="w-40">Compare from</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                  ) : sources.map((s, i) => {
                    const l = linkByRef.get(s.ref);
                    const d = draftFor(s);
                    const dirty = isDirty(s);
                    const showGroup = i === 0 || sources[i - 1].group !== s.group;
                    return (
                      <Fragment key={s.ref}>
                        {showGroup && (
                          <TableRow className="bg-muted/50 hover:bg-muted/50">
                            <TableCell colSpan={6} className="py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.group}</TableCell>
                          </TableRow>
                        )}
                        <TableRow className={cn(dirty && "bg-amber-50/50")}>
                          <TableCell className="font-medium whitespace-nowrap">{s.label}</TableCell>
                          <TableCell>
                            <SearchableSelect value={d.expenseId} onValueChange={(v) => setDraft(s, { expenseId: v })} options={expenseOptions}
                              placeholder="Choose an expense account" disabled={!canEdit} sortAlpha={false} triggerClassName="w-full min-w-[240px]" />
                            {d.suggested && <div className="text-[11px] text-indigo-700 mt-0.5">Suggested by name. Check it, then Save.</div>}
                            {l && sharedAccounts.has(l.expense_account_id) && <div className="text-[11px] text-muted-foreground mt-0.5">Shared with another source: compared together.</div>}
                          </TableCell>
                          <TableCell>
                            <SearchableSelect value={d.fundingId || "none"} onValueChange={(v) => setDraft(s, { fundingId: v === "none" ? "" : v })} options={fundingOptions}
                              disabled={!canEdit} sortAlpha={false} triggerClassName="w-full min-w-[200px]" />
                          </TableCell>
                          <TableCell><Input type="number" min={0} step="0.5" className="h-9 w-24" value={d.tolerance} disabled={!canEdit} onChange={(e) => setDraft(s, { tolerance: e.target.value })} /></TableCell>
                          <TableCell><Input type="date" className="h-9 w-40" value={d.compareFrom} disabled={!canEdit} onChange={(e) => setDraft(s, { compareFrom: e.target.value })} /></TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-2">
                              {l ? <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Linked</Badge> : <Badge variant="secondary">Not linked</Badge>}
                              {canEdit && dirty && <Button size="sm" disabled={save.isPending} onClick={() => save.mutate(s)}>Save</Button>}
                              {canEdit && l && !dirty && (
                                <Button size="icon" variant="ghost" title="Remove the link" disabled={remove.isPending} onClick={() => remove.mutate(l.id)}><Trash2 className="h-4 w-4" /></Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          More sources, such as general expense categories or utility types, are added here as they are brought into the same check. Removing a link only stops the comparison; it never changes petty cash, trip fuel or the ledger.
        </p>
      </div>
    </ERPLayout>
  );
}
