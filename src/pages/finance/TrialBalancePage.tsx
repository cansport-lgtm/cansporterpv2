import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { Save, AlertTriangle, CheckCircle } from "lucide-react";

export default function TrialBalancePage() {
  const queryClient = useQueryClient();
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");

  const { data: periods } = useQuery({
    queryKey: ["finance-periods-open"],
    queryFn: async () => {
      const { data, error } = await supabase.from("finance_periods").select("*").order("year", { ascending: false }).order("month", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: accounts } = useQuery({
    queryKey: ["finance-coa-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("finance_chart_of_accounts").select("*").eq("is_active", true).order("account_type").order("sort_order").order("code");
      if (error) throw error;
      return data;
    },
  });

  const { data: existingEntries } = useQuery({
    queryKey: ["finance-tb-entries", selectedPeriodId],
    queryFn: async () => {
      if (!selectedPeriodId) return [];
      const { data, error } = await supabase.from("finance_trial_balance_entries").select("*").eq("period_id", selectedPeriodId);
      if (error) throw error;
      return data;
    },
    enabled: !!selectedPeriodId,
  });

  // Local state for entries
  const [entries, setEntries] = useState<Record<string, { debit: string; credit: string; remarks: string }>>({});

  // Initialize entries when data loads
  useMemo(() => {
    if (!accounts || !existingEntries) return;
    const map: Record<string, { debit: string; credit: string; remarks: string }> = {};
    accounts.forEach((acc) => {
      const existing = existingEntries.find((e) => e.account_id === acc.id);
      map[acc.id] = {
        debit: existing ? String(existing.debit_amount || 0) : "0",
        credit: existing ? String(existing.credit_amount || 0) : "0",
        remarks: existing?.remarks || "",
      };
    });
    setEntries(map);
  }, [accounts, existingEntries]);

  const updateEntry = (accountId: string, field: "debit" | "credit" | "remarks", value: string) => {
    setEntries((prev) => ({ ...prev, [accountId]: { ...prev[accountId], [field]: value } }));
  };

  const totalDebit = Object.values(entries).reduce((s, e) => s + (parseFloat(e.debit) || 0), 0);
  const totalCredit = Object.values(entries).reduce((s, e) => s + (parseFloat(e.credit) || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;
  const selectedPeriod = periods?.find((p) => p.id === selectedPeriodId);
  const isPeriodClosed = selectedPeriod?.is_closed;

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPeriodId || !accounts) throw new Error("Select a period");
      if (!isBalanced) throw new Error("Trial balance must be balanced (Total Debit = Total Credit)");

      const upserts = accounts.map((acc) => ({
        period_id: selectedPeriodId,
        account_id: acc.id,
        debit_amount: parseFloat(entries[acc.id]?.debit || "0"),
        credit_amount: parseFloat(entries[acc.id]?.credit || "0"),
        remarks: entries[acc.id]?.remarks || null,
      }));

      // Delete existing entries for this period, then insert new ones
      await supabase.from("finance_trial_balance_entries").delete().eq("period_id", selectedPeriodId);
      const { error } = await supabase.from("finance_trial_balance_entries").insert(upserts);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finance-tb-entries"] });
      toast({ title: "Trial balance saved successfully" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const groupedAccounts = useMemo(() => {
    if (!accounts) return {};
    const groups: Record<string, typeof accounts> = {};
    accounts.forEach((acc) => {
      const type = acc.account_type;
      if (!groups[type]) groups[type] = [];
      groups[type].push(acc);
    });
    return groups;
  }, [accounts]);

  const typeLabels: Record<string, string> = { asset: "Assets", liability: "Liabilities", equity: "Equity", revenue: "Revenue", expense: "Expenses" };
  const typeOrder = ["asset", "liability", "equity", "revenue", "expense"];

  return (
    <ERPLayout>
      <PageHeader title="Trial Balance Entry" description="Enter summarized period data">
        <div className="flex gap-2 items-center">
          <Select value={selectedPeriodId} onValueChange={setSelectedPeriodId}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Select Period" /></SelectTrigger>
            <SelectContent>
              {periods?.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.period_name} {p.is_closed ? "(Closed)" : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedPeriodId && !isPeriodClosed && (
            <Button onClick={() => saveMutation.mutate()} disabled={!isBalanced || saveMutation.isPending}>
              <Save className="h-4 w-4 mr-1" />{saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          )}
        </div>
      </PageHeader>

      {/* Validation Status */}
      {selectedPeriodId && (
        <Card className="mb-4">
          <CardContent className="py-3 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="text-sm"><span className="text-muted-foreground">Total Debit:</span> <span className="font-bold">Rs. {totalDebit.toLocaleString("en-PK", { minimumFractionDigits: 2 })}</span></div>
              <div className="text-sm"><span className="text-muted-foreground">Total Credit:</span> <span className="font-bold">Rs. {totalCredit.toLocaleString("en-PK", { minimumFractionDigits: 2 })}</span></div>
              <div className="text-sm"><span className="text-muted-foreground">Difference:</span> <span className={`font-bold ${isBalanced ? "text-green-600" : "text-destructive"}`}>Rs. {Math.abs(totalDebit - totalCredit).toLocaleString("en-PK", { minimumFractionDigits: 2 })}</span></div>
            </div>
            {isBalanced ? (
              <Badge className="bg-green-100 text-green-800"><CheckCircle className="h-3 w-3 mr-1" />Balanced</Badge>
            ) : (
              <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Not Balanced</Badge>
            )}
          </CardContent>
        </Card>
      )}

      {!selectedPeriodId ? (
        <div className="text-center py-16 text-muted-foreground">Select a period to enter trial balance data</div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Code</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Sub Category</TableHead>
                <TableHead className="w-40 text-right">Debit (Rs.)</TableHead>
                <TableHead className="w-40 text-right">Credit (Rs.)</TableHead>
                <TableHead className="w-48">Remarks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {typeOrder.map((type) => (
                groupedAccounts[type] && (
                  <>
                    <TableRow key={`header-${type}`} className="bg-muted/50">
                      <TableCell colSpan={6} className="font-bold text-sm">{typeLabels[type]}</TableCell>
                    </TableRow>
                    {groupedAccounts[type].map((acc) => (
                      <TableRow key={acc.id}>
                        <TableCell className="font-mono text-xs">{acc.code}</TableCell>
                        <TableCell className="text-sm">{acc.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{acc.sub_category || "-"}</TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            className="text-right h-8"
                            value={entries[acc.id]?.debit || "0"}
                            onChange={(e) => updateEntry(acc.id, "debit", e.target.value)}
                            disabled={isPeriodClosed}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            className="text-right h-8"
                            value={entries[acc.id]?.credit || "0"}
                            onChange={(e) => updateEntry(acc.id, "credit", e.target.value)}
                            disabled={isPeriodClosed}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className="h-8 text-xs"
                            value={entries[acc.id]?.remarks || ""}
                            onChange={(e) => updateEntry(acc.id, "remarks", e.target.value)}
                            disabled={isPeriodClosed}
                            placeholder="Optional"
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </>
                )
              ))}
            </TableBody>
            <TableFooter>
              <TableRow className="font-bold">
                <TableCell colSpan={3}>Total</TableCell>
                <TableCell className="text-right">Rs. {totalDebit.toLocaleString("en-PK", { minimumFractionDigits: 2 })}</TableCell>
                <TableCell className="text-right">Rs. {totalCredit.toLocaleString("en-PK", { minimumFractionDigits: 2 })}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </ERPLayout>
  );
}
