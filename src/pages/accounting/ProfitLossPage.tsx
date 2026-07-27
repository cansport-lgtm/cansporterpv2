import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/accounting/fetchAllRows";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { HiddenFigures } from "@/components/shared/HiddenFigures";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, TrendingUp, TrendingDown, DollarSign, Layers, AlertTriangle } from "lucide-react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import * as XLSX from "xlsx";

const sb = supabase as any;

export default function ProfitLossPage() {
  const [fromDate, setFromDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  // Default toDate = end of current month so period-end adjustments (typically dated month-end) are included
  const [toDate, setToDate] = useState(format(endOfMonth(new Date()), "yyyy-MM-dd"));

  const { data: accounts } = useQuery({
    queryKey: ["acc-pl-accounts"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_chart_of_accounts")
        .select("id, code, name, account_type, sub_category")
        .in("account_type", ["revenue", "expense"])
        .eq("is_active", true)
        .not("sub_category", "is", null)
        .order("account_type")
        .order("sort_order")
        .order("code");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: lines } = useQuery({
    queryKey: ["acc-pl-lines", fromDate, toDate],
    queryFn: async () => {
      const data = await fetchAllRows((from, to) =>
        sb
          .from("accounting_voucher_lines")
          .select("account_id, debit_amount, credit_amount, voucher:accounting_vouchers!inner(voucher_date)")
          .gte("voucher.voucher_date", fromDate)
          .lte("voucher.voucher_date", toDate)
          .order("id", { ascending: true })
          .range(from, to));
      return data;
    },
  });

  // Diagnostic: domestic dispatches in the period that have no COGS voucher.
  // This makes a silently-skipped COGS posting (e.g. zero standard_cost, or a
  // manually backfilled sale) visible instead of just showing a blank line.
  const { data: cogsDiag } = useQuery({
    queryKey: ["acc-pl-cogs-diag", fromDate, toDate],
    queryFn: async () => {
      const { data: disp, error: e1 } = await sb
        .from("sales_dispatches")
        .select("id, dispatch_number, dispatch_date, sales_segment")
        .gte("dispatch_date", fromDate)
        .lte("dispatch_date", toDate);
      if (e1) throw e1;
      const domestic = (disp || []).filter((d: any) => !d.sales_segment || d.sales_segment === "domestic");
      if (!domestic.length) return { missing: [] as any[] };
      const { data: vouchers, error: e2 } = await sb
        .from("accounting_vouchers")
        .select("source_reference_id")
        .eq("source_module", "domestic_sales_cogs");
      if (e2) throw e2;
      const posted = new Set((vouchers || []).map((v: any) => v.source_reference_id));
      const missing = domestic.filter((d: any) => !posted.has(d.id));
      return { missing };
    },
  });

  const computed = useMemo(() => {
    const totals: Record<string, { dr: number; cr: number }> = {};
    (lines || []).forEach((l: any) => {
      if (!totals[l.account_id]) totals[l.account_id] = { dr: 0, cr: 0 };
      totals[l.account_id].dr += Number(l.debit_amount || 0);
      totals[l.account_id].cr += Number(l.credit_amount || 0);
    });

    const revenueRows = (accounts || [])
      .filter((a: any) => a.account_type === "revenue")
      .map((a: any) => {
        const t = totals[a.id] || { dr: 0, cr: 0 };
        // Revenue normal: Cr - Dr (returns reduce revenue if account is 'Sales Returns' which is contra-revenue but we just net it)
        return { ...a, net: t.cr - t.dr };
      })
      .filter((r: any) => r.net !== 0);

    // COGS gets its own section and is ALWAYS shown (even at Rs 0) so a missing
    // cost-of-sale can never silently disappear from the statement.
    const cogsRows = (accounts || [])
      .filter((a: any) => a.account_type === "expense" && a.sub_category === "COGS")
      .map((a: any) => {
        const t = totals[a.id] || { dr: 0, cr: 0 };
        return { ...a, net: t.dr - t.cr };
      });

    // Operating (non-COGS) expenses — hidden when zero, as before.
    const opexRows = (accounts || [])
      .filter((a: any) => a.account_type === "expense" && a.sub_category !== "COGS")
      .map((a: any) => {
        const t = totals[a.id] || { dr: 0, cr: 0 };
        return { ...a, net: t.dr - t.cr };
      })
      .filter((r: any) => r.net !== 0);

    const totalRevenue = revenueRows.reduce((s: number, r: any) => s + r.net, 0);
    const totalCOGS = cogsRows.reduce((s: number, r: any) => s + r.net, 0);
    const grossProfit = totalRevenue - totalCOGS;
    const totalOpex = opexRows.reduce((s: number, r: any) => s + r.net, 0);
    const netIncome = grossProfit - totalOpex;

    // group operating expenses by sub-category for collapsible-style render
    const opexByGroup: Record<string, any[]> = {};
    opexRows.forEach((r: any) => {
      const key = r.sub_category || "Other";
      if (!opexByGroup[key]) opexByGroup[key] = [];
      opexByGroup[key].push(r);
    });

    return { revenueRows, cogsRows, opexRows, opexByGroup, totalRevenue, totalCOGS, grossProfit, totalOpex, netIncome };
  }, [accounts, lines]);

  const missingCogs = cogsDiag?.missing || [];
  // Warn when there's revenue but the cost side is empty — the classic symptom
  // of unset product standard_cost or an unposted COGS voucher.
  const cogsLooksMissing = computed.totalRevenue > 0 && computed.totalCOGS === 0;
  const showCogsWarning = cogsLooksMissing || missingCogs.length > 0;

  const handleExport = () => {
    const data: any[] = [];
    data.push({ Section: "REVENUE", Code: "", Account: "", Amount: "" });
    computed.revenueRows.forEach((r: any) => data.push({ Section: "", Code: r.code, Account: r.name, Amount: r.net }));
    data.push({ Section: "Total Revenue", Code: "", Account: "", Amount: computed.totalRevenue });
    data.push({ Section: "", Code: "", Account: "", Amount: "" });
    data.push({ Section: "COST OF GOODS SOLD", Code: "", Account: "", Amount: "" });
    computed.cogsRows.forEach((r: any) => data.push({ Section: "", Code: r.code, Account: r.name, Amount: r.net }));
    data.push({ Section: "Total COGS", Code: "", Account: "", Amount: computed.totalCOGS });
    data.push({ Section: "", Code: "", Account: "", Amount: "" });
    data.push({ Section: "GROSS PROFIT", Code: "", Account: "", Amount: computed.grossProfit });
    data.push({ Section: "", Code: "", Account: "", Amount: "" });
    data.push({ Section: "OPERATING EXPENSES", Code: "", Account: "", Amount: "" });
    computed.opexRows.forEach((r: any) => data.push({ Section: "", Code: r.code, Account: r.name, Amount: r.net }));
    data.push({ Section: "Total Operating Expenses", Code: "", Account: "", Amount: computed.totalOpex });
    data.push({ Section: "", Code: "", Account: "", Amount: "" });
    data.push({ Section: "NET INCOME", Code: "", Account: "", Amount: computed.netIncome });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Profit & Loss");
    XLSX.writeFile(wb, `Profit_Loss_${fromDate}_to_${toDate}.xlsx`);
  };

  return (
    <ERPLayout>
      <PageHeader title="Profit & Loss" description="Revenue minus cost of goods sold and expenses for the selected period">
        <div className="flex gap-2">
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-[160px]" />
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-[160px]" />
          <Button size="sm" variant="outline" onClick={handleExport}><Download className="h-4 w-4 mr-1" />Export</Button>
        </div>
      </PageHeader>

      <HiddenFigures>
      {showCogsWarning && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Cost of Goods Sold may be understated</AlertTitle>
          <AlertDescription>
            <div className="space-y-1">
              {cogsLooksMissing && (
                <p>
                  This period has <strong>Rs. {computed.totalRevenue.toLocaleString()}</strong> of revenue but
                  {" "}<strong>Rs. 0</strong> of COGS. Gross profit shown below equals revenue, which is almost
                  certainly wrong.
                </p>
              )}
              {missingCogs.length > 0 && (
                <p>
                  <strong>{missingCogs.length}</strong> domestic dispatch{missingCogs.length === 1 ? "" : "es"} in this
                  period {missingCogs.length === 1 ? "has" : "have"} no COGS voucher
                  {missingCogs.length <= 6 && (
                    <> ({missingCogs.map((d: any) => d.dispatch_number || d.id.slice(0, 8)).join(", ")})</>
                  )}.
                </p>
              )}
              <p className="text-xs">
                Common causes: products have no <code>standard_cost</code> set (perpetual COGS posts Rs. 0 and is
                skipped), or a sale was backfilled manually without its cost entry. Set product costs, then post the
                cost of sale from{" "}
                <Link to="/accounting/periodic-cogs" className="underline font-medium">Periodic COGS</Link>{" "}
                or re-trigger the dispatch posting. Account mappings can be checked at{" "}
                <Link to="/accounting/default-accounts" className="underline font-medium">Default Accounts</Link>.
              </p>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3" />Total Revenue</div>
          <div className="text-2xl font-semibold text-green-600">Rs. {computed.totalRevenue.toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Layers className="h-3 w-3" />Cost of Goods Sold</div>
          <div className="text-2xl font-semibold text-amber-600">Rs. {computed.totalCOGS.toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><DollarSign className="h-3 w-3" />Gross Profit</div>
          <div className={`text-2xl font-semibold ${computed.grossProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
            Rs. {Math.abs(computed.grossProfit).toLocaleString()}
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><TrendingDown className="h-3 w-3" />Net {computed.netIncome >= 0 ? "Profit" : "Loss"}</div>
          <div className={`text-2xl font-semibold ${computed.netIncome >= 0 ? "text-green-600" : "text-red-600"}`}>
            Rs. {Math.abs(computed.netIncome).toLocaleString()}
          </div>
        </CardContent></Card>
      </div>
      </HiddenFigures>

      <div className="space-y-4">
        {/* Revenue */}
        <div className="border rounded-lg">
          <div className="px-4 py-3 border-b bg-green-50 dark:bg-green-950/20 font-semibold text-sm">REVENUE</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Code</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right w-36">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!computed.revenueRows.length && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No revenue postings in this period</TableCell></TableRow>}
              {computed.revenueRows.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.code}</TableCell>
                  <TableCell className="text-sm">
                    <Link to={`/accounting/general-ledger?account=${r.id}`} className="text-primary hover:underline" title="Open ledger">
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right text-sm">Rs. {r.net.toLocaleString()}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/40 font-semibold">
                <TableCell colSpan={2}>Total Revenue</TableCell>
                <TableCell className="text-right">Rs. {computed.totalRevenue.toLocaleString()}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {/* Cost of Goods Sold — always rendered so a missing cost can't hide */}
        <div className="border rounded-lg">
          <div className="px-4 py-3 border-b bg-amber-50 dark:bg-amber-950/20 font-semibold text-sm">COST OF GOODS SOLD</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Code</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right w-36">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!computed.cogsRows.length && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No COGS accounts configured</TableCell></TableRow>}
              {computed.cogsRows.map((r: any) => (
                <TableRow key={r.id} className={r.net === 0 ? "text-muted-foreground" : ""}>
                  <TableCell className="font-mono text-xs">{r.code}</TableCell>
                  <TableCell className="text-sm">
                    <Link to={`/accounting/general-ledger?account=${r.id}`} className="text-primary hover:underline" title="Open ledger">
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right text-sm">Rs. {r.net.toLocaleString()}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/40 font-semibold">
                <TableCell colSpan={2}>Total COGS</TableCell>
                <TableCell className="text-right">Rs. {computed.totalCOGS.toLocaleString()}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {/* Gross Profit */}
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div className="text-base font-semibold">Gross Profit (Revenue − COGS)</div>
            <div className={`text-xl font-bold ${computed.grossProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
              Rs. {Math.abs(computed.grossProfit).toLocaleString()}
            </div>
          </CardContent>
        </Card>

        {/* Operating Expenses */}
        <div className="border rounded-lg">
          <div className="px-4 py-3 border-b bg-red-50 dark:bg-red-950/20 font-semibold text-sm">OPERATING EXPENSES</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Code</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right w-36">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!computed.opexRows.length && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No operating expense postings in this period</TableCell></TableRow>}
              {Object.entries(computed.opexByGroup).map(([group, rows]) => (
                <>
                  <TableRow key={`g-${group}`} className="bg-muted/20">
                    <TableCell colSpan={3} className="text-xs font-medium text-muted-foreground">{group}</TableCell>
                  </TableRow>
                  {(rows as any[]).map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.code}</TableCell>
                      <TableCell className="text-sm">
                    <Link to={`/accounting/general-ledger?account=${r.id}`} className="text-primary hover:underline" title="Open ledger">
                      {r.name}
                    </Link>
                  </TableCell>
                      <TableCell className="text-right text-sm">Rs. {r.net.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </>
              ))}
              <TableRow className="bg-muted/40 font-semibold">
                <TableCell colSpan={2}>Total Operating Expenses</TableCell>
                <TableCell className="text-right">Rs. {computed.totalOpex.toLocaleString()}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      <Card className="mt-4">
        <CardContent className="p-4 flex items-center justify-between">
          <div className="text-lg font-semibold">Net {computed.netIncome >= 0 ? "Profit" : "Loss"} for the Period</div>
          <div className={`text-2xl font-bold ${computed.netIncome >= 0 ? "text-green-600" : "text-red-600"}`}>
            Rs. {Math.abs(computed.netIncome).toLocaleString()}
          </div>
        </CardContent>
      </Card>
    </ERPLayout>
  );
}
