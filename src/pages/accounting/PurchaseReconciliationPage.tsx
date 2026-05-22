import { useState, useMemo } from "react";
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
import { RefreshCw, CheckCircle, AlertTriangle } from "lucide-react";
import { format, startOfMonth } from "date-fns";
import { postGRNVoucher } from "@/lib/accounting/postGRNVoucher";

const sb = supabase as any;

export default function PurchaseReconciliationPage() {
  const queryClient = useQueryClient();
  const [fromDate, setFromDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [reposting, setReposting] = useState<string | null>(null);

  const { data: grns } = useQuery({
    queryKey: ["acc-purch-recon-grns", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await sb
        .from("goods_receipt_notes")
        .select("id, grn_number, receipt_date, total_amount, invoice_amount, supplier_id, purchase_order_id, supplier:suppliers(name, code), purchase_order:purchase_orders(po_number, category, total_amount)")
        .gte("receipt_date", fromDate)
        .lte("receipt_date", toDate)
        .order("receipt_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const grnIds = useMemo(() => (grns || []).map((g: any) => g.id), [grns]);
  const { data: postedVouchers } = useQuery({
    queryKey: ["acc-purch-recon-vouchers", grnIds.join(",")],
    queryFn: async () => {
      if (!grnIds.length) return {};
      const { data, error } = await sb
        .from("accounting_vouchers")
        .select("id, voucher_number, source_reference_id, total_amount")
        .eq("source_module", "purchase")
        .in("source_reference_id", grnIds);
      if (error) throw error;
      const map: Record<string, { number: string; amount: number }> = {};
      (data || []).forEach((v: any) => { map[v.source_reference_id] = { number: v.voucher_number, amount: Number(v.total_amount) }; });
      return map;
    },
    enabled: grnIds.length > 0,
  });

  const rows = useMemo(() => {
    return (grns || []).map((g: any) => {
      const expected = Number(g.invoice_amount || g.total_amount || 0);
      const poTotal = Number(g.purchase_order?.total_amount || 0);
      const poVariance = poTotal - expected;             // positive = under-delivery / under-billing
      const poVariancePct = poTotal > 0 ? Math.abs(poVariance) / poTotal * 100 : 0;
      let poVarStatus: "match" | "minor" | "warn" | "alert" | "no_po";
      if (poTotal === 0) poVarStatus = "no_po";
      else if (poVariancePct < 0.5) poVarStatus = "match";
      else if (poVariancePct < 2) poVarStatus = "minor";
      else if (poVariancePct < 10) poVarStatus = "warn";
      else poVarStatus = "alert";

      const v = postedVouchers?.[g.id];
      const posted = v?.amount || 0;
      const diff = expected - posted;
      let status: "ok" | "missing" | "mismatch" | "zero";
      if (expected === 0) status = "zero";
      else if (!v) status = "missing";
      else if (Math.abs(diff) < 0.01) status = "ok";
      else status = "mismatch";

      return { ...g, expected, posted, diff, status, voucherNumber: v?.number || null,
               poTotal, poVariance, poVariancePct, poVarStatus };
    });
  }, [grns, postedVouchers]);

  const repostMutation = useMutation({
    mutationFn: async (grnId: string) => {
      setReposting(grnId);
      const result = await postGRNVoucher(grnId);
      setReposting(null);
      if (!result.ok) throw new Error(result.error || "Unknown error");
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["acc-purch-recon-vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-vouchers"] });
      if (result.skipped === "flag_off") {
        toast({ title: "Auto-post flag is OFF", description: "Enable from Accounting Settings (super-admin).", variant: "destructive" });
      } else if (result.skipped === "already_posted") {
        toast({ title: "Already posted", description: result.voucherNumber });
      } else {
        toast({ title: `Posted ${result.voucherNumber}`, description: `Rs. ${result.amount?.toLocaleString()}` });
      }
    },
    onError: (err: any) => toast({ title: "Repost failed", description: err.message, variant: "destructive" }),
  });

  const totalExpected = rows.reduce((s: number, r: any) => s + r.expected, 0);
  const totalPosted = rows.reduce((s: number, r: any) => s + r.posted, 0);
  const missingCount = rows.filter((r: any) => r.status === "missing").length;
  const mismatchCount = rows.filter((r: any) => r.status === "mismatch").length;
  const poVarianceCount = rows.filter((r: any) => r.poVarStatus === "warn" || r.poVarStatus === "alert").length;
  const totalPOVariance = rows.reduce((s: number, r: any) => s + Math.abs(r.poVariance), 0);

  const renderStatus = (s: string) => {
    if (s === "ok") return <Badge variant="default" className="bg-green-600"><CheckCircle className="h-3 w-3 mr-1" />OK</Badge>;
    if (s === "missing") return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Missing</Badge>;
    if (s === "mismatch") return <Badge variant="outline" className="bg-amber-100 text-amber-800"><AlertTriangle className="h-3 w-3 mr-1" />Mismatch</Badge>;
    return <Badge variant="secondary">—</Badge>;
  };

  const renderPOVarStatus = (s: string, pct: number) => {
    if (s === "no_po") return <Badge variant="secondary" className="text-xs">No PO</Badge>;
    if (s === "match") return <Badge variant="default" className="bg-green-600 text-xs"><CheckCircle className="h-3 w-3 mr-1" />Match</Badge>;
    if (s === "minor") return <Badge variant="outline" className="bg-green-50 text-green-700 text-xs">±{pct.toFixed(1)}%</Badge>;
    if (s === "warn")  return <Badge variant="outline" className="bg-amber-100 text-amber-800 text-xs">±{pct.toFixed(1)}%</Badge>;
    if (s === "alert") return <Badge variant="destructive" className="text-xs"><AlertTriangle className="h-3 w-3 mr-1" />±{pct.toFixed(1)}%</Badge>;
    return <Badge variant="secondary">—</Badge>;
  };

  return (
    <ERPLayout>
      <PageHeader title="Purchase Reconciliation" description="GRNs vs accounting vouchers — find & repost orphans">
        <div className="flex gap-2">
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-[160px]" />
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-[160px]" />
        </div>
      </PageHeader>

      <div className="grid grid-cols-5 gap-3 mb-4">
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground">Total GRN Value</div>
          <div className="text-lg font-semibold">Rs. {totalExpected.toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground">Posted to GL</div>
          <div className="text-lg font-semibold">Rs. {totalPosted.toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground">Missing Vouchers</div>
          <div className={`text-lg font-semibold ${missingCount === 0 ? "text-green-600" : "text-red-600"}`}>{missingCount}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground">Posting Mismatches</div>
          <div className={`text-lg font-semibold ${mismatchCount === 0 ? "text-green-600" : "text-amber-600"}`}>{mismatchCount}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground">PO–GRN Variances (≥2%)</div>
          <div className={`text-lg font-semibold ${poVarianceCount === 0 ? "text-green-600" : "text-amber-600"}`}>{poVarianceCount}</div>
          <div className="text-[10px] text-muted-foreground mt-1">Total Rs. {totalPOVariance.toLocaleString()}</div>
        </CardContent></Card>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>GRN #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>PO #</TableHead>
              <TableHead>Cat.</TableHead>
              <TableHead className="text-right">PO Amt</TableHead>
              <TableHead className="text-right">GRN Amt</TableHead>
              <TableHead className="text-right">PO−GRN</TableHead>
              <TableHead>PO Var</TableHead>
              <TableHead className="text-right">GL Posted</TableHead>
              <TableHead>Voucher #</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!rows.length && <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground">No GRNs in this range</TableCell></TableRow>}
            {rows.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.grn_number}</TableCell>
                <TableCell className="text-xs">{r.receipt_date && format(new Date(r.receipt_date), "dd MMM yyyy")}</TableCell>
                <TableCell className="text-xs">{r.supplier?.name || "—"}</TableCell>
                <TableCell className="font-mono text-xs">{r.purchase_order?.po_number || "—"}</TableCell>
                <TableCell className="text-xs"><Badge variant="outline" className="text-[10px]">{r.purchase_order?.category || "—"}</Badge></TableCell>
                <TableCell className="text-right text-xs">Rs. {r.poTotal.toLocaleString()}</TableCell>
                <TableCell className="text-right text-xs">Rs. {r.expected.toLocaleString()}</TableCell>
                <TableCell className={`text-right text-xs font-medium ${Math.abs(r.poVariance) > 0.01 ? (r.poVarStatus === "alert" ? "text-red-600" : r.poVarStatus === "warn" ? "text-amber-600" : "text-muted-foreground") : ""}`}>
                  {Math.abs(r.poVariance) > 0.01 ? `Rs. ${r.poVariance.toLocaleString()}` : "—"}
                </TableCell>
                <TableCell>{renderPOVarStatus(r.poVarStatus, r.poVariancePct)}</TableCell>
                <TableCell className="text-right text-xs">Rs. {r.posted.toLocaleString()}</TableCell>
                <TableCell className="font-mono text-xs">{r.voucherNumber || "—"}</TableCell>
                <TableCell>{renderStatus(r.status)}</TableCell>
                <TableCell>
                  {(r.status === "missing" || r.status === "mismatch") && (
                    <Button size="sm" variant="outline" disabled={reposting === r.id} onClick={() => repostMutation.mutate(r.id)}>
                      <RefreshCw className={`h-3 w-3 mr-1 ${reposting === r.id ? "animate-spin" : ""}`} />Post
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </ERPLayout>
  );
}
