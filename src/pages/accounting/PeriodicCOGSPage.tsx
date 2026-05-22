import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Calculator, AlertTriangle, CheckCircle } from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { previewPeriodicCOGS, postPeriodicCOGS } from "@/lib/accounting/postPeriodicCOGS";

export default function PeriodicCOGSPage() {
  const queryClient = useQueryClient();
  const [fromDate, setFromDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(endOfMonth(new Date()), "yyyy-MM-dd"));
  const [note, setNote] = useState("");

  const { data: preview, isFetching } = useQuery({
    queryKey: ["periodic-cogs-preview-v2", fromDate, toDate],
    queryFn: () => previewPeriodicCOGS(fromDate, toDate),
  });

  const postMutation = useMutation({
    mutationFn: () => postPeriodicCOGS(fromDate, toDate, note || undefined),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["periodic-cogs-preview-v2"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-vouchers"] });
      if (result.skipped === "flag_off") {
        toast({ title: "Flag is OFF", variant: "destructive" });
      } else if (result.skipped === "already_posted") {
        toast({ title: "Already posted", description: result.voucherNumber });
      } else if (result.skipped === "zero_variance") {
        toast({ title: "Zero variance — no adjustment needed" });
      } else if (result.ok) {
        toast({ title: `Periodic COGS posted: ${result.voucherNumber}`, description: `Variance Rs. ${result.variance?.toLocaleString()}` });
        setNote("");
      } else {
        toast({ title: "Post failed", description: result.error, variant: "destructive" });
      }
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Auto-post flag is default-ON since PR #10 — opt out by setting VITE_ENABLE_ACC_AUTOPOST="false".
  const flagEnabled = import.meta.env.VITE_ENABLE_ACC_AUTOPOST !== "false";
  const p = preview;
  const variance = p?.variance ?? 0;
  const cogs = p?.calculatedCOGS ?? 0;

  return (
    <ERPLayout>
      <PageHeader title="Periodic COGS (Stock-Based)" description="COGS = (Previous Closing + RM Purchases) − Current Closing">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Auto-post flag:</span>
          {flagEnabled
            ? <Badge variant="default" className="bg-green-600"><CheckCircle className="h-3 w-3 mr-1" />ENABLED</Badge>
            : <Badge variant="secondary"><AlertTriangle className="h-3 w-3 mr-1" />DISABLED</Badge>}
        </div>
      </PageHeader>

      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>From Date (period start)</Label>
              <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">"Previous closing" = latest close BEFORE this date</p>
            </div>
            <div>
              <Label>To Date (period end)</Label>
              <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">"Current closing" = latest close IN [from, to]</p>
            </div>
            <div className="flex items-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setFromDate(format(startOfMonth(new Date()), "yyyy-MM-dd")); setToDate(format(endOfMonth(new Date()), "yyyy-MM-dd")); }}>This Month</Button>
              <Button variant="outline" size="sm" onClick={() => { const d = subMonths(new Date(), 1); setFromDate(format(startOfMonth(d), "yyyy-MM-dd")); setToDate(format(endOfMonth(d), "yyyy-MM-dd")); }}>Last Month</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {isFetching && <div className="text-center text-muted-foreground py-8">Loading stock valuations…</div>}

      {p && !isFetching && (
        <>
          <Card className="mb-4">
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Calculator className="h-4 w-4" />Periodic COGS Calculation</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead></TableHead>
                    <TableHead className="text-right">Raw Material<br /><span className="text-[10px] font-normal text-muted-foreground">consumption_stock_closing × cost_value</span></TableHead>
                    <TableHead className="text-right">FG + WIP<br /><span className="text-[10px] font-normal text-muted-foreground">daily_stock_closing × costing_value</span></TableHead>
                    <TableHead className="text-right">Total Inventory</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">
                      Previous Closing
                      <div className="text-[10px] text-muted-foreground">before {fromDate}</div>
                    </TableCell>
                    <TableCell className="text-right">Rs. {p.previousRMValue.toLocaleString()}<div className="text-[10px] text-muted-foreground">{p.itemCounts.previousRM} items</div></TableCell>
                    <TableCell className="text-right">Rs. {p.previousFGWIPValue.toLocaleString()}<div className="text-[10px] text-muted-foreground">{p.itemCounts.previousFGWIP} items</div></TableCell>
                    <TableCell className="text-right font-semibold">Rs. {p.previousTotalInventory.toLocaleString()}</TableCell>
                  </TableRow>
                  <TableRow className="bg-green-50 dark:bg-green-950/20">
                    <TableCell className="font-medium">
                      + Net RM Purchases (this period)
                      <div className="text-[10px] text-muted-foreground">All Dr − Cr on RM Inv, excluding consumption/output/periodic. Includes GRNs minus purchase returns and adjustments.</div>
                    </TableCell>
                    <TableCell className="text-right text-green-700 dark:text-green-400">+ Rs. {p.rmPurchasesValue.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-muted-foreground">—</TableCell>
                    <TableCell className="text-right font-semibold text-green-700 dark:text-green-400">+ Rs. {p.rmPurchasesValue.toLocaleString()}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">
                      − Current Closing
                      <div className="text-[10px] text-muted-foreground">in {fromDate} … {toDate}</div>
                    </TableCell>
                    <TableCell className="text-right">Rs. {p.currentRMValue.toLocaleString()}<div className="text-[10px] text-muted-foreground">{p.itemCounts.currentRM} items</div></TableCell>
                    <TableCell className="text-right">Rs. {p.currentFGWIPValue.toLocaleString()}<div className="text-[10px] text-muted-foreground">{p.itemCounts.currentFGWIP} items</div></TableCell>
                    <TableCell className="text-right font-semibold">− Rs. {p.currentTotalInventory.toLocaleString()}</TableCell>
                  </TableRow>
                  <TableRow className="bg-muted/40 border-t-2">
                    <TableCell className="font-bold">COGS = (Previous + Purchases) − Current</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground"></TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground"></TableCell>
                    <TableCell className={`text-right font-bold text-lg ${cogs >= 0 ? "text-primary" : "text-amber-600"}`}>Rs. {cogs.toLocaleString()}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-sm">Reference: Reconciliation to GL</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span>Periodic COGS (calculated above)</span><strong>Rs. {cogs.toLocaleString()}</strong></div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Already posted COGS in this period</span>
                  <span>Rs. {p.alreadyPostedCOGS.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground italic pl-3">
                  <span>(per-dispatch COGS + prior periodic adjustments)</span>
                </div>
                <div className={`flex justify-between border-t pt-2 font-bold ${Math.abs(variance) < 0.01 ? "text-muted-foreground" : variance > 0 ? "text-amber-600" : "text-blue-600"}`}>
                  <span>Variance to post</span>
                  <span>Rs. {variance.toLocaleString()}</span>
                </div>
                <div className="text-xs text-muted-foreground italic">
                  {Math.abs(variance) < 0.01 ? "GL already matches periodic value" :
                   variance > 0 ? "GL under-recognized — need to ADD this much COGS" :
                   "GL over-recognized — need to REVERSE this much COGS"}
                </div>
                <div className="text-xs text-muted-foreground mt-3 pt-3 border-t">
                  Informational: production_output JVs in this period sum to Rs. {p.productionAdditions.toLocaleString()} — not used in this formula but useful as a sanity check vs production flow.
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-sm">Post Adjustment</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="border rounded-md p-3 bg-muted/30 text-xs space-y-1">
                  <div className="font-semibold mb-1">Posting Preview</div>
                  {Math.abs(variance) < 0.01 ? (
                    <div className="text-muted-foreground">No adjustment needed — calculated COGS already matches GL.</div>
                  ) : variance > 0 ? (
                    <>
                      <div className="flex justify-between"><span>Dr Cost of Goods Sold (5100)</span><span className="font-medium">Rs. {variance.toLocaleString()}</span></div>
                      <div className="flex justify-between"><span>Cr FG Inventory + RM Inventory</span><span className="font-medium">Rs. {variance.toLocaleString()}</span></div>
                      <div className="text-[10px] text-muted-foreground italic pl-3">(credit split between FG and RM proportional to how each dropped)</div>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between"><span>Dr FG Inventory + RM Inventory</span><span className="font-medium">Rs. {(-variance).toLocaleString()}</span></div>
                      <div className="flex justify-between"><span>Cr Cost of Goods Sold (5100)</span><span className="font-medium">Rs. {(-variance).toLocaleString()}</span></div>
                    </>
                  )}
                </div>

                <div>
                  <Label>Note (optional)</Label>
                  <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. May 2026 month-end stock-take" />
                </div>

                {p.unpricedCount > 0 && (
                  <div className="text-xs text-amber-600 flex items-start gap-1 border border-amber-200 bg-amber-50 dark:bg-amber-950/20 rounded p-2">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>{p.unpricedCount} items have stock but no costing value. Set <code>planning_items.costing_value</code> (FG/WIP) or <code>consumption_raw_materials.cost_value</code> (RM) to make this accurate.</span>
                  </div>
                )}

                {p.alreadyPosted && (
                  <div className="text-xs text-amber-600 flex items-start gap-1 border border-amber-200 bg-amber-50 dark:bg-amber-950/20 rounded p-2">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>A periodic COGS voucher ({p.existingVoucherNumber}) already exists for this range. Posting blocked to prevent duplicates.</span>
                  </div>
                )}

                <Button className="w-full" disabled={!flagEnabled || p.alreadyPosted || Math.abs(variance) < 0.01 || postMutation.isPending} onClick={() => postMutation.mutate()}>
                  {postMutation.isPending ? "Posting..." : "Post Periodic COGS Adjustment"}
                </Button>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </ERPLayout>
  );
}
