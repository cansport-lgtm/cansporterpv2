import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/accounting/fetchAllRows";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { Lock, Unlock, AlertTriangle, CheckCircle, Archive } from "lucide-react";
import { format, endOfYear } from "date-fns";

const sb = supabase as any;

export default function PeriodClosePage() {
  const queryClient = useQueryClient();
  const [proposedClose, setProposedClose] = useState("");
  const [yearEndDate, setYearEndDate] = useState(format(endOfYear(new Date()), "yyyy-MM-dd"));
  const [yearEndNote, setYearEndNote] = useState("");

  const { data: state } = useQuery({
    queryKey: ["acc-period-close"],
    queryFn: async () => {
      const { data } = await sb.from("accounting_period_close").select("*").eq("id", 1).maybeSingle();
      return data;
    },
  });

  // Show what would be locked
  const { data: lockPreview } = useQuery({
    queryKey: ["acc-period-close-preview", proposedClose],
    queryFn: async () => {
      if (!proposedClose) return null;
      const { count } = await sb
        .from("accounting_vouchers")
        .select("id", { count: "exact", head: true })
        .lte("voucher_date", proposedClose);
      return count || 0;
    },
    enabled: !!proposedClose,
  });

  // Trial balance at proposed close
  const { data: tbAtClose } = useQuery({
    queryKey: ["acc-period-close-tb", proposedClose],
    queryFn: async () => {
      if (!proposedClose) return null;
      const data = await fetchAllRows((from, to) =>
        sb
          .from("accounting_voucher_lines")
          .select("debit_amount, credit_amount, account:accounting_chart_of_accounts(code, name, account_type), voucher:accounting_vouchers!inner(voucher_date)")
          .lte("voucher.voucher_date", proposedClose)
          .order("id", { ascending: true })
          .range(from, to));
      const totals: Record<string, { code: string; name: string; type: string; dr: number; cr: number }> = {};
      (data || []).forEach((l: any) => {
        const a = l.account; if (!a) return;
        const key = a.code;
        if (!totals[key]) totals[key] = { code: a.code, name: a.name, type: a.account_type, dr: 0, cr: 0 };
        totals[key].dr += Number(l.debit_amount || 0);
        totals[key].cr += Number(l.credit_amount || 0);
      });
      let totalRev = 0, totalExp = 0;
      Object.values(totals).forEach(t => {
        if (t.type === "revenue") totalRev += t.cr - t.dr;
        if (t.type === "expense") totalExp += t.dr - t.cr;
      });
      return { netIncome: totalRev - totalExp, totalRev, totalExp };
    },
    enabled: !!proposedClose,
  });

  const setCloseMutation = useMutation({
    mutationFn: async (date: string | null) => {
      const { error } = await sb.from("accounting_period_close").update({
        closed_through_date: date,
        last_closed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", 1);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["acc-period-close"] });
      toast({ title: vars === null ? "Period reopened" : `Period locked through ${vars}` });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // Year-end closing JV
  const yearEndMutation = useMutation({
    mutationFn: async () => {
      // 1) Pull all revenue + expense account balances up to yearEndDate
      const lines = await fetchAllRows((from, to) =>
        sb
          .from("accounting_voucher_lines")
          .select("debit_amount, credit_amount, account_id, account:accounting_chart_of_accounts(id, code, account_type), voucher:accounting_vouchers!inner(voucher_date)")
          .lte("voucher.voucher_date", yearEndDate)
          .order("id", { ascending: true })
          .range(from, to));

      const byAcc: Record<string, { id: string; type: string; net_dr_cr: number }> = {};
      (lines || []).forEach((l: any) => {
        const a = l.account; if (!a) return;
        if (!byAcc[a.id]) byAcc[a.id] = { id: a.id, type: a.account_type, net_dr_cr: 0 };
        byAcc[a.id].net_dr_cr += Number(l.debit_amount || 0) - Number(l.credit_amount || 0);
      });

      // 2) Build closing JV — zero out P&L accounts, plug to Retained Earnings (3010)
      const { data: re } = await sb.from("accounting_chart_of_accounts").select("id").eq("code", "3010").single();
      if (!re) throw new Error("Retained Earnings account (3010) not found");

      const voucherLines: any[] = [];
      let netIncome = 0;
      let order = 0;
      for (const a of Object.values(byAcc)) {
        if (a.type !== "revenue" && a.type !== "expense") continue;
        if (Math.abs(a.net_dr_cr) < 0.01) continue;
        // To zero the account, post opposite of current net balance
        if (a.net_dr_cr > 0) {
          // Dr balance (expense) → credit it to zero, contribute net_dr_cr to expenses
          voucherLines.push({ account_id: a.id, debit_amount: 0, credit_amount: a.net_dr_cr, line_order: order++, line_narration: "Year-end close — expense" });
          netIncome -= a.net_dr_cr;
        } else {
          // Cr balance (revenue) → debit it to zero
          voucherLines.push({ account_id: a.id, debit_amount: -a.net_dr_cr, credit_amount: 0, line_order: order++, line_narration: "Year-end close — revenue" });
          netIncome += -a.net_dr_cr;
        }
      }

      if (voucherLines.length === 0) throw new Error("No P&L activity to close");

      // Plug to Retained Earnings: if netIncome > 0 (profit), Cr Retained Earnings; if < 0 (loss), Dr it
      if (netIncome > 0) {
        voucherLines.push({ account_id: re.id, debit_amount: 0, credit_amount: netIncome, line_order: order++, line_narration: "Net profit transferred to Retained Earnings" });
      } else {
        voucherLines.push({ account_id: re.id, debit_amount: -netIncome, credit_amount: 0, line_order: order++, line_narration: "Net loss absorbed by Retained Earnings" });
      }

      const totalAmt = voucherLines.reduce((s, l) => s + Number(l.debit_amount || 0), 0);
      const { data: voucher, error: vErr } = await sb
        .from("accounting_vouchers")
        .insert({
          voucher_number: "",
          voucher_type: "JV",
          voucher_date: yearEndDate,
          narration: `Year-end closing entry — net ${netIncome >= 0 ? "profit" : "loss"} Rs. ${Math.abs(netIncome).toLocaleString()}${yearEndNote ? `. ${yearEndNote}` : ""}`,
          total_amount: totalAmt,
          status: "posted",
          source_module: "year_end_close",
          source_reference_id: yearEndDate,
        })
        .select("id, voucher_number")
        .single();
      if (vErr || !voucher) throw new Error(vErr?.message || "Voucher insert failed");

      const linesWithVoucher = voucherLines.map(l => ({ ...l, voucher_id: voucher.id }));
      const { error: lErr } = await sb.from("accounting_voucher_lines").insert(linesWithVoucher);
      if (lErr) throw new Error(lErr.message);

      return { voucherNumber: voucher.voucher_number, netIncome, lineCount: voucherLines.length };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["accounting-vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["acc-period-close-tb"] });
      toast({ title: `Year-end JV posted: ${result.voucherNumber}`, description: `Net ${result.netIncome >= 0 ? "profit" : "loss"} Rs. ${Math.abs(result.netIncome).toLocaleString()} → Retained Earnings (${result.lineCount} lines)` });
      setYearEndNote("");
    },
    onError: (e: any) => toast({ title: "Year-end close failed", description: e.message, variant: "destructive" }),
  });

  const isLocked = !!state?.closed_through_date;

  return (
    <ERPLayout>
      <PageHeader title="Period Close" description="Lock periods after they end + year-end closing entry to Retained Earnings" />

      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">Current Status</div>
              <div className="text-lg font-semibold mt-1 flex items-center gap-2">
                {isLocked ? (
                  <><Lock className="h-4 w-4 text-red-600" />Locked through <code className="bg-muted px-2 py-0.5 rounded">{state?.closed_through_date}</code></>
                ) : (
                  <><Unlock className="h-4 w-4 text-green-600" />No period locked — all dates open for posting</>
                )}
              </div>
              {state?.last_closed_at && <div className="text-xs text-muted-foreground mt-1">Last updated: {format(new Date(state.last_closed_at), "dd MMM yyyy HH:mm")}</div>}
            </div>
            {isLocked && (
              <Button variant="outline" size="sm" onClick={() => setCloseMutation.mutate(null)} disabled={setCloseMutation.isPending}>
                <Unlock className="h-4 w-4 mr-1" />Reopen Period
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Lock className="h-4 w-4" />Close a Period</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Close through date *</Label>
              <Input type="date" value={proposedClose} onChange={e => setProposedClose(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">All vouchers dated on or before this date will be locked. New vouchers cannot be posted to these dates until the period is reopened.</p>
            </div>

            {proposedClose && (
              <div className="border rounded-md p-3 bg-muted/30 space-y-2 text-xs">
                <div className="flex justify-between"><span>Vouchers to be locked</span><strong>{lockPreview ?? "—"}</strong></div>
                <div className="flex justify-between"><span>Total Revenue (period)</span><strong className="text-green-600">Rs. {(tbAtClose?.totalRev || 0).toLocaleString()}</strong></div>
                <div className="flex justify-between"><span>Total Expenses (period)</span><strong className="text-red-600">Rs. {(tbAtClose?.totalExp || 0).toLocaleString()}</strong></div>
                <div className="flex justify-between border-t pt-1"><span>Net Income at close</span><strong className={tbAtClose && tbAtClose.netIncome >= 0 ? "text-green-600" : "text-red-600"}>Rs. {(tbAtClose?.netIncome || 0).toLocaleString()}</strong></div>
              </div>
            )}

            <Button className="w-full" disabled={!proposedClose || setCloseMutation.isPending} onClick={() => setCloseMutation.mutate(proposedClose)}>
              <Lock className="h-4 w-4 mr-1" />
              {setCloseMutation.isPending ? "Locking..." : `Lock period through ${proposedClose || "..."}`}
            </Button>
            <div className="text-xs text-muted-foreground flex items-start gap-1">
              <AlertTriangle className="h-3 w-3 mt-0.5 text-amber-600" />
              Lock is enforced at database level by a trigger. Can be reopened anytime via this page.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Archive className="h-4 w-4" />Year-End Closing Entry</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Generates one big JV that zeros out all Revenue + Expense accounts and plugs the net result to <strong>Retained Earnings (3010)</strong>. Run at fiscal year-end so the new year starts with empty P&amp;L accounts.
            </div>
            <div>
              <Label>Year-end date *</Label>
              <Input type="date" value={yearEndDate} onChange={e => setYearEndDate(e.target.value)} />
            </div>
            <div>
              <Label>Note (optional)</Label>
              <Textarea rows={2} value={yearEndNote} onChange={e => setYearEndNote(e.target.value)} placeholder="e.g. FY 2025-26 closing entry, audited" />
            </div>
            <Button className="w-full" variant="default" disabled={yearEndMutation.isPending} onClick={() => yearEndMutation.mutate()}>
              <Archive className="h-4 w-4 mr-1" />
              {yearEndMutation.isPending ? "Posting..." : "Post Year-End Closing JV"}
            </Button>
            <div className="text-xs text-muted-foreground flex items-start gap-1">
              <CheckCircle className="h-3 w-3 mt-0.5 text-green-600" />
              Safe to run multiple times — each run posts a fresh JV. To prevent duplicates, lock the period afterwards using the panel on the left.
            </div>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
