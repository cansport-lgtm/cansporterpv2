import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { RefreshCw, CheckCircle, AlertTriangle, ExternalLink } from "lucide-react";
import { format, subDays } from "date-fns";
import { postProductionConsumption } from "@/lib/accounting/postProductionConsumption";

const sb = supabase as any;

interface DailyRow {
  date: string;
  consumptionAmount: number; // qty × cost_value summed
  rowCount: number;
  voucherNumber: string | null;
  voucherAmount: number;
  status: "ok" | "missing" | "mismatch" | "zero";
}

export default function ProductionReconciliationPage() {
  const queryClient = useQueryClient();
  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [reposting, setReposting] = useState<string | null>(null);

  const { data: closings } = useQuery({
    queryKey: ["acc-prod-recon-closings", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await sb
        .from("consumption_stock_closing")
        .select("closing_date, actual_consumption, raw_material:consumption_raw_materials(cost_value)")
        .gte("closing_date", fromDate)
        .lte("closing_date", toDate);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: vouchers } = useQuery({
    queryKey: ["acc-prod-recon-vouchers", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_vouchers")
        .select("source_reference_id, voucher_number, total_amount")
        .eq("source_module", "production_consumption")
        .gte("voucher_date", fromDate)
        .lte("voucher_date", toDate);
      if (error) throw error;
      return data || [];
    },
  });

  const rows: DailyRow[] = useMemo(() => {
    const byDate: Record<string, { amount: number; rowCount: number }> = {};
    (closings || []).forEach((c: any) => {
      const qty = Number(c.actual_consumption || 0);
      const cost = Number(c.raw_material?.cost_value || 0);
      if (qty <= 0) return;
      const date = c.closing_date as string;
      if (!byDate[date]) byDate[date] = { amount: 0, rowCount: 0 };
      byDate[date].amount += qty * cost;
      byDate[date].rowCount += 1;
    });

    const voucherByDate: Record<string, { number: string; amount: number }> = {};
    (vouchers || []).forEach((v: any) => {
      const d = v.source_reference_id;
      voucherByDate[d] = { number: v.voucher_number, amount: Number(v.total_amount || 0) };
    });

    const allDates = new Set([...Object.keys(byDate), ...Object.keys(voucherByDate)]);
    return Array.from(allDates)
      .sort((a, b) => (a < b ? 1 : -1))
      .map((date) => {
        const summary = byDate[date] || { amount: 0, rowCount: 0 };
        const v = voucherByDate[date];
        const expected = summary.amount;
        const posted = v?.amount || 0;
        const diff = expected - posted;
        let status: DailyRow["status"];
        if (expected === 0 && posted === 0) status = "zero";
        else if (!v) status = "missing";
        else if (Math.abs(diff) < 0.01) status = "ok";
        else status = "mismatch";
        return {
          date,
          consumptionAmount: expected,
          rowCount: summary.rowCount,
          voucherNumber: v?.number || null,
          voucherAmount: posted,
          status,
        };
      });
  }, [closings, vouchers]);

  const repostMutation = useMutation({
    mutationFn: async (date: string) => {
      setReposting(date);
      const result = await postProductionConsumption(date);
      setReposting(null);
      if (!result.ok) throw new Error(result.error || "Unknown error");
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["acc-prod-recon-vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-vouchers"] });
      if (result.skipped === "flag_off") {
        toast({ title: "Flag is OFF", description: "Enable from Accounting Settings (super-admin).", variant: "destructive" });
      } else if (result.skipped === "already_posted") {
        toast({ title: "Already posted", description: result.voucherNumber });
      } else if (result.skipped === "nothing_to_post") {
        toast({ title: "Nothing to post — no consumption rows" });
      } else {
        toast({ title: `Posted ${result.voucherNumber}`, description: `Rs. ${result.totalAmount?.toLocaleString()}` });
      }
    },
    onError: (err: any) => toast({ title: "Repost failed", description: err.message, variant: "destructive" }),
  });

  const renderStatus = (s: DailyRow["status"]) => {
    if (s === "ok") return <Badge variant="default" className="bg-green-600"><CheckCircle className="h-3 w-3 mr-1" />OK</Badge>;
    if (s === "missing") return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Missing</Badge>;
    if (s === "mismatch") return <Badge variant="outline" className="bg-amber-100 text-amber-800"><AlertTriangle className="h-3 w-3 mr-1" />Mismatch</Badge>;
    return <Badge variant="secondary">—</Badge>;
  };

  const totalExpected = rows.reduce((s, r) => s + r.consumptionAmount, 0);
  const totalPosted = rows.reduce((s, r) => s + r.voucherAmount, 0);
  const missingCount = rows.filter((r) => r.status === "missing").length;
  const mismatchCount = rows.filter((r) => r.status === "mismatch").length;

  return (
    <ERPLayout>
      <PageHeader title="Production Reconciliation" description="Daily consumption vs posted JVs — find & repost orphan days">
        <div className="flex gap-2">
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-[160px]" />
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-[160px]" />
          <Link to="/accounting/production-cost-recognition"><Button size="sm" variant="outline"><ExternalLink className="h-4 w-4 mr-1" />Cost Recognition</Button></Link>
        </div>
      </PageHeader>

      <div className="grid grid-cols-4 gap-4 mb-4">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Expected Consumption Cost</div>
          <div className="text-xl font-semibold">Rs. {totalExpected.toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Posted to GL</div>
          <div className="text-xl font-semibold">Rs. {totalPosted.toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Days Missing Voucher</div>
          <div className={`text-xl font-semibold ${missingCount === 0 ? "text-green-600" : "text-red-600"}`}>{missingCount}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Amount Mismatches</div>
          <div className={`text-xl font-semibold ${mismatchCount === 0 ? "text-green-600" : "text-amber-600"}`}>{mismatchCount}</div>
        </CardContent></Card>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead className="text-right">Expected Cost</TableHead>
              <TableHead className="text-right">Posted Amount</TableHead>
              <TableHead className="text-right">Diff</TableHead>
              <TableHead>Voucher #</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!rows.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No consumption activity in this range</TableCell></TableRow>}
            {rows.map((r) => {
              const diff = r.consumptionAmount - r.voucherAmount;
              return (
                <TableRow key={r.date}>
                  <TableCell className="text-xs">{format(new Date(r.date), "dd MMM yyyy")}</TableCell>
                  <TableCell className="text-right text-xs">{r.rowCount}</TableCell>
                  <TableCell className="text-right text-xs">Rs. {r.consumptionAmount.toLocaleString()}</TableCell>
                  <TableCell className="text-right text-xs">Rs. {r.voucherAmount.toLocaleString()}</TableCell>
                  <TableCell className={`text-right text-xs font-medium ${Math.abs(diff) > 0.01 ? "text-amber-600" : ""}`}>{Math.abs(diff) > 0.01 ? `Rs. ${diff.toLocaleString()}` : "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{r.voucherNumber || "—"}</TableCell>
                  <TableCell>{renderStatus(r.status)}</TableCell>
                  <TableCell>
                    {(r.status === "missing" || r.status === "mismatch") && r.consumptionAmount > 0 && (
                      <Button size="sm" variant="outline" disabled={reposting === r.date} onClick={() => repostMutation.mutate(r.date)}>
                        <RefreshCw className={`h-3 w-3 mr-1 ${reposting === r.date ? "animate-spin" : ""}`} />Post
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </ERPLayout>
  );
}
