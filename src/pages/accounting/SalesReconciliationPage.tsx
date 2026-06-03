import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { RefreshCw, CheckCircle, AlertTriangle } from "lucide-react";
import { format, startOfMonth, parseISO } from "date-fns";
import { postDispatchVoucher } from "@/lib/accounting/postDispatchVoucher";

const sb = supabase as any;

export default function SalesReconciliationPage() {
  const queryClient = useQueryClient();
  const [fromDate, setFromDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [reposting, setReposting] = useState<string | null>(null);

  // 1) All domestic dispatches in range
  const { data: dispatches } = useQuery({
    queryKey: ["sales-recon-dispatches", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await sb
        .from("sales_dispatches")
        .select("id, dispatch_number, dispatch_date, delivery_status, sales_segment")
        .eq("sales_segment", "domestic")
        .gte("dispatch_date", fromDate)
        .lte("dispatch_date", toDate)
        .order("dispatch_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // 2) For each dispatch — compute amount from items
  const dispatchIds = useMemo(() => (dispatches || []).map((d: any) => d.id), [dispatches]);

  const { data: itemTotals } = useQuery({
    queryKey: ["sales-recon-items", dispatchIds.join(",")],
    queryFn: async () => {
      if (!dispatchIds.length) return {};
      const { data, error } = await sb
        .from("sales_dispatch_items")
        .select("dispatch_id, quantity_dozens, order_item:sales_order_items(price_per_dozen, sales_orders:order_id(order_number, customer_id, customers:customer_id(name)))")
        .in("dispatch_id", dispatchIds);
      if (error) throw error;
      const map: Record<string, { amount: number; customers: Set<string>; orders: Set<string> }> = {};
      (data || []).forEach((row: any) => {
        const amount = Number(row.quantity_dozens || 0) * Number(row.order_item?.price_per_dozen || 0);
        if (!map[row.dispatch_id]) map[row.dispatch_id] = { amount: 0, customers: new Set(), orders: new Set() };
        map[row.dispatch_id].amount += amount;
        const cName = row.order_item?.sales_orders?.customers?.name;
        const oNum = row.order_item?.sales_orders?.order_number;
        if (cName) map[row.dispatch_id].customers.add(cName);
        if (oNum) map[row.dispatch_id].orders.add(oNum);
      });
      return map;
    },
    enabled: dispatchIds.length > 0,
  });

  // 3) Posted vouchers keyed by dispatch_id (for status)
  const { data: postedVouchers } = useQuery({
    queryKey: ["sales-recon-vouchers", dispatchIds.join(",")],
    queryFn: async () => {
      if (!dispatchIds.length) return {};
      const { data, error } = await sb
        .from("accounting_vouchers")
        .select("id, voucher_number, source_reference_id, total_amount")
        .eq("source_module", "domestic_sales")
        .in("source_reference_id", dispatchIds);
      if (error) throw error;
      const map: Record<string, { vouchers: any[]; total: number }> = {};
      (data || []).forEach((v: any) => {
        if (!map[v.source_reference_id]) map[v.source_reference_id] = { vouchers: [], total: 0 };
        map[v.source_reference_id].vouchers.push(v);
        map[v.source_reference_id].total += Number(v.total_amount || 0);
      });
      return map;
    },
    enabled: dispatchIds.length > 0,
  });

  const repostMutation = useMutation({
    mutationFn: async (dispatchId: string) => {
      setReposting(dispatchId);
      const result = await postDispatchVoucher(dispatchId);
      setReposting(null);
      if (!result.ok) throw new Error(result.error || "Unknown error");
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["sales-recon-vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-vouchers"] });
      if (result.skipped === "flag_off") {
        toast({ title: "Auto-post flag is OFF", description: "Enable from Accounting Settings (super-admin).", variant: "destructive" });
      } else if (result.vouchers && result.vouchers.length > 0) {
        toast({ title: `Posted ${result.vouchers.length} voucher(s)` });
      } else {
        toast({ title: "Already posted — no new vouchers" });
      }
    },
    onError: (err: any) => toast({ title: "Repost failed", description: err.message, variant: "destructive" }),
  });

  const rows = useMemo(() => {
    return (dispatches || []).map((d: any) => {
      const totals = itemTotals?.[d.id] || { amount: 0, customers: new Set(), orders: new Set() };
      const posted = postedVouchers?.[d.id];
      const expectedAmount = totals.amount;
      const postedAmount = posted?.total || 0;
      const diff = expectedAmount - postedAmount;
      let status: "missing" | "ok" | "mismatch" | "zero" = "missing";
      if (expectedAmount === 0) status = "zero";
      else if (!posted || posted.vouchers.length === 0) status = "missing";
      else if (Math.abs(diff) < 0.01) status = "ok";
      else status = "mismatch";
      return {
        ...d,
        customers: Array.from(totals.customers).join(", "),
        orders: Array.from(totals.orders).join(", "),
        expectedAmount,
        postedAmount,
        diff,
        status,
        voucherNumbers: posted?.vouchers.map((v: any) => v.voucher_number).join(", ") || "",
      };
    });
  }, [dispatches, itemTotals, postedVouchers]);

  const totalDispatched = rows.reduce((s: number, r: any) => s + r.expectedAmount, 0);
  const totalPosted = rows.reduce((s: number, r: any) => s + r.postedAmount, 0);
  const missingCount = rows.filter((r: any) => r.status === "missing").length;
  const mismatchCount = rows.filter((r: any) => r.status === "mismatch").length;

  const renderStatus = (s: string) => {
    if (s === "ok") return <Badge variant="default" className="bg-green-600"><CheckCircle className="h-3 w-3 mr-1" />OK</Badge>;
    if (s === "missing") return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Missing</Badge>;
    if (s === "mismatch") return <Badge variant="outline" className="bg-amber-100 text-amber-800"><AlertTriangle className="h-3 w-3 mr-1" />Mismatch</Badge>;
    return <Badge variant="secondary">—</Badge>;
  };

  return (
    <ERPLayout>
      <PageHeader title="Sales Reconciliation" description="Sales dispatches vs accounting vouchers — find & fix orphans">
        <div className="flex gap-2">
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-[160px]" />
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-[160px]" />
        </div>
      </PageHeader>

      <div className="grid grid-cols-4 gap-4 mb-4">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Total Dispatched</div>
          <div className="text-xl font-semibold">Rs. {totalDispatched.toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Total Posted to GL</div>
          <div className="text-xl font-semibold">Rs. {totalPosted.toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Missing Vouchers</div>
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
              <TableHead>Dispatch #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Customer(s)</TableHead>
              <TableHead>Order(s)</TableHead>
              <TableHead className="text-right">Expected</TableHead>
              <TableHead className="text-right">Posted</TableHead>
              <TableHead className="text-right">Diff</TableHead>
              <TableHead>Voucher #</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!rows.length && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground">No dispatches in this range</TableCell></TableRow>}
            {rows.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.dispatch_number}</TableCell>
                <TableCell className="text-xs">{r.dispatch_date && format(parseISO(r.dispatch_date), "dd MMM yyyy")}</TableCell>
                <TableCell className="text-xs">{r.customers || "—"}</TableCell>
                <TableCell className="text-xs">{r.orders || "—"}</TableCell>
                <TableCell className="text-right text-xs">Rs. {r.expectedAmount.toLocaleString()}</TableCell>
                <TableCell className="text-right text-xs">Rs. {r.postedAmount.toLocaleString()}</TableCell>
                <TableCell className={`text-right text-xs font-medium ${Math.abs(r.diff) > 0.01 ? "text-amber-600" : ""}`}>{r.diff !== 0 ? `Rs. ${r.diff.toLocaleString()}` : "—"}</TableCell>
                <TableCell className="font-mono text-xs">{r.voucherNumbers || "—"}</TableCell>
                <TableCell>{renderStatus(r.status)}</TableCell>
                <TableCell>
                  {(r.status === "missing" || r.status === "mismatch") && (
                    <Button size="sm" variant="outline" disabled={reposting === r.id} onClick={() => repostMutation.mutate(r.id)}>
                      <RefreshCw className={`h-3 w-3 mr-1 ${reposting === r.id ? "animate-spin" : ""}`} />Repost
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
