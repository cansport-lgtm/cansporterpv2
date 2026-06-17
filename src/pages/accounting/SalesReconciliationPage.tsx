import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/accounting/fetchAllRows";
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
    queryFn: () =>
      fetchAllRows((from, to) =>
        sb
          .from("sales_dispatches")
          .select("id, dispatch_number, dispatch_date, delivery_status, sales_segment")
          .eq("sales_segment", "domestic")
          .gte("dispatch_date", fromDate)
          .lte("dispatch_date", toDate)
          .order("dispatch_date", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to)),
  });

  // 2) For each dispatch — compute the OPERATIONAL amount from items (qty x order price)
  const dispatchIds = useMemo(() => (dispatches || []).map((d: any) => d.id), [dispatches]);

  const { data: itemTotals } = useQuery({
    queryKey: ["sales-recon-items", dispatchIds.join(",")],
    queryFn: async () => {
      if (!dispatchIds.length) return {};
      const data = await fetchAllRows((from, to) =>
        sb
          .from("sales_dispatch_items")
          .select("dispatch_id, quantity_dozens, order_item:sales_order_items(price_per_dozen, sales_orders:order_id(order_number, customer_id, customers:customer_id(name)))")
          .in("dispatch_id", dispatchIds)
          .order("id", { ascending: true })
          .range(from, to));
      const map: Record<string, { amount: number; customers: Set<string>; orders: Set<string> }> = {};
      data.forEach((row: any) => {
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

  // 3) Posted vouchers keyed by dispatch_id — the GL (ledger) value
  const { data: postedVouchers } = useQuery({
    queryKey: ["sales-recon-vouchers", dispatchIds.join(",")],
    queryFn: async () => {
      if (!dispatchIds.length) return {};
      const data = await fetchAllRows((from, to) =>
        sb
          .from("accounting_vouchers")
          .select("id, voucher_number, source_reference_id, total_amount, status")
          .eq("source_module", "domestic_sales")
          .in("source_reference_id", dispatchIds)
          .order("id", { ascending: true })
          .range(from, to));
      const map: Record<string, { vouchers: any[]; total: number }> = {};
      data.forEach((v: any) => {
        if (!map[v.source_reference_id]) map[v.source_reference_id] = { vouchers: [], total: 0 };
        map[v.source_reference_id].vouchers.push(v);
        map[v.source_reference_id].total += Number(v.total_amount || 0);
      });
      return map;
    },
    enabled: dispatchIds.length > 0,
  });

  // 4) Invoices keyed by dispatch_id — invoice number, billed total & status
  const { data: invoices } = useQuery({
    queryKey: ["sales-recon-invoices", dispatchIds.join(",")],
    queryFn: async () => {
      if (!dispatchIds.length) return {};
      const data = await fetchAllRows((from, to) =>
        sb
          .from("domestic_invoices")
          .select("id, invoice_number, dispatch_id, total_amount, status")
          .in("dispatch_id", dispatchIds)
          .order("id", { ascending: true })
          .range(from, to));
      const map: Record<string, { number: string; total: number; status: string }> = {};
      data.forEach((inv: any) => {
        // one invoice per dispatch in practice; keep the latest by total if duplicated
        map[inv.dispatch_id] = { number: inv.invoice_number || "—", total: Number(inv.total_amount || 0), status: inv.status || "—" };
      });
      return map;
    },
    enabled: dispatchIds.length > 0,
  });

  // 5) Bridge to the Profit & Loss: revenue-account decomposition (same maths
  // as the P&L). GL gross sales less returns/discounts/adjustments = Net Sales.
  const { data: glAccounts } = useQuery({
    queryKey: ["sales-recon-gl-accounts"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_chart_of_accounts")
        .select("id, code, name, sub_category")
        .eq("account_type", "revenue")
        .eq("is_active", true)
        .not("sub_category", "is", null)
        .order("code");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: glLines } = useQuery({
    queryKey: ["sales-recon-gl-lines", fromDate, toDate],
    queryFn: () =>
      fetchAllRows((from, to) =>
        sb
          .from("accounting_voucher_lines")
          .select("account_id, debit_amount, credit_amount, voucher:accounting_vouchers!inner(voucher_date)")
          .gte("voucher.voucher_date", fromDate)
          .lte("voucher.voucher_date", toDate)
          .order("id", { ascending: true })
          .range(from, to)),
  });

  const glBridge = useMemo(() => {
    const totals: Record<string, number> = {};
    (glLines || []).forEach((l: any) => {
      totals[l.account_id] = (totals[l.account_id] || 0) + Number(l.credit_amount || 0) - Number(l.debit_amount || 0);
    });
    const accountRows = (glAccounts || [])
      .map((a: any) => ({ ...a, net: totals[a.id] || 0 }))
      .filter((r: any) => r.net !== 0);
    const netSales = accountRows.reduce((s: number, r: any) => s + r.net, 0);
    return { accountRows, netSales };
  }, [glAccounts, glLines]);

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
      const inv = invoices?.[d.id];
      const operationalAmount = totals.amount;
      const postedAmount = posted?.total || 0;
      const diff = postedAmount - operationalAmount; // GL − operational
      let status: "missing" | "ok" | "mismatch" | "zero" = "missing";
      if (operationalAmount === 0 && postedAmount === 0) status = "zero";
      else if (!posted || posted.vouchers.length === 0) status = "missing";
      else if (Math.abs(diff) < 0.01) status = "ok";
      else status = "mismatch";
      return {
        ...d,
        customers: Array.from(totals.customers).join(", "),
        orders: Array.from(totals.orders).join(", "),
        operationalAmount,
        postedAmount,
        invoiceNumber: inv?.number || "—",
        invoiceTotal: inv?.total ?? null,
        invoiceStatus: inv?.status || "—",
        diff,
        status,
        voucherNumbers: posted?.vouchers.map((v: any) => v.voucher_number).join(", ") || "",
      };
    });
  }, [dispatches, itemTotals, postedVouchers, invoices]);

  const totalOperational = rows.reduce((s: number, r: any) => s + r.operationalAmount, 0);
  const totalInvoiced = rows.reduce((s: number, r: any) => s + (r.invoiceTotal || 0), 0);
  const totalPosted = rows.reduce((s: number, r: any) => s + r.postedAmount, 0);
  const missingCount = rows.filter((r: any) => r.status === "missing").length;
  const mismatchCount = rows.filter((r: any) => r.status === "mismatch").length;
  const draftInvoices = rows.filter((r: any) => r.invoiceStatus === "draft").length;

  const renderStatus = (s: string) => {
    if (s === "ok") return <Badge variant="default" className="bg-green-600"><CheckCircle className="h-3 w-3 mr-1" />OK</Badge>;
    if (s === "missing") return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Missing</Badge>;
    if (s === "mismatch") return <Badge variant="outline" className="bg-amber-100 text-amber-800"><AlertTriangle className="h-3 w-3 mr-1" />Mismatch</Badge>;
    return <Badge variant="secondary">—</Badge>;
  };

  return (
    <ERPLayout>
      <PageHeader title="Sales Reconciliation" description="Operational (order-price) vs GL (posted) vs invoice — per dispatch, with totals">
        <div className="flex gap-2">
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-[160px]" />
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-[160px]" />
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-4">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Operational (order price)</div>
          <div className="text-xl font-semibold">Rs. {totalOperational.toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Invoiced (billed)</div>
          <div className="text-xl font-semibold">Rs. {totalInvoiced.toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">GL Posted (sales)</div>
          <div className="text-xl font-semibold text-primary">Rs. {totalPosted.toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Missing from GL</div>
          <div className={`text-xl font-semibold ${missingCount === 0 ? "text-green-600" : "text-red-600"}`}>{missingCount}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Draft Invoices</div>
          <div className={`text-xl font-semibold ${draftInvoices === 0 ? "text-green-600" : "text-amber-600"}`}>{draftInvoices}</div>
        </CardContent></Card>
      </div>

      {/* Bridge: GL gross sales → less returns/discounts → Net Sales = Profit & Loss */}
      {glBridge.accountRows.length > 0 && (
        <Card className="mb-4 border-primary/30">
          <CardContent className="p-4">
            <div className="text-sm font-semibold mb-2">Bridge to Profit &amp; Loss (per GL, {fromDate} → {toDate})</div>
            <div className="max-w-md space-y-1 text-sm">
              {glBridge.accountRows.map((r: any) => (
                <div key={r.id} className="flex justify-between">
                  <span className="text-muted-foreground">{r.code} · {r.name}</span>
                  <span className={r.net < 0 ? "text-amber-600" : ""}>Rs. {r.net.toLocaleString()}</span>
                </div>
              ))}
              <div className="flex justify-between border-t pt-1 font-semibold">
                <span>Net Sales (per GL) = Profit &amp; Loss</span>
                <span className="text-primary">Rs. {glBridge.netSales.toLocaleString()}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              The table below totals <span className="font-medium text-foreground">GL Posted (sales)</span> per dispatch;
              subtracting returns, discounts &amp; adjustments above gives the authoritative <span className="font-medium text-foreground">Net Sales</span> shown on the Profit &amp; Loss and Sales Report.
            </p>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground mb-3">
        <span className="font-medium text-foreground">Operational</span> = dispatch dozens × order price (sales estimate).{" "}
        <span className="font-medium text-foreground">GL Posted</span> = amount actually booked to the ledger (this is what the Profit &amp; Loss uses).{" "}
        Where they differ, the GL is authoritative — common causes are sales priced only on the invoice and invoice-vs-order price changes.
      </p>

      <div className="border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dispatch #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Customer(s)</TableHead>
              <TableHead>Invoice #</TableHead>
              <TableHead className="text-right">Operational</TableHead>
              <TableHead className="text-right">Invoiced</TableHead>
              <TableHead className="text-right">GL Posted</TableHead>
              <TableHead className="text-right">Diff (GL − Op)</TableHead>
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
                <TableCell className="text-xs">
                  <span className="font-mono">{r.invoiceNumber}</span>
                  {r.invoiceStatus === "draft" && <Badge variant="outline" className="ml-1 text-[10px] py-0 bg-amber-100 text-amber-800">draft</Badge>}
                </TableCell>
                <TableCell className="text-right text-xs">Rs. {r.operationalAmount.toLocaleString()}</TableCell>
                <TableCell className="text-right text-xs">{r.invoiceTotal != null ? `Rs. ${r.invoiceTotal.toLocaleString()}` : "—"}</TableCell>
                <TableCell className="text-right text-xs font-medium">Rs. {r.postedAmount.toLocaleString()}</TableCell>
                <TableCell className={`text-right text-xs font-medium ${Math.abs(r.diff) > 0.01 ? "text-amber-600" : ""}`}>{Math.abs(r.diff) > 0.01 ? `Rs. ${r.diff.toLocaleString()}` : "—"}</TableCell>
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
            {rows.length > 0 && (
              <TableRow className="bg-muted/40 font-semibold">
                <TableCell colSpan={4}>Total ({rows.length} dispatch{rows.length === 1 ? "" : "es"})</TableCell>
                <TableCell className="text-right">Rs. {totalOperational.toLocaleString()}</TableCell>
                <TableCell className="text-right">Rs. {totalInvoiced.toLocaleString()}</TableCell>
                <TableCell className="text-right text-primary">Rs. {totalPosted.toLocaleString()}</TableCell>
                <TableCell className="text-right">Rs. {(totalPosted - totalOperational).toLocaleString()}</TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </ERPLayout>
  );
}
