import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { Calculator, CheckCircle, AlertTriangle, RefreshCw } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useAppSetting } from "@/hooks/useAppSetting";
import { previewProductionConsumption, postProductionConsumption } from "@/lib/accounting/postProductionConsumption";

export default function ProductionCostRecognitionPage() {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));

  const { data: preview, isFetching, refetch } = useQuery({
    queryKey: ["acc-prod-cost-preview", date],
    queryFn: () => previewProductionConsumption(date),
  });

  const postMutation = useMutation({
    mutationFn: () => postProductionConsumption(date),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["acc-prod-cost-preview"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-vouchers"] });
      if (result.skipped === "flag_off") {
        toast({ title: "Auto-post flag is OFF", description: "Enable it from Accounting Settings (super-admin).", variant: "destructive" });
      } else if (result.skipped === "already_posted") {
        toast({ title: "Already posted", description: `Existing voucher: ${result.voucherNumber}` });
      } else if (result.skipped === "nothing_to_post") {
        toast({ title: "Nothing to post", description: "No consumption recorded for this date." });
      } else if (result.ok) {
        toast({ title: "Production cost posted", description: `${result.voucherNumber} — Rs. ${result.totalAmount?.toLocaleString()}` });
      } else {
        toast({ title: "Post failed", description: result.error, variant: "destructive" });
      }
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const totalAmount = preview?.totalAmount || 0;
  const rowCount = preview?.rows.length || 0;
  const zeroCostRows = (preview?.rows || []).filter((r) => r.cost_value === 0).length;
  const { value: flagEnabled } = useAppSetting<boolean>("accounting_autopost_enabled", true);

  return (
    <ERPLayout>
      <PageHeader title="Production Cost Recognition" description="Post daily raw-material consumption as a batched journal voucher">
        <div className="flex gap-2 items-center">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-[170px]" />
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />Refresh
          </Button>
          <Button size="sm" onClick={() => postMutation.mutate()} disabled={!flagEnabled || preview?.alreadyPosted || rowCount === 0 || postMutation.isPending}>
            <Calculator className="h-4 w-4 mr-1" />
            {postMutation.isPending ? "Posting..." : preview?.alreadyPosted ? "Already Posted" : "Post Consumption JV"}
          </Button>
        </div>
      </PageHeader>

      <div className="grid grid-cols-4 gap-4 mb-4">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Materials Consumed</div>
          <div className="text-2xl font-semibold">{rowCount}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Total Cost (PKR)</div>
          <div className="text-2xl font-semibold">Rs. {totalAmount.toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Items with Zero Cost</div>
          <div className={`text-2xl font-semibold ${zeroCostRows === 0 ? "text-green-600" : "text-amber-600"}`}>{zeroCostRows}</div>
          {zeroCostRows > 0 && <div className="text-[10px] text-amber-600 mt-1">Set cost_value in Raw Materials</div>}
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Posting Status</div>
          <div className="text-sm font-semibold mt-1">
            {preview?.alreadyPosted
              ? <Badge variant="default" className="bg-green-600"><CheckCircle className="h-3 w-3 mr-1" />Posted ({preview.existingVoucherNumber})</Badge>
              : !flagEnabled
                ? <Badge variant="secondary"><AlertTriangle className="h-3 w-3 mr-1" />Flag OFF</Badge>
                : rowCount === 0
                  ? <Badge variant="secondary">No data</Badge>
                  : <Badge variant="outline" className="bg-amber-100 text-amber-800">Ready to post</Badge>}
          </div>
        </CardContent></Card>
      </div>

      <div className="border rounded-lg mb-4">
        <div className="px-4 py-3 border-b bg-muted/40 flex items-center justify-between">
          <div className="font-semibold text-sm">Posting Preview — {format(parseISO(date), "dd MMM yyyy")}</div>
          <div className="text-xs text-muted-foreground">
            Dr Raw Material Consumed (5101) Rs. {totalAmount.toLocaleString()} → Cr Inventory Raw Material (1130) Rs. {totalAmount.toLocaleString()}
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Material Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Qty Consumed</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">Standard Cost / Unit</TableHead>
              <TableHead className="text-right">Amount (PKR)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isFetching && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>}
            {!isFetching && !rowCount && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No consumption recorded on {date}</TableCell></TableRow>}
            {preview?.rows.map((r) => (
              <TableRow key={r.raw_material_id} className={r.cost_value === 0 ? "bg-amber-50 dark:bg-amber-950/20" : ""}>
                <TableCell className="font-mono text-xs">{r.code}</TableCell>
                <TableCell className="text-sm">{r.name}</TableCell>
                <TableCell className="text-right text-xs">{r.quantity.toLocaleString()}</TableCell>
                <TableCell className="text-xs">{r.unit}</TableCell>
                <TableCell className="text-right text-xs">
                  {r.cost_value === 0
                    ? <span className="text-amber-600">⚠ Rs. 0</span>
                    : `Rs. ${r.cost_value.toLocaleString(undefined, { maximumFractionDigits: 4 })}`}
                </TableCell>
                <TableCell className="text-right text-xs font-medium">Rs. {r.amount.toLocaleString()}</TableCell>
              </TableRow>
            ))}
            {rowCount > 0 && (
              <TableRow className="bg-muted/40 font-semibold">
                <TableCell colSpan={5}>Total</TableCell>
                <TableCell className="text-right">Rs. {totalAmount.toLocaleString()}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="text-xs text-muted-foreground space-y-1">
        <div>• <strong>Idempotency</strong>: only one voucher per date can be posted. Reposting is blocked once a voucher exists for {date}.</div>
        <div>• <strong>Cost source</strong>: each raw material's <code>cost_value</code> field. Items showing Rs. 0 will post zero — set cost in the Raw Materials master before posting.</div>
        <div>• <strong>Kill switch</strong>: posting is blocked when the accounting auto-post flag is OFF (toggle from Accounting Settings — super-admin).</div>
      </div>
    </ERPLayout>
  );
}
